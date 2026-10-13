// Ludo board geometry and drawing. Board units: the 15 x 15 grid, square (c, r) spans [c, c+1] x
// [r, r+1]. Everything is laid out for red (top-left corner) and rotated a quarter turn clockwise
// per corner: (x, y) -> (15 - y, x). The track runs clockwise from red's start square at (1, 6).
import { YARD, HOME, LAST_TRACK, TRACK, absOf, isStart, isStar } from './rules.js';
import { SEAT_COLOURS } from '../../core/seats.js';

const N = 15;
const rot = ([x, y], k) => {
  for (let i = 0; i < k; i++) [x, y] = [N - y, x];
  return [x, y];
};
const centre = ([c, r]) => [c + 0.5, r + 0.5];

// Red's quarter of the track (absolute squares 0-12), its home column (51-55) and yard spots.
const QUARTER = [[1, 6], [2, 6], [3, 6], [4, 6], [5, 6], [6, 5], [6, 4], [6, 3], [6, 2], [6, 1], [6, 0], [7, 0], [8, 0]];
const COLUMN = [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]];
const YARD_SPOTS = [[1.95, 1.95], [4.05, 1.95], [1.95, 4.05], [4.05, 4.05]];
const HOME_SPOTS = [[6.42, 6.95], [6.42, 8.05], [6.42, 7.5], [6.98, 7.5]];
// Track square centres for absolute squares 0..51.
export const TRACK_XY = Array.from({ length: TRACK }, (_, a) => rot(centre(QUARTER[a % 13]), Math.floor(a / 13)));

// Where a token sits (centre, board units) before stacking: yard spot, track, column or home.
export function spotOf(corner, rel, token) {
  if (rel === YARD) return { xy: rot(YARD_SPOTS[token], corner), key: `y${corner}:${token}`, fixed: true };
  if (rel === HOME) return { xy: rot(HOME_SPOTS[token], corner), key: `h${corner}:${token}`, fixed: true };
  if (rel <= LAST_TRACK) {
    const a = absOf(corner, rel);
    return { xy: TRACK_XY[a], key: `t${a}` };
  }
  return { xy: rot(centre(COLUMN[rel - LAST_TRACK - 1]), corner), key: `c${corner}:${rel}` };
}

// Offsets (board units) and scale for k tokens sharing a square.
const FAN = {
  1: { s: 1, d: [[0, 0]] },
  2: { s: 0.72, d: [[-0.17, -0.17], [0.17, 0.17]] },
  3: { s: 0.62, d: [[-0.19, -0.15], [0.19, -0.15], [0, 0.2]] },
  4: { s: 0.58, d: [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]] },
};

// Layout of every token: [{ seat, token, x, y, scale }]. `rels[seat][token]` are the positions to show.
export function layout(corners, rels) {
  const groups = new Map();
  const out = [];
  rels.forEach((ts, seat) =>
    ts.forEach((rel, token) => {
      const sp = spotOf(corners[seat], rel, token);
      const item = { seat, token, x: sp.xy[0], y: sp.xy[1], scale: sp.fixed && rel === HOME ? 0.6 : 1 };
      out.push(item);
      if (!sp.fixed) groups.set(sp.key, [...(groups.get(sp.key) || []), item]);
    }),
  );
  for (const items of groups.values()) {
    const k = Math.min(items.length, 4);
    if (k === 1) continue;
    items.forEach((it, i) => {
      const [dx, dy] = FAN[k].d[i % k];
      it.x += dx;
      it.y += dy;
      it.scale = FAN[k].s;
    });
  }
  return out;
}

// The squares a move passes through, for the hop animation (YARD -> [0]).
export const hopPath = (from, to) => (from === YARD ? [0] : Array.from({ length: to - from }, (_, i) => from + 1 + i));

// Colourblind shapes (centred on 0,0, about 0.5 across), per corner colour.
export const SHAPES = [
  '<circle r="0.2"/>',
  '<path d="M0 -0.25L0.23 0.17H-0.23Z"/>',
  '<rect x="-0.18" y="-0.18" width="0.36" height="0.36"/>',
  '<path d="M0 -0.26L0.22 0L0 0.26L-0.22 0Z"/>',
];

const STAR_PATH = (() => {
  const p = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.17 : 0.38;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    p.push(`${(r * Math.cos(a)).toFixed(3)} ${(r * Math.sin(a)).toFixed(3)}`);
  }
  return `M${p.join('L')}Z`;
})();

