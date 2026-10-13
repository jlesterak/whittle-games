// Dotwork: the board model and the peel solver. Pure, no DOM (spec 8.1, 8.2).
//
// Level format: { W, H, arrows: [{ cells: [tail .. head] (cell = y * W + x), color }], mask? }
// An arrow points in the direction of its last step. Tapping it casts a ray from the head to
// the board edge: if no other arrow sits on that ray it escapes (and its cells free up at
// once, so a second arrow can fly through its lane); otherwise it bumps the first arrow on the
// ray, turns white and costs a star. Removal only ever frees cells, so a level is winnable iff
// greedy peeling (remove every free arrow, repeat) empties it.

export const DIRS = [
  [0, -1], // up
  [1, 0], // right
  [0, 1], // down
  [-1, 0], // left
];
const LETTER = { U: 0, R: 1, D: 2, L: 3 };
export const STARS = 3;

export function headDir(W, cells) {
  const h = cells[cells.length - 1];
  const p = cells[cells.length - 2];
  const dx = (h % W) - (p % W);
  const dy = Math.floor(h / W) - Math.floor(p / W);
  return DIRS.findIndex(([x, y]) => x === dx && y === dy);
}

// The cells from the head (exclusive) to the board edge, in order.
export function rayCells(W, H, cells, dir = headDir(W, cells)) {
  const h = cells[cells.length - 1];
  const [dx, dy] = DIRS[dir];
  const out = [];
  for (let x = (h % W) + dx, y = Math.floor(h / W) + dy; x >= 0 && y >= 0 && x < W && y < H; x += dx, y += dy) out.push(y * W + x);
  return out;
}

// Spec section 7 format: "<colour><tailX>,<tailY>:<moves>" tokens, moves run-length from the
// tail ("3U" = 3 cells up). colours maps the letter to a palette index.
export function parseArrows(text, W, colours) {
  return text
    .trim()
    .split(/\s+/)
    .map((tok) => {
      const m = /^([A-Z])(\d+),(\d+):(.+)$/.exec(tok);
      if (!m) throw new Error(`bad arrow token ${tok}`);
      let x = +m[2];
      let y = +m[3];
      const cells = [y * W + x];
      for (const [, n, d] of m[4].matchAll(/(\d*)([URDL])/g)) {
        const [dx, dy] = DIRS[LETTER[d]];
        for (let k = 0; k < (n ? +n : 1); k++) cells.push((y += dy) * W + (x += dx));
      }
      return { cells, color: colours[m[1]] };
    });
}

// Runtime board. gone/failed per arrow; occ maps a cell to the arrow on it (-1 = none).
export function createBoard(level) {
  const { W, H, arrows } = level;
  const b = {
    W,
    H,
    arrows,
    dirs: arrows.map((a) => headDir(W, a.cells)),
    occ: new Int32Array(W * H).fill(-1),
    gone: new Uint8Array(arrows.length),
    failed: new Uint8Array(arrows.length),
    stars: STARS,
    removed: 0,
    mistakes: 0,
    status: 'playing', // 'won' | 'lost'
  };
  arrows.forEach((a, id) => {
    for (const c of a.cells) {
      if (b.occ[c] !== -1) throw new Error(`arrows ${b.occ[c]} and ${id} overlap at cell ${c}`);
      b.occ[c] = id;
    }
  });
  return b;
}

// The first occupied cell on an arrow's ray: { cell, id, dist } (dist 1 = right in front of
// the head), or null when the way out is clear.
export function blocker(b, id) {
  const ray = rayCells(b.W, b.H, b.arrows[id].cells, b.dirs[id]);
  for (let k = 0; k < ray.length; k++) {
    const o = b.occ[ray[k]];
    if (o !== -1 && o !== id) return { cell: ray[k], id: o, dist: k + 1 };
  }
  return null;
}

export const isFree = (b, id) => !b.gone[id] && !blocker(b, id);

export function freeArrows(b) {
  const out = [];
  for (let id = 0; id < b.arrows.length; id++) if (isFree(b, id)) out.push(id);
  return out;
}

function lift(b, id) {
  for (const c of b.arrows[id].cells) b.occ[c] = -1;
  b.gone[id] = 1;
  b.failed[id] = 0;
  b.removed++;
  if (b.removed === b.arrows.length) b.status = 'won';
}

// Tap an arrow. Returns { ok: true } when it escapes, { ok: false, blocker } when it bumps
// (white, -1 star; a repeat bump of a white arrow costs again, spec unknown 7), or null.
export function fire(b, id) {
  if (b.status !== 'playing' || b.gone[id]) return null;
  const bl = blocker(b, id);
  if (!bl) {
    lift(b, id);
    return { ok: true };
  }
  b.failed[id] = 1;
  b.stars--;
  b.mistakes++;
  if (b.stars <= 0) b.status = 'lost';
  return { ok: false, blocker: bl };
}

// Eraser booster: any arrow, free or blocked, is removed without moving and at no cost.
export function erase(b, id) {
  if (b.status !== 'playing' || b.gone[id]) return false;
  lift(b, id);
  return true;
}

// Continue after Out of Stars: the board stays as it is (spec 3).
export function addStar(b, n = 1) {
  b.stars += n;
  if (b.status === 'lost' && b.stars > 0) b.status = 'playing';
}

export function serialize(b) {
  const ids = (arr) => [...arr.keys()].filter((i) => arr[i]);
  return { gone: ids(b.gone), failed: ids(b.failed), stars: b.stars, mistakes: b.mistakes };
}

export function loadBoard(level, s) {
  const b = createBoard(level);
  for (const id of s.gone) {
    if (id < 0 || id >= level.arrows.length) throw new Error('save does not match the level');
    lift(b, id);
  }
  for (const id of s.failed) if (!b.gone[id]) b.failed[id] = 1;
  b.stars = s.stars;
  b.mistakes = s.mistakes || 0;
  if (b.stars <= 0 && b.status === 'playing') b.status = 'lost';
  return b;
}

// Greedy peeling: { ok, layers: [[ids removed together]...] }. ok = the board empties.
export function peel(level) {
  const b = createBoard(level);
  const layers = [];
  let left = level.arrows.map((_, id) => id);
  while (left.length) {
    const free = left.filter((id) => !blocker(b, id));
    if (!free.length) return { ok: false, layers, stuck: left };
    for (const id of free) lift(b, id);
    layers.push(free);
    const done = new Set(free);
    left = left.filter((id) => !done.has(id));
  }
  return { ok: true, layers };
}
