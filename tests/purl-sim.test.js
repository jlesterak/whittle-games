// Purl simulation on the slot-sort engine: conservation, thread/claim rules, facing
// dispensers that persist, the lose state, boosters and save/restore.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim, BLOCK_ROWS, BOBBIN_ROWS } from '../games/purl/rules.js';
import { canPick, DISP } from '../engines/slotsort/board.js';
import { makeRng } from '../core/rng.js';
import { knitLevel } from './fixtures/knit.js';

const b = (c, extra = {}) => ({ c, ...extra });

function run(sim, seconds, onEvent) {
  for (let t = 0; t < seconds * 60 && sim.status === 'playing'; t++) {
    sim.step();
    if (onEvent) for (const e of sim.events) onEvent(e);
    sim.events.length = 0;
  }
}

// 12 bobbins in 4 colours on a 6x3 board with a void, a hidden bobbin and a facing dispenser.
function busyLevel() {
  return knitLevel({
    rows: 3,
    cells: [
      b(0), b(1), b(2), b(3), b(0), b(1),
      b(2), null, { disp: [3, 0], zone: [9] }, b(2, { hidden: true }), b(3), 0,
      b(1), 0, 0, 0, 0, 0,
    ],
    // 3 blocks per bobbin: colours 0..3 have 3, 3, 3, 3 bobbins -> 9 blocks each
    columns: [
      [1, 0, 2, 3, 0, 1, 2, 3, 0],
      [0, 1, 3, 2, 1, 0, 3, 2, 1],
      [2, 3, 0, 1, 3, 2, 1, 0, 2],
      [3, 2, 1, 0, 2, 3, 0, 1, 3],
    ],
  });
}

function rowsByColour(level) {
  const t = {};
  for (const col of level.columns) for (const c of col) t[c] = (t[c] || 0) + BLOCK_ROWS;
  return t;
}

test('random play conserves stitch rows and never overfills a bobbin', () => {
  const outcomes = { won: 0, lost: 0, playing: 0 };
  for (let seed = 1; seed <= 24; seed++) {
    const level = busyLevel();
    const want = rowsByColour(level);
    const sim = createSim(level);
    const rng = makeRng(seed);
    const done = {};
    for (let t = 0; t < 60 * 200 && sim.status === 'playing'; t++) {
      if (rng.chance(0.03)) {
        const picks = [...Array(sim.board.n).keys()].filter((i) => canPick(sim.board, i, sim.reach));
        if (picks.length) sim.pick(rng.pick(picks));
      }
      if (seed % 5 === 0 && t === 900) sim.addSlot();
      if (seed % 4 === 0 && t % 700 === 350) {
        const s = sim.slots.findIndex((x) => x && x.doneAt < 0);
        if (s >= 0) sim.fill(s, 0.05, 0.3);
      }
      if (seed % 3 === 0 && t === 500) sim.supply.balloon(sim.waitingColours());
      sim.step();
      for (const e of sim.events) if (e.type === 'slotFree') done[e.color] = (done[e.color] || 0) + BOBBIN_ROWS;
      sim.events.length = 0;
      for (const sl of sim.slots) if (sl) assert.ok(sl.landed + sim.reserved(sl) <= BOBBIN_ROWS, 'overfill');
      if (t % 97 === 0) for (const c in want) assert.equal(sim.unitsOf(+c, done), want[c], `colour ${c} at tick ${t}`);
    }
    for (const c in want) assert.equal(sim.unitsOf(+c, done), want[c]);
    if (sim.status === 'won') assert.equal(sim.supply.total(), 0, 'a won level leaves the picture empty');
    outcomes[sim.status]++;
  }
  assert.ok(outcomes.won > 0 && outcomes.lost > 0, JSON.stringify(outcomes));
});

test('threads: parallel columns, whole blocks capped at need, left bobbin first, after the flight', () => {
  // four red column bottoms, one red bobbin: only 3 columns thread (it needs 3 blocks)
  const level = knitLevel({ rows: 1, cells: [b(0), b(0), 0, 0, 0, 0], columns: [[0, 0], [0], [0], [0]] });
  const sim = createSim(level);
  const threads = [];
  assert.equal(sim.pick(0), 'ok');
  run(sim, 0.6, (e) => e.type === 'thread' && threads.push(e));
  assert.equal(threads.length, 0, 'no thread while the bobbin is still flying');
  run(sim, 0.2, (e) => e.type === 'thread' && threads.push(e));
  assert.deepEqual(threads.map((e) => e.lane), [0, 1, 2], 'leftmost three columns, at once');
  run(sim, 1.4);
  assert.equal(sim.slots[0], null, 'three threads fill a bobbin in one block time');
  // the second red bobbin takes the last two blocks (column 4's and column 1's second)
  assert.equal(sim.pick(1), 'ok');
  run(sim, 3);
  assert.equal(sim.slots[0].landed, 2 * BLOCK_ROWS);
});

test('one column feeds the left of two same-colour bobbins', () => {
  const level = knitLevel({ rows: 1, cells: [b(1), b(0), b(1), 0, 0, 0], columns: [[1, 1, 1, 1, 1, 1], [0, 0, 0]] });
  const sim = createSim(level);
  sim.pick(0);
  sim.pick(1);
  sim.pick(2);
  run(sim, 0.8);
  assert.ok(sim.reserved(sim.slots[0]) > 0, 'slot 1 is threaded');
  assert.equal(sim.reserved(sim.slots[2]), 0, 'slot 3 waits');
});