// Mix a #rrggbb colour with white (to > 0) or black (to < 0) by |to|.
export function shade(hex, to) {
  const n = parseInt(hex.slice(1), 16);
  const t = to > 0 ? 255 : 0;
  const f = Math.abs(to);
  const ch = (v) => Math.round(v + (t - v) * f);
  return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

// The board as an SVG string, drawn once per game. `seated` lists the corners in play (empty yards
// are drawn faded); stars appear only when safe squares are on.
export function boardSvg({ seated, safe, symbols }) {
  const parts = [];
  parts.push(`<rect x="0" y="0" width="15" height="15" rx="0.35" fill="#fbf7ea"/>`);
  for (let k = 0; k < 4; k++) {
    const hex = SEAT_COLOURS[k].hex;
    const g = [];
    const on = seated.includes(k);
    // yard
    g.push(`<g class="ld-yard" data-corner="${k}"><rect x="0.06" y="0.06" width="5.88" height="5.88" rx="0.3" fill="${hex}"/>`);
    g.push(`<rect class="ld-yard-glow" x="0.06" y="0.06" width="5.88" height="5.88" rx="0.3" fill="none"/>`);
    g.push(`<rect x="0.85" y="0.85" width="4.3" height="4.3" rx="0.45" fill="#fffdf6"/>`);
    for (const [x, y] of YARD_SPOTS) g.push(`<circle cx="${x}" cy="${y}" r="0.44" fill="${shade(hex, 0.72)}" stroke="${hex}" stroke-width="0.07"/>`);
    if (symbols) g.push(`<g fill="${hex}" transform="translate(3 3) scale(1.3) rotate(${-90 * k})">${SHAPES[k]}</g>`);
    g.push(`</g>`);
    if (!on) g.push(`<rect x="0.06" y="0.06" width="5.88" height="5.88" rx="0.3" fill="#fbf7ea" opacity="0.55"/>`);
    // this quarter's track squares
    QUARTER.forEach(([c, r], i) => {
      const fill = i === 0 ? hex : '#fffdf6';
      g.push(`<rect x="${c + 0.03}" y="${r + 0.03}" width="0.94" height="0.94" rx="0.1" fill="${fill}" stroke="#d6ceb3" stroke-width="0.04"/>`);
    });
    // home column
    for (const [c, r] of COLUMN) g.push(`<rect x="${c + 0.03}" y="${r + 0.03}" width="0.94" height="0.94" rx="0.1" fill="${hex}"/>`);
    // start square arrow (direction of travel)
    g.push(`<path d="M1.25 6.5H1.75M1.6 6.33L1.79 6.5L1.6 6.67" stroke="#fff" stroke-width="0.1" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`);
    // centre triangle
    g.push(`<path d="M6 6L7.5 7.5L6 9Z" fill="${hex}"/>`);
    parts.push(`<g transform="rotate(${90 * k} 7.5 7.5)">${g.join('')}</g>`);
  }
  // the arrow into each home column, on the square before it (drawn last: that square is the next quarter's)
  for (let k = 0; k < 4; k++) {
    parts.push(`<path transform="rotate(${90 * k} 7.5 7.5)" d="M0.26 7.5H0.7M0.53 7.32L0.73 7.5L0.53 7.68" stroke="${SEAT_COLOURS[k].hex}" stroke-width="0.1" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  if (safe) {
    for (let a = 0; a < TRACK; a++) {
      const [x, y] = TRACK_XY[a];
      if (isStar(a)) parts.push(`<path d="${STAR_PATH}" transform="translate(${x} ${y})" fill="#cfc6a8"/>`);
      else if (isStart(a)) parts.push(`<circle cx="${x}" cy="${y}" r="0.4" fill="none" stroke="#fff8" stroke-width="0.06"/>`);
    }
  }
  parts.push(`<path d="M6 6H9V9H6Z" fill="none" stroke="#0002" stroke-width="0.04"/>`);
  return `<svg class="ld-svg" viewBox="0 0 15 15" aria-hidden="true">${parts.join('')}</svg>`;
}

// One token as SVG markup (viewBox -0.5..0.5): shadow, body, rim, top shine, optional shape.
export function tokenSvg(corner, symbols) {
  const hex = SEAT_COLOURS[corner].hex;
  return `<svg viewBox="-0.5 -0.5 1 1" aria-hidden="true">
<ellipse cx="0" cy="0.1" rx="0.42" ry="0.36" fill="#0005"/>
<circle r="0.4" fill="${hex}" stroke="#fff" stroke-width="0.07"/>
<circle r="0.26" fill="${shade(hex, -0.22)}"/>
<circle r="0.22" fill="${hex}"/>
<ellipse cx="-0.1" cy="-0.15" rx="0.14" ry="0.08" fill="#fff8"/>
${symbols ? `<g fill="#fff" transform="scale(0.85)">${SHAPES[corner]}</g>` : ''}</svg>`;
}

// ---- powerups (spec 2.1) ----
// Each effect: a colour and a white icon drawn in a -0.5..0.5 box. Colour and shape both differ, so no
// effect depends on telling two colours apart.
const ST = 'fill="none" stroke="#fff" stroke-width="0.075" stroke-linecap="round" stroke-linejoin="round"';
const FLAKE = [0, 60, 120].map((a) => `<path d="M-0.27 0H0.27" transform="rotate(${a})"/>`).join('');
export const PU_LOOK = {
  start: { hex: '#c62f2f', icon: `<g ${ST}><path d="M-0.28 -0.26V0.26"/></g><path d="M0.27 -0.27L-0.14 0L0.27 0.27Z" fill="#fff"/>` },
  back: { hex: '#df7a10', icon: `<g ${ST}><path d="M0.2 0.2A0.27 0.27 0 1 0 -0.2 -0.1"/><path d="M-0.34 -0.22L-0.2 -0.08L-0.06 -0.24"/></g>` },
  jump3: { hex: '#2b9a47', icon: `<g ${ST}><path d="M-0.1 -0.27L0.17 0L-0.1 0.27"/></g>` },
  jump6: { hex: '#0e8c8c', icon: `<g ${ST}><path d="M-0.24 -0.25L0 0L-0.24 0.25M0.04 -0.25L0.28 0L0.04 0.25"/></g>` },
  swap: { hex: '#8a4cd0', icon: `<g ${ST}><path d="M-0.27 -0.11H0.25M0.1 -0.26L0.26 -0.11L0.1 0.04M0.27 0.14H-0.25M-0.1 -0.01L-0.26 0.14L-0.1 0.29"/></g>` },
  shield: { hex: '#b07d00', icon: '<path d="M0 -0.31L0.26 -0.2V0.03C0.26 0.19 0.12 0.28 0 0.33C-0.12 0.28 -0.26 0.19 -0.26 0.03V-0.2Z" fill="#fff"/>' },
  extra: { hex: '#d23a86', icon: '<rect x="-0.26" y="-0.26" width="0.52" height="0.52" rx="0.09" fill="#fff"/><g fill="#d23a86"><circle cx="-0.12" cy="-0.12" r="0.06"/><circle cx="0.12" cy="0.12" r="0.06"/><circle cx="0.12" cy="-0.12" r="0.06"/><circle cx="-0.12" cy="0.12" r="0.06"/></g>' },
  freeze: { hex: '#2f84d4', icon: `<g ${ST}>${FLAKE}</g>` },
};
export const puIcon = (kind, hex = PU_LOOK[kind].hex, size = 40) =>
  `<svg viewBox="-0.5 -0.5 1 1" width="${size}" height="${size}" aria-hidden="true"><rect x="-0.47" y="-0.47" width="0.94" height="0.94" rx="0.12" fill="${hex}"/>${PU_LOOK[kind].icon}</svg>`;

// The live powerup squares as an SVG layer over the board: [{ sq, kind }].
export function puSvg(pu) {
  const sq = pu.map(({ sq, kind }) => {
    const [x, y] = TRACK_XY[sq];
    const l = PU_LOOK[kind];
    return `<g transform="translate(${x} ${y})"><rect x="-0.46" y="-0.46" width="0.92" height="0.92" rx="0.12" fill="${l.hex}" stroke="#fffdf6" stroke-width="0.05"/><rect x="-0.49" y="-0.49" width="0.98" height="0.98" rx="0.14" fill="none" stroke="#0007" stroke-width="0.04"/>${l.icon}</g>`;
  });
  return `<svg class="ld-svg" viewBox="0 0 15 15" aria-hidden="true">${sq.join('')}</svg>`;
}
