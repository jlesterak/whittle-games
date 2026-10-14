// Beadloom on the slot-sort engine: config, difficulty knobs, sim factory and level generator.

import { SlotSim } from '../../engines/slotsort/sim.js';
import { generate } from '../../engines/slotsort/generator.js';
import { hashSeed } from '../../core/rng.js';
import { NCOLORS } from './colors.js';
import { RingSupply, ringModel, streamFromOrder, SEG_ROWS, SPEEDS } from './ring.js';
import { buildTrack, shapeFor } from './track.js';

export { SEG_ROWS, SPEEDS };
export const CRATE_ROWS = 20; // a crate holds 2 segments = 100 beads

export const CONFIG = {
  capacity: CRATE_ROWS,
  completeDelay: 0.45,
  ejectTime: 0.6,
  maxSlots: 6, // the +1 booster stops at 5 (game.js); Add space after Out of space may open a 6th
  slots: 4,
  speeds: SPEEDS,
};

export const createSim = (level) => new SlotSim(level, CONFIG, new RingSupply(level, NCOLORS));

// Difficulty: d ramps 0 -> 1 over levels 1..60. Every 5th level is a breather and every 10th
// a spike; past 60 it wanders in the upper range so levels stay varied.
export function difficulty(n) {
  let d = Math.min(1, (n - 1) / 60);
  if (n > 60) d = 0.7 + 0.3 * ((hashSeed('d', n) % 1000) / 1000);
  if (n % 10 === 0) d = Math.min(1, d + 0.12);
  else if (n % 5 === 0) d *= 0.7;
  return d;
}

function knobs(n, rng) {
  const d = difficulty(n);
  const crates = Math.round(6 + 19 * d);
  const colours = Math.max(Math.ceil(crates / 2), Math.min(NCOLORS, Math.round(crates * 0.74)));
  // Each level features one or two kinds of special tile (2796: swaps + dispenser, 2414: locks).
  const kinds = [];
  if (n >= 4) kinds.push('swaps');
  if (n >= 7) kinds.push('disp');
  if (n >= 10) kinds.push('locks');
  if (n >= 14) kinds.push('ice');
  rng.shuffle(kinds);
  const use = new Set(kinds.slice(0, n >= 20 && rng.chance(0.5) ? 2 : 1));
  return {
    d,
    crates,
    colours,
    // 6-column boards are a very-hard feature (ref C.2, level 2803); otherwise 5 wide.
    cols: n >= 22 && d > 0.78 && rng.chance(0.5) ? 6 : 5,
    jitter: n <= 2 ? 0 : 1 + 6 * d,
    swaps: use.has('swaps') ? Math.min(5, 1 + Math.floor(d * 4 + rng.next())) : 0,
    dispensers: use.has('disp') ? (d > 0.8 && rng.chance(0.35) ? 2 : 1) : 0,
    dispSize: () => rng.range(2, d > 0.6 ? 4 : 3),
    locks: use.has('locks') ? Math.min(3, 1 + Math.floor(d * 2.5 + rng.next() * 0.5)) : 0,
    ice: use.has('ice') ? Math.min(3, 1 + Math.floor(d * 2 + rng.next() * 0.8)) : 0,
    // ice thaws after 20-55% of the other crates' rows, in 10-bead steps (2 rows)
    iceUnits: () => 2 * Math.max(1, Math.round((CRATE_ROWS * (crates - 3) * (0.2 + 0.35 * rng.next())) / 2)),
    hiddenTiles: 0, // Beadloom hides feeder segments, not crates
    hidden: n >= 3 && rng.chance(0.75) ? Math.min(0.55, 0.15 + 0.5 * d) : 0,
    ringShare: 0.2 + 0.2 * rng.next(), // share of all segments that start in the ring
    slotsToSolve: n <= 10 ? 3 : 4, // early levels must be winnable with a slot to spare
    band: [Math.max(0.02, 0.8 - 0.85 * d), Math.min(1, 1.05 - 0.6 * d)], // random-player win rate
  };
}

// Later attempts calm down: less jitter, fewer specials.
function calm(k, attempt) {
  const c = Math.floor(attempt / 6);
  k.jitter *= 0.75 ** c;
  if (c >= 2) k.locks = Math.min(k.locks, 1);
  if (c >= 3) k.swaps = Math.min(k.swaps, 2);
}

function supply(order, k, rng) {
  const total = order.length * 2;
  const ringSegs = Math.max(8, Math.min(13, Math.round(total * (k.ringShare ?? 0.2)), total - 2)); // 8+ keeps the O ring round
  return streamFromOrder(order, { jitter: k.jitter, ringSegs, hidden: k.hidden || 0 }, rng);
}

export function assemble({ n, seed, board, supply: { ring, feeders }, theme = n % 2, slots = 4, variant = n }) {
  const N = ring.length * SEG_ROWS;
  const shape = shapeFor(N, variant);
  const track = buildTrack(shape, N);
  return {
    n,
    seed,
    theme,
    slots,
    board,
    ring: { shape, rows: N, cells: ring.flatMap((c) => new Array(SEG_ROWS).fill(c)), mouthR: track.mouthR, mouthL: track.mouthL },
    feeders,
  };
}

export const GAME = {
  id: 'beadloom',
  cols: 5,
  maxRows: 5,
  ncolors: NCOLORS,
  dispZone: ['below', 'side'], // under the box (recordings A, B) or from the board edge (C)
  dispVanish: true,
  model: { ...ringModel, init: (level) => ringModel.init(level, NCOLORS) },
  cap: CRATE_ROWS / SEG_ROWS,
  unitsPerModel: SEG_ROWS,
  unitsPerCrate: CRATE_ROWS,
  makeSim: createSim,
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
