// Solver and generator: correctness on hand-made levels, a generated level with swaps and a dispenser checked
// pick by pick, and "every generated level is winnable" across many level numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solve as solveG, replay as replayG } from '../engines/slotsort/solver.js';
import { generateLevel, GAME } from '../games/beadloom/rules.js';
import { createBoard, applyPick, runDispensers, computeReach, canPick, newPickInfo, boardCleared } from '../engines/slotsort/board.js';

const solve = (lvl, o) => solveG(lvl, GAME, o);
const replay = (lvl, picks, o) => replayG(lvl, picks, GAME, o);
import { tinyLevel } from './fixtures/tiny.js';

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

// Level 33 has 8 swap crates and a dispenser: the generator's intended order must be legal on the board alone
// (exit paths, swap crates trading colours, the dispenser putting out its queue in order and vanishing), clear it, and
// win in the real simulation.
test('level 33 (swaps + dispenser): the intended order is legal pick by pick, clears the board and wins', () => {
  const lvl = generateLevel(33);
  const b = createBoard(lvl.board);
  assert.ok(b.disps.length >= 1 && lvl.board.cells.filter((c) => c && c.alt !== undefined).length >= 2, 'swaps and a dispenser');
  const fed = b.disps.map(() => []); // colours each dispenser put out, in order
  const first = newPickInfo();
  runDispensers(b, first);
  for (const e of first.ejects) fed[e.disp].push(e.color);
  const reach = new Uint8Array(b.n);
  let swapped = 0;
  for (const [k, cell] of lvl.meta.solution.entries()) {
    computeReach(b, reach);
    assert.ok(canPick(b, cell, reach), `pick ${k + 1} (cell ${cell}) should be pickable`);
    const was = { color: b.color.slice(), alt: b.alt.slice(), pair: b.pair.slice() };
    const info = newPickInfo();
    applyPick(b, cell, info);
    for (let j = 0; j < b.n; j++) {
      if (j === cell || was.pair[j] < 0) continue;
      if (was.pair[j] === was.pair[cell]) {
        // the picked crate's partner stops swapping and keeps the colour it shows
        assert.ok(b.pair[j] === -1 && b.color[j] === was.color[j], `pick ${k + 1}: partner ${j} keeps its colour`);
      } else {
        assert.ok(b.color[j] === was.alt[j] && b.alt[j] === was.color[j], `pick ${k + 1}: swap crate ${j} swapped colours`);
        swapped++;
      }
    }
    for (const e of info.ejects) {
      assert.equal(b.color[e.to], e.color, `pick ${k + 1}: the ejected crate has the colour it was sent with`);
      fed[e.disp].push(e.color);
    }
  }
  assert.ok(swapped > 0, 'the swaps swapped along the way');
  b.disps.forEach((d, i) => assert.deepEqual(fed[i], d.queue, `dispenser ${i} put out its queue in order`));
  assert.ok(fed.flat().length > 0, 'the dispenser refilled');
  assert.ok(boardCleared(b), 'board and dispenser empty');
  assert.ok(replay(lvl, lvl.meta.solution).ok, 'intended order wins in the sim');
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
