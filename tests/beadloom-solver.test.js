// Solver and generator: correctness on hand-made levels, the level 2796 fixture, and
// "every generated level is winnable" across many level numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solve as solveG, replay as replayG } from '../engines/slotsort/solver.js';
import { generateLevel, GAME } from '../games/beadloom/rules.js';
import { createBoard, applyPick, runDispensers, computeReach, canPick } from '../engines/slotsort/board.js';

const solve = (lvl, o) => solveG(lvl, GAME, o);
const replay = (lvl, picks, o) => replayG(lvl, picks, GAME, o);
import { tinyLevel } from './fixtures/tiny.js';
import { board2796, log2796, level2796 } from './fixtures/level2796.js';

const A = 0;
const B = 1;

test('solver finds the one winning order, and proves a jammed level unwinnable', () => {
  // One slot. Ring holds only B; A arrives once B has drained. Picking A first jams.
  const good = tinyLevel({ rows: 1, cells: [{ c: A }, { c: B }, 0, 0, 0], ring: [B, B], R: [A, A], slots: 1 });
  const s = solve(good, { slots: 1 });
  assert.ok(s.ok);
  assert.deepEqual(s.picks, [1, 0]);
  assert.ok(replay(good, s.picks, { slots: 1 }).ok, 'the solution also wins in the real sim');
  // Same, but B is buried under A: A must go first, so it can never be won.
  const bad = tinyLevel({ cols: 1, rows: 2, cells: [{ c: A }, { c: B }], ring: [B, B], R: [A, A], slots: 1 });
  const r = solve(bad, { slots: 1 });
  assert.equal(r.ok, false);
  assert.equal(r.exhausted, false, 'proven, not given up');
});

test('solver respects swap pairs (needs the second pick to land on the right colour)', () => {
  // Two slots. A swap pair shows (A|B) and (B|A); a plain C crate is on top.
  // Ring: C C A A, then B B. Every pick toggles the pair.
  const lvl = tinyLevel({
    rows: 1,
    cells: [{ c: 2 }, { c: A, alt: B, pair: 0 }, { c: B, alt: A, pair: 0 }, 0, 0],
    ring: [2, 2, A, A],
    R: [B, B],
    slots: 2,
  });
  const s = solve(lvl, { slots: 2 });
  assert.ok(s.ok);
  assert.ok(replay(lvl, s.picks, { slots: 2 }).ok);
});

test('level 2796: the logged picks are legal and take the logged colours under our rules', () => {
  const b = createBoard(board2796);
  runDispensers(b, null);
  const reach = new Uint8Array(b.n);
  for (const [k, [cell, colour]] of log2796.entries()) {
    computeReach(b, reach);
    assert.ok(canPick(b, cell, reach), `pick ${k + 1} (cell ${cell}) should be pickable`);
    assert.equal(applyPick(b, cell, null), colour, `pick ${k + 1} colour`);
  }
});

test('level 2796: logged order and solver solution both win in the simulation', () => {
  const lvl = level2796();
  assert.ok(replay(lvl, log2796.map(([cell]) => cell)).ok, 'logged order');
  const s = solve(lvl, { slots: 4 });
  assert.ok(s.ok, 'solver');
  assert.ok(replay(lvl, s.picks).ok, 'solver order');
});

test('every generated level is winnable (solver + full-sim replay)', () => {
  const ns = [...Array(80).keys()].map((i) => i + 1).concat([97, 123, 250, 333, 500, 999, 1234, 2414, 2796, 5000]);
  for (const n of ns) {
    const lvl = generateLevel(n);
    const slots = lvl.meta.solvedWith;
    const s = solve(lvl, { slots });
    assert.ok(s.ok, `level ${n} solvable with ${slots} slots`);
    const r = replay(lvl, s.picks, { slots });
    assert.ok(r.ok, `level ${n} replay: ${r.reason} at pick ${r.at}`);
  }
});
