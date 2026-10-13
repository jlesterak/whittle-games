// Purl sprites, drawn procedurally (no image files) in design pixels and cached at
// device resolution: knitted blocks (4 stitches x 6 rows), upright spools, flat caps, hidden
// caps, plus per-frame helpers for dispensers, balloons and outlined text.

import { COLORS, HIDDEN, UI } from './colors.js';

export const BLOCK_W = 114;
export const BLOCK_H = 109;
export const SPOOL_W = 92;
export const SPOOL_H = 96;
export const CAP_W = 86;

// Mix a #rrggbb colour toward black (amt < 0) or white (amt > 0).
export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const t = amt < 0 ? 0 : 255;
  const a = Math.abs(amt);
  const ch = (v) => Math.round(v + (t - v) * a);
  return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

export function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

function makeCanvas(w, h, k, draw) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w * k));
  c.height = Math.max(1, Math.ceil(h * k));
  const g = c.getContext('2d');
  g.scale(k, k);
  draw(g);
  return c;
}

// A sprite centred on (ox, oy) in design units.
function sprite(w, h, k, ox, oy, draw) {
  const img = makeCanvas(w, h, k, (g) => {
    g.translate(ox, oy);
    draw(g);
  });
  return { img, dw: w, dh: h, ox, oy };
}

export function drawSprite(g, s, x, y, sc = 1) {
  g.drawImage(s.img, x - s.ox * sc, y - s.oy * sc, s.dw * sc, s.dh * sc);
}

export function outlinedText(g, text, x, y, size, fill, stroke, lw) {
  g.font = `900 ${size}px ui-rounded, 'Arial Rounded MT Bold', system-ui, Roboto, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = lw;
  g.strokeStyle = stroke;
  g.strokeText(text, x, y);
  g.fillStyle = fill;
  g.fillText(text, x, y);
}

function symbol(g, c, x, y, size, colour = '#fff') {
  g.font = `900 ${size}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = size * 0.18;
  g.strokeStyle = '#0008';
  g.strokeText(COLORS[c].sym, x, y);
  g.fillStyle = colour;
  g.fillText(COLORS[c].sym, x, y);
}

// ---- knit ----
function drawBlock(g, hex) {
  g.fillStyle = shade(hex, -0.5);
  g.fillRect(0, 0, BLOCK_W, BLOCK_H);
  const sw = BLOCK_W / 4;
  const sh = BLOCK_H / 6;
  const edge = shade(hex, -0.38);
  const hi = shade(hex, 0.28);
  for (let r = 0; r < 6; r++) {
    for (let s = 0; s < 4; s++) {
      const x = s * sw;
      const y = r * sh;
      for (const side of [-1, 1]) {
        g.save();
        g.translate(x + sw / 2 + side * sw * 0.22, y + sh * 0.55);
        g.rotate(side * 0.5);
        const grd = g.createLinearGradient(-6, -10, 6, 10);
        grd.addColorStop(0, hi);
        grd.addColorStop(0.55, hex);
        grd.addColorStop(1, shade(hex, -0.18));
        g.fillStyle = grd;
        g.beginPath();
        g.ellipse(0, 0, sw * 0.24, sh * 0.66, 0, 0, Math.PI * 2);
        g.fill();
        g.lineWidth = 1.4;
        g.strokeStyle = edge;
        g.stroke();
        g.restore();
      }
    }
  }
}

// ---- spools ----
function cylinder(g, cx, cy, rx, ry, h, top, side) {
  g.fillStyle = side;
  g.beginPath();
  g.ellipse(cx, cy + h, rx, ry, 0, 0, Math.PI);
  g.lineTo(cx - rx, cy);
  g.ellipse(cx, cy, rx, ry, 0, Math.PI, 0, true);
  g.closePath();
  g.fill();
  g.fillStyle = top;
  g.beginPath();
  g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  g.fill();
}

