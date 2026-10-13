// Slot-sort engine solver: depth-first search over an abstract model, then a confirming replay
// in the real simulation.
//
// The supply is time-free for feasibility (the player can always wait), so the abstract state is
// board + slots (colour, whole units filled) + the game's abstract supply state. After each pick
// the forced closure runs to a fixed point; dead = all slots full at a fixed point.
//
// game = {
//   model: { init(level), clone(s), closure(s, slots, fill, cap), key(s) -> int[], distance(s, c) },
//   cap,                 // whole supply units per crate (Beadloom: 2 segments; Purl: 3 blocks)
//   unitsPerModel?,      // sim units per model unit, for ice counters (Beadloom: 10 rows/segment)
//   makeSim(level),      // real simulation for replay (a SlotSim)
// }

import { createBoard, cloneBoard, computeReach, canPick, applyPick, runDispensers, boardCleared, thawBoard } from './board.js';
import { CRATE } from './board.js';

function setup(level, game, K) {
  const b = createBoard(level.board);
  runDispensers(b, null);
  return { b, slots: new Int8Array(K).fill(-1), fill: new Int8Array(K), sup: game.model.init(level) };
}

const clone = (st, model) => ({ b: cloneBoard(st.b), slots: st.slots.slice(), fill: st.fill.slice(), sup: model.clone(st.sup) });

const sum = (a) => a.reduce((x, y) => x + y, 0);

function settle(st, game) {
  const before = sum(st.fill);
  game.model.closure(st.sup, st.slots, st.fill, game.cap);
  const got = sum(st.fill) - before; // model units collected: ice thaws
  if (got > 0) thawBoard(st.b, got * (game.unitsPerModel || 1));
  for (let k = 0; k < st.slots.length; k++) {
    if (st.slots[k] >= 0 && st.fill[k] >= game.cap) {
      st.slots[k] = -1;
      st.fill[k] = 0;
    }
  }
}

const won = (st) => boardCleared(st.b) && st.slots.every((c) => c < 0);

function keyOf(st, model) {
  const b = st.b;
  const codes = [];
  for (let i = 0; i < b.n; i++) {
    codes.push(
      b.kind[i] === CRATE
        ? 8 + b.color[i] + 40 * (b.alt[i] + 1) + (b.lock[i] >= 0 ? 2000 : 0) + (b.key[i] >= 0 ? 4000 : 0) + (b.ice[i] > 0 ? 8000 : 0)
        : b.kind[i] + 2,
    );
  }
  for (let d = 0; d < b.dispIdx.length; d++) codes.push(b.dispIdx[d] + 1);
  for (let s = 0; s < st.slots.length; s++) codes.push(st.slots[s] + 2 + 64 * st.fill[s]);
  for (const v of model.key(st.sup)) codes.push(v + 1);
  return String.fromCharCode(...codes);
}

function moves(st, reach, model) {
  computeReach(st.b, reach);
  const out = [];
  for (let i = 0; i < st.b.n; i++) {
    if (!canPick(st.b, i, reach)) continue;
    let score = model.distance(st.sup, st.b.color[i]);
    if (st.b.key[i] >= 0) score -= 0.5; // keys open things up
    out.push([score, i]);
  }
  out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return out.map((m) => m[1]);
}

function pickInto(st, i) {
  const color = applyPick(st.b, i, null);
  const s = st.slots.indexOf(-1);
  st.slots[s] = color;
  st.fill[s] = 0;
}

// Find a pick order that clears the level with K slots. Returns { ok, picks, nodes } or
// { ok: false, nodes, exhausted } (exhausted = gave up at maxNodes, not proven impossible).
export function solve(level, game, { slots = 4, maxNodes = 150000 } = {}) {
  const st = setup(level, game, slots);
  const reach = new Uint8Array(st.b.n);
  const failed = new Set();
  const path = [];
  let nodes = 0;
  let exhausted = false;

  function dfs(s) {
    settle(s, game);
    if (won(s)) return true;
    if (s.slots.indexOf(-1) < 0) return false;
    const key = keyOf(s, game.model);
    if (failed.has(key)) return false;
    if (++nodes > maxNodes) {
      exhausted = true;
      return false;
    }
    for (const i of moves(s, reach, game.model)) {
      const child = clone(s, game.model);
      pickInto(child, i);
      path.push(i);
      if (dfs(child)) return true;
      path.pop();
      if (exhausted) return false;
    }
    failed.add(key);
    return false;
  }

  const ok = dfs(st);
  return ok ? { ok, picks: path.slice(), nodes } : { ok: false, nodes, exhausted };
}

// Win rate of a player who picks uniformly at random among legal picks (a difficulty gauge).
export function randomWinRate(level, game, { slots = 4, playouts = 40, rng }) {
  const base = setup(level, game, slots);
  const reach = new Uint8Array(base.b.n);
  let wins = 0;
  for (let p = 0; p < playouts; p++) {
    const st = clone(base, game.model);
    for (;;) {
      settle(st, game);
      if (won(st)) {
        wins++;
        break;
      }
      if (st.slots.indexOf(-1) < 0) break;
      computeReach(st.b, reach);
      const opts = [];
      for (let i = 0; i < st.b.n; i++) if (canPick(st.b, i, reach)) opts.push(i);
      if (!opts.length) break;
      pickInto(st, opts[rng.int(opts.length)]);
    }
  }
  return wins / playouts;
}

// Replay a pick order in the real simulation, picking whenever the sim has settled.
export function replay(level, picks, game, { slots = 4, speed = 'fast', maxSeconds = 1800 } = {}) {
  const sim = game.makeSim({ ...level, slots });
  sim.setSpeed(speed);
  let k = 0;
  for (let t = 0; t < maxSeconds * 60; t++) {
    if (sim.status === 'won') return { ok: true, seconds: sim.time, sim };
    if (sim.status === 'lost') return { ok: false, reason: 'lost', at: k, sim };
    if (k < picks.length && sim.hasFreeSlot() && sim.isSettled()) {
      const r = sim.pick(picks[k]);
      if (r !== 'ok') return { ok: false, reason: r, at: k, sim };
      k++;
    }
    sim.step();
    sim.events.length = 0;
  }
  return { ok: false, reason: 'timeout', at: k, sim };
}
