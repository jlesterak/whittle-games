// Dotwork level generator (ref 8.3, 8.4). Deterministic per level number and winnable by
// construction: the board is partitioned into random snakes, then oriented by forward peeling
// (repeatedly pick an unoriented snake with an end whose outward ray is clear of every other
// unoriented snake, make that end its head). The pick order is a solution. A few seeds are
// tried per level and the one closest to the level's difficulty band (peel layers, share of
// arrows free at the start) is kept.
//
// Level: { n, W, H, hard, arrows: [{ cells, color }], meta: { layers, free0, seed } }

import { hashSeed, makeRng } from '../../core/rng.js';
import { DIRS, peel, rayCells } from './board.js';

export const isHard = (n) => n >= 5 && n % 5 === 0;
const isBreather = (n) => n > 5 && n % 5 === 1;

// Silhouettes over u, v in [-1, 1] (ref 1.1: boards are pictures, level 209 is not a rectangle).
const SHAPES = {
  circle: (u, v) => u * u + v * v <= 1.02,
  diamond: (u, v) => Math.abs(u) + Math.abs(v) <= 1.08,
  heart: (u, v) => {
    const x = u * 1.25;
    const y = -v * 1.3 + 0.25;
    return (x * x + y * y - 1) ** 3 - x * x * y ** 3 <= 0;
  },
  plus: (u, v) => Math.abs(u) <= 0.42 || Math.abs(v) <= 0.42,
  ring: (u, v) => {
    const r = u * u + v * v;
    return r <= 1.02 && r >= 0.16;
  },
  hourglass: (u, v) => Math.abs(u) <= Math.abs(v) + 0.2,
};
const SHAPE_ORDER = ['circle', 'diamond', 'heart', 'plus', 'ring', 'hourglass'];

// Difficulty knobs per level number (ref 8.4). t: 0 at level 1, 1 from level 81.
export function knobs(n) {
  const t = Math.min(1, (n - 1) / 80);
  const hard = isHard(n);
  let w = 6 + 24 * t ** 0.85 + Math.max(0, n - 81) / 15;
  if (hard) w *= 1.15;
  if (isBreather(n)) w *= 0.85;
  const W = Math.max(5, Math.min(40, Math.round(w)));
  const shape = W >= 11 && n % 3 === 0 ? SHAPE_ORDER[(n / 3) % SHAPE_ORDER.length] : 'rect';
  const H = Math.round(W * (shape === 'rect' ? 1.25 : 1.12));
  const d = Math.max(0, Math.min(1, t + (hard ? 0.25 : 0) - (isBreather(n) ? 0.15 : 0)));
  return {
    W,
    H,
    hard,
    shape,
    fill: Math.min(0.97, 0.85 + 0.12 * t + (hard ? 0.02 : 0)),
    pStraight: 0.9 - 0.25 * d,
    p2: 0.3 - 0.08 * d, // share of 2-cell arrows (208: 22 %)
    meanLen: 1.2 + 5 * d, // mean extra length over 3 cells
    maxLen: Math.max(4, W),
    colours: Math.min(5, 2 + Math.round(2 * t) + (hard ? 1 : 0)),
    bias: 3 - 4 * d, // > 0 prefers short rays (easy), < 0 long rays and interior heads (hard)
    free0: 0.42 - 0.32 * d, // target share free at the start (208: 10 %)
    layers: Math.round(3 + 30 * d), // target peel depth (208: 31)
  };
}

function makeMask(k) {
  const { W, H, shape } = k;
  const m = new Uint8Array(W * H);
  const f = SHAPES[shape];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) m[y * W + x] = !f || f(((x + 0.5) / W) * 2 - 1, ((y + 0.5) / H) * 2 - 1) ? 1 : 0;
  return m;
}

const neighbours = (W, H, c) => {
  const x = c % W;
  const y = (c / W) | 0;
  const out = [];
  for (const [dx, dy] of DIRS) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < W && ny < H) out.push(ny * W + nx);
  }
  return out;
};

