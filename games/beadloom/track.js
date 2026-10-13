// Track geometry in design pixels (1080x2316 portrait). Pure, so the generator (Node) and the
// renderer share it. The ring is a closed centreline sampled every STEP px by arc length,
// starting at the spout (bottom centre) and running counter-clockwise on screen.
// Feeder paths are polylines sampled from their mouth backwards up to above the screen.

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

// Shape families. Each takes one size parameter that the length fit solves for.
const SHAPES = {
  // A tall "O" (level 2796): stadium, height grows with length.
  O: { param: [2 * RC, 900], make: (h) => roundedRect(2 * RC, h, RC), mouthAt: 0.42 },
  // A wide rounded ring for long tracks.
  wide: { param: [2 * RC, 760], make: (w) => roundedRect(w, 470, RC), mouthAt: 0.42 },
  // An hourglass (level 2414): the wide ring pinched above mid-height; feeders join the lower lobe.
  hourglass: {
    param: [2 * RC, 800],
    make: (w) =>
      roundedRect(w, 500, RC).map(([x, y]) => {
        const k = 1 - 0.42 * Math.exp(-(((y - (BOTTOM - 300)) / 95) ** 2));
        return [CX + (x - CX) * k, y];
      }),
    mouthAt: 0.24,
  },
  // A rounder, squarer donut for variety.
  squareO: { param: [2 * RC, 760], make: (s) => roundedRect(s, s * 0.82, RC), mouthAt: 0.42 },
};

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
  const cycle = ['wide', 'O', 'hourglass', 'squareO', 'O', 'wide', 'hourglass', 'squareO'];
  return cycle[variant % cycle.length];
}

const cache = new Map();

// Build the ring of n rows for a shape: samples, pitch, mouth indices and feeder paths.
export function buildTrack(shape, n) {
  const key = `${shape}:${n}`;
  if (cache.has(key)) return cache.get(key);
  const def = SHAPES[shape] || SHAPES.O;
  const target = n * ROW_PITCH;
  // Fit the size parameter so the centreline is n rows long (shrink to a circle if short).
  let lo = def.param[0];
  let hi = def.param[1];
  let pts = def.make(lo);
  if (polyLength(pts, true) > target) {
    // shorter than the minimum shape: scale the minimum shape down about the spout
    const k = target / polyLength(pts, true);
    pts = pts.map(([x, y]) => [CX + (x - CX) * k, BOTTOM + (y - BOTTOM) * k]);
  } else {
    for (let it = 0; it < 40; it++) {
      const mid = (lo + hi) / 2;
      if (polyLength(def.make(mid), true) < target) lo = mid;
      else hi = mid;
    }
    pts = def.make((lo + hi) / 2);
  }
  const ring = resample(pts, true);
  const pitch = ring.length / n;

  let top = Infinity;
  for (let i = 0; i < ring.count; i++) top = Math.min(top, ring.ys[i]);
  const mouthY = BOTTOM - (BOTTOM - top) * def.mouthAt;
  // Right mouth: on the right side going up; left mouth: on the left side going down.
  let iR = -1;
  let iL = -1;
  for (let i = 1; i < ring.count; i++) {
    if (iR < 0 && ring.xs[i] > CX && ring.ys[i] <= mouthY && ring.ys[i - 1] > mouthY) iR = i;
    if (iL < 0 && iR >= 0 && ring.xs[i] < CX && ring.ys[i] >= mouthY && ring.ys[i - 1] < mouthY) iL = i;
  }
  const mouthR = Math.round((iR * ring.ds) / pitch) % n;
  const mouthL = Math.round((iL * ring.ds) / pitch) % n;

  const t = {
    shape,
    n,
    pitch,
    ring,
    mouthR,
    mouthL,
    top,
    feeders: [feederPath(ring, iR, +1), feederPath(ring, iL, -1)],
  };
  cache.set(key, t);
  return t;
}

// A feeder comes down from its capped end (just above design y=0, inside the headroom) beside the ring and merges at sample index i,
// arriving along the ring's direction of travel. side +1 = right (U-turn), -1 = left (S-bend).
function feederPath(ring, i, side) {
  const M = [ring.xs[i], ring.ys[i]];
  const j = (i + 3) % ring.count;
  const k = (i - 3 + ring.count) % ring.count;
  let tx = ring.xs[j] - ring.xs[k];
  let ty = ring.ys[j] - ring.ys[k];
  const l = Math.hypot(tx, ty);
  tx /= l;
  ty /= l;
  const gap = CHANNEL + 2 * WALL + 8;
  const fx = M[0] + side * gap;
  const fwd = []; // from above the screen down to the mouth
  const start = [fx, -60];
  if (side > 0) {
    const p1 = [fx, M[1]];
    fwd.push(start);
    cubic(start, start, p1, p1, fwd);
    cubic(p1, [fx, M[1] + 120], [M[0] - tx * 120, M[1] - ty * 120], M, fwd);
  } else {
    const p1 = [fx, M[1] - 170];
    fwd.push(start);
    cubic(start, start, p1, p1, fwd);
    cubic(p1, [fx, M[1] - 80], [M[0] - tx * 90, M[1] - ty * 90], M, fwd);
  }
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
