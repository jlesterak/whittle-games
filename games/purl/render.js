// Purl canvas renderer. Everything is drawn in design pixels (1080x2316 portrait, ref
// 6.1) through one transform; sprites are pre-rendered at device resolution. The static parts
// (wallpaper, floor, frame, slot wells, board tiles and voids) live on a cached layer. Animated
// state comes from the sim (thread progress uses sim time) plus a few short-lived effects.

import { fitStage } from '../../core/stage.js';
import { COLORS, UI } from './colors.js';
import { SpriteSet, drawSprite, drawSpool, drawWinding, drawDispenser, drawBalloon, outlinedText, rr, shade, BLOCK_W, BLOCK_H } from './sprites.js';
import { CRATE, DISP, WALL as NOCELL, canPick } from '../../engines/slotsort/board.js';
import { BOBBIN_ROWS, BLOCK_ROWS } from './columns.js';

export const W = 1080;
export const H = 2316;
// Headroom above y=0 kept on screen for the frame's top rail.
export const FIT = { W, H, top: 175 };
const PIC_BOTTOM = 590;
const FRAME_TOP = -170; // the frame's top rail: the picture feeds down from behind it
const KNIT_TOP = -128; // the knit's bottom edge (ref 1.1)
const FRAME_BOTTOM = 628;
const SLOT_Y = 1007;
const SLOT_W = 113;
const SLOT_H = 86;
const BOB_W = 70;
const BOB_H = 80;
const BOB_Y = 975; // slotted bobbin centre (it stands on the slot)
const BOARD_TOP = 1250;
const BOARD_SPAN = 667;
const HOOK_Y = 470;
const PCT = Array.from({ length: 101 }, (_, i) => `${i}%`);
const ease = (t) => 1 - (1 - t) ** 3;
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

// ---- particles (fixed pool) ----
const P_SPARK = 0;
const P_PUFF = 1;
const P_FLASH = 2;

