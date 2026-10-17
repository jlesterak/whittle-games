// Beadloom canvas renderer. Everything is drawn in design pixels (1080x2316 portrait) through
// one transform; sprites are pre-rendered at device resolution. The static parts (background,
// track, spout, slot wells, board rails, booster bar) live on a cached layer. Per frame it draws
// beads, crates, slots and effects without allocating (pooled particles and flights).

import { fitStage } from '../../core/stage.js';
import { COLORS, THEMES } from './colors.js';
import { buildTrack, samplePath, filletShape, W, H, LANE, LANES, BEAD, CHANNEL, WALL } from './track.js';
import { SpriteSet, drawSprite, drawSwapArrows, drawLock, drawKey, drawDispenser, drawIce, outlinedText, rr, drawCrate, LOCK_COLORS, CRATE_W, CRATE_H } from './sprites.js';
import { CRATE, DISP, WALL as NOCELL } from '../../engines/slotsort/board.js';
import { CRATE_ROWS } from './rules.js';

// Headroom above y=0 kept on screen: the HUD row (gear, level, coins) sits in it, clear of the track.
export const FIT = { W, H, top: 160 };

export const LAYOUT = {
  // column-aware and centred: 6-col boards (ref C.2) use a tighter pitch, 5-col a wider one.
  // Bigger pitch than before so crates read larger and more tappable.
  colPitch: (cols) => (cols >= 6 ? 162 : 182),
  colX: (c, cols = 5) => 540 + (c - (cols - 1) / 2) * LAYOUT.colPitch(cols),
  // bottom-anchored (ref 3.1): hugs the booster bar and grows upward, space above.
  rowY: (r, rows) => 1920 - (rows - 1 - r) * 166,
  slotY: 1050,
  slotX: (s, K) => 540 + (s - (K - 1) / 2) * 162,
  spout: { x: 540, y: 893, w: 140, h: 74 },
  barY: 2140,
};
const BEADS_PER_ROW = 5; // ice counters show beads, the sim counts rows
const SLOT_W = 140;
// -1 / 1 when a dispenser sits beside its single zone cell (faces left / right), else 0.
function dispSide(b, disp) {
  if (disp.zone.length !== 1) return 0;
  const z = disp.zone[0];
  if (((z / b.cols) | 0) !== ((disp.cell / b.cols) | 0)) return 0;
  return z < disp.cell ? -1 : 1;
}
export const SLOT_H = 128;
// A board cell's rail box around its centre, and the widest rail's padding (drawRails)
export const CELL_BOX = { left: 70, right: 70, up: 76, down: 84 };
export const RAIL_PAD = 26;
const FILLET = 30; // radius (design px) of the outermost wall's rounded join where a feeder meets the ring
const PCT = Array.from({ length: CRATE_ROWS + 1 }, (_, i) => `${i * 5}%`);
const DASH = [18, 12];
const NODASH = [];
const ease = (t) => 1 - (1 - t) ** 3;
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

// ---- particles (fixed pool, struct-of-arrays) ----
const P_STAR = 0;
const P_CONFETTI = 1;
const P_SMOKE = 2;
const P_QMARK = 3;
const P_SPARK = 4;
const P_SHARD = 5;

class Particles {
  constructor(n) {
    this.n = n;
    this.on = new Uint8Array(n);
    this.type = new Uint8Array(n);
    this.col = new Int16Array(n);
    for (const k of ['x', 'y', 'vx', 'vy', 'age', 'life', 'size', 'rot', 'vr', 'g']) this[k] = new Float32Array(n);
    this.next = 0;
  }
  spawn(type, x, y, vx, vy, life, size, col = 0, g = 0) {
    const i = this.next;
    this.next = (i + 1) % this.n;
    this.on[i] = 1;
    this.type[i] = type;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.age[i] = 0;
    this.life[i] = life;
    this.size[i] = size;
    this.col[i] = col;
    this.rot[i] = Math.random() * 6.28;
    this.vr[i] = (Math.random() - 0.5) * 10;
    this.g[i] = g;
  }
  clear() {
    this.on.fill(0);
  }
}