// Random snake partition of the mask (ref 8.3 step 3). Returns paths of >= 2 cells.
function partition(k, mask, rng) {
  const { W, H } = k;
  const owner = new Int32Array(W * H).fill(-1);
  const paths = [];
  const order = rng.shuffle([...mask.keys()].filter((c) => mask[c]));
  const free = (c) => mask[c] && owner[c] === -1;
  const sampleLen = () => {
    if (rng.chance(k.p2)) return 2;
    return Math.min(k.maxLen, 3 + Math.floor(-Math.log(1 - rng.next()) * k.meanLen));
  };
  // free-neighbour count per cell, bucketed so the most hemmed-in free cell is found in O(1)
  const deg = new Int8Array(W * H);
  const buckets = [0, 1, 2, 3, 4].map(() => new Set());
  for (const c of order) {
    deg[c] = neighbours(W, H, c).filter(free).length;
    buckets[deg[c]].add(c);
  }
  const take = (c, id) => {
    owner[c] = id;
    buckets[deg[c]].delete(c);
    for (const nb of neighbours(W, H, c)) {
      if (!free(nb)) continue;
      buckets[deg[nb]].delete(nb);
      buckets[--deg[nb]].add(nb);
    }
  };
  // grow straight with pStraight, else into the most hemmed-in neighbour (keeps the empty
  // region compact, so snakes stay long instead of leaving 1-2 cell pockets)
  const grow = (path, target, id) => {
    let dir = -1;
    while (path.length < target) {
      const cur = path[path.length - 1];
      const opts = neighbours(W, H, cur).filter(free);
      if (!opts.length) break;
      const straight = dir >= 0 ? opts.find((c) => c - cur === dir) : undefined;
      let next = straight;
      if (next === undefined || !rng.chance(k.pStraight)) {
        const lo = Math.min(...opts.map((c) => deg[c]));
        next = rng.pick(opts.filter((c) => deg[c] === lo));
      }
      dir = next - cur;
      take(next, id);
      path.push(next);
    }
  };
  // start each snake on the most hemmed-in free cell (ties: shuffled order)
  for (;;) {
    const bucket = buckets.find((bk) => bk.size);
    if (!bucket) break;
    const c = bucket.values().next().value;
    const id = paths.length;
    const path = [c];
    take(c, id);
    const target = sampleLen();
    grow(path, target, id);
    if (path.length < target) {
      path.reverse();
      grow(path, target, id);
    }
    paths.push(path);
  }
  // singletons: join onto an adjacent path end, else leave the cell empty
  for (let id = 0; id < paths.length; id++) {
    const p = paths[id];
    if (p.length !== 1) continue;
    const c = p[0];
    owner[c] = -1;
    paths[id] = null;
    for (const nb of neighbours(W, H, c)) {
      const q = paths[owner[nb]];
      if (!q || q.length >= k.maxLen) continue;
      if (q[q.length - 1] === nb) q.push(c);
      else if (q[0] === nb) q.unshift(c);
      else continue;
      owner[c] = owner[nb];
      break;
    }
  }
  const out = paths.filter(Boolean);
  // thin to the fill target by dropping random short paths (the empty cells of ref 1.1)
  const total = mask.reduce((s, v) => s + v, 0);
  let filled = out.reduce((s, p) => s + p.length, 0);
  rng.shuffle(out);
  for (let i = out.length - 1; i >= 0 && filled / total > k.fill; i--) {
    if (out[i].length <= 3) {
      filled -= out[i].length;
      out.splice(i, 1);
    }
  }
  return out;
}

