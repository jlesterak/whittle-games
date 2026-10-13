// Track geometry in design pixels (1080x2316 portrait). Pure, so the generator (Node) and the
// renderer share it. The ring is a closed centreline sampled every STEP px by arc length,
// starting at the spout (bottom centre) and running counter-clockwise on screen.
// Feeder paths are polylines sampled from their mouth backwards up to the arm's capped top.

export const W = 1080;
export const H = 2316;
export const CX = 540;
export const BOTTOM = 778; // ring centreline y at the spout
export const ROW_PITCH = 13; // row spacing along the track (beads overlap ~50%)
export const LANE = 25.5; // lane spacing across the track
export const BEAD = 27; // bead diameter
export const LANES = 5;
export const CHANNEL = 142; // dark channel width
export const WALL = 17; // light lip on each side
export const STEP = 2; // sample spacing (px)
const RC = 160; // ring corner radius

// Closed rounded-rectangle centreline, bottom-centre start, CCW on screen.
function roundedRect(w, h, rc) {
  const pts = [];
  const L = CX - w / 2;
  const R = CX + w / 2;
  const T = BOTTOM - h;
  const B = BOTTOM;
  const line = (x0, y0, x1, y1) => {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 1));
    for (let i = 0; i < n; i++) pts.push([x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);
  };
  const arc = (cx, cy, a0, a1) => {
    const n = Math.max(1, Math.ceil((Math.abs(a1 - a0) * rc) / 1));
    for (let i = 0; i < n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      pts.push([cx + rc * Math.cos(a), cy + rc * Math.sin(a)]);
    }
  };
  line(CX, B, R - rc, B);
  arc(R - rc, B - rc, Math.PI / 2, 0);
  line(R, B - rc, R, T + rc);
  arc(R - rc, T + rc, 0, -Math.PI / 2);
  line(R - rc, T, L + rc, T);
  arc(L + rc, T + rc, -Math.PI / 2, -Math.PI);
  line(L, T + rc, L, B - rc);
  arc(L + rc, B - rc, -Math.PI, -1.5 * Math.PI);
  line(L + rc, B, CX, B);
  return pts;
}

// The ring lives in a box under the HUD (centreline top >= BOTTOM - HMAX) and narrow enough
// that both feeder arms fit beside it (WMAX). A shape grows its box along one parameter s >= 0
// until the centreline is n rows long; the smallest box is the circle of radius RC, so the hole
// never collapses (the old scaled-down and pinched shapes squashed it shut).
const MIN = 2 * RC;
const WMAX = 420;
const HMAX = 600;
const box = (w, h) => roundedRect(w, h, Math.min(RC, w / 2, h / 2));
const SHAPES = {
  // A tall "O" (level 2796): stadium, height grows first.
  O: (s) => box(MIN + Math.max(0, s - (HMAX - MIN)), MIN + Math.min(s, HMAX - MIN)),
  // A wide rounded ring: width grows first.
  wide: (s) => box(MIN + Math.min(s, WMAX - MIN), MIN + Math.max(0, s - (WMAX - MIN))),
  // A rounder, squarer donut: both grow together, then height.
  squareO: (s) => {
    const a = Math.min(s, WMAX - MIN);
    const r = s - a;
    return box(MIN + a + Math.max(0, r - (HMAX - WMAX)), MIN + a + Math.min(r, HMAX - WMAX));
  },
};
SHAPES.hourglass = SHAPES.wide; // older levels name it; the pinch closed the hole

