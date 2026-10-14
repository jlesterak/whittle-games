// Purl solver and generator: hand-made levels, a hard generated level with hidden bobbins and dispensers checked
// pick by pick, board outlines, and "every generated level is winnable".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solve as solveG, replay as replayG } from '../engines/slotsort/solver.js';
import { generateLevel, GAME, knitMask, createSim } from '../games/purl/rules.js';
import { createBoard, applyPick, runDispensers, computeReach, canPick, revealReachable, DISP } from '../engines/slotsort/board.js';
import { makeRng } from '../core/rng.js';
import { knitLevel } from './fixtures/knit.js';

const solve = (lvl, o) => solveG(lvl, GAME, o);
const replay = (lvl, picks, o) => replayG(lvl, picks, GAME, o);

test('solver finds the one winning order, and proves a clogged level unwinnable', () => {
  // One slot. The bottoms show only B; A sits above B in every column.
  const good = knitLevel({ rows: 1, cells: [{ c: 0 }, { c: 1 }, 0, 0, 0, 0], columns: [[1, 0], [1, 0], [1, 0]], slots: 1 });
  const s = solve(good, { slots: 1 });
  assert.ok(s.ok);
  assert.deepEqual(s.picks, [1, 0]);
  assert.ok(replay(good, s.picks, { slots: 1 }).ok, 'the solution also wins in the real sim');
  // B is buried under A: A must go first and clogs the only slot.
  const bad = knitLevel({ cols: 1, rows: 2, cells: [{ c: 0 }, { c: 1 }], columns: [[1, 0], [1, 0], [1, 0]], slots: 1 });
  const r = solve(bad, { slots: 1 });
  assert.equal(r.ok, false);
  assert.equal(r.exhausted, false, 'proven, not given up');
});

// Level 45 is hard: 27 bobbins, 11 hidden, two facing dispensers, 4 columns. The generator's intended order must be
// legal on the board alone, every "?" must be shown the moment it can be picked (not sooner, not later) and before it
// is picked, and the empty domes must stay.
test('level 45 (hidden bobbins + dispensers): the intended order is legal, reveals each "?" first, and wins', () => {
  const lvl = generateLevel(45);
  const b = createBoard(lvl.board);
  const hidden = lvl.board.cells.filter((c) => c && c.hidden).length;
  assert.ok(lvl.hard && b.disps.length >= 2 && hidden >= 5 && lvl.columns.length === 4, 'the mix this test is about');
  runDispensers(b, null);
  const reach = new Uint8Array(b.n);
  computeReach(b, reach);
  assert.deepEqual(revealReachable(b, reach), [], 'no "?" is pickable at the start');
  let revealed = 0;
  for (const [k, cell] of lvl.meta.solution.entries()) {
    computeReach(b, reach);
    assert.ok(canPick(b, cell, reach), `pick ${k + 1} (cell ${cell}) should be pickable`);
    assert.equal(b.hid[cell], 0, `pick ${k + 1}: a "?" is shown before it is picked`);
    applyPick(b, cell, null);
    computeReach(b, reach);
    const shown = revealReachable(b, reach);
    for (const i of shown) assert.ok(reach[i], `pick ${k + 1}: the "?" at ${i} was shown before it could be picked`);
    for (let i = 0; i < b.n; i++) if (b.hid[i]) assert.equal(reach[i], 0, `pick ${k + 1}: the pickable "?" at ${i} stays hidden`);
    revealed += shown.length;
  }
  assert.equal(revealed, hidden, 'every "?" was revealed on the way');
  b.disps.forEach((d, i) => {
    assert.equal(b.dispIdx[i], d.queue.length, 'dispensers exhausted');
    assert.equal(b.kind[d.cell], DISP, 'empty domes stay');
  });
  assert.ok(replay(lvl, lvl.meta.solution, { slots: 7 }).ok, 'intended order wins in the sim');
  const s = solve(lvl, { slots: 7, maxNodes: 200000 });
  assert.ok(s.ok, 'solver');
  assert.ok(replay(lvl, s.picks, { slots: 7 }).ok, 'solver order');
});

test('board outlines: exact cell count, every cell reachable from the top row', () => {
  const rng = makeRng(7);
  let made = 0;
  for (let cells = 6; cells <= 40; cells++) {
    for (let t = 0; t < 10; t++) {
      const m = knitMask(cells, 6, rng);
      if (!m) continue;
      made++;
      assert.equal(m.mask.filter(Boolean).length, cells);
      const b = createBoard({ cols: 6, rows: m.rows, cells: m.mask.map((x) => (x ? { c: 0 } : null)) });
      const reach = new Uint8Array(b.n);
      while (b.kind.includes(1)) {
        computeReach(b, reach);
        const i = [...reach.keys()].find((j) => reach[j]);
        assert.ok(i !== undefined, `cells ${cells}: a pocket is cut off`);
        applyPick(b, i, null);
      }
    }
  }
  assert.ok(made > 300, `${made} outlines`);
});

test('every generated level is winnable (solver + full-sim replay), none falls back', () => {
  const ns = [...Array(40).keys()].map((i) => i + 1).concat([45, 50, 55, 60, 75, 100, 254, 999]);
  for (const n of ns) {
    const lvl = generateLevel(n);
    assert.ok(!lvl.meta.fallback, `level ${n} fell back`);
    const slots = lvl.meta.solvedWith;
    const s = solve(lvl, { slots });
    assert.ok(s.ok, `level ${n} solvable with ${slots} slots`);
    const r = replay(lvl, s.picks, { slots });
    assert.ok(r.ok, `level ${n} replay: ${r.reason} at pick ${r.at}`);
  }
});

test('generated levels keep the conservation invariant (3 blocks per bobbin, per colour)', () => {
  for (const n of [1, 9, 23, 41, 77]) {
    const lvl = generateLevel(n);
    const want = {};
    for (const cell of lvl.board.cells) {
      for (const c of cell?.disp || (cell ? [cell.c] : [])) want[c] = (want[c] || 0) + 3;
    }
    const got = {};
    for (const col of lvl.columns) for (const c of col) got[c] = (got[c] || 0) + 1;
    assert.deepEqual(got, want, `level ${n}`);
    assert.equal(createSim(lvl).slots.length, 7);
  }
});