class Particles {
  constructor(n) {
    this.n = n;
    this.on = new Uint8Array(n);
    this.type = new Uint8Array(n);
    this.col = new Int16Array(n);
    for (const k of ['x', 'y', 'vx', 'vy', 'age', 'life', 'size']) this[k] = new Float32Array(n);
    this.next = 0;
  }
  spawn(type, x, y, vx, vy, life, size, col = 0) {
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
  }
  clear() {
    this.on.fill(0);
  }
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.layer = document.createElement('canvas');
    this.parts = new Particles(300);
    this.opts = { colourblind: false, reducedMotion: false };
    this.sprites = null;
    this.level = null;
    this.liftMode = false; // bobbin-arrow armed: every liftable bobbin stands up and glows
    this.fillMode = false; // scissors armed: a marker over every slotted bobbin
    this.rate = 1;
    this.resetAnims();
  }

  resetAnims() {
    this.slotAnim = []; // per slot: { t0, x0, y0 } pick flight
    this.doneAnims = []; // completed bobbins flying off: { t0, x, y, color, sparked }
    this.ejects = new Map(); // cell -> { t0, dur, fromX, fromY, color }
    this.shakes = new Map(); // cell -> t0
    this.stand = new Map(); // cell -> t0 of a stand-up (cap -> spool)
    this.flash = new Map(); // cell -> t0 of a "?" reveal flash
    this.gaps = []; // { lane, depth, t0 } a block left the middle/bottom: the column above slides
    this.snips = []; // { t0, x, y, slot, color }
    this.parks = []; // { t0, x0, y0, hook, color }
    this.threadT0 = new Map(); // lane -> t0 (thread shoot)
    this.loseT0 = -1;
    this.prevReach = null;
    this.slotShake = -1;
    this.parts?.clear();
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
    const x0 = this.knitX0;
    const kw = this.C * BLOCK_W;
    const b = this.sim.board;
    const [cx0, cy0] = this.cellXY(0);
    const [cx1, cy1] = this.cellXY(b.cols * b.rows - 1);
    const sw = SLOT_W * Math.min(1, this.slotPitch() / 137.5);
    const K = this.sim.slots.length;
    return [
      { ...css('frame', x0 - 64, FRAME_TOP, x0 + kw + 64, FRAME_BOTTOM + 14), hudOk: true }, // wide frames run under the side HUD
      css('picture', x0, KNIT_TOP, x0 + kw, PIC_BOTTOM),
      css('hooks', this.laneX(this.C) - 20, HOOK_Y - 62, this.laneX(this.C + 1) + 20, HOOK_Y),
      css('slots', this.slotX(0) - sw / 2, BOB_Y - BOB_H / 2 - 6, this.slotX(K - 1) + sw / 2, SLOT_Y + SLOT_H / 2 + 6),
      css('board', cx0 - 69, cy0 - this.pitchY / 2, cx1 + 69, cy1 + this.pitchY / 2), // cells with their grout
    ];
  }

  toDesign(cx, cy, rect) {
    return [(cx - rect.left - this.offX) / this.scale, (cy - rect.top - this.offY) / this.scale];
  }

  setLevel(level, sim) {
    this.level = level;
    this.sim = sim;
    this.C = level.columns.length;
    this.knitX0 = 540 - (this.C * BLOCK_W) / 2;
    this.resetAnims();
    this.prevReach = sim.reach.slice();
    this.staticDirty = true;
  }

  ensureSprites() {
    if (!this.sprites) {
      this.sprites = new SpriteSet(this.k, this.opts.colourblind);
      this.staticDirty = true;
    }
  }

  // ---- geometry ----
  get pitchY() {
    return Math.min(111, BOARD_SPAN / this.sim.board.rows);
  }

  cellXY(i) {
    const b = this.sim.board;
    const r = (i / b.cols) | 0;
    const c = i - r * b.cols;
    return [540 + (c - (b.cols - 1) / 2) * 137.5, BOARD_TOP + r * this.pitchY];
  }

  slotPitch() {
    return this.sim.slots.length <= 7 ? 137.5 : 126;
  }

  slotX(s) {
    return 540 + (s - (this.sim.slots.length - 1) / 2) * this.slotPitch();
  }

  laneX(l) {
    if (l < this.C) return this.knitX0 + (l + 0.5) * BLOCK_W;
    return l === this.C ? this.knitX0 - 105 : this.knitX0 + this.C * BLOCK_W + 105;
  }

  hookXY(h) {
    return [this.laneX(h), HOOK_Y];
  }

  dispDir(d) {
    const b = this.sim.board;
    const disp = b.disps[d];
    const z = disp.zone[0];
    if (z === disp.cell - 1) return 'left';
    if (z === disp.cell + 1) return 'right';
    return 'down';
  }

  // ---------- static layer ----------
  buildStatic() {
    const L = this.layer;
    L.width = this.canvas.width;
    L.height = this.canvas.height;
    const g = L.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = UI.surround;
    g.fillRect(0, 0, L.width, L.height);
    g.setTransform(this.k, 0, 0, this.k, this.offX * this.dpr, this.offY * this.dpr);
    // wallpaper stripes, floor band, maroon surround
    g.fillStyle = UI.wallpaper;
    g.fillRect(-3000, -1400, W + 6000, 2100);
    g.fillStyle = UI.wallpaper2;
    for (let x = -3000; x < W + 3000; x += 72) g.fillRect(x, -1400, 30, 2100);
    const fb = g.createLinearGradient(0, 640, 0, 1190);
    fb.addColorStop(0, '#e2b9b1');
    fb.addColorStop(0.15, UI.floorBand);
    fb.addColorStop(1, UI.floorBand2);
    g.fillStyle = fb;
    g.fillRect(-3000, 640, W + 6000, 560);
    g.fillStyle = '#c99289';
    g.fillRect(-3000, 636, W + 6000, 8);
    const sb = g.createLinearGradient(0, 1180, 0, H);
    sb.addColorStop(0, UI.surround);
    sb.addColorStop(1, UI.bottom);
    g.fillStyle = sb;
    g.fillRect(-3000, 1190, W + 6000, H);

    // picture frame: dark backboard, wood strips, bottom bar
    const x0 = this.knitX0;
    const kw = this.C * BLOCK_W;
    g.fillStyle = '#00000030';
    g.fillRect(x0 - 50, FRAME_TOP + 10, kw + 116, FRAME_BOTTOM + 4 - FRAME_TOP);
    g.fillStyle = UI.back;
    g.fillRect(x0 - 16, FRAME_TOP, kw + 32, FRAME_BOTTOM - FRAME_TOP);
    for (const wx of [x0 - 58, x0 + kw + 16]) {
      const wg = g.createLinearGradient(wx, 0, wx + 42, 0);
      wg.addColorStop(0, UI.woodEdge);
      wg.addColorStop(0.3, UI.wood);
      wg.addColorStop(1, shade(UI.wood, -0.2));
      g.fillStyle = wg;
      g.fillRect(wx, FRAME_TOP, 42, FRAME_BOTTOM - FRAME_TOP);
    }
    const tg = g.createLinearGradient(0, FRAME_TOP, 0, KNIT_TOP);
    tg.addColorStop(0, UI.woodEdge);
    tg.addColorStop(1, shade(UI.wood, -0.15));
    g.fillStyle = tg;
    rr(g, x0 - 64, FRAME_TOP, kw + 128, KNIT_TOP - FRAME_TOP, 8);
    g.fill();
    const bg = g.createLinearGradient(0, PIC_BOTTOM + 12, 0, FRAME_BOTTOM);
    bg.addColorStop(0, UI.woodEdge);
    bg.addColorStop(1, shade(UI.wood, -0.15));
    g.fillStyle = bg;
    g.fillRect(x0 - 58, PIC_BOTTOM + 14, kw + 116, FRAME_BOTTOM - PIC_BOTTOM - 14);
    // balloon hooks either side of the frame
    for (let h = 0; h < 2; h++) {
      const [hx, hy] = this.hookXY(this.C + h);
      g.strokeStyle = '#d9b25a';
      g.lineWidth = 7;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(hx, hy - 50);
      g.lineTo(hx, hy - 20);
      g.arc(hx + 10, hy - 20, 10, Math.PI, 0, true);
      g.stroke();
      g.fillStyle = '#b08a3a';
      g.beginPath();
      g.arc(hx, hy - 54, 8, 0, Math.PI * 2);
      g.fill();
    }

    // slot wells
    const K = this.sim.slots.length;
    const sw = SLOT_W * Math.min(1, this.slotPitch() / 137.5);
    for (let s = 0; s < K; s++) {
      const x = this.slotX(s);
      g.fillStyle = '#b48c86';
      rr(g, x - sw / 2, SLOT_Y - SLOT_H / 2 + 6, sw, SLOT_H, 16);
      g.fill();
      const sg = g.createLinearGradient(0, SLOT_Y - SLOT_H / 2, 0, SLOT_Y + SLOT_H / 2);
      sg.addColorStop(0, '#f4f2f0');
      sg.addColorStop(1, UI.slot);
      g.fillStyle = sg;
      rr(g, x - sw / 2, SLOT_Y - SLOT_H / 2, sw, SLOT_H, 16);
      g.fill();
    }

    // board: grout, tiles, then raised voids
    const b = this.sim.board;
    const py = this.pitchY;
    for (let i = 0; i < b.n; i++) {
      if (b.kind[i] === NOCELL) continue;
      const [x, y] = this.cellXY(i);
      g.fillStyle = UI.grout;
      g.fillRect(x - 69, y - py / 2 - 1, 138, py + 2);
    }
    for (let i = 0; i < b.n; i++) {
      if (b.kind[i] === NOCELL) continue;
      const [x, y] = this.cellXY(i);
      g.fillStyle = shade(UI.tile, -0.08);
      rr(g, x - 62, y - py / 2 + 6, 124, py - 8, 14);
      g.fill();
      g.fillStyle = UI.tile;
      rr(g, x - 62, y - py / 2 + 4, 124, py - 12, 14);
      g.fill();
    }
    // walls jutting into the board: one raised maroon mass (adjacent voids merge, no seams);
    // voids on the board's outline are left as plain surround
    const walls = new Map(); // cell -> [x, y]
    for (let i = 0; i < b.n; i++) {
      if (b.kind[i] !== NOCELL) continue;
      const below = i + b.cols < b.n && b.kind[i + b.cols] !== NOCELL;
      if (below || this.innerVoid(i)) walls.set(i, this.cellXY(i));
    }
    for (const [fill, dy] of [['#00000038', 10], [UI.void, -2]]) {
      g.fillStyle = fill;
      for (const [i, [x, y]] of walls) {
        rr(g, x - 70, y - py / 2 + dy, 140, py + 4, 16);
        g.fill();
        // bridge to wall neighbours right and below so the mass has no seams
        if (walls.has(i + 1) && (i + 1) % b.cols) g.fillRect(x, y - py / 2 + dy, 137.5, py + 4);
        if (walls.has(i + b.cols)) g.fillRect(x - 70, y + dy, 140, py);
      }
    }
    this.staticDirty = false;
  }

  // A void with board cells on both sides in its row (a wall jutting into the board).
  innerVoid(i) {
    const b = this.sim.board;
    const r = (i / b.cols) | 0;
    let left = false;
    let right = false;
    for (let c = 0; c < b.cols; c++) {
      const j = r * b.cols + c;
      if (b.kind[j] === NOCELL) continue;
      if (j < i) left = true;
      else right = true;
    }
    return left && right;
  }

  dur(sec) {
    return sec / this.rate;
  }

  onEvent(e, now) {
    const rm = this.opts.reducedMotion;
    switch (e.type) {
      case 'pick': {
        const [x0, y0] = this.cellXY(e.cell);
        this.slotAnim[e.slot] = { t0: now, x0, y0 };
        for (const ej of e.info.ejects) {
          const [fx, fy] = this.cellXY(ej.from);
          this.ejects.set(ej.to, { t0: now, dur: this.dur(0.2), fromX: fx, fromY: fy, color: ej.color });
        }
        break;
      }
      case 'thread':
        this.threadT0.set(e.lane, now);
        break;
      case 'reveal':
        this.flash.set(e.cell, now);
        break;
      case 'slotFree': {
        const x = this.slotX(e.slot);
        this.doneAnims.push({ t0: now, x, y: BOB_Y, color: e.color, sparked: false });
        break;
      }
      case 'snip': {
        const lane = e.lane;
        let x;
        let y;
        if (lane >= this.C) [x, y] = this.hookXY(lane);
        else {
          x = this.laneX(lane);
          y = PIC_BOTTOM - (e.depth + 0.5) * BLOCK_H;
          this.gaps.push({ lane, depth: e.depth, t0: now });
        }
        this.snips.push({ t0: now, x, y: Math.max(KNIT_TOP + 40, y), slot: e.slot, color: e.color });
        if (!rm) for (let i = 0; i < 8; i++) this.parts.spawn(P_PUFF, x + (Math.random() - 0.5) * 80, Math.max(KNIT_TOP + 40, y), (Math.random() - 0.5) * 120, -60 - Math.random() * 80, 0.5, 18, e.color);
        break;
      }
      case 'park': {
        this.parks.push({ t0: now, x0: this.laneX(e.lane), y0: PIC_BOTTOM - BLOCK_H / 2, hook: e.hook, color: e.color });
        this.gaps.push({ lane: e.lane, depth: 0, t0: now });
        break;
      }
      case 'lose':
        this.loseT0 = now;
        break;
      case 'addSlot':
        this.loseT0 = -1;
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

  hitCell(x, y) {
    const b = this.sim.board;
    const py = this.pitchY;
    for (let i = 0; i < b.n; i++) {
      if (b.kind[i] === NOCELL) continue;
      const [cx, cy] = this.cellXY(i);
      if (Math.abs(x - cx) < 69 && y > cy - py / 2 - 20 && y < cy + py / 2) return i;
    }
    return -1;
  }

  hitSlot(x, y) {
    const half = this.slotPitch() / 2;
    for (let s = 0; s < this.sim.slots.length; s++) {
      if (Math.abs(x - this.slotX(s)) < half && y > SLOT_Y - 110 && y < SLOT_Y + 90) return s;
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
    this.drawPicture(g, now);
    this.drawHooks(g, now);
    this.drawThreads(g, now);
    this.drawBoard(g, now);
    this.drawSlots(g, now);
    this.drawEffects(g, now, dt);
  }

  // Extra upward offset of block d in a lane while gaps below it close.
  gapOffset(lane, d, now) {
    let off = 0;
    for (const gp of this.gaps) {
      if (gp.lane === lane && gp.depth <= d) off += (1 - ease(clamp01((now - gp.t0) / 0.35))) * BLOCK_H;
    }
    return off;
  }

  drawPicture(g, now) {
    const sim = this.sim;
    const sup = sim.supply;
    const x0 = this.knitX0;
    const sp = this.sprites;
    this.gaps = this.gaps.filter((gp) => now - gp.t0 < 0.35);
    g.save();
    g.beginPath();
    g.rect(x0, KNIT_TOP, this.C * BLOCK_W, PIC_BOTTOM - KNIT_TOP + 8);
    g.clip();
    for (let l = 0; l < this.C; l++) {
      const lane = sup.lanes[l];
      const x = x0 + l * BLOCK_W;
      let y = PIC_BOTTOM;
      if (lane.run) {
        // the bottom block unravels row by row; the column slides down with it
        const f = clamp01((lane.run.end - sim.time) / (lane.run.end - lane.run.t0));
        const h = f * BLOCK_H;
        if (h > 0.5) {
          const s = sp.blocks[lane.run.color];
          g.drawImage(s.img, 0, 0, s.img.width, s.img.height * f, x, y - h, BLOCK_W, h);
          drawSprite(g, sp.loops, x, y - 4);
        }
        y -= h;
      }
      const st = lane.stack;
      for (let d = 0; d < st.length; d++) {
        const by = y - (d + 1) * BLOCK_H - this.gapOffset(l, d, now);
        if (by + BLOCK_H < KNIT_TOP) break;
        drawSprite(g, sp.blocks[st[d]], x, by);
      }
      if (!lane.run && st.length) drawSprite(g, sp.loops, x, y - 4);
    }
    g.restore();
    // a soft shadow under the top rail (the picture runs on behind it)
    const sh = g.createLinearGradient(0, KNIT_TOP, 0, KNIT_TOP + 50);
    sh.addColorStop(0, '#0007');
    sh.addColorStop(1, '#0000');
    g.fillStyle = sh;
    g.fillRect(x0, KNIT_TOP, this.C * BLOCK_W, 50);
  }

  drawHooks(g, now) {
    const sim = this.sim;
    const sup = sim.supply;
    const sp = this.sprites;
    for (let h = 0; h < 2; h++) {
      const l = this.C + h;
      const lane = sup.lanes[l];
      const [hx, hy] = this.hookXY(l);
      const park = this.parks.find((p) => p.hook === l);
      if (park) {
        const t = (now - park.t0) / this.dur(0.8);
        if (t < 1) {
          const e = ease(t);
          const x = park.x0 + (hx - park.x0) * e;
          const y = park.y0 + (hy + 40 - park.y0) * e - Math.sin(t * Math.PI) * 120;
          const sc = 1 - 0.4 * e;
          drawSprite(g, sp.blocks[park.color], x - (BLOCK_W * sc) / 2, y - (BLOCK_H * sc) / 2, sc);
          drawBalloon(g, x, y - (BLOCK_H * sc) / 2, Math.sin(now * 3));
          continue;
        }
        this.parks.splice(this.parks.indexOf(park), 1);
      }
      let color = -1;
      let f = 1;
      if (lane.run) {
        color = lane.run.color;
        f = clamp01((lane.run.end - sim.time) / (lane.run.end - lane.run.t0));
      } else if (lane.stack.length) color = lane.stack[0];
      if (color < 0) continue;
      const sc = 0.6;
      const w = BLOCK_W * sc;
      const hh = BLOCK_H * sc;
      const s = sp.blocks[color];
      // the swatch hangs from the hook and unravels from the bottom
      g.drawImage(s.img, 0, 0, s.img.width, s.img.height * f, hx - w / 2, hy - 8, w, hh * f);
      if (!lane.run) drawBalloon(g, hx, hy - 30, Math.sin(now * 2 + h));
    }
  }

  // Thread start point for a lane's running block.
  threadFrom(l) {
    if (l < this.C) return [this.laneX(l), PIC_BOTTOM + 4];
    const [hx, hy] = this.hookXY(l);
    return [hx, hy - 8 + BLOCK_H * 0.6];
  }

  drawThreads(g, now) {
    const sim = this.sim;
    const sup = sim.supply;
    g.lineCap = 'round';
    for (let l = 0; l < sup.lanes.length; l++) {
      const run = sup.lanes[l].run;
      if (!run || run.slot < 0) continue;
      const [x0, y0] = this.threadFrom(l);
      this.thread(g, x0, y0, this.slotX(run.slot), BOB_Y - 30, run.color, clamp01((now - (this.threadT0.get(l) ?? now - 1)) / 0.18), now);
    }
    // scissors: threads from the cut blocks while the bobbin fills
    this.snips = this.snips.filter((s) => now - s.t0 < this.dur(1.8));
    for (const s of this.snips) {
      const t = (now - s.t0) / this.dur(1.8);
      if (sim.slots[s.slot]) this.thread(g, s.x, s.y, this.slotX(s.slot), BOB_Y - 30, s.color, clamp01(t * 6), now);
      if (t < 0.4) outlinedText(g, '✂', s.x + 30, s.y - 20, 64, '#e8323c', '#fff', 8);
    }
  }

  thread(g, x0, y0, x1, y1, color, grow, now) {
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2 + 40 + Math.sin(now * 2 + x0) * 6;
    const ex = x0 + (x1 - x0) * grow;
    const ey = y0 + (y1 - y0) * grow;
    const cx = x0 + (mx - x0) * grow;
    const cy = y0 + (my - y0) * grow;
    g.strokeStyle = shade(COLORS[color].yarn, -0.35);
    g.lineWidth = 9;
    g.beginPath();
    g.moveTo(x0, y0);
    g.quadraticCurveTo(cx, cy, ex, ey);
    g.stroke();
    g.strokeStyle = COLORS[color].yarn;
    g.lineWidth = 6;
    g.stroke();
  }

  drawBoard(g, now) {
    const sim = this.sim;
    const b = sim.board;
    const sp = this.sprites;
    const reach = sim.reach;
    const prev = this.prevReach;
    for (let i = 0; i < b.n; i++) {
      const kind = b.kind[i];
      if (prev) {
        if (kind === CRATE && reach[i] && !prev[i] && !this.ejects.has(i)) this.stand.set(i, now);
        prev[i] = kind === CRATE ? reach[i] : 0;
      }
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
        const left = b.disps[d].queue.length - b.dispIdx[d];
        let open = 0;
        const ej = this.ejects.get(b.disps[d].zone[0]);
        if (ej) open = clamp01(1 - (now - ej.t0) / ej.dur);
        drawDispenser(g, x, y, this.dispDir(d), left, open);
        continue;
      }
      const ej = this.ejects.get(i);
      if (ej) {
        const t = (now - ej.t0) / ej.dur;
        if (t < 1) {
          const e = ease(t);
          drawSprite(g, sp.spools[ej.color], ej.fromX + (x - ej.fromX) * e, ej.fromY + (y - ej.fromY) * e - 14);
          continue;
        }
        this.ejects.delete(i);
      }
      const c = b.color[i];
      const up = this.liftMode ? canPick(b, i, reach, true) : reach[i] === 1 && sim.readyAt[i] <= sim.time;
      if (this.liftMode && up) {
        g.fillStyle = '#fff7b0aa';
        g.beginPath();
        g.ellipse(x, y + 4, 60, 46, 0, 0, Math.PI * 2);
        g.fill();
      }
      if (b.hid[i]) {
        // still a "?" (lift mode may take it, but doesn't show its colour)
        drawSprite(g, sp.hidden, x, y);
        continue;
      }
      const st = this.stand.get(i);
      if (up && st !== undefined && now - st < 0.18) {
        const k = ease((now - st) / 0.18);
        drawSprite(g, sp.caps[c], x, y + 6, 1 - k * 0.3);
        g.save();
        g.translate(x, y + 30);
        g.scale(1, 0.3 + 0.7 * k);
        drawSprite(g, sp.spools[c], 0, -30);
        g.restore();
      } else if (up) {
        drawSprite(g, sp.spools[c], x, y - 12);
      } else {
        drawSprite(g, sp.caps[c], x, y + 4);
      }
      const fl = this.flash.get(i);
      if (fl !== undefined) {
        const t = (now - fl) / 0.25;
        if (t > 1) this.flash.delete(i);
        else {
          g.fillStyle = `rgba(255,255,255,${0.85 * (1 - t)})`;
          g.beginPath();
          g.ellipse(x, y, 56, 48, 0, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
  }

  // Rows shown in slot s: landed plus the part-row each feeding thread has pulled.
  shownRows(s, sl) {
    let n = sl.landed;
    for (const lane of this.sim.supply.lanes) {
      const run = lane.run;
      if (!run || run.slot !== s) continue;
      const p = ((this.sim.time - run.t0) / (run.end - run.t0)) * BLOCK_ROWS;
      n += p - Math.floor(p);
    }
    return Math.min(BOBBIN_ROWS, n);
  }

  drawSlots(g, now) {
    const sim = this.sim;
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
      let x = this.slotX(s) + shakeX;
      let y = BOB_Y;
      let rot = 0;
      let landed = true;
      const a = this.slotAnim[s];
      if (a) {
        const t = (now - a.t0) / this.dur(0.45);
        if (t < 1) {
          // tumbling arc from the board up to the slot
          const e = ease(t);
          x = a.x0 + (x - a.x0) * e;
          y = a.y0 + (y - a.y0) * e - Math.sin(t * Math.PI) * 140;
          rot = this.opts.reducedMotion ? 0 : t * Math.PI * 2;
          landed = false;
        }
      }
      // Out of space: topple left to right
      if (this.loseT0 >= 0 && sim.status === 'lost') rot = (Math.PI / 2) * ease(clamp01((now - this.loseT0 - 0.1 - s * 0.18) / 0.15));
      const col = COLORS[sl.color].bobbin;
      const shown = landed ? this.shownRows(s, sl) : 0;
      g.save();
      g.translate(x, y + (rot ? 18 * Math.min(1, rot) : 0));
      if (rot) g.rotate(rot);
      drawSpool(g, col, BOB_W, BOB_H, { wood: true, outline: false });
      drawWinding(g, COLORS[sl.color].yarn, 0, 0, BOB_W, BOB_H, shown / BOBBIN_ROWS);
      g.restore();
      if (!landed) continue;
      if (this.fillMode && sl.doneAt < 0) outlinedText(g, '✂', x, y - 80, 50, '#e8323c', '#fff', 8);
      // 3-segment bar and percentage
      for (let k = 0; k < 3; k++) {
        const bx = x - 50 + k * 34;
        g.fillStyle = '#00000030';
        rr(g, bx, 1056, 30, 12, 4);
        g.fill();
        const f = clamp01(shown / BLOCK_ROWS - k);
        if (f > 0) {
          g.fillStyle = COLORS[sl.color].bobbin;
          rr(g, bx, 1056, 30 * f, 12, 4);
          g.fill();
        }
      }
      g.fillStyle = '#4a3a3a';
      g.font = `800 30px ui-rounded, system-ui, Roboto, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(PCT[Math.floor((shown / BOBBIN_ROWS) * 100 + 1e-6)], x, 1092);
    }
  }

  drawEffects(g, now, dt) {
    const rm = this.opts.reducedMotion;
    // completed bobbins pop up, fly toward the picture turning sideways, and sparkle
    for (let k = this.doneAnims.length - 1; k >= 0; k--) {
      const d = this.doneAnims[k];
      const t = (now - d.t0) / this.dur(0.45);
      if (t >= 1) {
        if (!d.sparked && !rm) {
          for (let i = 0; i < 9; i++) {
            const a = Math.random() * 6.28;
            const v = 160 + Math.random() * 200;
            this.parts.spawn(P_SPARK, d.tx, d.ty, Math.cos(a) * v, Math.sin(a) * v, 0.35, 22);
          }
        }
        this.doneAnims.splice(k, 1);
        continue;
      }
      d.tx = d.x + (540 - d.x) * 0.25;
      d.ty = 720;
      const e = ease(t);
      const x = d.x + (d.tx - d.x) * e;
      const y = d.y - 30 * Math.sin(Math.min(1, t * 3) * Math.PI * 0.5) + (d.ty - d.y) * e;
      g.save();
      g.translate(x, y);
      g.rotate((Math.PI / 2) * e);
      g.scale(1 - 0.5 * e, (1 - 0.5 * e) * (t < 0.2 ? 1.2 : 1));
      drawSpool(g, COLORS[d.color].bobbin, BOB_W, BOB_H, { wood: true, outline: false });
      drawWinding(g, COLORS[d.color].yarn, 0, 0, BOB_W, BOB_H, 1);
      g.restore();
    }
    const P = this.parts;
    for (let i = 0; i < P.n; i++) {
      if (!P.on[i]) continue;
      P.age[i] += dt;
      const t = P.age[i] / P.life[i];
      if (t >= 1) {
        P.on[i] = 0;
        continue;
      }
      P.x[i] += P.vx[i] * dt;
      P.y[i] += P.vy[i] * dt;
      if (P.type[i] === P_SPARK) {
        g.strokeStyle = `rgba(255,255,255,${1 - t})`;
        g.lineWidth = 4;
        g.beginPath();
        g.moveTo(P.x[i], P.y[i]);
        g.lineTo(P.x[i] - P.vx[i] * 0.06, P.y[i] - P.vy[i] * 0.06);
        g.stroke();
      } else if (P.type[i] === P_PUFF) {
        g.fillStyle = COLORS[P.col[i]].yarn;
        g.globalAlpha = 1 - t;
        g.beginPath();
        g.arc(P.x[i], P.y[i], P.size[i] * (0.5 + t), 0, Math.PI * 2);
        g.fill();
        g.globalAlpha = 1;
      } else if (P.type[i] === P_FLASH) {
        g.fillStyle = `rgba(255,255,255,${0.8 * (1 - t)})`;
        g.beginPath();
        g.arc(P.x[i], P.y[i], P.size[i], 0, Math.PI * 2);
        g.fill();
      }
    }
  }
}
