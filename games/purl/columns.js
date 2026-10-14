// Purl supply: the knitted picture, C independent column stacks of blocks (ref 1, 8.1).
//
// Each column is a FIFO of block colours, bottom first; only the bottom block can be pulled.
// A free column whose bottom matches a slotted bobbin that still needs a whole block starts a
// thread: the block leaves the stack at once (its 6 stitch rows are reserved in that slot with
// sim.claim and land one by one over BLOCK_TIME), and the column is busy until the last row
// lands. One column feeds one bobbin at a time; a bobbin may draw from several columns at once.
// Claims are whole blocks capped at the bobbin's need, leftmost columns first (the ref notes'
// "simple" model, 8.2): the real game drains every matching column evenly and can leave
// part-blocks behind, which only matters when more columns match than a bobbin needs.
//
// Lanes 0..C-1 are the columns; lanes C and C+1 are the balloon hooks (left, right), each
// holding at most one parked block that acts like an extra column bottom (ref 5.2).
//
// Level supply format: columns: [[colour, ...bottom first], ...].
// Events: thread (a block starts unravelling), unravelled, snip (scissors), park (balloon).

export const BLOCK_ROWS = 6; // stitch rows per block (4 stitches x 6 rows)
export const BOBBIN_BLOCKS = 3;
export const BOBBIN_ROWS = BLOCK_ROWS * BOBBIN_BLOCKS;
export const BLOCK_TIME = 1.3; // seconds per block per thread (~0.77 blocks/s)
export const HOOKS = 2;
// No speed toggle in Purl (ref 5.2); 'fast' is for the solver's replay and the win fast-forward.
export const SPEEDS = {
  normal: { timers: 1, rate: 1 },
  fast: { timers: 0.25, rate: 4 },
};

export class ColumnSupply {
  constructor(level) {
    this.C = level.columns.length;
    this.lanes = [...level.columns.map((col) => ({ stack: col.slice(), run: null })), ...Array.from({ length: HOOKS }, () => ({ stack: [], run: null }))];
    this.rate = 1;
  }

  attach(sim) {
    this.sim = sim;
  }

  setSpeed(name) {
    this.rate = (SPEEDS[name] || SPEEDS.normal).rate;
  }

  isHook(l) {
    return l >= this.C;
  }

  step() {
    const sim = this.sim;
    const t = sim.time;
    for (let l = 0; l < this.lanes.length; l++) {
      const lane = this.lanes[l];
      if (lane.run && t >= lane.run.end - 1e-9) {
        sim.events.push({ type: 'unravelled', lane: l, color: lane.run.color, slot: lane.run.slot });
        lane.run = null;
      }
    }
    for (let l = 0; l < this.lanes.length; l++) this.tryThread(l);
  }

  // Start a thread from lane l if its bottom block is wanted by a slotted bobbin.
  tryThread(l) {
    const sim = this.sim;
    const lane = this.lanes[l];
    if (lane.run || !lane.stack.length) return false;
    const c = lane.stack[0];
    if (!sim.wants(c, BLOCK_ROWS)) return false;
    const row = BLOCK_TIME / BLOCK_ROWS / this.rate;
    const t0 = sim.time;
    let slot = -1;
    for (let r = 1; r <= BLOCK_ROWS; r++) {
      const s = sim.claim(c, 1, t0 + r * row);
      if (slot < 0) slot = s;
    }
    lane.stack.shift();
    lane.run = { color: c, slot, t0, end: t0 + BLOCK_ROWS * row };
    sim.events.push({ type: 'thread', lane: l, slot, color: c, hook: this.isHook(l) });
    return true;
  }

  // Lanes that can bring a colour without a pick: a running thread (its column then exposes the
  // next block) or a free lane whose bottom matches.
  canFeed(colours) {
    for (const lane of this.lanes) {
      if (lane.run) return true;
      if (lane.stack.length && colours.includes(lane.stack[0])) return true;
    }
    return false;
  }

  idle(colours) {
    return !this.canFeed(colours);
  }

  // Scissors (the engine's fill booster): cut whole blocks of colour c from anywhere in the
  // picture, lowest first (parked swatches, then column positions nearest the bottom), and close
  // the gaps. Returns the rows taken.
  take(c, max, onUnit, slot) {
    let n = 0;
    const blocks = Math.floor(max / BLOCK_ROWS);
    const found = [];
    for (let l = this.C; l < this.lanes.length; l++) if (this.lanes[l].stack[0] === c) found.push([l, 0, -1]);
    for (let l = 0; l < this.C; l++) this.lanes[l].stack.forEach((x, d) => x === c && found.push([l, d, d]));
    found.sort((a, b) => a[2] - b[2] || a[0] - b[0]);
    const cut = found.slice(0, blocks);
    // remove deepest first so indices stay valid
    for (const [l, d] of [...cut].sort((a, b) => b[1] - a[1])) this.lanes[l].stack.splice(d, 1);
    for (const [l, d] of cut) {
      this.sim.events.push({ type: 'snip', lane: l, depth: d, color: c, slot });
      for (let r = 0; r < BLOCK_ROWS; r++) {
        onUnit(1);
        n++;
      }
    }
    return n;
  }

