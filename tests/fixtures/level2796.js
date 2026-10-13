// Level 2796 from the recording (spec section 7): the exact board, specials and pick log.
// The real ring/feeder contents were not fully visible, so the bead stream is built from the
// logged pick order with no jitter (the order the player actually used).
import { C } from '../../games/beadloom/colors.js';
import { streamFromOrder } from '../../games/beadloom/ring.js';
import { assemble } from '../../games/beadloom/rules.js';
import { makeRng } from '../../core/rng.js';

const x = (c) => ({ c });
const sw = (c, alt, pair) => ({ c, alt, pair });

export const board2796 = {
  cols: 5,
  rows: 5,
  cells: [
    x(C.navy), x(C.crimson), x(C.pink), x(C.darkgreen), x(C.green),
    x(C.white), sw(C.cyan, C.lavender, 0), { disp: [C.pink, C.blue, C.orange], zone: [11, 12, 13] }, sw(C.red, C.gray, 1), x(C.violet),
    sw(C.olive, C.blue, 2), x(C.lavender), sw(C.teal, C.navy, 3), x(C.amber), sw(C.blue, C.olive, 2),
    x(C.brown), sw(C.gray, C.red, 1), x(C.darkpurple), sw(C.lavender, C.cyan, 0), x(C.yellow),
    null, x(C.orange), sw(C.navy, C.teal, 3), x(C.crimson), null,
  ],
};

// [cell, colour it was taken as], in the order played.
export const log2796 = [
  [1, C.crimson], [6, C.lavender], [11, C.lavender], [11, C.pink], [0, C.navy], [11, C.blue],
  [11, C.orange], [16, C.red], [17, C.darkpurple], [4, C.green], [9, C.violet], [5, C.white],
  [3, C.darkgreen], [22, C.teal], [15, C.brown], [14, C.olive], [19, C.yellow], [23, C.crimson],
  [10, C.blue], [21, C.orange], [2, C.pink], [8, C.gray], [18, C.cyan], [12, C.navy], [13, C.amber],
];

export function level2796() {
  const order = log2796.map(([, c]) => c);
  const { ring, feeders } = streamFromOrder(order, { jitter: 0, ringSegs: 10, hidden: 0.5 }, makeRng(2796));
  return assemble({ n: 2796, seed: 2796, board: structuredClone(board2796), supply: { ring, feeders }, theme: 0 });
}
