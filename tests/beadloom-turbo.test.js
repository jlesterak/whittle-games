// The 4x "win is unavoidable" fast-forward: sim.winLocked() must only ever be true when the
// level is certain to be won, and must turn on once the last crate is placed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateLevel, createSim } from '../games/beadloom/rules.js';
import { tinyLevel } from './fixtures/tiny.js';

test('winLocked turns on after the last pick and is never followed by a loss', () => {
  for (const n of [1, 5, 12, 20, 22, 30, 37, 44, 60, 77]) {
    const level = generateLevel(n);
    const picks = level.meta.solution;
    const sim = createSim({ ...level, slots: level.meta.solvedWith });
    sim.setSpeed('fast');
    let k = 0;
    let lockedAt = -1;
    for (let t = 0; t < 60 * 1800 && sim.status === 'playing'; t++) {
      if (k < picks.length && sim.hasFreeSlot() && sim.isSettled()) {
        assert.equal(sim.winLocked(), false, `level ${n}: crates are still on the board`);
        assert.equal(sim.pick(picks[k++]), 'ok');
      }
      if (lockedAt < 0 && sim.winLocked()) lockedAt = k;
      sim.step();
      sim.events.length = 0;
    }
    assert.equal(sim.status, 'won', `level ${n}`);
    assert.equal(lockedAt, picks.length, `level ${n}: locked in only after the last pick`);
  }
});

test('winLocked stays off when the board is cleared but the supply can still jam', () => {
  // One slot, one crate of colour 0; the ring is full of colour 5 rows nobody wants, so the
  // 0 rows waiting in the feeder can never get in: that is an Out of space, not a win.
  const level = tinyLevel({ rows: 1, cells: [{ c: 0 }, 0, 0, 0, 0], ring: [5, 5], R: [0, 0], slots: 1 });
  const sim = createSim(level);
  assert.equal(sim.pick(0), 'ok');
  assert.equal(sim.winLocked(), false);
  for (let t = 0; t < 600; t++) sim.step();
  assert.equal(sim.status, 'lost');
});
