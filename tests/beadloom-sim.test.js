// Beadloom simulation: bead conservation, no overfill, pickability, and the lose state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim, CRATE_ROWS, SEG_ROWS } from '../games/beadloom/rules.js';
import { createBoard, computeReach, canPick, applyPick, revealReachable, DISP } from '../engines/slotsort/board.js';
import { makeRng } from '../core/rng.js';
import { tinyLevel } from './fixtures/tiny.js';

const crate = (c, extra = {}) => ({ c, ...extra });

// 10 crates in 5 colours, two crates each, plus swap pair and lock/key to exercise everything.
function busyLevel() {
  return tinyLevel({
    rows: 2,
    cells: [
      crate(0), crate(1, { alt: 2, pair: 0 }), crate(2), crate(3, { key: 0 }), crate(4),
      crate(4), crate(0, { lock: 0 }), crate(2, { alt: 1, pair: 0 }), crate(3), crate(1),
    ],
    ring: [3, 0, 4, 1, 2, 3],
    R: [0, 1, 2, 4, 2, 3],
    L: [0, 1, 4, 3, 1, 0, 4, 2],
  });
}

function totals(level) {
  const t = {};
  const add = (c, n) => (t[c] = (t[c] || 0) + n);
  for (const c of level.ring.cells) if (c >= 0) add(c, 1);
  for (const f of level.feeders) for (const s of f) add(s.c, SEG_ROWS);
  return t;
}

test('random play conserves beads and never overfills a crate', () => {
  const outcomes = { won: 0, lost: 0, playing: 0 };
  for (let seed = 1; seed <= 30; seed++) {
    const level = busyLevel();
    const want = totals(level);
    const sim = createSim(level);
    sim.setSpeed(['slow', 'normal', 'double', 'fast'][seed % 4]);
    const rng = makeRng(seed);
    const done = {};
    for (let t = 0; t < 60 * 400 && sim.status === 'playing'; t++) {
      if (rng.chance(0.05)) {
        const picks = [...Array(sim.board.n).keys()].filter((i) => canPick(sim.board, i, sim.reach));
        if (picks.length) sim.pick(rng.pick(picks));
      }
      if (seed % 5 === 0 && t === 600) sim.addSlot();
      if (seed % 7 === 0 && t % 900 === 450) {
        const s = sim.slots.findIndex((x) => x);
        if (s >= 0) sim.fill(s);
      }
      sim.step();
      for (const e of sim.events) if (e.type === 'slotFree') done[e.color] = (done[e.color] || 0) + CRATE_ROWS;
      sim.events.length = 0;
      for (const sl of sim.slots) if (sl) assert.ok(sl.landed + sim.reserved(sl) <= CRATE_ROWS, 'overfill');
      if (t % 97 === 0) for (const c in want) assert.equal(sim.unitsOf(+c, done), want[c], `colour ${c} at tick ${t}`);
    }
    for (const c in want) assert.equal(sim.unitsOf(+c, done), want[c]);
    if (sim.status === 'won') assert.equal(sim.supply.empty, sim.supply.N, 'a won level leaves the ring empty');
    outcomes[sim.status]++;
  }
  assert.ok(outcomes.won > 0, JSON.stringify(outcomes));
});

test('pickability: top row, open path to the top, enclosed pockets, locks, dispensers', () => {
  // . = floor, X = crate, L = locked crate, D = dispenser, # = no cell
  const map = ['X.XXX', 'X..XX', 'XXXLX', 'X.X.X', '#XDX#'];
  const cells = map.join('').split('').map((ch) => {
    if (ch === '.') return 0;
    if (ch === '#') return null;
    if (ch === 'D') return { disp: [1], zone: [] };
    return crate(0, ch === 'L' ? { lock: 0 } : {});
  });
  const b = createBoard({ cols: 5, rows: 5, cells });
  const reach = computeReach(b, new Uint8Array(b.n));
  const ok = (r, c) => canPick(b, r * 5 + c, reach);
  assert.ok(ok(0, 0) && ok(0, 2) && ok(0, 4), 'top row');
  assert.ok(ok(1, 0) && ok(2, 1), 'next to r1c1, open to the top through r0c1');
  assert.ok(ok(1, 3) && ok(2, 2), 'next to r1c2, open through r1c1');
  assert.ok(!ok(2, 0), 'buried');
  assert.ok(!ok(3, 0) && !ok(3, 2) && !ok(4, 1), 'next to an enclosed pocket (r3c1) only');
  assert.ok(!ok(2, 3), 'locked, even though reachable');
  assert.ok(!ok(4, 3), 'r3c3 pocket is enclosed: dispenser and locked crate block it');
  assert.ok(canPick(b, 4 * 5 + 3, reach, true), 'the lift booster ignores paths');
});

