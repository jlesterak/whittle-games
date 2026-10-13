// Purl on the slot-sort engine: config, difficulty knobs, board outlines with voids,
// sim factory and level generator.

import { SlotSim } from '../../engines/slotsort/sim.js';
import { generate } from '../../engines/slotsort/generator.js';
import { hashSeed } from '../../core/rng.js';
import { NCOLORS } from './colors.js';
import { ColumnSupply, columnModel, columnsFromOrder, BLOCK_ROWS, BOBBIN_ROWS, BOBBIN_BLOCKS, BLOCK_TIME, SPEEDS } from './columns.js';

export { BLOCK_ROWS, BOBBIN_ROWS, BLOCK_TIME, SPEEDS };
export const SLOTS = 7;
export const BOARD_COLS = 6;
export const MAX_ROWS = 7;

export const CONFIG = {
  capacity: BOBBIN_ROWS, // a bobbin holds 3 blocks of 6 stitch rows
  completeDelay: 0.2, // hold at 100 %, then pop (spec 2.4)
  ejectTime: 0.2, // dispenser slide (spec 3.4)
  claimDelay: 0.7, // lands 0.45 s after the tap, thread shoots at ~0.7 s (spec 2.2)
  maxSlots: SLOTS + 1, // Continue after Out of space opens an 8th slot
  slots: SLOTS,
  speeds: SPEEDS,
};

export const createSim = (level) => new SlotSim(level, CONFIG, new ColumnSupply(level));

// HARD every 5th level from 5 on (spec 8.4: "every ~5th level, higher J and more hidden").
export const isHard = (n) => n >= 5 && n % 5 === 0;

// Difficulty d ramps 0 -> 1 over levels 1..60 and wanders in the upper range after that.
export function difficulty(n) {
  let d = Math.min(1, (n - 1) / 60);
  if (n > 60) d = 0.65 + 0.35 * ((hashSeed('ck-d', n) % 1000) / 1000);
  if (isHard(n)) d = Math.min(1, d + 0.15);
  return d;
}

// Knobs (spec 8.4 table; level 254 = 4 columns, 9 colours, 33 bobbins, 7/27 hidden, 2 x 3
// dispensers, 7 slots).
function knobs(n, rng) {
  const d = difficulty(n);
  const hard = isHard(n);
  const crates = Math.min(40, Math.round(8 + 25 * d + (hard ? 3 : 0) + rng.next() * 2));
  const colours = Math.min(NCOLORS, Math.max(Math.ceil(crates / 5), Math.round(3 + 6.5 * d)));
  const dispensers = n < 6 ? 0 : d < 0.35 ? (rng.chance(0.5) ? 1 : 0) : d < 0.7 ? 1 + (rng.chance(0.3) ? 1 : 0) : 1 + rng.int(3);
  const hiddenShare = n < 4 ? 0 : Math.min(0.35, 0.06 + 0.22 * d + (hard ? 0.08 : 0));
  return {
    d,
    hard,
    crates,
    colours,
    maxPerColour: 5,
    C: n <= 3 ? 3 : d > 0.75 && rng.chance(0.2) ? 5 : 4,
    jitter: n <= 2 ? 0 : Math.min(10, 1 + 6 * d + (hard ? 2 : 0)),
    swaps: 0,
    locks: 0,
    ice: 0,
    dispensers,
    dispSize: () => rng.range(2, d > 0.6 ? 4 : 3),
    hiddenTiles: Math.round(crates * hiddenShare),
    slotsToSolve: n <= 10 ? 5 : SLOTS, // easy levels must be winnable with 2 slots to spare
    band: hard ? [0.15, 0.45] : [0.5, d < 0.3 ? 1 : 0.85], // random-player win rate
  };
}

// Later attempts calm down: less jitter, fewer hidden.
function calm(k, attempt) {
  const c = Math.floor(attempt / 6);
  k.jitter *= 0.75 ** c;
  if (c >= 2) k.hiddenTiles = Math.floor(k.hiddenTiles / 2);
}