// Upright spool centred at 0,0 (w x h). wood: barrel is bare wood (slot bobbins wind yarn on it).
export function drawSpool(g, hex, w, h, { outline = true, wood = false } = {}) {
  const fr = w / 2;
  const fry = w * 0.2;
  const fh = h * 0.13;
  const top = -h / 2 + fry;
  const bot = h / 2 - fry - fh;
  const br = w * 0.33;
  g.lineJoin = 'round';
  if (outline) {
    // a thin black outline: each part drawn a little bigger in black first
    const o = 3.5;
    cylinder(g, 0, bot - o, fr + o, fry + o, fh + o * 2, '#1b1416', '#1b1416');
    g.fillStyle = '#1b1416';
    g.fillRect(-br - o, top, br * 2 + o * 2, bot - top);
    cylinder(g, 0, top - fh - o, fr + o, fry + o, fh + o * 2, '#1b1416', '#1b1416');
  }
  cylinder(g, 0, bot, fr, fry, fh, shade(hex, -0.05), shade(hex, -0.3));
  const bg = g.createLinearGradient(-br, 0, br, 0);
  const base = wood ? '#e8cba0' : hex;
  bg.addColorStop(0, shade(base, -0.25));
  bg.addColorStop(0.35, shade(base, 0.25));
  bg.addColorStop(1, shade(base, -0.3));
  g.fillStyle = bg;
  g.fillRect(-br, top, br * 2, bot - top + 2);
  if (wood) {
    g.strokeStyle = '#c99f6e';
    g.lineWidth = 1.5;
    for (let i = 1; i < 4; i++) {
      g.beginPath();
      g.moveTo(-br + (br * 2 * i) / 4, top + 4);
      g.lineTo(-br + (br * 2 * i) / 4 + 3, bot - 2);
      g.stroke();
    }
  }
  cylinder(g, 0, top - fh, fr, fry, fh, shade(hex, 0.12), shade(hex, -0.22));
  // the hole and a gloss streak on the top flange
  g.fillStyle = shade(hex, -0.55);
  g.beginPath();
  g.ellipse(0, top - fh, br * 0.62, fry * 0.5, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#ffffff70';
  g.lineWidth = 3;
  g.beginPath();
  g.ellipse(0, top - fh, fr * 0.78, fry * 0.7, 0, Math.PI * 1.1, Math.PI * 1.45);
  g.stroke();
}

// Yarn wound on a slot bobbin's barrel, bottom up, for fill 0..1.
export function drawWinding(g, hex, x, y, w, h, fill) {
  if (fill <= 0) return;
  const fry = w * 0.2;
  const fh = h * 0.13;
  const top = y - h / 2 + fry;
  const bot = y + h / 2 - fry - fh;
  const br = w * 0.33 + w * 0.12 * fill;
  const span = bot - top;
  const yTop = bot - span * Math.min(1, fill);
  const grd = g.createLinearGradient(x - br, 0, x + br, 0);
  grd.addColorStop(0, shade(hex, -0.3));
  grd.addColorStop(0.4, shade(hex, 0.2));
  grd.addColorStop(1, shade(hex, -0.35));
  g.fillStyle = grd;
  g.fillRect(x - br, yTop, br * 2, bot - yTop + 1);
  g.strokeStyle = shade(hex, -0.4);
  g.lineWidth = 1.5;
  for (let yy = bot - 5; yy > yTop; yy -= 6) {
    g.beginPath();
    g.moveTo(x - br, yy);
    g.quadraticCurveTo(x, yy + 3, x + br, yy);
    g.stroke();
  }
}

// A flat cap (buried bobbin seen from above): a short puck.
function drawCap(g, top, side, w) {
  const rx = w / 2;
  const ry = w * 0.3;
  g.fillStyle = '#0000002a';
  g.beginPath();
  g.ellipse(0, 22, rx + 2, ry, 0, 0, Math.PI * 2);
  g.fill();
  cylinder(g, 0, -4, rx, ry, 20, top, side);
  g.strokeStyle = '#ffffff60';
  g.lineWidth = 3;
  g.beginPath();
  g.ellipse(0, -4, rx * 0.8, ry * 0.7, 0, Math.PI * 1.1, Math.PI * 1.5);
  g.stroke();
}

export class SpriteSet {
  constructor(k, colourblind) {
    this.k = k;
    this.cb = colourblind;
    this.blocks = [];
    this.spools = [];
    this.caps = [];
    for (let c = 0; c < COLORS.length; c++) {
      const col = COLORS[c];
      this.blocks.push(
        sprite(BLOCK_W, BLOCK_H, k, 0, 0, (g) => {
          drawBlock(g, col.yarn);
          if (colourblind) symbol(g, c, BLOCK_W / 2, BLOCK_H / 2, 34);
        }),
      );
      this.spools.push(
        sprite(SPOOL_W + 12, SPOOL_H + 12, k, SPOOL_W / 2 + 6, SPOOL_H / 2 + 6, (g) => {
          drawSpool(g, col.bobbin, SPOOL_W, SPOOL_H);
          if (colourblind) symbol(g, c, 0, 8, 30);
        }),
      );
      this.caps.push(
        sprite(CAP_W + 8, CAP_W, k, CAP_W / 2 + 4, CAP_W / 2, (g) => {
          drawCap(g, col.cap, shade(col.cap, -0.28), CAP_W);
          if (colourblind) symbol(g, c, 0, -4, 26);
        }),
      );
    }
    this.hidden = sprite(CAP_W + 8, CAP_W, k, CAP_W / 2 + 4, CAP_W / 2, (g) => {
      drawCap(g, HIDDEN.cap, shade(HIDDEN.cap, -0.25), CAP_W);
      outlinedText(g, '?', 0, -4, 40, HIDDEN.mark, '#ffffff', 3);
    });
    this.loops = sprite(BLOCK_W, 14, k, 0, 0, (g) => {
      for (let s = 0; s < 4; s++) {
        g.strokeStyle = '#00000055';
        g.lineWidth = 3;
        g.beginPath();
        g.ellipse(s * (BLOCK_W / 4) + BLOCK_W / 8, 4, 6, 6, 0, 0, Math.PI);
        g.stroke();
      }
    });
  }
}

// Glass dome dispenser centred at x, y. dir: 'left' | 'right' | 'down' (its open side).
export function drawDispenser(g, x, y, dir, left, open = 0) {
  g.save();
  g.translate(x, y);
  if (dir === 'right') g.scale(-1, 1);
  else if (dir === 'down') g.rotate(-Math.PI / 2);
  // back plate on the side away from the opening
  g.fillStyle = shade(UI.plate, -0.25);
  rr(g, 24, -50, 22, 100, 8);
  g.fill();
  g.fillStyle = UI.plate;
  rr(g, 22, -48, 16, 92, 6);
  g.fill();
  // dome
  const s = 1 + open * 0.06;
  g.scale(s, s);
  const grd = g.createRadialGradient(-6, -18, 6, 0, 0, 60);
  grd.addColorStop(0, '#ffffffee');
  grd.addColorStop(0.5, `${UI.glass}cc`);
  grd.addColorStop(1, '#7f97b8dd');
  g.fillStyle = grd;
  g.beginPath();
  g.moveTo(26, -44);
  g.bezierCurveTo(-30, -48, -52, -10, -46, 22);
  g.lineTo(-46, 40);
  g.lineTo(26, 40);
  g.closePath();
  g.fill();
  g.strokeStyle = '#6f84a8';
  g.lineWidth = 3;
  g.stroke();
  g.strokeStyle = '#ffffffb0';
  g.lineWidth = 5;
  g.beginPath();
  g.arc(-2, 2, 34, Math.PI * 1.15, Math.PI * 1.5);
  g.stroke();
  g.restore();
  if (left > 0) outlinedText(g, String(left), x + (dir === 'left' ? -6 : dir === 'right' ? 6 : 0), y + (dir === 'down' ? 8 : 4), 52, '#fff', '#4a4458', 9);
}

// A red balloon with a string down to (x, y).
export function drawBalloon(g, x, y, sway = 0) {
  const bx = x + sway * 8;
  const by = y - 95;
  g.strokeStyle = '#ffffffc0';
  g.lineWidth = 2.5;
  g.beginPath();
  g.moveTo(x, y);
  g.quadraticCurveTo(x - 8 + sway * 6, y - 40, bx, by + 42);
  g.stroke();
  const grd = g.createRadialGradient(bx - 12, by - 14, 4, bx, by, 46);
  grd.addColorStop(0, '#ff9a9a');
  grd.addColorStop(0.4, '#e8323c');
  grd.addColorStop(1, '#a1121e');
  g.fillStyle = grd;
  g.beginPath();
  g.ellipse(bx, by, 34, 42, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#a1121e';
  g.beginPath();
  g.moveTo(bx - 6, by + 46);
  g.lineTo(bx + 6, by + 46);
  g.lineTo(bx, by + 38);
  g.fill();
}