test('facing dispensers eject into their one cell and stay as empty blockers', () => {
  // r0: A  B  .  .  .  .     r1: D(->left, [C, A])  ?X  .  .  .  .
  const level = knitLevel({
    rows: 2,
    cells: [b(0), b(1), 0, 0, 0, 0, { disp: [2, 0], zone: [0] }, b(1, { hidden: true }), 0, 0, 0, 0],
    columns: [[0, 1, 2, 0], [1, 0, 2], [2, 1], [0]],
  });
  const sim = createSim(level);
  assert.equal(sim.board.hid[7], 0, 'next to the open r0c2: revealed from the start');
  assert.equal(sim.pick(0), 'ok');
  assert.equal(sim.board.color[0], 2, 'ejected into the facing cell');
  assert.equal(sim.pick(0), 'busy', 'still sliding out');
  run(sim, 0.3);
  assert.equal(sim.pick(0), 'ok');
  assert.equal(sim.board.color[0], 0);
  run(sim, 0.3);
  assert.equal(sim.pick(0), 'ok');
  assert.equal(sim.board.kind[6], DISP, 'an empty hood stays');
  assert.equal(sim.pick(6), 'blocked');
});

test('out of space: 7 slots of colours the bottoms cannot feed; Continue opens an 8th slot', () => {
  const cells = [0, 1, 2, 3, 4, 5, 6, 7].map((c) => b(c)).concat([0, 0, 0, 0]);
  const columns = [[8, 0, 1, 2], [8, 3, 4, 5], [8, 6, 7], [7, 6, 5, 4, 3, 2, 1, 0]];
  const level = knitLevel({ rows: 2, cells, columns });
  const sim = createSim(level);
  // the bottoms are 8, 8, 8, 7: colours 0..6 in all 7 slots clog
  for (const i of [0, 1, 2, 3, 4, 5, 6]) assert.equal(sim.pick(i), 'ok');
  run(sim, 2);
  assert.equal(sim.status, 'lost');
  assert.ok(sim.addSlot(), 'Continue');
  assert.equal(sim.slots.length, 8);
  assert.equal(sim.status, 'playing');
});

test('a level is won once the board, dispensers, slots and picture are all empty', () => {
  const level = knitLevel({ rows: 1, cells: [b(0), b(1), { disp: [0], zone: [3] }, 0, 0, 0], columns: [[0, 1, 0], [1, 0, 0], [1, 0, 0]] });
  const sim = createSim(level);
  for (const i of [0, 1]) assert.equal(sim.pick(i), 'ok');
  run(sim, 0.4);
  let won = false;
  run(sim, 2);
  assert.equal(sim.pick(3), 'ok', 'the ejected bobbin');
  run(sim, 20, (e) => e.type === 'win' && (won = true));
  assert.ok(won && sim.status === 'won');
  assert.equal(sim.board.kind[2], DISP, 'the empty hood is still there on the win');
});

test('scissors cut matching blocks from anywhere; balloons park bottoms that later feed', () => {
  const level = knitLevel({ rows: 1, cells: [b(0), b(1), b(2), 0, 0, 0], columns: [[2, 0, 1], [1, 2, 0], [2, 1, 0], [1, 2, 2]] });
  const sim = createSim(level);
  assert.equal(sim.pick(0), 'ok'); // red: no red at any bottom
  run(sim, 1);
  assert.equal(sim.reserved(sim.slots[0]), 0);
  assert.ok(sim.fill(0, 0.05, 0.3));
  assert.equal(sim.supply.count(0), 0, 'all three reds were cut out of the middle');
  run(sim, 2);
  assert.equal(sim.slots[0], null, 'filled and completed');
  // bottoms now: 2, 1, 2, 1. Park two of them; a yellow bobbin then draws from a hook.
  const parked = sim.supply.balloon([]);
  assert.equal(parked.length, 2);
  assert.equal(sim.supply.hooksFree(), 0);
  assert.equal(sim.supply.balloon([]).length, 0, 'no free hook');
  const threads = [];
  assert.equal(sim.pick(1), 'ok');
  run(sim, 1, (e) => e.type === 'thread' && threads.push(e));
  assert.ok(threads.length >= 1);
});

test('save/restore mid-thread lands the reserved rows and round-trips', () => {
  const level = busyLevel();
  const sim = createSim(level);
  const want = rowsByColour(level);
  sim.pick(0);
  sim.pick(1);
  run(sim, 1.2);
  const saved = JSON.parse(JSON.stringify(sim.serialize()));
  const back = createSim(busyLevel()).load(saved);
  assert.deepEqual(back.serialize(), saved);
  for (const c in want) assert.equal(back.unitsOf(+c), want[c], `colour ${c}`);
  run(back, 30);
  assert.ok(back.slots.every((s) => !s || s.landed % BLOCK_ROWS === 0), 'whole blocks after resume');
});

test('the end-game fast-forward (winLocked) only turns on after the last pick and never precedes a loss', async () => {
  const { generateLevel } = await import('../games/purl/rules.js');
  for (const n of [1, 7, 15, 26]) {
    const level = generateLevel(n);
    const picks = level.meta.solution;
    const sim = createSim({ ...level, slots: level.meta.solvedWith });
    sim.setSpeed('fast');
    let k = 0;
    let lockedAt = -1;
    for (let t = 0; t < 60 * 900 && sim.status === 'playing'; t++) {
      if (k < picks.length && sim.hasFreeSlot() && sim.isSettled()) {
        assert.equal(sim.winLocked(), false, `level ${n}: bobbins are still on the board`);
        assert.equal(sim.pick(picks[k++]), 'ok');
      }
      if (lockedAt < 0 && sim.winLocked()) lockedAt = k;
      sim.step();
      sim.events.length = 0;
    }
    assert.equal(sim.status, 'won', `level ${n}`);
    assert.equal(lockedAt, picks.length, `level ${n}`);
  }
});