test('picks follow swap, key and dispenser rules', () => {
  const level = tinyLevel({
    rows: 2,
    cells: [crate(0, { key: 0 }), crate(1, { alt: 2, pair: 0 }), { disp: [3, 4], zone: [7] }, 0, 0,
            crate(2, { alt: 1, pair: 0 }), crate(5), crate(6), 0, crate(0, { lock: 0 })],
    ring: [0],
  });
  const sim = createSim(level);
  assert.equal(sim.pick(9), 'locked');
  assert.equal(sim.pick(0), 'ok'); // key: unlocks r1c4; swap pair toggles
  assert.equal(sim.board.lock[9], -1);
  assert.equal(sim.board.color[1], 2);
  assert.equal(sim.board.color[5], 1);
  assert.equal(sim.pick(1), 'ok'); // takes the swap crate as colour 2; partner freezes at 1
  assert.equal(sim.slots[1].color, 2);
  assert.equal(sim.board.pair[5], -1);
  assert.equal(sim.pick(7), 'ok'); // the zone cell empties: the dispenser ejects colour 3 into it
  assert.equal(sim.board.color[7], 3);
  assert.equal(sim.pick(7), 'busy'); // still in the air
});

test('out of space: slots full and nothing matching can arrive; +1 slot continues', () => {
  const level = tinyLevel({
    rows: 1,
    cells: [crate(1), crate(2), crate(3), crate(4), crate(0)],
    ring: [0, 0, 5, 5],
    R: [1, 1, 2, 2, 3, 3, 4, 4],
  });
  const sim = createSim(level);
  for (const i of [0, 1, 2, 3]) assert.equal(sim.pick(i), 'ok');
  for (let t = 0; t < 600; t++) sim.step();
  assert.equal(sim.status, 'lost');
  assert.ok(sim.addSlot());
  assert.equal(sim.status, 'playing');
  assert.equal(sim.pick(4), 'ok');
  for (let t = 0; t < 60 * 60 && sim.status === 'playing'; t++) sim.step();
  assert.equal(sim.status, 'won', 'colour 0 drains, its gaps bring in 1..4, everything completes');
});

test('engine: hidden tiles reveal when they become pickable; persistent dispensers keep blocking', () => {
  // r0: A  D(->r0c0, 1 crate, persists)  .   r1: ?B  C
  const b = createBoard({
    cols: 3,
    rows: 2,
    dispVanish: false,
    cells: [{ c: 0 }, { disp: [2], zone: [0] }, 0, { c: 1, hidden: true }, { c: 3 }, 0],
  });
  const reach = computeReach(b, new Uint8Array(b.n));
  assert.equal(b.hid[3], 1);
  assert.deepEqual(revealReachable(b, reach), []);
  applyPick(b, 0, null); // the dispenser refills r0c0 and is now empty but stays
  assert.equal(b.color[0], 2);
  assert.equal(b.kind[1], DISP);
  applyPick(b, 0, null);
  computeReach(b, reach);
  assert.deepEqual(revealReachable(b, reach), [3], 'r1c0 is now next to the open r0c0');
  assert.equal(b.kind[1], DISP, 'an exhausted persistent dispenser stays');
});

test('save/restore mid-level round-trips the whole state', async () => {
  const { generateLevel } = await import('../games/beadloom/rules.js');
  const level = generateLevel(37);
  const sim = createSim(level);
  const picks = level.meta.solution;
  let k = 0;
  for (let t = 0; t < 60 * 20; t++) {
    if (k < picks.length && sim.hasFreeSlot() && t % 90 === 0) sim.pick(picks[k++]);
    sim.step();
  }
  const saved = JSON.parse(JSON.stringify(sim.serialize()));
  const back = createSim(generateLevel(37)).load(saved);
  assert.deepEqual(back.serialize(), saved);
  assert.equal(back.status, 'playing');
});

test('ice crates: frozen until enough rows are collected, then an ordinary crate', () => {
  // r0: A  B  .  .  .   r1: ice(C, thaws after 10 rows)  .  .  .  .
  const level = tinyLevel({
    rows: 2,
    cells: [crate(0), crate(1), 0, 0, 0, crate(2, { ice: 10 }), 0, 0, 0, 0],
    ring: [0, 0, 1, 1, 2, 2],
  });
  const sim = createSim(level);
  assert.equal(sim.pick(5), 'frozen');
  assert.equal(sim.pick(5, true), 'frozen', 'the lift booster cannot take ice either');
  assert.equal(sim.pick(0), 'ok');
  let thawed = -1;
  for (let t = 0; t < 60 * 30 && thawed < 0; t++) {
    sim.step();
    for (const e of sim.events) if (e.type === 'thaw') thawed = e.cell;
    sim.events.length = 0;
  }
  assert.equal(thawed, 5);
  assert.equal(sim.board.ice[5], 0);
  assert.equal(sim.pick(5), 'ok', 'next to the open r0c0 once thawed');
});
