// Beadloom board layout: every board the generator can make (5 or 6 columns, up to GAME.maxRows rows) fits the
// design width, rails included, and sits between the slot row and the booster bar. Guards the layout constants
// against a pitch or row change that would push the board off screen (docs/games/beadloom.md, PLAN P4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAYOUT, FIT, SLOT_H, CELL_BOX, RAIL_PAD } from '../games/beadloom/render.js';
import { CRATE_W } from '../games/beadloom/sprites.js';
import { GAME, generateLevel } from '../games/beadloom/rules.js';

const RAIL_STUB = 40; // drawRails: the stubs out to the sides sit this far above the top rail box

test('5- and 6-column boards and their rails fit between the slots and the booster bar', () => {
  for (const cols of [5, 6]) {
    const left = LAYOUT.colX(0, cols) - CELL_BOX.left - RAIL_PAD;
    const right = LAYOUT.colX(cols - 1, cols) + CELL_BOX.right + RAIL_PAD;
    assert.ok(left >= 0 && right <= FIT.W, `${cols} columns: the rails span ${left}..${right} of ${FIT.W}`);
    assert.ok(LAYOUT.colPitch(cols) >= CRATE_W, `${cols} columns: crates overlap`);
    for (let rows = 1; rows <= GAME.maxRows; rows++) {
      const top = LAYOUT.rowY(0, rows) - CELL_BOX.up - RAIL_STUB;
      const bottom = LAYOUT.rowY(rows - 1, rows) + CELL_BOX.down + RAIL_PAD;
      assert.ok(top > LAYOUT.slotY + SLOT_H / 2, `${rows} rows: the rails reach up into the slots (${top})`);
      assert.ok(bottom < LAYOUT.barY, `${rows} rows: the rails reach down into the booster bar (${bottom})`);
    }
  }
});

test('the generator makes 6-column boards on some levels, never taller than the layout allows', () => {
  const boards = Array.from({ length: 31 }, (_, k) => generateLevel(40 + k).board);
  assert.ok(boards.some((b) => b.cols === 6), 'no 6-column board in levels 40-70');
  for (const b of boards) assert.ok([5, 6].includes(b.cols) && b.rows <= GAME.maxRows, `${b.cols}x${b.rows}`);
});
