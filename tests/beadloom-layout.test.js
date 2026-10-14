// Beadloom board layout: every board the generator can make (5 or 6 columns, up to GAME.maxRows rows) fits
// the design width and sits between the slot row and the booster bar. Guards the layout constants against
// a pitch or row change that would push crates off the board (see docs/games/beadloom.md, PLAN P4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAYOUT, FIT } from '../games/beadloom/render.js';
import { CRATE_W, CRATE_H } from '../games/beadloom/sprites.js';
import { GAME, generateLevel } from '../games/beadloom/rules.js';

const SLOT_H = 128; // render.js

test('5- and 6-column boards fit between the slots and the booster bar', () => {
  for (const cols of [5, 6]) {
    const left = LAYOUT.colX(0, cols) - CRATE_W / 2;
    const right = LAYOUT.colX(cols - 1, cols) + CRATE_W / 2;
    assert.ok(left >= 0 && right <= FIT.W, `${cols} columns span ${left}..${right} of ${FIT.W}`);
    assert.ok(LAYOUT.colPitch(cols) >= CRATE_W, `${cols} columns: crates overlap`);
    for (let rows = 1; rows <= GAME.maxRows; rows++) {
      const top = LAYOUT.rowY(0, rows) - CRATE_H / 2;
      const bottom = LAYOUT.rowY(rows - 1, rows) + CRATE_H / 2;
      assert.ok(top > LAYOUT.slotY + SLOT_H / 2, `${rows} rows reach up into the slots (${top})`);
      assert.ok(bottom < LAYOUT.barY, `${rows} rows reach down into the booster bar (${bottom})`);
    }
  }
});

test('the generator does make 6-column boards on some hard levels', () => {
  const six = [48, 60, 99].map((n) => generateLevel(n).board);
  for (const b of six) {
    assert.equal(b.cols, 6);
    assert.ok(b.rows <= GAME.maxRows);
  }
});
