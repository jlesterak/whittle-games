// A damaged in-progress level (a missing or wrong field in the saved sim or board) must be refused before
// anything changes, so the game can restart the level instead of crashing every frame (past bug: Beadloom and
// Purl ran ~60 exceptions a second, Dotwork showed a blank board, and both were saved back).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as beadloom from '../games/beadloom/rules.js';
import * as purl from '../games/purl/rules.js';
import { generateLevel as dotworkLevel } from '../games/dotwork/generator.js';
import { createBoard, fire, freeArrows, serialize, loadBoard } from '../games/dotwork/board.js';

// Play a slot-sort level for a while and return its saved state.
function midLevel(rules, n) {
  const level = rules.generateLevel(n);
  const sim = rules.createSim(level);
  const picks = level.meta.solution;
  let k = 0;
  for (let t = 0; t < 60 * 15; t++) {
    if (k < picks.length && sim.hasFreeSlot() && t % 90 === 0) sim.pick(picks[k++]);
    sim.step();
  }
  return { level, saved: JSON.parse(JSON.stringify(sim.serialize())) };
}

const drop = (obj, path) => {
  const out = structuredClone(obj);
  const keys = path.split('.');
  const last = keys.pop();
  let o = out;
  for (const k of keys) o = o[k];
  delete o[last];
  return out;
};
const set = (obj, path, value) => {
  const out = structuredClone(obj);
  const keys = path.split('.');
  const last = keys.pop();
  let o = out;
  for (const k of keys) o = o[k];
  o[last] = value;
  return out;
};

for (const [name, rules, n, supplyFields] of [
  ['Beadloom', beadloom, 37, ['supply.ring', 'supply.offset', 'supply.phase', 'supply.feeders']],
  ['Purl', purl, 12, ['supply.lanes']],
]) {
  test(`${name}: a damaged saved level is refused whole, a good one still loads`, () => {
    const { level, saved } = midLevel(rules, n);
    // the good save loads (a full slot completes on load, so compare from the second round on)
    const once = rules.createSim(level).load(structuredClone(saved)).serialize();
    assert.deepEqual(rules.createSim(level).load(structuredClone(once)).serialize(), once, 'the good save loads and stays put');
    const damaged = [
      ...['tick', 'slots', 'board', 'picks', 'supply', ...supplyFields].map((p) => drop(saved, p)),
      ...['kind', 'color', 'pair', 'lock', 'dispIdx', 'hid'].map((k) => drop(saved, `board.${k}`)),
      set(saved, 'tick', 'x'),
      set(saved, 'board.kind', saved.board.kind.slice(1)),
      set(saved, 'slots', []),
      set(saved, 'slots', [{ color: 'red', landed: 3 }]),
    ];
    for (const d of damaged) {
      const sim = rules.createSim(level);
      const before = JSON.stringify(sim.serialize());
      assert.throws(() => sim.load(d), /bad save/);
      assert.equal(JSON.stringify(sim.serialize()), before, 'a refused save leaves the sim as it was');
    }
    const noIce = drop(saved, 'board.ice'); // saves from before ice crates still load
    assert.doesNotThrow(() => rules.createSim(level).load(noIce));
  });
}

test('Dotwork: a damaged saved board is refused, a good one still loads', () => {
  const level = dotworkLevel(12);
  const b = createBoard(level);
  for (let k = 0; k < 5; k++) fire(b, freeArrows(b)[0]);
  const saved = serialize(b);
  assert.deepEqual(serialize(loadBoard(level, saved)), saved);
  for (const d of [null, {}, { ...saved, gone: 'x' }, { ...saved, failed: [99999] }, { ...saved, stars: 'x' }, { ...saved, stars: -1 }, { ...saved, gone: [1.5] }]) {
    assert.throws(() => loadBoard(level, d), /does not match/);
  }
  assert.equal(loadBoard(level, { ...saved, mistakes: 'x' }).mistakes, 0);
});