function polyLength(pts, closed) {
  let L = 0;
  const n = pts.length;
  for (let i = 1; i < n + (closed ? 1 : 0); i++) {
    const a = pts[i - 1];
    const b = pts[i % n];
    L += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return L;
}

// Resample a polyline at uniform arc-length spacing; adds unit normals.
function resample(pts, closed) {
  const n = pts.length;
  const segs = closed ? n : n - 1;
  const total = polyLength(pts, closed);
  const count = Math.max(2, Math.round(total / STEP));
  const ds = total / (closed ? count : count - 1);
  const xs = new Float32Array(count);
  const ys = new Float32Array(count);
  let seg = 0;
  let segStart = 0;
  let segLen = 0;
  const segAt = (k) => {
    const a = pts[k];
    const b = pts[(k + 1) % n];
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
  };
  segLen = segAt(0);
  for (let i = 0; i < count; i++) {
    const s = i * ds;
    while (seg < segs - 1 && s > segStart + segLen) {
      segStart += segLen;
      seg++;
      segLen = segAt(seg);
    }
    const a = pts[seg];
    const b = pts[(seg + 1) % n];
    const t = segLen > 0 ? Math.min(1, (s - segStart) / segLen) : 0;
    xs[i] = a[0] + (b[0] - a[0]) * t;
    ys[i] = a[1] + (b[1] - a[1]) * t;
  }
  const nx = new Float32Array(count);
  const ny = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const p = closed ? (i - 2 + count) % count : Math.max(0, i - 2);
    const q = closed ? (i + 2) % count : Math.min(count - 1, i + 2);
    const tx = xs[q] - xs[p];
    const ty = ys[q] - ys[p];
    const l = Math.hypot(tx, ty) || 1;
    nx[i] = -ty / l;
    ny[i] = tx / l;
  }
  return { xs, ys, nx, ny, count, ds, length: total };
}

function cubic(p0, c1, c2, p1, out) {
  const n = Math.ceil(polyLength([p0, c1, c2, p1], false));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p1[0],
      u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p1[1],
    ]);
  }
}

// Which shape suits a ring of n rows (the generator stores the result in the level).
export function shapeFor(n, variant = 0) {
  if (variant <= 4) return 'O'; // teach on the clean O for the first few levels
  const cycle = ['wide', 'O', 'squareO', 'O', 'wide', 'squareO'];
  return cycle[variant % cycle.length];
}

const cache = new Map();

// Feeder arms: as far out as the screen allows (at least ARM_GAP from the ring's side, so the
// right arm's U-turn has room), the merge angle against the ring's direction of travel, and the
// height of both mouths above the spout.
const ARM_GAP = CHANNEL + 2 * WALL + 20;
const ARM_X = W / 2 - CHANNEL / 2 - WALL - 14; // arm centre's furthest distance from CX
const MERGE = (50 * Math.PI) / 180;
const MOUTH_Y = BOTTOM - 150;
const ARM_TOP = 40; // the arms' rounded caps sit just under the HUD row

// Build the ring of n rows for a shape: samples, pitch, mouth indices and feeder paths.
export function buildTrack(shape, n) {
  const key = `${shape}:${n}`;
  if (cache.has(key)) return cache.get(key);
  const make = SHAPES[shape] || SHAPES.O;
  const target = n * ROW_PITCH;
  let pts = make(0);
  if (polyLength(pts, true) > target) {
    // shorter than the smallest circle: a smaller circle
    const k = target / polyLength(pts, true);
    pts = pts.map(([x, y]) => [CX + (x - CX) * k, BOTTOM + (y - BOTTOM) * k]);
  } else {
    let lo = 0;
    let hi = 2000;
    for (let it = 0; it < 40; it++) {
      const mid = (lo + hi) / 2;
      if (polyLength(make(mid), true) < target) lo = mid;
      else hi = mid;
    }
    pts = make((lo + hi) / 2);
  }
  const ring = resample(pts, true);
  const pitch = ring.length / n;

  let top = Infinity;
  let left = Infinity;
  let right = -Infinity;
  for (let i = 0; i < ring.count; i++) {
    top = Math.min(top, ring.ys[i]);
    left = Math.min(left, ring.xs[i]);
    right = Math.max(right, ring.xs[i]);
  }
  // Right mouth: on the right side going up; left mouth: on the left side going down.
  const mouthY = Math.max(MOUTH_Y, top + (BOTTOM - top) * 0.3);
  let iR = -1;
  let iL = -1;
  for (let i = 1; i < ring.count; i++) {
    if (iR < 0 && ring.xs[i] > CX && ring.ys[i] <= mouthY && ring.ys[i - 1] > mouthY) iR = i;
    if (iL < 0 && iR >= 0 && ring.xs[i] < CX && ring.ys[i] >= mouthY && ring.ys[i - 1] < mouthY) iL = i;
  }
  const mouthR = Math.round((iR * ring.ds) / pitch) % n;
  const mouthL = Math.round((iL * ring.ds) / pitch) % n;
  const feeders = [feederPath(ring, iR, +1, Math.max(right + ARM_GAP, CX + ARM_X), (top + BOTTOM) / 2),
    feederPath(ring, iL, -1, Math.min(left - ARM_GAP, CX - ARM_X), (top + BOTTOM) / 2),
  ];

  const t = {
    shape,
    n,
    pitch,
    ring,
    mouthR,
    mouthL,
    top,
    feeders,
    // arc distance along each feeder where its queue starts: just clear of the ring's channel,
    // so waiting beads never sit under (or on) the ring's beads
    queueStart: feeders.map((f) => clearOf(ring, f, CHANNEL / 2 + 6)),
  };
  cache.set(key, t);
  return t;
}