  // Balloon: park the bottom blocks of up to 2 idle columns on the free hooks. Prefers columns
  // whose bottom no slotted bobbin wants and whose next block one does, then any idle column
  // with an unwanted bottom (the original's choice is unknown, ref 9 #4). Returns the lanes.
  balloon(colours) {
    const free = [];
    for (let l = this.C; l < this.lanes.length; l++) if (!this.lanes[l].stack.length && !this.lanes[l].run) free.push(l);
    if (!free.length) return [];
    const cand = [];
    for (let l = 0; l < this.C; l++) {
      const lane = this.lanes[l];
      if (lane.run || !lane.stack.length || colours.includes(lane.stack[0])) continue;
      const next = lane.stack.length > 1 && colours.includes(lane.stack[1]) ? 0 : 1;
      cand.push([next, l]);
    }
    cand.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const out = [];
    for (const [, l] of cand.slice(0, free.length)) {
      const h = free[out.length];
      const c = this.lanes[l].stack.shift();
      this.lanes[h].stack.push(c);
      out.push(l);
      this.sim.events.push({ type: 'park', lane: l, hook: h, color: c });
    }
    return out;
  }

  hooksFree() {
    let n = 0;
    for (let l = this.C; l < this.lanes.length; l++) if (!this.lanes[l].stack.length && !this.lanes[l].run) n++;
    return n;
  }

  count(c) {
    let n = 0;
    for (const lane of this.lanes) for (const x of lane.stack) if (x === c) n += BLOCK_ROWS;
    return n;
  }

  total() {
    let n = 0;
    for (const lane of this.lanes) n += lane.stack.length * BLOCK_ROWS;
    return n;
  }

  // Running threads are not saved: the engine lands their reserved rows on save.
  serialize() {
    return { lanes: this.lanes.map((l) => l.stack.slice()) };
  }

  load(d) {
    this.lanes = d.lanes.map((stack) => ({ stack: stack.slice(), run: null }));
    while (this.lanes.length < this.C + HOOKS) this.lanes.push({ stack: [], run: null });
  }
}

// Abstract supply model for the solver (ref 8.2): whole blocks, column pointers only.
export const columnModel = {
  init: (level) => ({ cols: level.columns, ptr: new Int16Array(level.columns.length) }),
  clone: (s) => ({ cols: s.cols, ptr: s.ptr.slice() }),
  // Slots left to right take matching column bottoms, leftmost columns first, up to cap.
  closure(s, slots, fill, cap) {
    let progress = true;
    while (progress) {
      progress = false;
      for (let k = 0; k < slots.length; k++) {
        const c = slots[k];
        if (c < 0) continue;
        for (let j = 0; j < s.cols.length && fill[k] < cap; j++) {
          while (fill[k] < cap && s.ptr[j] < s.cols[j].length && s.cols[j][s.ptr[j]] === c) {
            s.ptr[j]++;
            fill[k]++;
            progress = true;
          }
        }
      }
    }
  },
  key: (s) => Array.from(s.ptr),
  // How deep colour c's nearest block sits (0 = a column bottom now).
  distance(s, c) {
    let best = 999;
    for (let j = 0; j < s.cols.length; j++) {
      const col = s.cols[j];
      for (let d = s.ptr[j]; d < col.length && d - s.ptr[j] < best; d++) {
        if (col[d] === c) {
          best = d - s.ptr[j];
          break;
        }
      }
    }
    return best;
  },
};

// Turn an intended pick order into column stacks (ref 8.4 step 4): each bobbin gives 3 blocks
// keyed near its place in the order (jittered by J); blocks are dealt bottom-up in key order,
// mostly to the lowest column (random ties), sometimes to any column within one block of it, so
// heights end up a little ragged.
export function columnsFromOrder(order, { jitter, C }, rng) {
  const blocks = [];
  order.forEach((c, i) => {
    blocks.push({ c, key: i - rng.next() * jitter });
    blocks.push({ c, key: i });
    blocks.push({ c, key: i + rng.next() * jitter });
  });
  blocks.sort((a, b) => a.key - b.key);
  const cols = Array.from({ length: C }, () => []);
  for (const b of blocks) {
    const lo = Math.min(...cols.map((x) => x.length)) + (rng.chance(0.3) ? 1 : 0);
    const near = cols.map((x, j) => (x.length <= lo ? j : -1)).filter((j) => j >= 0);
    cols[rng.pick(near)].push(b.c);
  }
  return cols;
}
