import { SEG_ROWS } from '../../games/beadloom/ring.js';

// Build a level from segment colour lists. Each ring entry is one 10-row segment.
export function tinyLevel({ cols = 5, rows, cells, ring, R = [], L = [], slots = 4 }) {
  const N = ring.length * SEG_ROWS;
  return {
    n: 0,
    slots,
    board: { cols, rows, cells },
    ring: { shape: 'O', rows: N, cells: ring.flatMap((c) => Array(SEG_ROWS).fill(c)), mouthR: Math.round(N * 0.3), mouthL: Math.round(N * 0.7) },
    feeders: [R.map((c) => ({ c, hidden: false })), L.map((c) => ({ c, hidden: true }))],
  };
}