// Forward peeling with a free choice of head (ref 8.3 step 4). Returns oriented paths in
// removal order, or null if repairs ran out. Removal only frees cells, so an end that is free
// stays free; after each removal only ends in the freed rows / columns are rechecked.
function orient(k, paths, rng) {
  const { W, H } = k;
  const occ = new Int32Array(W * H).fill(-1);
  const S = paths.map((p) => p.slice());
  S.forEach((p, id) => p.forEach((c) => (occ[c] = id)));
  const alive = new Set(S.keys());
  const cand = new Map(); // key id*2 + atHead -> { id, p, w }
  const done = [];
  const clearRay = (p) => {
    const ray = rayCells(W, H, p);
    for (const c of ray) if (occ[c] !== -1) return -1; // own body or another snake
    return ray.length;
  };
  const check = (id) => {
    for (const atHead of [0, 1]) {
      const key = id * 2 + atHead;
      if (cand.has(key)) continue;
      const p = atHead ? S[id] : S[id].slice().reverse();
      const len = clearRay(p);
      if (len >= 0) cand.set(key, { id, p, w: Math.exp((-k.bias * len) / Math.max(W, H)) });
    }
  };
  for (const id of alive) check(id);
  let repairs = 0;
  while (alive.size) {
    if (!cand.size) {
      if (++repairs > paths.length) return null;
      if (!split()) {
        const id = rng.pick([...alive]); // last resort: leave a snake's cells empty
        S[id].forEach((c) => (occ[c] = -1));
        alive.delete(id);
        recheck(S[id]);
      }
      continue;
    }
    const list = [...cand.values()];
    let r = rng.next() * list.reduce((t, c) => t + c.w, 0);
    const pick = list.find((c) => (r -= c.w) <= 0) || list[list.length - 1];
    pick.p.forEach((c) => (occ[c] = -1));
    alive.delete(pick.id);
    cand.delete(pick.id * 2);
    cand.delete(pick.id * 2 + 1);
    done.push(pick.p);
    recheck(pick.p);
  }
  return done;

  function recheck(cells) {
    const rows = new Set(cells.map((c) => (c / W) | 0));
    const cols = new Set(cells.map((c) => c % W));
    for (const id of alive) {
      const p = S[id];
      if (rows.has((p[0] / W) | 0) || cols.has(p[0] % W) || rows.has((p[p.length - 1] / W) | 0) || cols.has(p[p.length - 1] % W)) check(id);
    }
  }

  // Cut a snake where one of the two new ends gets a clear ray (both halves >= 2 cells).
  function split() {
    const opts = [];
    for (const id of alive) {
      const p = S[id];
      for (let cut = 2; cut <= p.length - 2; cut++) {
        if (clearRay(p.slice(0, cut)) >= 0 || clearRay(p.slice(cut).reverse()) >= 0) opts.push([id, cut]);
      }
    }
    if (!opts.length) return false;
    const [id, cut] = rng.pick(opts);
    const p = S[id];
    const nid = S.length;
    S[id] = p.slice(0, cut);
    S.push(p.slice(cut));
    S[nid].forEach((c) => (occ[c] = nid));
    alive.add(nid);
    cand.delete(id * 2);
    cand.delete(id * 2 + 1);
    check(id);
    check(nid);
    return true;
  }
}

// Colours (ref 8.3 step 6): rectangles get the least-used colour among each arrow's
// neighbours (so side-by-side arrows differ); pictures get concentric bands, one colour each.
function colour(k, paths, rng, n) {
  const { W, H } = k;
  const pal = [0, 1, 2, 3, 4].slice(0, k.colours);
  const shift = n % pal.length;
  const col = pal.map((_, i) => pal[(i + shift) % pal.length]);
  if (k.shape !== 'rect') {
    const pair = [[3, 4], [0, 2], [1, 4]][n % 3]; // two tones per picture (209: orange + slate)
    return paths.map((p) => {
      const [sx, sy] = p.reduce(([a, b], c) => [a + (c % W), b + ((c / W) | 0)], [0, 0]);
      const u = sx / p.length / W - 0.5;
      const v = sy / p.length / H - 0.5;
      return pair[Math.floor(Math.hypot(u, v) * 7) % 2];
    });
  }
  const cell = new Int8Array(W * H).fill(-1);
  return paths.map((p) => {
    const count = new Array(col.length).fill(0);
    for (const c of p) for (const nb of neighbours(W, H, c)) if (cell[nb] >= 0) count[cell[nb]]++;
    const best = Math.min(...count);
    const ci = rng.pick(count.map((v, i) => (v === best ? i : -1)).filter((i) => i >= 0));
    p.forEach((c) => (cell[c] = ci));
    return col[ci];
  });
}

const TRIES = 6;

export function generateLevel(n) {
  const k = knobs(n);
  const mask = makeMask(k);
  let best = null;
  for (let s = 0; s < TRIES; s++) {
    const seed = hashSeed('dotwork', n, s);
    const rng = makeRng(seed);
    const oriented = orient(k, partition(k, mask, rng), rng);
    if (!oriented) continue;
    const order = rng.shuffle(oriented.map((_, i) => i)); // arrow ids must not leak the solution
    const paths = order.map((i) => oriented[i]);
    const colours = colour(k, paths, rng, n);
    const lvl = { n, W: k.W, H: k.H, hard: k.hard, shape: k.shape, arrows: paths.map((cells, i) => ({ cells, color: colours[i] })) };
    const p = peel(lvl);
    if (!p.ok) throw new Error(`dotwork: level ${n} seed ${s} not winnable (generator bug)`);
    const free0 = p.layers[0].length / lvl.arrows.length;
    const score = Math.abs(free0 - k.free0) * 4 + Math.abs(p.layers.length - k.layers) / k.layers;
    if (!best || score < best.score) best = { score, lvl, meta: { layers: p.layers.length, free0, seed: s, solution: p.layers.flat() } };
  }
  if (!best) throw new Error(`dotwork: level ${n} could not be generated`);
  return { ...best.lvl, meta: best.meta };
}
