// Slot-sort engine simulation. Pure (no DOM), deterministic, fixed 60 Hz timestep.
//
// Shared by the "pick a crate into a slot, a supply pours matching colour into it" family
// (Beadloom, Purl, ...). The engine owns the board, the slot row, claiming and
// landing, completion, boosters, win/lose, events and saves. The game supplies:
//
//   cfg = {
//     capacity,        // fine units a slotted crate holds (Beadloom: 20 bead rows)
//     completeDelay,   // seconds from full to slot free (Beadloom 0.45, Purl 0.2)
//     claimDelay?,     // seconds after a pick before the slotted crate accepts units (its flight
//                      // to the slot; Purl 0.7: lands at 0.45 s, the thread shoots at 0.7 s)
//     ejectTime,       // seconds a dispensed crate is in the air (not pickable)
//     maxSlots,        // most slots a level can grow to (+1 booster, continues)
//     speeds?,         // { name: { timers } }  timer scale per speed setting
//   }
//   supply = {          // the pluggable supply model (Beadloom: ring + feeders)
//     attach(sim), setSpeed(name), step(dt),
//     canFeed(colours)   -> can any of these colours still reach the slots without a pick?
//     idle(colours)      -> nothing more will happen for these colours without a pick
//     take(colour, max, onUnit) -> remove up to max units now (fill booster), returns count
//     count(colour)      -> units of colour still in the supply (conservation checks)
//     total?()           -> all units still in the supply (enables winLocked)
//     serialize(), load(data)
//     check?(data)       -> throw if saved supply data can't be loaded (sim.load calls it first)
//   }
// The supply hands units to slots with sim.claim(colour, n, landAt).
//
// Events (sim.events, drained by the caller): pick, land, complete, slotFree, reveal (board
// "?" tile), thaw (ice crate), fill, addSlot, win, lose, plus whatever the supply emits.

import { createBoard, computeReach, applyPick, runDispensers, newPickInfo, boardCleared, revealReachable, thawBoard } from './board.js';
import { CRATE, DISP } from './board.js';

export const DT = 1 / 60;

export class SlotSim {
  constructor(level, cfg, supply) {
    this.level = level;
    this.cfg = cfg;
    this.cap = cfg.capacity;
    this.board = createBoard(level.board);
    this.reach = new Uint8Array(this.board.n);
    this.readyAt = new Float64Array(this.board.n); // dispensed crates are not pickable mid-air
    this.slots = new Array(level.slots ?? cfg.slots ?? 4).fill(null);
    this.tick = 0;
    this.time = 0;
    this.speed = 'normal';
    this.status = 'playing'; // playing | won | lost
    this.events = [];
    this.boostersUsed = 0;
    this.completions = 0;
    this.supply = supply;
    supply.attach(this);
    runDispensers(this.board, newPickInfo());
    this.updateReach();
  }

  get ts() {
    return this.cfg.speeds?.[this.speed]?.timers ?? 1;
  }

  setSpeed(name) {
    if (this.cfg.speeds && !this.cfg.speeds[name]) return;
    this.speed = name;
    this.supply.setSpeed(name);
  }

  updateReach() {
    computeReach(this.board, this.reach);
    for (const cell of revealReachable(this.board, this.reach)) {
      this.events.push({ type: 'reveal', cell, color: this.board.color[cell] });
    }
  }

  step() {
    this.tick++;
    this.time = this.tick * DT;
    for (let s = 0; s < this.slots.length; s++) {
      const sl = this.slots[s];
      if (!sl) continue;
      while (sl.land.length && sl.land[0].at <= this.time) {
        sl.landed += sl.land.shift().n;
        this.events.push({ type: 'land', slot: s, color: sl.color, landed: sl.landed });
      }
      if (sl.landed >= this.cap && sl.doneAt < 0) {
        sl.doneAt = this.time + this.cfg.completeDelay * this.ts;
        this.events.push({ type: 'complete', slot: s, color: sl.color });
      }
      if (sl.doneAt >= 0 && sl.doneAt <= this.time) {
        this.slots[s] = null;
        this.completions++;
        this.events.push({ type: 'slotFree', slot: s, color: sl.color });
      }
    }
    this.supply.step(DT);
    this.checkEnd();
  }

  // n units were just collected into a crate: ice counters drop, thawed crates may be pickable.
  collect(n) {
    const thawed = thawBoard(this.board, n);
    if (!thawed.length) return;
    for (const cell of thawed) this.events.push({ type: 'thaw', cell, color: this.board.color[cell] });
    this.updateReach();
  }

  // Units in flight to slot s.
  reserved(sl) {
    let n = 0;
    for (const l of sl.land) n += l.n;
    return n;
  }

