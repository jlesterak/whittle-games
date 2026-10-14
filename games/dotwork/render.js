// Dotwork renderer: a pan/zoom camera over the arrow grid and every animation (ref 2.2,
// 2.3, 4.3, 5.3, 5.4). Board coordinates are in cells; cell (x, y) has its centre at
// (x + .5, y + .5). Screen (CSS px) = o + board * pitch. Arrows are drawn as a window of
// length (cells - 1) sliding along "path + straight ray", so the snake motion is one number s.

import { DIRS, rayCells } from './board.js';
import { ARROW, PAL } from './colors.js';

const ACC = 95; // cells/s^2 (ref 2.2: v = 13 + 95 t, capped)
const V0 = 13;
const VMAX = 60;
const BACK = 0.15; // bump retract, s
const FLASH = 0.6; // blocker fades white -> colour
const RUB = 0.8; // eraser rub-out
const WAVE = 1.7; // win dot wave

const easeOut = (k) => 1 - (1 - k) * (1 - k);
const lerp = (a, b, k) => a + (b - a) * k;
const HEX = new Map();
const hex = (h) => HEX.get(h) || (HEX.set(h, [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))), HEX.get(h));
const mix = (a, b, k) => {
  const A = hex(a);
  const B = hex(b);
  return `rgb(${A.map((v, i) => Math.round(lerp(v, B[i], k))).join(',')})`;
};
// distance travelled after t seconds of constant acceleration, capped at VMAX
function travel(t) {
  const tc = (VMAX - V0) / ACC;
  if (t <= tc) return V0 * t + 0.5 * ACC * t * t;
  return V0 * tc + 0.5 * ACC * tc * tc + VMAX * (t - tc);
}
const timeTo = (d) => (-V0 + Math.sqrt(V0 * V0 + 2 * ACC * d)) / ACC;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.opts = { reducedMotion: false };
    this.pitch = 10;
    this.ox = 0;
    this.oy = 0;
    this.camAnim = null;
    this.dirty = true;
  }

  setOptions(o) {
    this.opts = { ...this.opts, ...o };
    this.dirty = true;
  }

  // view: the play rect (CSS px) the board fits into, between the HUD and the boosters
  resize(cssW, cssH, dpr, view) {
    this.cssW = cssW;
    this.cssH = cssH;
    this.dpr = dpr;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    const first = !this.view;
    this.view = view;
    if (this.level) {
      if (first || this.pitch <= this.fitPitch * 1.001) this.fit(false);
      else this.clamp();
    }
    this.dirty = true;
  }

  setLevel(level, board) {
    this.level = level;
    this.board = board;
    const n = level.W * level.H;
    this.vacAt = new Float64Array(n).fill(-1); // when a cell was vacated (dots)
    this.vacCol = new Int8Array(n);
    this.everOcc = new Uint8Array(n);
    for (const a of level.arrows) for (const c of a.cells) this.everOcc[c] = 1;
    for (let c = 0; c < n; c++) if (this.everOcc[c] && board.occ[c] === -1) this.vacAt[c] = -10; // resumed: settled grey
    this.ver = (this.ver || 0) + 1; // still-picture version for the cached layer
    this.nextSettle = Infinity;
    this.flights = new Map(); // id -> { kind, t0, ... }
    this.flash = new Map(); // blocker id -> t0
    this.badges = [];
    this.rubs = [];
    this.sparks = [];
    this.wand = null;
    this.hint = -1;
    this.guides = false;
    this.wave = null;
    this.fit(false);
    this.dirty = true;
  }

  // ---- camera ----
  get fitPitch() {
    const { W, H } = this.level;
    return Math.min(this.view.w / W, this.view.h / H);
  }
  get maxPitch() {
    return Math.max(this.fitPitch * 2.5, 44);
  }
  fitTarget() {
    const p = this.fitPitch;
    return { pitch: p, ox: this.view.x + (this.view.w - this.level.W * p) / 2, oy: this.view.y + (this.view.h - this.level.H * p) / 2 };
  }
  fit(animate = true, now = performance.now() / 1000) {
    this.camTo(this.fitTarget(), animate, now);
  }
  camTo(to, animate, now) {
    if (animate && !this.opts.reducedMotion) this.camAnim = { from: { pitch: this.pitch, ox: this.ox, oy: this.oy }, to, t0: now, dur: 0.45 };
    else {
      this.camAnim = null;
      Object.assign(this, to);
    }
    this.dirty = true;
  }
  isFit() {
    return this.pitch <= this.fitPitch * 1.02;
  }
  // zoom to pitch p keeping screen point (sx, sy) over the same board point
  zoomAt(sx, sy, p) {
    this.camAnim = null;
    const np = Math.max(this.fitPitch, Math.min(this.maxPitch, p));
    const bx = (sx - this.ox) / this.pitch;
    const by = (sy - this.oy) / this.pitch;
    this.pitch = np;
    this.ox = sx - bx * np;
    this.oy = sy - by * np;
    this.clamp();
  }
  zoomToggle(sx, sy, now) {
    if (this.isFit()) {
      const p = Math.min(this.maxPitch, this.fitPitch * 2);
      const bx = (sx - this.ox) / this.pitch;
      const by = (sy - this.oy) / this.pitch;
      const to = this.clamped({ pitch: p, ox: sx - bx * p, oy: sy - by * p });
      this.camTo(to, true, now);
    } else this.fit(true, now);
  }
  panBy(dx, dy) {
    this.camAnim = null;
    this.ox += dx;
    this.oy += dy;
    this.clamp();
  }
  // at least a quarter of the board stays on screen (ref 4.1)
  clamped(c) {
    const bw = this.level.W * c.pitch;
    const bh = this.level.H * c.pitch;
    const out = { ...c };
    out.ox = Math.min(this.cssW - bw * 0.25, Math.max(-bw * 0.75, c.ox));
    out.oy = Math.min(this.cssH - bh * 0.25, Math.max(-bh * 0.75, c.oy));
    return out;
  }
  clamp() {
    Object.assign(this, this.clamped({ pitch: this.pitch, ox: this.ox, oy: this.oy }));
    this.dirty = true;
  }
  toBoard(sx, sy) {
    return [(sx - this.ox) / this.pitch, (sy - this.oy) / this.pitch];
  }
  toScreen(bx, by) {
    return [this.ox + bx * this.pitch, this.oy + by * this.pitch];
  }
  cellXY(c) {
    const W = this.level.W;
    return this.toScreen((c % W) + 0.5, Math.floor(c / W) + 0.5);
  }

  // Nearest arrow to a screen point, within half a cell or 14 CSS px (ref unknown 15).
  hit(sx, sy) {
    const { W, H } = this.level;
    const b = this.board;
    const [bx, by] = this.toBoard(sx, sy);
    const lim = Math.max(0.55, 14 / this.pitch);
    const R = Math.ceil(lim) + 1;
    const cx = Math.floor(bx);
    const cy = Math.floor(by);
    let best = -1;
    let bd = lim;
    for (let y = cy - R; y <= cy + R; y++) {
      for (let x = cx - R; x <= cx + R; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const id = b.occ[y * W + x];
        if (id < 0) continue;
        const cells = this.level.arrows[id].cells;
        const i = cells.indexOf(y * W + x);
        for (const j of [i - 1, i + 1]) {
          const o = cells[j === cells.length ? i : Math.max(0, j)];
          const d = segDist(bx, by, x + 0.5, y + 0.5, (o % W) + 0.5, Math.floor(o / W) + 0.5);
          if (d < bd) {
            bd = d;
            best = id;
          }
        }
      }
    }
    return best;
  }

  // ---- events from the game ----
  escape(id, now) {
    this.ver++;
    const a = this.level.arrows[id];
    this.flights.set(id, { kind: 'escape', t0: now });
    a.cells.forEach((c, i) => {
      this.vacAt[c] = now + (a.cells.length - 1 - i) * 0.02;
      this.vacCol[c] = a.color;
    });
    if (this.hint === id) this.hint = -1;
    this.guides = false;
    this.dirty = true;
  }
  bump(id, bl, now) {
    this.ver++;
    const contact = Math.max(0.25, bl.dist - 1);
    const tOut = timeTo(contact);
    this.flights.set(id, { kind: 'bump', t0: now, contact, tOut });
    const W = this.level.W;
    this.flashAt = now + tOut;
    this.flash.set(bl.id, now + tOut);
    this.badges.push({ x: (bl.cell % W) + 0.5, y: Math.floor(bl.cell / W) + 0.5, t0: now + tOut });
    this.guides = false;
    if (this.hint === id) this.hint = -1;
    this.dirty = true;
    return tOut;
  }
  erase(id, now) {
    this.ver++;
    const a = this.level.arrows[id];
    this.rubs.push({ id, t0: now });
    a.cells.forEach((c, i) => {
      this.vacAt[c] = now + (i / a.cells.length) * RUB;
      this.vacCol[c] = a.color;
    });
    if (this.hint === id) this.hint = -1;
    this.dirty = true;
  }
  // wand: golden sparks from (sx, sy) on screen to each target, landing after dur
  sparkTo(ids, sx, sy, now, dur) {
    this.wand = { ids: new Set(ids), t0: now, dur };
    for (const id of ids) this.sparks.push({ id, sx, sy, t0: now + Math.random() * 0.3, dur: dur - 0.3 });
    this.dirty = true;
  }
  startWave(now) {
    this.wave = { t0: now };
    this.dirty = true;
  }
  busy() {
    return this.flights.size > 0 || this.rubs.length > 0 || !!this.camAnim;
  }

  // ---- drawing ----
  // Arrows at rest, settled dots and rays live in a cached layer, rebuilt only when the camera
  // or the board's still picture changes; each frame blits it and draws what moves on top.
  frame(now) {
    const animating = this.busy() || this.flash.size || this.badges.length || this.sparks.length || this.wave || this.recentVac(now);
    if (!this.dirty && !animating) return;
    this.dirty = false;
    if (this.camAnim) {
      const { from, to, t0, dur } = this.camAnim;
      const k = Math.min(1, (now - t0) / dur);
      const e = easeOut(k);
      this.pitch = lerp(from.pitch, to.pitch, e);
      this.ox = lerp(from.ox, to.ox, e);
      this.oy = lerp(from.oy, to.oy, e);
      if (k >= 1) this.camAnim = null;
    }
    const key = [this.pitch, this.ox, this.oy, this.ver, this.hint, this.guides, !!this.wand, this.canvas.width, this.canvas.height].join();
    if (key !== this.layerKey || now >= this.nextSettle) {
      this.layerKey = key;
      this.buildLayer(now);
    }
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.layer, 0, 0);
    this.boardSpace(g);
    this.drawDots(now, true);
    this.drawArrows(now, true);
    this.drawRubs(now);
    this.drawSparks(now);
    this.drawBadges(now);
  }

  boardSpace(g) {
    g.setTransform(this.dpr * this.pitch, 0, 0, this.dpr * this.pitch, this.dpr * this.ox, this.dpr * this.oy);
    g.lineCap = 'round';
    g.lineJoin = 'round';
  }

  buildLayer(now) {
    if (!this.layer) this.layer = document.createElement('canvas');
    const L = this.layer;
    if (L.width !== this.canvas.width || L.height !== this.canvas.height) {
      L.width = this.canvas.width;
      L.height = this.canvas.height;
      this.lg = L.getContext('2d');
    }
    const main = this.g;
    const g = (this.g = this.lg); // the draw helpers paint on this.g
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = PAL.bg;
    g.fillRect(0, 0, this.cssW, this.cssH);
    this.boardSpace(g);
    this.drawDots(now, false);
    if (this.guides) this.drawRays([...this.level.arrows.keys()].filter((id) => !this.board.gone[id]), PAL.ray);
    if (this.hint >= 0 && !this.board.gone[this.hint]) this.drawRays([this.hint], '#8a92a8');
    this.drawArrows(now, false);
    this.g = main;
  }

  isLive(id) {
    return this.flights.has(id) || this.flash.has(id) || !!this.wand?.ids.has(id);
  }

  recentVac(now) {
    return this.lastVac > now - 1.2;
  }

  // live = false: settled grey dots (cached layer); live = true: freshly tinted dots and the win wave
  drawDots(now, live) {
    const g = this.g;
    const { W } = this.level;
    const r = 0.085;
    let latest = -1;
    const wave = live && this.wave && !this.opts.reducedMotion ? (now - this.wave.t0) / WAVE : -1;
    if (wave > 1) this.wave = null;
    if (!live) this.nextSettle = Infinity;
    const settled = new Path2D(); // every grey dot in one fill
    const dot = (path, x, y, rr) => {
      path.moveTo(x + rr, y);
      path.arc(x, y, rr, 0, Math.PI * 2);
    };
    for (let c = 0; c < this.vacAt.length; c++) {
      const t = this.vacAt[c];
      if (t === -1) continue;
      const fresh = t >= 0 && now - t < 1;
      if (fresh) this.nextSettle = Math.min(this.nextSettle, t + 1);
      if (t >= 0) latest = Math.max(latest, t);
      if (t > now) continue;
      const x = (c % W) + 0.5;
      const y = Math.floor(c / W) + 0.5;
      if (!live) {
        if (!fresh) dot(settled, x, y, r);
        continue;
      }
      let w = 0;
      if (wave >= 0) {
        // a bright ring sweeping out from the centre (ref 3, win)
        const d = Math.hypot(x / this.level.W - 0.5, y / this.level.H - 0.5) / 0.71;
        w = Math.max(0, 1 - Math.abs(wave * 1.4 - d) * 5);
      }
      if (!fresh && w === 0) continue;
      g.fillStyle = w > 0 ? mix(PAL.dot, PAL.wave, w) : mix(ARROW[this.vacCol[c]], PAL.dot, now - t);
      g.beginPath();
      dot(g, x, y, r * (1 + w));
      g.fill();
    }
    if (!live) {
      g.fillStyle = PAL.dot;
      g.fill(settled);
    }
    if (live) this.lastVac = latest;
  }

  drawRays(ids, colour) {
    const g = this.g;
    const { W, H } = this.level;
    g.strokeStyle = colour;
    g.lineWidth = Math.max(0.06, 1.3 / this.pitch);
    g.beginPath();
    for (const id of ids) {
      const a = this.level.arrows[id];
      const h = a.cells[a.cells.length - 1];
      const [dx, dy] = DIRS[this.board.dirs[id]];
      const n = rayCells(W, H, a.cells, this.board.dirs[id]).length;
      const x = (h % W) + 0.5;
      const y = Math.floor(h / W) + 0.5;
      g.moveTo(x + dx * 0.5, y + dy * 0.5);
      g.lineTo(x + dx * (n + 0.5), y + dy * (n + 0.5));
    }
    g.stroke();
  }

  arrowColour(id, now) {
    const b = this.board;
    if (this.wand?.ids.has(id) && now > this.wand.t0 + 0.3) return '#ffd84a';
    if (id === this.hint) return PAL.hint;
    if (b.failed[id]) return PAL.white;
    const base = ARROW[this.level.arrows[id].color];
    const f = this.flash.get(id);
    if (f !== undefined && now >= f) {
      const k = (now - f) / FLASH;
      if (k >= 1) {
        this.flash.delete(id);
        this.ver++;
        return base;
      }
      return k < 0.4 ? mix(PAL.white, PAL.cream, k / 0.4) : mix(PAL.cream, base, (k - 0.4) / 0.6);
    }
    return base;
  }

  drawArrows(now, live) {
    const b = this.board;
    const byColour = new Map(); // colour -> [[id, s]]
    for (let id = 0; id < this.level.arrows.length; id++) {
      const fl = this.flights.get(id);
      if (!fl && b.gone[id]) continue;
      if (this.isLive(id) !== live) continue;
      let s = 0;
      let colour = this.arrowColour(id, now);
      if (fl) {
        const t = now - fl.t0;
        if (fl.kind === 'escape') {
          s = travel(t);
          colour = ARROW[this.level.arrows[id].color];
          if (this.offscreen(id, s)) {
            this.flights.delete(id);
            this.ver++;
            continue;
          }
        } else {
          colour = PAL.white;
          if (t < fl.tOut) s = Math.min(fl.contact, travel(t));
          else if (t < fl.tOut + BACK) s = fl.contact * (1 - easeOut((t - fl.tOut) / BACK));
          else {
            this.flights.delete(id);
            this.ver++;
          }
        }
      }
      if (!byColour.has(colour)) byColour.set(colour, []);
      byColour.get(colour).push([id, s]);
    }
    for (const [colour, list] of byColour) this.strokeArrows(list, colour);
  }

  // escape is done once the tail is on the straight ray and outside the canvas
  offscreen(id, s) {
    const a = this.level.arrows[id];
    const n = a.cells.length;
    if (s < n - 1) return false;
    const [tx, ty] = this.toScreen(...this.pointAt(id, s));
    const [dx, dy] = DIRS[this.board.dirs[id]];
    const m = this.pitch;
    return (dx > 0 && tx > this.cssW + m) || (dx < 0 && tx < -m) || (dy > 0 && ty > this.cssH + m) || (dy < 0 && ty < -m) || s > n + 400;
  }

  // a point at distance d along "path + ray" from the tail, in board units
  pointAt(id, d) {
    const a = this.level.arrows[id];
    const W = this.level.W;
    const n = a.cells.length;
    const cx = (c) => (c % W) + 0.5;
    const cy = (c) => Math.floor(c / W) + 0.5;
    if (d >= n - 1) {
      const h = a.cells[n - 1];
      const [dx, dy] = DIRS[this.board.dirs[id]];
      return [cx(h) + dx * (d - n + 1), cy(h) + dy * (d - n + 1)];
    }
    const i = Math.floor(d);
    const f = d - i;
    const p = a.cells[i];
    const q = a.cells[i + 1];
    return [lerp(cx(p), cx(q), f), lerp(cy(p), cy(q), f)];
  }

  // Arrows of one colour in one stroke + one fill: [[id, s, s0?]]. The body runs from distance
  // s0 to s + n - 1 along the track, the head sits at s + n - 1.
  strokeArrows(list, colour) {
    const g = this.g;
    const body = new Path2D();
    const heads = new Path2D();
    for (const [id, s, s0 = s] of list) this.arrowPath(body, heads, id, s, s0);
    g.strokeStyle = colour;
    g.fillStyle = colour;
    g.lineWidth = 0.23;
    g.stroke(body);
    g.fill(heads);
  }

  arrowPath(body, heads, id, s, s0) {
    const a = this.level.arrows[id];
    const W = this.level.W;
    const n = a.cells.length;
    const e = s + n - 1;
    const pts = [this.pointAt(id, s0)];
    for (let i = Math.floor(s0) + 1; i < Math.min(n, Math.ceil(e)); i++) pts.push([(a.cells[i] % W) + 0.5, Math.floor(a.cells[i] / W) + 0.5]);
    const head = this.pointAt(id, e);
    pts.push(head);
    body.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) {
      const [px, py] = pts[i - 1];
      const [x, y] = pts[i];
      const [nx, ny] = pts[i + 1];
      const r = Math.min(0.3, Math.hypot(x - px, y - py) * 0.9, Math.hypot(nx - x, ny - y) * 0.9);
      if (r > 0.01) body.arcTo(x, y, nx, ny, r);
      else body.lineTo(x, y);
    }
    body.lineTo(head[0], head[1]);
    const [dx, dy] = DIRS[this.board.dirs[id]];
    heads.moveTo(head[0] + dx * 0.45, head[1] + dy * 0.45);
    heads.lineTo(head[0] - dy * 0.275, head[1] + dx * 0.275);
    heads.lineTo(head[0] + dy * 0.275, head[1] - dx * 0.275);
    heads.closePath();
  }

  // eraser: pink, rubbed out tail -> head with sparkles (ref 4.3)
  drawRubs(now) {
    const g = this.g;
    this.rubs = this.rubs.filter((r) => {
      const k = (now - r.t0) / RUB;
      if (k >= 1) return false;
      const n = this.level.arrows[r.id].cells.length;
      const s0 = k * (n - 1);
      this.strokeArrows([[r.id, 0, s0]], PAL.erase);
      const [x, y] = this.pointAt(r.id, s0);
      g.fillStyle = '#fff';
      for (let i = 0; i < 4; i++) {
        const ang = now * 9 + i * 1.6;
        g.beginPath();
        g.arc(x + Math.cos(ang) * 0.4, y + Math.sin(ang) * 0.4, 0.07, 0, Math.PI * 2);
        g.fill();
      }
      return true;
    });
  }

  drawSparks(now) {
    const g = this.g;
    const W = this.level.W;
    this.sparks = this.sparks.filter((sp) => {
      const k = (now - sp.t0) / sp.dur;
      if (k >= 1) return false;
      if (k < 0) return true;
      const a = this.level.arrows[sp.id];
      const h = a.cells[a.cells.length - 1];
      const [fx, fy] = this.toBoard(sp.sx, sp.sy);
      const e = easeOut(k);
      const x = lerp(fx, (h % W) + 0.5, e);
      const y = lerp(fy, Math.floor(h / W) + 0.5, e) - Math.sin(k * Math.PI) * 3;
      g.fillStyle = '#ffe680';
      g.beginPath();
      g.arc(x, y, Math.max(0.15, 3 / this.pitch), 0, Math.PI * 2);
      g.fill();
      return true;
    });
    if (this.wand && now > this.wand.t0 + this.wand.dur + 0.2) {
      this.wand = null;
      this.ver++;
    }
  }

  // "-1" star badge at the contact point: pop, hold, fade (ref 2.3)
  drawBadges(now) {
    const g = this.g;
    this.badges = this.badges.filter((bd) => {
      const t = now - bd.t0;
      if (t > 1.3) return false;
      if (t < 0) return true;
      const sc = t < 0.12 ? 1.3 * (t / 0.12) : t < 0.2 ? 1.3 - (t - 0.12) * 3.75 : 1;
      const alpha = t < 0.8 ? 1 : 1 - (t - 0.8) / 0.5;
      const R = (16 / this.pitch) * sc;
      g.save();
      g.globalAlpha = alpha;
      g.translate(bd.x + 0.6, bd.y - 0.6);
      starPath(g, R);
      g.fillStyle = PAL.star;
      g.fill();
      g.lineWidth = R * 0.12;
      g.strokeStyle = '#a07a00';
      g.stroke();
      g.font = `900 ${R * 0.9}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = R * 0.22;
      g.strokeStyle = '#c0282e';
      g.strokeText('-1', 0, R * 0.08);
      g.fillStyle = '#fff';
      g.fillText('-1', 0, R * 0.08);
      g.restore();
      return true;
    });
  }
}

export function starPath(g, R) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? R * 0.48 : R;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.closePath();
}

function segDist(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const L = vx * vx + vy * vy;
  const t = L ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / L)) : 0;
  return Math.hypot(px - ax - t * vx, py - ay - t * vy);
}