// First arc distance along feeder f (from its mouth) whose centreline is at least d from the ring's.
function clearOf(ring, f, d) {
  for (let j = 0; j < f.count; j++) {
    let best = Infinity;
    for (let i = 0; i < ring.count; i += 2) best = Math.min(best, Math.hypot(ring.xs[i] - f.xs[j], ring.ys[i] - f.ys[j]));
    if (best >= d) return j * f.ds;
  }
  return 0;
}

// A feeder comes straight down its arm at x = ax from its capped top (ARM_TOP) and merges at ring
// sample i, arriving at MERGE degrees to the ring's direction of travel from outside, so the
// junction is short and the arm keeps its own wall. side +1 = right (U-turn under the mouth),
// -1 = left (a bend in).
function feederPath(ring, i, side, ax, midY) {
  const M = [ring.xs[i], ring.ys[i]];
  const j = (i + 3) % ring.count;
  const k = (i - 3 + ring.count) % ring.count;
  let tx = ring.xs[j] - ring.xs[k];
  let ty = ring.ys[j] - ring.ys[k];
  const l = Math.hypot(tx, ty);
  tx /= l;
  ty /= l;
  // outward normal: away from the ring's middle
  let ox = -ty;
  let oy = tx;
  if (ox * (M[0] - CX) + oy * (M[1] - midY) < 0) {
    ox = -ox;
    oy = -oy;
  }
  const c = Math.cos(MERGE);
  const s = Math.sin(MERGE);
  const dx = tx * c - ox * s; // arrival direction, pointing into the ring
  const dy = ty * c - oy * s;
  const E = 70; // straight run into the mouth
  const P = [M[0] - dx * E, M[1] - dy * E];
  const fwd = []; // from the arm's top down to the mouth
  const start = [ax, ARM_TOP];
  fwd.push(start);
  if (side > 0) {
    // down the arm, round the U under the mouth, up into the ring
    const b = [ax, P[1] - 30];
    cubic(start, start, b, b, fwd);
    cubic(b, [ax, b[1] + 150], [P[0] - dx * 150, P[1] - dy * 150], P, fwd);
  } else {
    const b = [ax, P[1] - 150];
    cubic(start, start, b, b, fwd);
    cubic(b, [ax, b[1] + 90], [P[0] - dx * 90, P[1] - dy * 90], P, fwd);
  }
  cubic(P, P, M, M, fwd);
  fwd.reverse(); // index 0 at the mouth
  return resample(fwd, false);
}

// Sample a path at arc distance s (px). Writes x, y, nx, ny into out. Closed paths wrap.
export function samplePath(path, s, closed, out) {
  let f = s / path.ds;
  const c = path.count;
  if (closed) {
    f %= c;
    if (f < 0) f += c;
  } else if (f > c - 1) f = c - 1;
  else if (f < 0) f = 0;
  const i = f | 0;
  const j = closed ? (i + 1) % c : Math.min(c - 1, i + 1);
  const t = f - i;
  out.x = path.xs[i] + (path.xs[j] - path.xs[i]) * t;
  out.y = path.ys[i] + (path.ys[j] - path.ys[i]) * t;
  out.nx = path.nx[i];
  out.ny = path.ny[i];
  return out;
}
