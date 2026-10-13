// Dotwork board model: the level 208 fixture, the tap rule (escape / bump), stars, the
// eraser, continue, win, and save/restore.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBoard, fire, erase, addStar, blocker, freeArrows, peel, serialize, loadBoard, rayCells, parseArrows } from '../games/dotwork/board.js';
import { level208 } from '../games/dotwork/level208.js';

test('level 208 fixture: 163 arrows on 1564 cells, no overlap, no ray through its own body', () => {
  const lvl = level208();
  assert.equal(lvl.arrows.length, 163);
  const b = createBoard(lvl); // throws on overlap
  assert.equal(b.occ.filter((o) => o >= 0).length, 1564);
  lvl.arrows.forEach((a, id) => {
    assert.ok(a.cells.length >= 2);
    for (const c of rayCells(lvl.W, lvl.H, a.cells)) assert.notEqual(b.occ[c], id, `arrow ${id} points through itself`);
  });
});

test('level 208 fixture: greedy peel clears it in 31 layers, 17 free at the start', () => {
  const p = peel(level208());
  assert.ok(p.ok);
  assert.equal(p.layers.length, 31);
  assert.deepEqual(
    p.layers.map((l) => l.length),
    [17, 15, 15, 13, 10, 8, 7, 5, 4, 4, 4, 4, 5, 5, 5, 2, 2, 3, 2, 4, 4, 1, 3, 2, 7, 4, 3, 1, 2, 1, 1],
  );
});

// A 5x3 board (> < ^ v are heads):
//   row 0:  0 >  .  .  2      arrow 0 points right into arrow 2's head at (4,0)
//   row 1:  1 1  >  .  2      arrow 1 points right into arrow 2's tail at (4,1); 2 points up, clear
//   row 2:  3 >  .  .  .      arrow 3 points right, clear
const tiny = () => ({ W: 5, H: 3, arrows: parseArrows('B0,0:R B0,1:2R R4,1:U O0,2:R', 5, { B: 0, R: 1, O: 2 }) });

test('tap rule: a clear arrow escapes and frees its lane at once; a blocked one bumps, turns white, costs a star', () => {
  const lvl = tiny();
  const b = createBoard(lvl);
  // arrow 1 (row 1, pointing right) is blocked by arrow 2's tail at (4,1)
  assert.deepEqual(blocker(b, 1), { cell: 9, id: 2, dist: 2 });
  const r = fire(b, 1);
  assert.equal(r.ok, false);
  assert.equal(r.blocker.id, 2);
  assert.equal(b.stars, 2);
  assert.equal(b.failed[1], 1);
  assert.equal(b.gone[1], 0, 'a bumped arrow stays on the board');
  // a repeat bump of the white arrow costs again
  fire(b, 1);
  assert.equal(b.stars, 1);
  // arrow 2 points up: (4,1) -> (4,0), clear
  assert.equal(fire(b, 2).ok, true);
  assert.equal(b.occ[9], -1, 'cells free at launch');
  // now the white arrow escapes for free and regains its colour
  assert.equal(fire(b, 1).ok, true);
  assert.equal(b.failed[1], 0);
  assert.equal(b.stars, 1);
  assert.equal(fire(b, 1), null, 'gone arrows ignore taps');
});

test('three bumps lose; +1 star continues with the board kept; clearing every arrow wins', () => {
  const lvl = {
    W: 4,
    H: 1,
    arrows: parseArrows('B0,0:R R3,0:L', 4, { B: 0, R: 1 }),
  };
  const b = createBoard(lvl);
  assert.deepEqual(freeArrows(b), []);
  fire(b, 0);
  fire(b, 1);
  fire(b, 0);
  assert.equal(b.status, 'lost');
  assert.equal(fire(b, 1), null, 'no taps after the loss');
  addStar(b);
  assert.equal(b.status, 'playing');
  assert.equal(b.stars, 1);
  // eraser removes a blocked arrow at no cost; then the other is free
  assert.ok(erase(b, 1));
  assert.equal(b.stars, 1);
  assert.deepEqual(freeArrows(b), [0]);
  fire(b, 0);
  assert.equal(b.status, 'won');
});

test('save/restore round trip keeps removed, white arrows and stars', () => {
  const lvl = level208();
  const b = createBoard(lvl);
  const [l0] = peel(lvl).layers;
  for (const id of l0.slice(0, 5)) fire(b, id);
  const stuck = lvl.arrows.findIndex((_, id) => !b.gone[id] && blocker(b, id));
  fire(b, stuck);
  const s = JSON.parse(JSON.stringify(serialize(b)));
  const r = loadBoard(lvl, s);
  assert.deepEqual([...r.occ], [...b.occ]);
  assert.deepEqual([...r.failed], [...b.failed]);
  assert.equal(r.stars, 2);
  assert.equal(r.removed, 5);
});

test('tiny fixture is wired as drawn', () => {
  const b = createBoard(tiny());
  assert.deepEqual(freeArrows(b), [2, 3]);
  assert.equal(blocker(b, 0).id, 2);
});