  // The supply offers n units of colour c landing at time landAt: the leftmost slotted crate
  // of that colour with room takes them. Returns the slot index, or -1 if none can.
  claim(c, n, landAt) {
    for (let s = 0; s < this.slots.length; s++) {
      const sl = this.slots[s];
      if (this.takes(sl, c, n)) {
        // keep the landing queue in time order (parallel feeds interleave)
        let k = sl.land.length;
        while (k > 0 && sl.land[k - 1].at > landAt) k--;
        sl.land.splice(k, 0, { at: landAt, n });
        this.collect(n);
        return s;
      }
    }
    return -1;
  }

  // Can slot sl take n more units of colour c now?
  takes(sl, c, n) {
    return (
      sl && sl.color === c && sl.doneAt < 0 && sl.landed + this.reserved(sl) + n <= this.cap &&
      this.time >= sl.at + (this.cfg.claimDelay || 0) * this.ts
    );
  }

  // Does some slotted crate of colour c have room for n more units?
  wants(c, n = 1) {
    for (const sl of this.slots) if (this.takes(sl, c, n)) return true;
    return false;
  }

  // Tap on a board cell. Returns 'ok' or why not: over | none | blocked | locked | busy | full.
  // lift = the "lift any crate" booster (ignores the exit path, not locks).
  pick(i, lift = false) {
    if (this.status !== 'playing') return 'over';
    const b = this.board;
    if (!(i >= 0 && i < b.n) || b.kind[i] !== CRATE) return b.kind[i] === DISP ? 'blocked' : 'none';
    if (b.lock[i] >= 0) return 'locked';
    if (b.ice[i] > 0) return 'frozen';
    if (this.readyAt[i] > this.time) return 'busy';
    if (!lift && !this.reach[i]) return 'blocked';
    const s = this.slots.indexOf(null);
    if (s < 0) return 'full';
    const info = newPickInfo();
    const color = applyPick(b, i, info);
    this.slots[s] = { color, landed: 0, land: [], doneAt: -1, at: this.time };
    for (const e of info.ejects) this.readyAt[e.to] = this.time + this.cfg.ejectTime * this.ts;
    if (lift) this.boostersUsed++;
    this.events.push({ type: 'pick', cell: i, slot: s, color, lift, info });
    this.updateReach();
    return 'ok';
  }

  // Booster: +1 slot. Also the "continue" from Out of space. limit lets a game cap the booster
  // below cfg.maxSlots (Beadloom: the booster stops at 5, the paid continue may open a 6th).
  addSlot(limit = this.cfg.maxSlots) {
    if (this.slots.length >= Math.min(limit, this.cfg.maxSlots) || this.status === 'won') return false;
    this.slots.push(null);
    this.boostersUsed++;
    if (this.status === 'lost') this.status = 'playing';
    this.events.push({ type: 'addSlot', slot: this.slots.length - 1 });
    return true;
  }

  // Booster: instantly fill the crate in slot s from the supply.
  fill(s, stagger = 0.012, delay = 0.15) {
    const sl = this.slots[s];
    if (this.status !== 'playing' || !sl || sl.doneAt >= 0) return false;
    const need = this.cap - sl.landed - this.reserved(sl);
    if (need <= 0) return false;
    let k = 0;
    const ts = this.ts;
    let got = 0;
    this.supply.take(sl.color, need, (n = 1) => {
      sl.land.push({ at: this.time + (delay + k++ * stagger) * ts, n });
      got += n;
    }, s);
    if (got) this.collect(got);
    sl.land.sort((a, b) => a.at - b.at);
    this.boostersUsed++;
    this.events.push({ type: 'fill', slot: s, color: sl.color });
    return true;
  }

  hasFreeSlot() {
    return this.slots.indexOf(null) >= 0;
  }

  // Colours of slotted crates that are waiting (not completing).
  waitingColours() {
    const out = [];
    for (const sl of this.slots) if (sl && sl.doneAt < 0 && !out.includes(sl.color)) out.push(sl.color);
    return out;
  }

  checkEnd() {
    if (this.status !== 'playing') return;
    if (boardCleared(this.board) && this.slots.every((s) => s === null)) {
      this.status = 'won';
      this.events.push({ type: 'win' });
    } else if (this.isDeadlocked() || this.isStuck()) {
      this.status = 'lost';
      this.events.push({ type: 'lose' });
    }
  }

  // Stuck with a free slot: nothing is moving, nothing will arrive, and every crate left is frozen
  // or locked (no pick, not even a lift, can help). Only possible with ice crates.
  isStuck() {
    const b = this.board;
    let frozen = false;
    for (let i = 0; i < b.n; i++) {
      if (b.kind[i] !== CRATE) continue;
      if (b.ice[i] > 0) frozen = true;
      else if (b.lock[i] < 0) return false;
    }
    if (!frozen || !this.hasFreeSlot()) return false;
    for (const sl of this.slots) if (sl && (sl.land.length || sl.doneAt >= 0)) return false;
    return !this.supply.canFeed(this.waitingColours());
  }