// ---- pooled flights (bead clumps from the spout to a crate) ----
class Flights {
  constructor(n) {
    this.n = n;
    this.on = new Uint8Array(n);
    this.col = new Int16Array(n);
    for (const k of ['t0', 'dur', 'x0', 'y0', 'x1', 'y1', 'seed']) this[k] = new Float32Array(n);
    this.next = 0;
  }
  spawn(t0, dur, x0, y0, x1, y1, col) {
    const i = this.next;
    this.next = (i + 1) % this.n;
    this.on[i] = 1;
    this.t0[i] = t0;
    this.dur[i] = dur;
    this.x0[i] = x0;
    this.y0[i] = y0;
    this.x1[i] = x1;
    this.y1[i] = y1;
    this.col[i] = col;
    this.seed[i] = Math.random() * 100;
  }
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.layer = document.createElement('canvas');
    this.pt = { x: 0, y: 0, nx: 0, ny: 0 };
    this.parts = new Particles(500);
    this.flights = new Flights(160);
    this.opts = { colourblind: false, reducedMotion: false };
    this.sprites = null;
    this.level = null;
    this.liftMode = false; // Move Box armed: every liftable crate shows raised
    this.rate = 1; // sim seconds per real second (4 while the win fast-forwards)
    this.resetAnims();
  }

  resetAnims() {
    this.slotAnim = []; // per slot: { t0, x0, y0 } pick flight
    this.doneAnims = []; // completed crates: { t0, slot, color, x, y }
    this.ejects = new Map(); // cell -> { t0, dur, fromX, fromY, color }
    this.keyAnims = []; // { t0, x0, y0, x1, y1, lock }
    this.lockFades = []; // { t0, x, y, lock }
    this.shakes = new Map(); // cell -> t0
    this.slotShake = -1;
    this.swapT0 = -1;
    this.feederShift = [0, 0];
    this.banner = null; // { t0, text }
    this.dispGone = []; // { t0, x, y }
    this.lastComplete = -10;
    this.hint = -1;
    this.parts?.clear();
    this.flights?.on.fill(0);
  }

  setOptions(o) {
    const cbChanged = o.colourblind !== this.opts.colourblind;
    this.opts = { ...this.opts, ...o };
    if (cbChanged) this.sprites = null;
  }

  resize(cssW, cssH, dpr) {
    this.dpr = dpr;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    const f = fitStage(cssW, cssH, FIT);
    this.scale = f.scale; // CSS px per design px
    this.offX = f.offX;
    this.offY = f.offY;
    this.k = f.scale * dpr;
    this.sprites = null;
    this.staticDirty = true;
  }

  // What the level puts on screen, as boxes in CSS px within the canvas (smoke --sweep checks they stay inside).
  bounds() {
    const css = (name, x0, y0, x1, y1) => ({ name, x0: this.offX + x0 * this.scale, y0: this.offY + y0 * this.scale, x1: this.offX + x1 * this.scale, y1: this.offY + y1 * this.scale });
    const half = (CHANNEL + 2 * WALL + 10) / 2; // the widest track layer (its shadow)
    const out = [];
    for (const [name, p] of [['ring', this.track.ring], ['left arm', this.track.feeders[1]], ['right arm', this.track.feeders[0]]]) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < p.count; i++) {
        x0 = Math.min(x0, p.xs[i]); x1 = Math.max(x1, p.xs[i]);
        y0 = Math.min(y0, p.ys[i]); y1 = Math.max(y1, p.ys[i]);
      }
      out.push(css(name, x0 - half, y0 - half, x1 + half, y1 + half + 10)); // the shadow sits 10 px lower
    }
    const b = this.sim.board;
    const [bx0, by0] = [LAYOUT.colX(0, b.cols), LAYOUT.rowY(0, b.rows)];
    const [bx1, by1] = [LAYOUT.colX(b.cols - 1, b.cols), LAYOUT.rowY(b.rows - 1, b.rows)];
    out.push(css('crates', bx0 - CRATE_W / 2, by0 - CRATE_H / 2 - 12, bx1 + CRATE_W / 2, by1 + CRATE_H / 2));
    const K = this.sim.slots.length;
    out.push(css('slots', LAYOUT.slotX(0, K) - SLOT_W / 2, LAYOUT.slotY - SLOT_H / 2, LAYOUT.slotX(K - 1, K) + SLOT_W / 2, LAYOUT.slotY + SLOT_H / 2));
    return out;
  }

  // CSS client coordinates -> design coordinates.
  toDesign(cx, cy, rect) {
    return [(cx - rect.left - this.offX) / this.scale, (cy - rect.top - this.offY) / this.scale];
  }

  setLevel(level, sim) {
    this.level = level;
    this.sim = sim;
    this.track = buildTrack(level.ring.shape, level.ring.rows);
    this.theme = THEMES[level.theme % THEMES.length];
    const N = level.ring.rows;
    // draw ring positions back to front (top of screen first) for the 3D overlap
    const ys = [];
    for (let k = 0; k < N; k++) ys.push([samplePath(this.track.ring, k * this.track.pitch, true, this.pt).y, k]);
    ys.sort((a, b) => a[0] - b[0]);
    this.order = Int16Array.from(ys.map((v) => v[1]));
    this.resetAnims();
    this.staticDirty = true;
  }

  ensureSprites() {
    if (!this.sprites) {
      this.sprites = new SpriteSet(this.k, this.opts.colourblind, BEAD);
      this.staticDirty = true;
    }
  }

  cellXY(i) {
    const b = this.sim.board;
    const r = (i / b.cols) | 0;
    const c = i - r * b.cols;
    return [LAYOUT.colX(c, b.cols), LAYOUT.rowY(r, b.rows)];
  }

  slotXY(s) {
    return [LAYOUT.slotX(s, this.sim.slots.length), LAYOUT.slotY];
  }

  // ---------- static layer ----------
  buildStatic() {
    const L = this.layer;
    L.width = this.canvas.width;
    L.height = this.canvas.height;
    const g = L.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = this.theme.bg;
    g.fillRect(0, 0, L.width, L.height);
    g.setTransform(this.k, 0, 0, this.k, this.offX * this.dpr, this.offY * this.dpr);

    this.drawRails(g);

    // track: shadows, walls, then channels, so feeders and ring merge into one channel
    const paths = [
      [this.track.ring, true],
      [this.track.feeders[0], false],
      [this.track.feeders[1], false],
    ];
    const OUTER = (CHANNEL + 2 * WALL + 10) / 2; // the shadow's half-width: the widest layer
    const stroke = (ctx, lw, style, dy = 0, round = false) => {
      ctx.lineWidth = lw;
      ctx.strokeStyle = style;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round'; // the feeder arms end in a rounded cap; their mouth ends sit inside the ring channel
      for (const [p, closed] of paths) {
        ctx.beginPath();
        for (let i = 0; i < p.count; i++) ctx[i ? 'lineTo' : 'moveTo'](p.xs[i], p.ys[i] + dy);
        if (closed) ctx.closePath();
        ctx.stroke();
      }
      if (!round) return;
      // the wall layers round off the sharp V where each feeder band leaves the ring band (concentric arcs)
      ctx.fillStyle = style;
      for (let i = 0; i < 4; i++) {
        const f = filletShape(this.track, i, lw / 2, OUTER, FILLET);
        if (!f) continue;
        ctx.beginPath();
        ctx.moveTo(f.X[0], f.X[1] + dy);
        ctx.lineTo(f.A0[0], f.A0[1] + dy);
        ctx.lineTo(f.A[0], f.A[1] + dy);
        ctx.arc(f.C[0], f.C[1] + dy, f.r, f.a0, f.a1, f.ccw);
        ctx.lineTo(f.B0[0], f.B0[1] + dy);
        ctx.closePath();
        ctx.fill();
      }
    };
    // The drop shadow is translucent, so it is drawn opaque on its own layer and laid down once at 25 %: overlaps
    // (ring under feeder, fillet over stroke) then can't darken twice.
    // The layer is kept between rebuilds: allocating it each time made a rebuild about 3x slower (P5 re-check).
    const sh = (this.shadowLayer ??= document.createElement('canvas'));
    if (sh.width !== L.width || sh.height !== L.height) {
      sh.width = L.width;
      sh.height = L.height;
    }
    const sg = sh.getContext('2d');
    sg.setTransform(1, 0, 0, 1, 0, 0);
    sg.clearRect(0, 0, sh.width, sh.height);
    sg.setTransform(this.k, 0, 0, this.k, this.offX * this.dpr, this.offY * this.dpr);
    stroke(sg, CHANNEL + 2 * WALL + 10, 'rgb(30,30,90)', 8, true);
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 0.25;
    g.drawImage(sh, 0, 0);
    g.restore();
    stroke(g, CHANNEL + 2 * WALL + 4, '#5d669f', 0, true);
    stroke(g, CHANNEL + 2 * WALL - 2, '#7e88c6', 0, true);
    stroke(g, CHANNEL + 6, '#5a5f8c');
    stroke(g, CHANNEL, '#4e4e6c');
    // faint chevrons pointing along the flow
    g.strokeStyle = 'rgba(0,0,0,0.13)';
    g.lineWidth = 5;
    g.lineCap = 'round';
    for (const [p, closed] of paths) {
      const dir = closed ? 1 : -1; // feeder paths are sampled from the mouth backwards
      for (let s = 40; s < p.length - 40; s += 90) {
        const a = samplePath(p, s, closed, { x: 0, y: 0, nx: 0, ny: 0 });
        const tx = -a.ny * dir;
        const ty = a.nx * dir;
        g.beginPath();
        g.moveTo(a.x - tx * 9 + a.nx * 14, a.y - ty * 9 + a.ny * 14);
        g.lineTo(a.x + tx * 4, a.y + ty * 4);
        g.lineTo(a.x - tx * 9 - a.nx * 14, a.y - ty * 9 - a.ny * 14);
        g.stroke();
      }
    }
    // spout: a short dark chute below the ring bottom
    const sp = LAYOUT.spout;
    g.fillStyle = '#4a4f70';
    rr(g, sp.x - sp.w / 2 - 6, sp.y - sp.h / 2, sp.w + 12, sp.h + 6, 10);
    g.fill();
    const grad = g.createLinearGradient(0, sp.y - sp.h / 2, 0, sp.y + sp.h / 2);
    grad.addColorStop(0, '#3f4360');
    grad.addColorStop(1, '#666b8c');
    g.fillStyle = grad;
    rr(g, sp.x - sp.w / 2, sp.y - sp.h / 2, sp.w, sp.h - 4, 8);
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.15)';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(sp.x - 16, sp.y - 2);
    g.lineTo(sp.x, sp.y + 10);
    g.lineTo(sp.x + 16, sp.y - 2);
    g.stroke();

    // slot wells
    const K = this.sim.slots.length;
    for (let s = 0; s < K; s++) {
      const [x, y] = this.slotXY(s);
      g.fillStyle = 'rgba(40,40,110,0.18)';
      rr(g, x - 58, y - 46, 116, 100, 18);
      g.fill();
      g.fillStyle = this.theme.slot;
      rr(g, x - 56, y - 50, 112, 98, 17);
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.55)';
      g.lineWidth = 3;
      g.stroke();
    }

    // booster bar
    g.fillStyle = '#274c8d';
    g.fillRect(-2000, LAYOUT.barY, W + 4000, 2000);
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fillRect(-2000, LAYOUT.barY, W + 4000, 6);
    this.staticDirty = false;
  }

  // Light-blue double rail around the board shape, with stubs out to the screen sides.
  drawRails(g) {
    const b = this.sim.board;
    const cells = [];
    for (let i = 0; i < b.n; i++) if (b.kind[i] !== NOCELL) cells.push(this.cellXY(i));
    const B = CELL_BOX;
    const fill = (pad, style) => {
      g.fillStyle = style;
      for (const [x, y] of cells) {
        rr(g, x - B.left - pad, y - B.up - pad, B.left + B.right + pad * 2, B.up + B.down + pad * 2, 22 + pad);
        g.fill();
      }
    };
    const top = Math.min(...cells.map((c) => c[1])) - B.up;
    const xs = cells.map((c) => c[0]);
    const left = Math.min(...xs) - B.left;
    const right = Math.max(...xs) + B.right;
    g.fillStyle = this.theme.rail;
    g.fillRect(-2000, top - 40, left + 2000, 26);
    g.fillRect(right, top - 40, W + 2000 - right, 26);
    g.fillStyle = this.theme.rail2;
    g.fillRect(-2000, top - 34, left + 2000, 12);
    g.fillRect(right, top - 34, W + 2000 - right, 12);
    fill(RAIL_PAD, this.theme.rail);
    fill(RAIL_PAD - 8, this.theme.rail2);
    fill(10, this.theme.bg);
  }

  // ---------- events -> animations ----------
  // Real seconds for a duration of `sec` sim-timer seconds.
  dur(sec) {
    return (sec * this.sim.ts) / this.rate;
  }

  onEvent(e, now) {
    const sim = this.sim;
    const rm = this.opts.reducedMotion;
    switch (e.type) {
      case 'pick': {
        const [x0, y0] = this.cellXY(e.cell);
        this.slotAnim[e.slot] = { t0: now, x0, y0: y0 - 10 };
        if (e.info.toggled) this.swapT0 = now;
        for (const ej of e.info.ejects) {
          const [fx, fy] = this.cellXY(ej.from);
          this.ejects.set(ej.to, { t0: now, dur: this.dur(0.6), fromX: fx, fromY: fy, color: ej.color });
        }
        for (const d of e.info.gone) {
          const [x, y] = this.cellXY(sim.board.disps[d].cell);
          this.dispGone.push({ t0: now + this.dur(0.6), x, y });
        }
        if (e.info.unlocked >= 0) {
          const [x1, y1] = this.cellXY(e.info.unlocked);
          this.keyAnims.push({ t0: now, x0, y0, x1, y1: y1 - 22, lock: e.info.lockId });
        }
        break;
      }
      case 'extract': {
        const [x, y] = this.slotXY(e.slot);
        const sp = LAYOUT.spout;
        this.flights.spawn(now, this.dur(0.28), sp.x, sp.y + 20, x, y - 20, e.color);
        break;
      }
      case 'fillBead': {
        const s = samplePath(this.track.ring, sim.supply.cellPos(e.cell) * this.track.pitch, true, this.pt);
        const [x, y] = this.slotXY(e.slot);
        this.flights.spawn(now, this.dur(0.35), s.x, s.y, x, y - 20, e.color);
        break;
      }
      case 'inject':
        this.feederShift[e.feeder] += 1;
        break;
      case 'feederReveal': {
        if (rm) break;
        const p = samplePath(this.track.feeders[e.feeder], this.track.queueStart[e.feeder] + 5 * this.track.pitch, false, this.pt);
        for (let i = 0; i < 5; i++) {
          this.parts.spawn(P_QMARK, p.x + (Math.random() - 0.5) * 60, p.y, (Math.random() - 0.5) * 80, -140 - Math.random() * 80, 0.7, 34);
        }
        this.parts.spawn(P_SMOKE, p.x, p.y, 0, 0, 0.3, 70);
        break;
      }
      case 'thaw': {
        const [x, y] = this.cellXY(e.cell);
        if (!rm) {
          for (let i = 0; i < 16; i++) {
            const a = Math.random() * 6.283;
            const v = 120 + Math.random() * 220;
            this.parts.spawn(P_SHARD, x + Math.cos(a) * 30, y + Math.sin(a) * 30, Math.cos(a) * v, Math.sin(a) * v - 80, 0.45 + Math.random() * 0.2, 10 + Math.random() * 10, i & 1, 600);
          }
        }
        this.parts.spawn(P_SMOKE, x, y, 0, 0, 0.3, 80);
        break;
      }
      case 'complete': {
        const [x, y] = this.slotXY(e.slot);
        this.doneAnims.push({ t0: now, slot: e.slot, color: e.color, x, y, ts: this.dur(1) });
        if (!rm) {
          for (let i = 0; i < 10; i++) {
            const a = Math.random() * 6.28;
            const v = 120 + Math.random() * 160;
            this.parts.spawn(P_STAR, x, y - 10, Math.cos(a) * v, Math.sin(a) * v - 60, 0.55, 18 + Math.random() * 10, 0, 150);
          }
        }
        if (now - this.lastComplete < 2.2) this.banner = { t0: now, text: 'Awesome!' };
        this.lastComplete = now;
        break;
      }
      case 'win':
        if (!this.banner || now - this.banner.t0 > 0.5) this.banner = { t0: now, text: 'Awesome!' };
        break;
      case 'addSlot':
        this.staticDirty = true;
        break;
    }
  }

  shake(cell, now) {
    if (!this.opts.reducedMotion) this.shakes.set(cell, now);
  }

  shakeSlots(now) {
    if (!this.opts.reducedMotion) this.slotShake = now;
  }

  showHint(now) {
    this.hint = now;
  }

  // ---------- hit testing (design coords) ----------
  hitCell(x, y) {
    const b = this.sim.board;
    for (let i = 0; i < b.n; i++) {
      if (b.kind[i] === NOCELL) continue;
      const [cx, cy] = this.cellXY(i);
      if (Math.abs(x - cx) < 68 && y > cy - 72 && y < cy + 72) return i;
    }
    return -1;
  }

  hitSlot(x, y) {
    for (let s = 0; s < this.sim.slots.length; s++) {
      const [cx, cy] = this.slotXY(s);
      if (Math.abs(x - cx) < 62 && Math.abs(y - cy) < 62) return s;
    }
    return -1;
  }

  // ---------- frame ----------
  frame(now, dt) {
    if (!this.level) return;
    this.ensureSprites();
    if (this.staticDirty) this.buildStatic();
    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.layer, 0, 0);
    g.setTransform(this.k, 0, 0, this.k, this.offX * this.dpr, this.offY * this.dpr);
    const sim = this.sim;
    const rows = sim.supply.rows;
    for (let f = 0; f < 2; f++) this.feederShift[f] = Math.max(0, this.feederShift[f] - dt * Math.max(10, rows * 1.3));

    this.drawRing(g);
    this.drawFeeders(g); // over the ring, so the waiting rows at each mouth stay in view
    this.drawBoard(g, now);
    this.drawSlots(g, now);
    this.drawFlights(g, now);
    this.drawEffects(g, now, dt);
  }

  // One row of 5 beads across the track. Odd rows shift half a lane (hex packing).
  drawBeadRow(g, x, y, nx, ny, spr, symSpr, odd) {
    const flip = ny < 0 || (ny === 0 && nx < 0);
    const st = odd ? 0.25 : -0.25;
    for (let j = 0; j < LANES; j++) {
      const l = (flip ? 2 - j : j - 2) + st;
      const s = j === 2 ? symSpr : spr;
      g.drawImage(s, x + nx * l * LANE - s.ox, y + ny * l * LANE - s.oy, s.dw, s.dh);
    }
  }

  drawRing(g) {
    const sup = this.sim.supply;
    const N = sup.N;
    const tr = this.track;
    const sp = this.sprites;
    const pt = this.pt;
    const order = this.order;
    for (let o = 0; o < N; o++) {
      const k = order[o];
      const i = (k - sup.offset + N) % N;
      const c = sup.ring[i];
      if (c < 0) continue;
      samplePath(tr.ring, (k + sup.phase) * tr.pitch, true, pt);
      this.drawBeadRow(g, pt.x, pt.y, pt.nx, pt.ny, sp.beads[c], (i & 1) === 0 ? sp.beadsSym[c] : sp.beads[c], i & 1);
    }
  }

  drawFeeders(g) {
    const sup = this.sim.supply;
    const tr = this.track;
    const sp = this.sprites;
    const pt = this.pt;
    for (let f = 0; f < 2; f++) {
      const fd = sup.feeders[f];
      const path = tr.feeders[f];
      const s0 = tr.queueStart[f] + 0.5 * tr.pitch; // the front row sits just clear of the ring
      const end = path.length - 30; // rows past this are inside the arm's end cap
      const shift = this.feederShift[f];
      const visible = Math.min(fd.colors.length - fd.head, Math.ceil((end - s0) / tr.pitch) + 1);
      const at = (h) => s0 + (h + shift) * tr.pitch;
      for (let h = visible - 1; h >= 0; h--) {
        const idx = fd.head + h;
        const c = fd.colors[idx];
        const hid = fd.hidden[fd.seg[idx]];
        if (at(h) > end) continue;
        samplePath(path, at(h), false, pt);
        const spr = hid ? sp.hidden : sp.beads[c];
        this.drawBeadRow(g, pt.x, pt.y, pt.nx, pt.ny, spr, hid || (idx & 1) ? spr : sp.beadsSym[c], idx & 1);
      }
      // "?" on hidden segments, on the 5th row of each run
      let run = 0;
      for (let h = 0; h < visible; h++) {
        const idx = fd.head + h;
        run = h > 0 && fd.seg[idx] === fd.seg[idx - 1] ? run + 1 : 0;
        if (run === 4 && fd.hidden[fd.seg[idx]] && at(h) <= end) {
          samplePath(path, at(h), false, pt);
          drawSprite(g, sp.qmark, pt.x, pt.y);
        }
      }
    }
  }

  drawBoard(g, now) {
    const sim = this.sim;
    const b = sim.board;
    const sp = this.sprites;
    const swapK = this.swapT0 < 0 ? 1 : clamp01((now - this.swapT0) / 0.25);
    // dispenser target zones (dashed)
    g.setLineDash(DASH);
    g.lineWidth = 5;
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    for (let d = 0; d < b.disps.length; d++) {
      const disp = b.disps[d];
      if (b.kind[disp.cell] !== DISP || b.dispIdx[d] >= disp.queue.length) continue;
      if (dispSide(b, disp)) continue; // side-facing: no dashed zone (recording C)
      let x0 = 1e9;
      let x1 = -1e9;
      let y = 0;
      for (const z of disp.zone) {
        const [x, yy] = this.cellXY(z);
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y = yy;
      }
      rr(g, x0 - 68, y - 70, x1 - x0 + 136, 150, 24);
      g.stroke();
    }
    g.setLineDash(NODASH);

    for (let i = 0; i < b.n; i++) {
      const kind = b.kind[i];
      if (kind !== CRATE && kind !== DISP) continue;
      let [x, y] = this.cellXY(i);
      const sh = this.shakes.get(i);
      if (sh !== undefined) {
        const t = now - sh;
        if (t > 0.3) this.shakes.delete(i);
        else x += Math.sin(t * 60) * 9 * (1 - t / 0.3);
      }
      if (kind === DISP) {
        const d = b.dispAt[i];
        const disp = b.disps[d];
        const left = disp.queue.length - b.dispIdx[d];
        let open = 0;
        for (const z of disp.zone) {
          const ej = this.ejects.get(z);
          if (ej) open = Math.max(open, 1 - Math.abs((now - ej.t0) / ej.dur - 0.35) * 3);
        }
        drawDispenser(g, x, y - 4, 126, 120, left, left > 0 ? COLORS[disp.queue[b.dispIdx[d]]].crate : null, clamp01(open), dispSide(b, disp));
        continue;
      }
      const ej = this.ejects.get(i);
      if (ej) {
        const t = (now - ej.t0) / ej.dur;
        if (t < 1) {
          const k = clamp01((t - 0.3) / 0.7);
          if (k <= 0) continue; // still inside the dispenser
          const e = ease(k);
          const px = ej.fromX + (x - ej.fromX) * e;
          const py = ej.fromY + (y - ej.fromY) * e - Math.sin(k * Math.PI) * 90;
          drawSprite(g, sp.crate(ej.color, false), px, py);
          if (!this.opts.reducedMotion && Math.random() < 0.5) this.parts.spawn(P_SMOKE, px, py + 30, 0, -20, 0.5, 34);
          continue;
        }
        this.ejects.delete(i);
      }
      if (b.ice[i] > 0) {
        drawIce(g, x, y, CRATE_W, CRATE_H, String(b.ice[i] * BEADS_PER_ROW));
        continue;
      }
      const c = b.color[i];
      const raised = (this.liftMode || sim.reach[i] === 1) && b.lock[i] < 0 && sim.readyAt[i] <= sim.time;
      if (b.pair[i] >= 0 && swapK < 1) {
        // cross-fade from the old colour (now in alt) to the new one
        g.globalAlpha = 1 - swapK;
        drawSprite(g, sp.crate(b.alt[i], raised), x, y);
        g.globalAlpha = swapK;
        drawSprite(g, sp.crate(c, raised), x, y);
        g.globalAlpha = 1;
      } else {
        drawSprite(g, sp.crate(c, raised), x, y);
      }
      if (!raised && b.ice[i] <= 0) {
        // blocked (non-pickable) crates recede behind a soft dark veil, so the raised, white-
        // outlined pickable crates clearly stand out. Specials (arrows/lock/key) draw on top.
        g.fillStyle = 'rgba(20,22,45,0.18)';
        rr(g, x - CRATE_W / 2, y - CRATE_H / 2, CRATE_W, CRATE_H, CRATE_W * 0.22);
        g.fill();
      }
      const topY = y - CRATE_H / 2 - (raised ? 12 : 0);
      if (b.pair[i] >= 0) {
        const ang = swapK < 1 ? swapK * Math.PI : 0;
        const arrowCol = swapK < 0.5 ? COLORS[c].crate : COLORS[b.alt[i]].crate;
        drawSwapArrows(g, x, topY + CRATE_H * 0.33, 26, arrowCol, ang);
      }
      if (b.lock[i] >= 0) {
        drawLock(g, x, topY + 30, 72, LOCK_COLORS[b.lock[i] % 3]);
      }
      if (b.key[i] >= 0) {
        drawKey(g, x, topY + CRATE_H * 0.33, 78, LOCK_COLORS[b.key[i] % 3], -0.5 + Math.sin(now * 3 + i) * 0.14);
      }
    }
  }

  drawSlots(g, now) {
    const sim = this.sim;
    const sp = this.sprites;
    const K = sim.slots.length;
    let shakeX = 0;
    if (this.slotShake >= 0) {
      const t = now - this.slotShake;
      if (t > 0.35) this.slotShake = -1;
      else shakeX = Math.sin(t * 55) * 10 * (1 - t / 0.35);
    }
    for (let s = 0; s < K; s++) {
      const sl = sim.slots[s];
      if (!sl) continue;
      let [x, y] = this.slotXY(s);
      x += shakeX;
      let sc = 1;
      const a = this.slotAnim[s];
      if (a) {
        const t = (now - a.t0) / 0.29;
        if (t < 1) {
          const e = ease(t);
          x = a.x0 + (x - a.x0) * e;
          y = a.y0 + (y - a.y0) * e - Math.sin(t * Math.PI) * 70;
          sc = 1.12 - 0.12 * e;
        } else if (t < 1.28) {
          sc = 1 - Math.sin(((t - 1) / 0.28) * Math.PI) * 0.06;
        }
      }
      const done = sl.doneAt >= 0;
      const x0 = x - (SLOT_W / 2) * sc;
      const y0 = y - (SLOT_H / 2) * sc;
      if (done) {
        g.save();
        g.translate(x0, y0);
        g.scale(sc, sc);
        drawCrate(g, COLORS[sl.color].crate, SLOT_W, SLOT_H, 0, this.opts.colourblind ? sl.color : -1, true);
        g.restore();
      } else {
        drawSprite(g, sp.crate(sl.color, false, true), x, y, sc);
        this.drawPile(g, sl, x0, y0, sc);
      }
      outlinedText(g, PCT[Math.min(CRATE_ROWS, sl.landed)], x, y + 34 * sc, 34, '#fff', '#2a2440', 8);
    }
  }

  // Beads piled inside a slotted crate's well, rising with the fill.
  drawPile(g, sl, x0, y0, sc) {
    if (sl.landed <= 0) return;
    const spr = this.sprites.small[sl.color];
    const wx = x0 + SLOT_W * 0.12 * sc;
    const wy = y0 + SLOT_H * 0.08 * sc;
    const ww = SLOT_W * 0.76 * sc;
    const wh = SLOT_H * 0.5 * sc;
    const rowsShown = Math.ceil((sl.landed / CRATE_ROWS) * 4);
    g.save();
    g.beginPath();
    g.rect(wx, wy, ww, wh);
    g.clip();
    for (let r = 0; r < rowsShown; r++) {
      const yy = wy + wh - 6 * sc - r * 11 * sc;
      for (let c = 0; c < 7; c++) {
        const xx = wx + 6 * sc + c * 12 * sc + (r & 1) * 6 * sc;
        g.drawImage(spr, xx - spr.ox * sc, yy - spr.oy * sc, spr.dw * sc, spr.dh * sc);
      }
    }
    g.restore();
  }

  drawFlights(g, now) {
    const F = this.flights;
    const small = this.sprites.small;
    for (let i = 0; i < F.n; i++) {
      if (!F.on[i]) continue;
      const t = (now - F.t0[i]) / F.dur[i];
      if (t >= 1) {
        F.on[i] = 0;
        continue;
      }
      if (t < 0) continue;
      const e = t;
      const bx = F.x0[i] + (F.x1[i] - F.x0[i]) * e;
      const by = F.y0[i] + (F.y1[i] - F.y0[i]) * e - Math.sin(t * Math.PI) * 50;
      const spr = small[F.col[i]];
      const sd = F.seed[i];
      for (let j = 0; j < 4; j++) {
        const ox = Math.sin(sd + j * 2.1) * 9;
        const oy = Math.cos(sd * 1.7 + j * 1.3) * 7;
        g.drawImage(spr, bx + ox - spr.ox * 1.3, by + oy - spr.oy * 1.3, spr.dw * 1.3, spr.dh * 1.3);
      }
    }
    // keys flying to their locks, then the lock pops and fades
    for (let k = this.keyAnims.length - 1; k >= 0; k--) {
      const a = this.keyAnims[k];
      const t = (now - a.t0) / 0.3;
      if (t >= 1) {
        this.keyAnims.splice(k, 1);
        this.lockFades.push({ t0: now, x: a.x1, y: a.y1, lock: a.lock });
        continue;
      }
      const e = ease(t);
      const x = a.x0 + (a.x1 - a.x0) * e;
      const y = a.y0 + (a.y1 - a.y0) * e - Math.sin(t * Math.PI) * 80;
      drawKey(g, x, y, 78, LOCK_COLORS[a.lock % 3], -0.5 + t * 6);
    }
    for (let k = this.lockFades.length - 1; k >= 0; k--) {
      const a = this.lockFades[k];
      const t = (now - a.t0) / 0.4;
      if (t >= 1) {
        this.lockFades.splice(k, 1);
        continue;
      }
      g.globalAlpha = 1 - t;
      drawLock(g, a.x, a.y - t * 30, 72 * (1 + t * 0.3), LOCK_COLORS[a.lock % 3], Math.min(1, t * 3));
      g.globalAlpha = 1;
    }
  }

  drawEffects(g, now, dt) {
    const rm = this.opts.reducedMotion;
    // completed crates: lid + glow, then (after the slot frees) tumble up and poof
    for (let k = this.doneAnims.length - 1; k >= 0; k--) {
      const a = this.doneAnims[k];
      const t = (now - a.t0) / a.ts;
      if (t < 0.1) {
        const glow = g.createRadialGradient(a.x, a.y, 10, a.x, a.y, 120);
        glow.addColorStop(0, 'rgba(255,250,190,0.9)');
        glow.addColorStop(1, 'rgba(255,240,120,0)');
        g.fillStyle = glow;
        g.fillRect(a.x - 120, a.y - 120, 240, 240);
      }
      if (t < 0.45) continue; // the slot draws the lidded crate until it frees
      if (t > 1.1) {
        this.doneAnims.splice(k, 1);
        continue;
      }
      if (t < 0.85) {
        const u = (t - 0.45) / 0.4;
        const e = ease(u);
        const x = a.x + (540 - a.x) * e;
        const y = a.y + (800 - a.y) * e - Math.sin(u * Math.PI) * 60;
        g.save();
        g.translate(x, y);
        g.rotate((rm ? 0 : 0.35) * u);
        const s = 1 - 0.25 * u;
        g.scale(s, s);
        g.globalAlpha = rm ? 1 - u : 1;
        g.translate(-SLOT_W / 2, -SLOT_H / 2);
        drawCrate(g, COLORS[a.color].crate, SLOT_W, SLOT_H, 0, -1, true);
        g.restore();
        g.globalAlpha = 1;
      } else if (!a.poofed) {
        a.poofed = true;
        if (!rm) {
          for (let i = 0; i < 6; i++) this.parts.spawn(P_SMOKE, 540 + (Math.random() - 0.5) * 60, 800 + (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 120, -40, 0.45, 50 + Math.random() * 30);
          for (let i = 0; i < 26; i++) {
            const ang = Math.random() * 6.28;
            const v = 200 + Math.random() * 380;
            this.parts.spawn(P_CONFETTI, 540, 800, Math.cos(ang) * v, Math.sin(ang) * v - 150, 1.1, 14, (Math.random() * COLORS.length) | 0, 700);
          }
        }
      }
    }
    for (let k = this.dispGone.length - 1; k >= 0; k--) {
      const a = this.dispGone[k];
      if (now < a.t0) continue;
      this.dispGone.splice(k, 1);
      if (!rm) for (let i = 0; i < 8; i++) this.parts.spawn(P_SMOKE, a.x + (Math.random() - 0.5) * 90, a.y + (Math.random() - 0.5) * 80, (Math.random() - 0.5) * 60, -30, 0.7, 50 + Math.random() * 40);
    }

    // particles
    const P = this.parts;
    for (let i = 0; i < P.n; i++) {
      if (!P.on[i]) continue;
      P.age[i] += dt;
      const t = P.age[i] / P.life[i];
      if (t >= 1) {
        P.on[i] = 0;
        continue;
      }
      P.vy[i] += P.g[i] * dt;
      P.x[i] += P.vx[i] * dt;
      P.y[i] += P.vy[i] * dt;
      P.rot[i] += P.vr[i] * dt;
      const x = P.x[i];
      const y = P.y[i];
      const s = P.size[i];
      switch (P.type[i]) {
        case P_STAR:
          g.globalAlpha = 1 - t;
          g.fillStyle = '#ffe14a';
          g.beginPath();
          for (let j = 0; j < 8; j++) {
            const a = P.rot[i] + (j * Math.PI) / 4;
            const r = j & 1 ? s * 0.3 : s;
            g[j ? 'lineTo' : 'moveTo'](x + Math.cos(a) * r, y + Math.sin(a) * r);
          }
          g.fill();
          break;
        case P_CONFETTI:
          g.globalAlpha = 1 - t * t;
          g.fillStyle = COLORS[P.col[i]].bead;
          g.save();
          g.translate(x, y);
          g.rotate(P.rot[i]);
          g.fillRect(-s / 2, -s / 4, s, s / 2);
          g.restore();
          break;
        case P_SMOKE:
          g.globalAlpha = 0.85 * (1 - t);
          g.fillStyle = '#fff';
          g.beginPath();
          g.arc(x, y, s * (0.5 + t * 0.6), 0, 6.283);
          g.fill();
          break;
        case P_SHARD:
          g.globalAlpha = 1 - t;
          g.fillStyle = P.col[i] ? '#e8f6ff' : '#7cc4f4';
          g.save();
          g.translate(x, y);
          g.rotate(P.rot[i]);
          g.beginPath();
          g.moveTo(0, -s);
          g.lineTo(s * 0.6, 0);
          g.lineTo(0, s * 0.7);
          g.lineTo(-s * 0.5, 0);
          g.fill();
          g.restore();
          break;
        case P_QMARK:
          g.globalAlpha = 1 - t;
          outlinedText(g, '?', x, y, s, '#fff', '#1b1f26', 6);
          break;
        case P_SPARK:
          g.globalAlpha = 1 - t;
          g.fillStyle = '#fff';
          g.fillRect(x - s / 2, y - s / 2, s, s);
          break;
      }
    }
    g.globalAlpha = 1;

    if (this.banner) {
      const t = now - this.banner.t0;
      if (t > 1.3) this.banner = null;
      else {
        const s = rm ? 1 : t < 0.15 ? 0.6 + (t / 0.15) * 0.5 : t < 0.25 ? 1.1 - ((t - 0.15) / 0.1) * 0.1 : 1;
        g.save();
        g.globalAlpha = t > 1 ? 1 - (t - 1) / 0.3 : 1;
        g.translate(540, 790);
        g.scale(s, s);
        g.fillStyle = 'rgba(60,20,0,0.35)';
        outlinedText(g, this.banner.text, 6, 10, 104, 'rgba(60,30,10,0.4)', 'rgba(60,30,10,0.4)', 18);
        outlinedText(g, this.banner.text, 0, 0, 104, '#ffd83b', '#9a4a10', 16);
        g.restore();
        g.globalAlpha = 1;
      }
    }
  }
}
