// Purl level 254 from the recordings (spec section 7): the exact board, dispensers and
// the lost game's pick log. The six "?" bobbins never revealed, so their colours are guesses
// (spread over the picture's colours); r5c5 revealed yellow. Only the bottom of the picture was
// visible, so the full level's columns are dealt from a plausible pick order with no jitter.
import { C } from '../../games/purl/colors.js';
import { columnsFromOrder } from '../../games/purl/columns.js';
import { makeRng } from '../../core/rng.js';

const x = (c) => ({ c });
const h = (c) => ({ c, hidden: true });
const { red, yellow, purple, beige, gray, green, blue, cyan, orange } = C;

// 6 x 6, row 0 at the top. Voids: r3c3-c5, r4c2-c4, r5c3 (1-based as in the spec).
export const board254 = {
  cols: 6,
  rows: 6,
  dispVanish: false,
  cells: [
    x(gray), x(purple), x(beige), x(green), x(gray), x(red),
    x(gray), x(blue), x(orange), x(red), x(cyan), x(yellow),
    x(green), { disp: [red, blue, cyan], zone: [12] }, null, null, null, x(blue),
    x(red), null, null, null, { disp: [yellow, blue, beige], zone: [23] }, x(cyan),
    x(yellow), h(gray), null, h(orange), h(yellow), x(red),
    x(purple), h(beige), h(green), h(purple), h(gray), x(yellow),
  ],
};

// [cell, colour taken], in the order played (the lost game, t = 6.4 .. 62.6 s).
export const log254 = [
  [5, red], [11, yellow], [1, purple], [0, gray], [2, beige], [17, blue], [23, cyan], [3, green],
  [9, red], [6, gray], [12, green], [23, yellow], [12, red], [23, blue], [23, beige], [8, orange],
  [10, cyan], [29, red], [12, blue],
];

// A full level: the log's colours, then the rest of the board's bobbins in reading order,
// dealt into 4 columns with no jitter.
export function level254() {
  const rest = [];
  for (const cell of board254.cells) {
    if (cell && cell.disp) rest.push(...cell.disp);
    else if (cell) rest.push(cell.c);
  }
  for (const [, c] of log254) rest.splice(rest.indexOf(c), 1);
  const order = [...log254.map(([, c]) => c), ...rest];
  return { n: 254, slots: 7, hard: true, board: board254, columns: columnsFromOrder(order, { jitter: 0, C: 4 }, makeRng(254)) };
}