// Board outline: 6 wide, 2-7 rows, voids for the cells not used. Small boards lose their outer
// columns from the bottom up (voids there look like a narrower board, since voids and surround
// share a colour); bigger ones get a blob of voids jutting into the middle rows, like level
// 254's cross, sometimes mirrored. Every cell must connect to the top row through non-void cells.
export function knitMask(cells, cols, rng) {
  let rows = Math.max(2, Math.ceil(cells / cols));
  if (cells >= 16 && rows < MAX_ROWS && rows * cols - cells < 3) rows++;
  if (rows > MAX_ROWS) return null;
  const V = rows * cols - cells;
  const at = (r, c) => r * cols + c;
  const edges = [0, cols - 1, 1, cols - 2, 2, cols - 3];
  for (let attempt = 0; attempt < 20; attempt++) {
    const mask = new Array(rows * cols).fill(true);
    let voids = V;
    if (cells < 16) {
      for (let r = rows - 1; r >= 1 && voids > 0; r--) {
        for (const c of edges.slice(0, 4)) if (voids > 0) (mask[at(r, c)] = false), voids--;
      }
    } else {
      const r0 = rows >= 5 ? 2 : 1;
      const region = [];
      for (let r = r0; r < rows - 1; r++) for (let c = 1; c < cols - 1; c++) region.push(at(r, c));
      const inRegion = (r, c) => r >= r0 && r < rows - 1 && c >= 1 && c < cols - 1;
      const mirror = V % 2 === 0 && rng.chance(0.5);
      const blob = new Set();
      const add = (i) => {
        const twin = at((i / cols) | 0, cols - 1 - (i % cols));
        if (blob.has(i) || blob.size + (mirror && twin !== i ? 2 : 1) > voids) return;
        blob.add(i);
        if (mirror) blob.add(twin);
      };
      add(rng.pick(region));
      for (let guard = 0; blob.size < voids && guard < 60; guard++) {
        const from = rng.pick([...blob]);
        const r = (from / cols) | 0;
        const c = from % cols;
        const nb = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].filter(([rr, cc]) => inRegion(rr, cc));
        if (nb.length) add(at(...rng.pick(nb)));
      }
      for (const i of blob) mask[i] = false;
      voids -= blob.size;
    }
    for (const c of edges) if (voids > 0 && mask[at(rows - 1, c)]) (mask[at(rows - 1, c)] = false), voids--;
    if (voids === 0 && connected(mask, rows, cols)) return { rows, mask };
  }
  return null;
}

function connected(mask, rows, cols) {
  const seen = new Uint8Array(rows * cols);
  const q = [];
  for (let c = 0; c < cols; c++) if (mask[c]) (seen[c] = 1), q.push(c);
  while (q.length) {
    const i = q.pop();
    const r = (i / cols) | 0;
    const c = i % cols;
    for (const [rr, cc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
      if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
      const j = rr * cols + cc;
      if (mask[j] && !seen[j]) (seen[j] = 1), q.push(j);
    }
  }
  return mask.every((m, i) => !m || seen[i]);
}

function supply(order, k, rng) {
  return columnsFromOrder(order, { jitter: k.jitter, C: k.C }, rng);
}

export function assemble({ n, seed, board, supply: columns, k }) {
  return { n, seed, slots: SLOTS, hard: !!k?.hard, board, columns };
}

export const GAME = {
  id: 'purl',
  cols: BOARD_COLS,
  maxRows: MAX_ROWS,
  ncolors: NCOLORS,
  dispZone: 'facing',
  dispVanish: false,
  model: columnModel,
  cap: BOBBIN_BLOCKS,
  unitsPerModel: BLOCK_ROWS,
  makeSim: createSim,
  mask: knitMask,
  knobs,
  calm,
  supply,
  assemble,
};

const cache = new Map();

export function generateLevel(n) {
  if (!cache.has(n)) {
    cache.set(n, generate(n, GAME));
    if (cache.size > 8) cache.delete(cache.keys().next().value);
  }
  return structuredClone(cache.get(n));
}
