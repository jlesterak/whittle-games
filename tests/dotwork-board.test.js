// Dotwork board model: a big generated board, the tap rule (escape / bump), stars, the
// eraser, continue, win, and save/restore.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBoard, fire, erase, addStar, blocker, freeArrows, peel, serialize, loadBoard, rayCells, parseArrows } from '../games/dotwork/board.js';
import { generateLevel } from '../games/dotwork/generator.js';

const big = () => generateLevel(80); // a hard 34x43 board, deep peel

test('a big board: no overlap, every cell an arrow covers counted once, no ray through its own body', () => {
  const lvl = big();
  const b = createBoard(lvl); // throws on overlap
  assert.equal(b.occ.filter((o) => o >= 0).length, lvl.arrows.reduce((s, a) => s + a.cells.length, 0));
  lvl.arrows.forEach((a, id) => {
    assert.ok(a.cells.length >= 2);
    for (const c of rayCells(lvl.W, lvl.H, a.cells)) assert.notEqual(b.occ[c], id, `arrow ${id} points through itself`);
  });
});

test('a big board: greedy peel clears it, each layer every arrow free at that point, as the generator recorded', () => {
  const lvl = big();
  const p = peel(lvl);
  assert.ok(p.ok);
  assert.equal(p.layers.length, lvl.meta.layers);
  // checked against the tap rule, not peel itself: each layer is exactly the arrows free then, and they all escape
  const b = createBoard(lvl);
  p.layers.forEach((layer, k) => {
    assert.deepEqual(layer, freeArrows(b), `layer ${k + 1} is every arrow free at that point`);
    for (const id of layer) assert.ok(fire(b, id)?.ok, `layer ${k + 1}: arrow ${id} escapes`);
  });
  assert.equal(b.status, 'won');
  assert.ok(p.layers.length >= 20, `deep enough to exercise the solver (${p.layers.length} layers)`);
  assert.equal(p.layers.flat().length, lvl.arrows.length, 'every arrow leaves exactly once');
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
  const lvl = big();
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