  // Out of space: every slot holds a waiting crate, nothing is in flight, and the supply can't
  // bring any slotted colour without another pick.
  isDeadlocked() {
    for (const sl of this.slots) if (!sl || sl.doneAt >= 0 || sl.land.length) return false;
    return !this.supply.canFeed(this.waitingColours());
  }

  // Is the win now unavoidable? True once every crate is in a slot (board, dispensers and locks
  // empty) and every unit left in the supply has a waiting crate with room for it: no pick
  // remains, every unit the supply brings past the slots is taken, so no Out of space is possible.
  // A cheap sufficient check (exact need == supply per colour); false when unsure.
  winLocked() {
    if (this.status !== 'playing' || !this.supply.total || !boardCleared(this.board)) return false;
    const need = new Map();
    let sum = 0;
    for (const sl of this.slots) {
      if (!sl || sl.doneAt >= 0) continue;
      const n = this.cap - sl.landed - this.reserved(sl);
      need.set(sl.color, (need.get(sl.color) || 0) + n);
      sum += n;
    }
    for (const [c, n] of need) if (this.supply.count(c) !== n) return false;
    return this.supply.total() === sum;
  }

  // Nothing more will happen without a pick (used by the solver's replay).
  isSettled() {
    for (const sl of this.slots) if (sl && (sl.land.length || sl.doneAt >= 0)) return false;
    if (!this.supply.idle(this.waitingColours())) return false;
    for (let i = 0; i < this.readyAt.length; i++) if (this.readyAt[i] > this.time) return false;
    return true;
  }

  // Units of colour c anywhere except completed crates (pass completedByColour to add those).
  unitsOf(c, completedByColor) {
    let n = this.supply.count(c);
    for (const sl of this.slots) if (sl && sl.color === c) n += sl.landed + this.reserved(sl);
    return n + (completedByColor ? completedByColor[c] || 0 : 0);
  }

  serialize() {
    const b = this.board;
    return {
      v: 2,
      tick: this.tick,
      supply: this.supply.serialize(),
      // units in flight are landed; a full crate counts as completed
      slots: this.slots.map((sl) => sl && { color: sl.color, landed: Math.min(this.cap, sl.landed + this.reserved(sl)) }),
      board: Object.fromEntries(
        ['kind', 'color', 'alt', 'pair', 'lock', 'key', 'dispAt', 'dispIdx', 'hid', 'ice'].map((k) => [k, Array.from(b[k])]),
      ),
      picks: b.picks,
      speed: this.speed,
      status: this.status,
      boostersUsed: this.boostersUsed,
      completions: this.completions,
    };
  }

  // Restore a saved state into this (freshly constructed) sim. Throws before changing anything if the state
  // doesn't fit this level (a damaged save); callers then restart the level.
  load(d) {
    const b = this.board;
    const ints = (a, n) => Array.isArray(a) && a.length === n && a.every(Number.isInteger);
    const bad = (what) => {
      throw new Error(`bad save: ${what}`);
    };
    if (!d || typeof d !== 'object' || !Number.isInteger(d.tick) || d.tick < 0) bad('tick');
    if (!d.board || typeof d.board !== 'object') bad('board');
    for (const k of ['kind', 'color', 'alt', 'pair', 'lock', 'key', 'dispAt', 'dispIdx', 'hid', 'ice']) {
      if (k === 'ice' && d.board.ice === undefined) continue; // saves from before ice crates
      if (!ints(d.board[k], b[k].length)) bad(`board.${k}`);
    }
    if (!Array.isArray(d.slots) || d.slots.length < 1 || d.slots.length > this.cfg.maxSlots) bad('slots');
    for (const sl of d.slots) if (sl !== null && !(sl && Number.isInteger(sl.color) && sl.color >= 0 && Number.isFinite(sl.landed))) bad('slot');
    if (!Number.isInteger(d.picks) || !Number.isInteger(d.completions) || !Number.isInteger(d.boostersUsed)) bad('counters');
    this.supply.check?.(d.supply);
    this.tick = d.tick;
    this.time = d.tick * DT;
    this.supply.load(d.supply);
    this.completions = d.completions;
    this.slots = d.slots.map((sl) => {
      if (!sl) return null;
      if (sl.landed >= this.cap) {
        this.completions++;
        return null;
      }
      return { color: sl.color, landed: sl.landed, land: [], doneAt: -1, at: -1e9 };
    });
    if (!d.board.ice) b.ice.fill(0); // saves from before ice crates
    for (const k of Object.keys(d.board)) b[k].set(d.board[k]);
    b.picks = d.picks;
    this.setSpeed(d.speed);
    this.status = d.status === 'won' ? 'won' : 'playing';
    this.boostersUsed = d.boostersUsed;
    this.events.length = 0;
    this.updateReach();
    this.events.length = 0;
    this.checkEnd();
    return this;
  }
}
