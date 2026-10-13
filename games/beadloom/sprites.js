// Pre-rendered sprites (beads, crates) and vector icons (swap arrows, lock, key, dispenser,
// colourblind symbols). Sprites are drawn at device resolution: k = device px per design px.
// Each sprite canvas carries .dw/.dh (its size in design px) and .ox/.oy (anchor offset).

import { COLORS, HIDDEN_BEAD } from './colors.js';

export function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// amt > 0 mixes toward white, < 0 toward black.
export function shade(hex, amt) {
  const [r, g, b] = rgb(hex);
  const t = amt > 0 ? 255 : 0;
  const a = Math.abs(amt);
  const m = (v) => Math.round(v + (t - v) * a);
  return `rgb(${m(r)},${m(g)},${m(b)})`;
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

export function rr(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// Make a sprite of design size dw x dh, anchored at (ox, oy) design px from its top-left.
function sprite(k, dw, dh, ox, oy, draw) {
  const c = canvas(dw * k, dh * k);
  const g = c.getContext('2d');
  g.scale(c.width / dw, c.height / dh);
  draw(g);
  c.dw = dw;
  c.dh = dh;
  c.ox = ox;
  c.oy = oy;
  return c;
}

export function drawSprite(ctx, s, x, y, scale = 1) {
  ctx.drawImage(s, x - s.ox * scale, y - s.oy * scale, s.dw * scale, s.dh * scale);
}

// ---- beads ----

export function beadSprite(k, hex, d, symbol = -1) {
  const pad = d * 0.18;
  const size = d + pad * 2;
  return sprite(k, size, size, size / 2, size / 2, (g) => {
    const c = size / 2;
    const r = d / 2;
    g.fillStyle = 'rgba(10,10,40,0.18)';
    g.beginPath();
    g.ellipse(c, c + r * 0.16, r * 1.0, r * 0.95, 0, 0, Math.PI * 2);
    g.fill();
    const grad = g.createRadialGradient(c - r * 0.35, c - r * 0.42, r * 0.05, c, c, r);
    grad.addColorStop(0, shade(hex, 0.55));
    grad.addColorStop(0.35, shade(hex, 0.1));
    grad.addColorStop(0.8, hex);
    grad.addColorStop(1, shade(hex, -0.32));
    g.fillStyle = grad;
    g.beginPath();
    g.arc(c, c, r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.beginPath();
    g.ellipse(c - r * 0.36, c - r * 0.4, r * 0.3, r * 0.19, -0.6, 0, Math.PI * 2);
    g.fill();
    if (symbol >= 0) drawSymbol(g, symbol, c, c + r * 0.05, r * 0.62, 'rgba(255,255,255,0.95)', 'rgba(0,0,0,0.7)');
  });
}

export const hiddenBead = (k, d) => beadSprite(k, HIDDEN_BEAD, d);

// ---- crates ----
// A crate is a rounded box seen from the front and a little above: a lighter top rim with a
// dark well, over a front wall. Raised (pickable) crates are taller with a glassy lower band
// and a thick white outline.

export const CRATE_W = 148;
export const CRATE_H = 138;

export function crateSprite(k, hex, { raised = false, w = CRATE_W, h = CRATE_H, symbol = -1 } = {}) {
  const lift = raised ? 12 : 0;
  const m = 12; // margin for outline and shadow
  return sprite(k, w + m * 2, h + lift + m * 2, m + w / 2, m + lift + h / 2, (g) => {
    g.translate(m, m);
    drawCrate(g, hex, w, h, lift, symbol);
  });
}

// Draws a crate with its top-left at (0,0); the body spans y 0..h+lift.
export function drawCrate(g, hex, w, h, lift = 0, symbol = -1, lid = false) {
  const H = h + lift;
  const R = w * 0.2;
  if (lift) {
    g.fillStyle = '#eef0f8';
    rr(g, -8, -8, w + 16, H + 16, R + 8);
    g.fill();
  }
  g.fillStyle = 'rgba(20,20,60,0.22)';
  rr(g, 2, 8, w - 4, H, R);
  g.fill();
  // front wall
  const fy = h * 0.4;
  let grad = g.createLinearGradient(0, fy, 0, H);
  grad.addColorStop(0, shade(hex, -0.05));
  grad.addColorStop(1, shade(hex, -0.3));
  g.fillStyle = grad;
  rr(g, 0, fy, w, H - fy, R);
  g.fill();
  if (lift) {
    g.fillStyle = 'rgba(255,255,255,0.38)';
    rr(g, 5, H - 30, w - 10, 24, 12);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.fillRect(14, H - 26, w - 28, 3);
  }
  // inset rim on the front face
  g.strokeStyle = shade(hex, -0.25);
  g.lineWidth = 3;
  rr(g, 6, fy + 10, w - 12, H - fy - 16, R * 0.7);
  g.stroke();
  // top rim
  const th = h * 0.7;
  grad = g.createLinearGradient(0, 0, 0, th);
  grad.addColorStop(0, shade(hex, 0.22));
  grad.addColorStop(1, shade(hex, 0.04));
  g.fillStyle = grad;
  rr(g, 0, 0, w, th, R);
  g.fill();
  if (lid) {
    g.fillStyle = shade(hex, 0.3);
    rr(g, w * 0.06, h * 0.05, w * 0.88, th * 0.82, R * 0.8);
    g.fill();
    g.fillStyle = shade(hex, -0.15);
    rr(g, w * 0.36, h * 0.2, w * 0.28, h * 0.12, 6);
    g.fill();
  } else {
    // well
    grad = g.createLinearGradient(0, h * 0.08, 0, h * 0.58);
    grad.addColorStop(0, shade(hex, -0.3));
    grad.addColorStop(1, shade(hex, -0.08));
    g.fillStyle = grad;
    rr(g, w * 0.12, h * 0.08, w * 0.76, h * 0.5, R * 0.75);
    g.fill();
  }
  // gloss
  g.strokeStyle = 'rgba(255,255,255,0.35)';
  g.lineWidth = 3;
  rr(g, 2.5, 2.5, w - 5, th - 5, R - 2);
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.35)';
  rr(g, w * 0.1, 3, w * 0.35, 6, 3);
  g.fill();
  if (symbol >= 0) drawSymbol(g, symbol, w / 2, fy + (H - fy) * 0.52, 15, '#fff', 'rgba(0,0,0,0.65)');
}

// Well rectangle inside a crate, relative to its top-left: where beads pile up.
export const wellRect = (w, h) => [w * 0.12, h * 0.08, w * 0.76, h * 0.5];

// ---- icons ----

// Two curved arrows chasing each other (swap pair), in `hex`, rotated by `angle`.
export function drawSwapArrows(g, x, y, r, hex, angle = 0) {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  for (let s = 0; s < 2; s++) {
    g.save();
    g.rotate(s * Math.PI);
    g.beginPath();
    g.arc(0, 0, r, Math.PI * 1.05, Math.PI * 1.75);
    g.lineWidth = r * 0.42 + 4;
    g.strokeStyle = 'rgba(20,20,50,0.75)';
    g.stroke();
    g.lineWidth = r * 0.42;
    g.strokeStyle = hex;
    g.stroke();
    const a = Math.PI * 1.75;
    const hx = Math.cos(a) * r;
    const hy = Math.sin(a) * r;
    g.translate(hx, hy);
    g.rotate(a + Math.PI / 2);
    g.beginPath();
    g.moveTo(r * 0.5, -r * 0.05);
    g.lineTo(-r * 0.5, -r * 0.05);
    g.lineTo(0, r * 0.55);
    g.closePath();
    g.lineWidth = 4;
    g.strokeStyle = 'rgba(20,20,50,0.75)';
    g.stroke();
    g.fillStyle = hex;
    g.fill();
    g.restore();
  }
  g.restore();
}

export const LOCK_COLORS = ['#e23a3a', '#3e6fe6', '#e8a317'];

export function drawLock(g, x, y, s, hex, open = 0) {
  g.save();
  g.translate(x, y);
  g.lineWidth = s * 0.16;
  g.strokeStyle = '#3a3a48';
  g.beginPath();
  g.arc(0, -s * 0.18 - open * s * 0.25, s * 0.28, Math.PI, 0);
  g.lineTo(s * 0.28, -s * 0.05 - open * s * 0.25);
  g.moveTo(-s * 0.28, -s * 0.05 - open * s * 0.25);
  g.lineTo(-s * 0.28, -s * 0.18 - open * s * 0.25);
  g.stroke();
  g.lineWidth = s * 0.08;
  g.strokeStyle = '#c8ccd8';
  g.stroke();
  const grad = g.createLinearGradient(0, -s * 0.1, 0, s * 0.5);
  grad.addColorStop(0, shade(hex, 0.25));
  grad.addColorStop(1, shade(hex, -0.25));
  g.fillStyle = grad;
  rr(g, -s * 0.42, -s * 0.12, s * 0.84, s * 0.62, s * 0.14);
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = shade(hex, -0.45);
  g.stroke();
  g.fillStyle = '#2a2030';
  g.beginPath();
  g.arc(0, s * 0.12, s * 0.09, 0, Math.PI * 2);
  g.fill();
  g.fillRect(-s * 0.04, s * 0.12, s * 0.08, s * 0.18);
  g.restore();
}

export function drawKey(g, x, y, s, hex, angle = -0.5) {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.lineJoin = 'round';
  const path = () => {
    g.beginPath();
    g.arc(-s * 0.28, 0, s * 0.2, 0, Math.PI * 2);
    g.moveTo(-s * 0.1, -s * 0.06);
    g.rect(-s * 0.1, -s * 0.06, s * 0.55, s * 0.12);
    g.rect(s * 0.22, s * 0.04, s * 0.08, s * 0.14);
    g.rect(s * 0.36, s * 0.04, s * 0.08, s * 0.18);
  };
  path();
  g.lineWidth = 6;
  g.strokeStyle = shade(hex, -0.5);
  g.stroke();
  g.fillStyle = hex;
  g.fill();
  g.fillStyle = shade(hex, -0.35);
  g.beginPath();
  g.arc(-s * 0.28, 0, s * 0.08, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

// Dispenser: grey metal box, corrugated top, big count, a stripe showing the next colour.
// side: 0 = ejects downward (stripe on the front lip), -1 / 1 = faces left / right (stripe on
// that side, spec C.2).
export function drawDispenser(g, x, y, w, h, count, nextHex, open = 0, side = 0) {
  g.save();
  g.translate(x - w / 2, y - h / 2);
  g.fillStyle = 'rgba(20,20,60,0.25)';
  rr(g, 2, 8, w - 4, h, w * 0.18);
  g.fill();
  let grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#b8bcc6');
  grad.addColorStop(1, '#7a7f8c');
  g.fillStyle = grad;
  rr(g, 0, 0, w, h, w * 0.18);
  g.fill();
  grad = g.createLinearGradient(0, 0, 0, h * 0.7);
  grad.addColorStop(0, '#dfe2ea');
  grad.addColorStop(1, '#a3a8b4');
  g.fillStyle = grad;
  rr(g, 4, 4, w - 8, h * 0.68, w * 0.15);
  g.fill();
  if (open > 0 && nextHex) {
    g.globalAlpha = open;
    g.fillStyle = nextHex;
    rr(g, 12, 12, w - 24, h * 0.5, w * 0.1);
    g.fill();
    g.globalAlpha = 1;
  } else {
    g.strokeStyle = 'rgba(80,85,100,0.45)';
    g.lineWidth = 3;
    for (let i = 0; i < 6; i++) {
      const yy = 14 + i * ((h * 0.6 - 14) / 5);
      g.beginPath();
      g.moveTo(14, yy);
      g.lineTo(w - 14, yy);
      g.stroke();
    }
  }
  if (nextHex) {
    g.fillStyle = nextHex;
    if (side) rr(g, side < 0 ? 6 : w - 6 - w * 0.16, 8, w * 0.16, h - 22, 6);
    else rr(g, 10, h * 0.76, w - 20, h * 0.12, 6);
    g.fill();
  }
  g.restore();
  if (open < 0.5) outlinedText(g, String(count), x + side * 8, y - h * 0.12, 64, '#fff', '#2b2e3a', 9);
}

// Ice crate (spec C.2): a translucent blue cube hiding the crate, with the beads still to collect.
export function drawIce(g, x, y, w, h, label) {
  g.save();
  g.translate(x - w / 2, y - h / 2);
  g.fillStyle = 'rgba(20,40,90,0.22)';
  rr(g, 2, 8, w - 4, h, w * 0.14);
  g.fill();
  let grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#bfe6ff');
  grad.addColorStop(0.5, '#6cb8f0');
  grad.addColorStop(1, '#3f86d6');
  g.fillStyle = grad;
  rr(g, 0, 0, w, h, w * 0.14);
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.75)';
  g.lineWidth = 4;
  rr(g, 5, 5, w - 10, h - 10, w * 0.11);
  g.stroke();
  // frosty top edge and a diagonal glint
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.beginPath();
  g.moveTo(8, 18);
  for (let k = 0; k <= 8; k++) g.lineTo(8 + ((w - 16) * k) / 8, 12 + (k & 1 ? 10 : 0));
  g.lineTo(w - 8, 26);
  g.lineTo(8, 26);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.35)';
  g.beginPath();
  g.moveTo(w * 0.15, h * 0.85);
  g.lineTo(w * 0.32, h * 0.85);
  g.lineTo(w * 0.62, h * 0.3);
  g.lineTo(w * 0.45, h * 0.3);
  g.fill();
  g.restore();
  outlinedText(g, label, x, y + 4, label.length > 3 ? 44 : 52, '#fff', '#1d3a70', 9);
}

export function outlinedText(g, text, x, y, size, fill, stroke, lw, align = 'center') {
  g.font = `900 ${size}px ui-rounded, 'Arial Rounded MT Bold', system-ui, Roboto, sans-serif`;
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = lw;
  g.strokeStyle = stroke;
  g.strokeText(text, x, y);
  g.fillStyle = fill;
  g.fillText(text, x, y);
}

// Colourblind symbols: one simple vector glyph per colour id.
export function drawSymbol(g, id, x, y, r, fill, stroke) {
  g.save();
  g.translate(x, y);
  g.beginPath();
  const poly = (n, rot = -Math.PI / 2, rad = r) => {
    for (let i = 0; i < n; i++) {
      const a = rot + (i * 2 * Math.PI) / n;
      g[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rad, Math.sin(a) * rad);
    }
    g.closePath();
  };
  const star = (n, inner) => {
    for (let i = 0; i < n * 2; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / n;
      const rad = i % 2 ? r * inner : r;
      g[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rad, Math.sin(a) * rad);
    }
    g.closePath();
  };
  const bar = (w, h) => g.rect(-w / 2, -h / 2, w, h);
  switch (id % 19) {
    case 0: g.arc(0, 0, r * 0.8, 0, Math.PI * 2); break; // circle
    case 1: poly(3); break; // triangle
    case 2: bar(r * 1.4, r * 1.4); break; // square
    case 3: poly(4, 0); break; // diamond
    case 4: star(5, 0.45); break; // star
    case 5: bar(r * 1.8, r * 0.55); g.rect(-r * 0.275, -r * 0.9, r * 0.55, r * 1.8); break; // plus
    case 6: poly(3, Math.PI / 2); break; // down triangle
    case 7: g.arc(0, 0, r * 0.85, 0, Math.PI * 2); g.arc(0, 0, r * 0.4, 0, Math.PI * 2, true); break; // ring
    case 8: poly(6, 0); break; // hexagon
    case 9: bar(r * 1.8, r * 0.6); break; // dash
    case 10: bar(r * 0.6, r * 1.8); break; // bar
    case 11: poly(5); break; // pentagon
    case 12: star(4, 0.4); break; // 4-point star
    case 13: g.arc(0, 0, r * 0.85, Math.PI, 0); g.closePath(); break; // half disc
    case 14: g.arc(-r * 0.45, 0, r * 0.38, 0, Math.PI * 2); g.moveTo(r * 0.83, 0); g.arc(r * 0.45, 0, r * 0.38, 0, Math.PI * 2); break; // two dots
    case 15: poly(3, 0); break; // right triangle
    case 16: star(6, 0.5); break; // 6-point star
    case 17: g.moveTo(-r, -r * 0.2); g.lineTo(0, -r * 0.9); g.lineTo(r, -r * 0.2); g.lineTo(r, r * 0.3); g.lineTo(0, -r * 0.4); g.lineTo(-r, r * 0.3); g.closePath(); break; // chevron
    case 18: bar(r * 1.6, r * 0.45); g.rect(-r * 0.8, r * 0.35, r * 1.6, r * 0.45); g.rect(-r * 0.8, -r * 0.8, r * 1.6, r * 0.45); break; // three bars
  }
  g.lineWidth = Math.max(2, r * 0.3);
  g.lineJoin = 'round';
  g.strokeStyle = stroke;
  g.stroke();
  g.fillStyle = fill;
  g.fill('evenodd');
  g.restore();
}

// Sprite cache for one device scale. Rebuilt on resize or colourblind toggle.
export class SpriteSet {
  constructor(k, colourblind, beadD) {
    this.k = k;
    this.cb = colourblind;
    this.beadD = beadD;
    this.beads = COLORS.map((c) => beadSprite(k, c.bead, beadD));
    this.beadsSym = colourblind ? COLORS.map((c, i) => beadSprite(k, c.bead, beadD, i)) : this.beads;
    this.hidden = hiddenBead(k, beadD);
    this.small = COLORS.map((c) => beadSprite(k, c.bead, 14));
    this.crates = new Map();
    this.qmark = sprite(k, 90, 100, 45, 50, (g) => outlinedText(g, '?', 45, 52, 74, '#fff', '#1b1f26', 10));
  }
  crate(color, raised, slot = false) {
    const key = color * 4 + (raised ? 1 : 0) + (slot ? 2 : 0);
    let s = this.crates.get(key);
    if (!s) {
      const hex = COLORS[color].crate;
      s = crateSprite(this.k, hex, {
        raised,
        w: slot ? 140 : CRATE_W,
        h: slot ? 128 : CRATE_H,
        symbol: this.cb ? color : -1,
      });
      this.crates.set(key, s);
    }
    return s;
  }
}
