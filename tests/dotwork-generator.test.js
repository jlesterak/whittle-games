// Dotwork generator: every level is winnable, well formed and deterministic; difficulty
// rises; picture masks show up where expected; level 208 is generated like any other.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateLevel, knobs, isHard } from '../games/dotwork/generator.js';
import { createBoard, peel, rayCells } from '../games/dotwork/board.js';

const LEVELS = [...Array.from({ length: 60 }, (_, i) => i + 1), 80, 150, 209];

test('every generated level is winnable and well formed (>= 2 cells, no overlap, no ray through itself)', () => {
  for (const n of LEVELS) {
    const lvl = generateLevel(n);
    const b = createBoard(lvl); // throws on overlap
    lvl.arrows.forEach((a, id) => {
      assert.ok(a.cells.length >= 2, `level ${n} arrow ${id} too short`);
      for (let i = 1; i < a.cells.length; i++) {
        const d = Math.abs(a.cells[i] - a.cells[i - 1]);
        assert.ok(d === 1 || d === lvl.W, `level ${n} arrow ${id} not orthogonally connected`);
      }
      for (const c of rayCells(lvl.W, lvl.H, a.cells)) assert.notEqual(b.occ[c], id, `level ${n} arrow ${id} points through itself`);
    });
    const p = peel(lvl);
    assert.ok(p.ok, `level ${n} not winnable`);
    assert.equal(p.layers.length, lvl.meta.layers);
  }
});

test('levels are deterministic, and difficulty rises with breathers after hard levels', () => {
  assert.deepEqual(generateLevel(23), generateLevel(23));
  const a = generateLevel(2).meta;
  const z = generateLevel(55).meta;
  assert.ok(z.layers > a.layers * 3, `layers ${a.layers} -> ${z.layers}`);
  assert.ok(z.free0 < a.free0, `free at start ${a.free0} -> ${z.free0}`);
  assert.ok(isHard(10) && !isHard(11) && !isHard(1));
  assert.ok(knobs(11).W < knobs(10).W, 'a smaller breather follows a hard level');
});

test('picture masks: some boards are not rectangles; level 208 is an ordinary generated level', () => {
  const shaped = LEVELS.filter((n) => knobs(n).shape !== 'rect');
  assert.ok(shaped.length >= 8);
  const l = generateLevel(shaped[3]);
  const filled = l.arrows.reduce((s, a) => s + a.cells.length, 0) / (l.W * l.H);
  assert.ok(filled < 0.8, `a picture leaves its corners empty (${filled.toFixed(2)})`);
  const l208 = generateLevel(208);
  assert.equal(l208.n, 208);
  assert.equal(l208.W, knobs(208).W, 'sized by the knobs, not a stored board');
  assert.ok(Number.isInteger(l208.meta.seed), 'built from a seed');
});
