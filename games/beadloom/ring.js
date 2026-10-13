// Beadloom supply: a rotating ring of bead rows fed by two feeders (spec 1, 8.1).
//
// The ring is a fixed circular array of row cells (colour or -1 for empty) that rotates one
// position per row of travel; it never compacts. Positions along the travel direction: spout at
// 0, then the right feeder mouth, then the left one. Cell i sits at position
// (i + offset + phase) mod N. A row passing the spout pours into the leftmost slotted crate of
// its colour with room; a gap passing a feeder mouth takes that feeder's front row.
//
// Level supply format: ring: { shape, rows: N, cells: [colour|-1 per row], mouthR, mouthL },
//                      feeders: [right, left], each [{ c, hidden }] 10-row segments, front first.
// Events: extract, inject, feederReveal, fillBead.

export const SEG_ROWS = 10; // a segment is 10 rows x 5 lanes = 50 beads
export const SPEEDS = {
  slow: { rows: 6, timers: 1 }, // super slow, ~0.36x normal
  normal: { rows: 16.5, timers: 1 }, // the speed in the recordings ("x2" in the original)
  fast: { rows: 66, timers: 0.5 }, // 4x the recordings
};
export const BEAD_FLIGHT = 0.28;

function makeFeeder(segs) {
  const colors = [];
  const seg = [];
  const hidden = [];
  segs.forEach((s, k) => {
    hidden.push(!!s.hidden);
    for (let r = 0; r < SEG_ROWS; r++) {
      colors.push(s.c);
      seg.push(k);
    }
  });
  if (colors.length) hidden[seg[0]] = false; // the front segment is always revealed
  return { colors, seg, hidden, head: 0 };
}

export class RingSupply {
  constructor(level, ncolors = 32) {
    this.N = level.ring.rows;
    this.ring = Int8Array.from(level.ring.cells);
    this.ringCount = new Int16Array(ncolors);
    this.empty = 0;
    this.recount();
    this.offset = 0;
    this.phase = 0;
    this.mouth = [level.ring.mouthR, level.ring.mouthL];
    this.feeders = level.feeders.map(makeFeeder);
    this.rows = SPEEDS.normal.rows;
  }

  attach(sim) {
    this.sim = sim;
  }

  setSpeed(name) {
    this.rows = SPEEDS[name].rows;
  }

  recount() {
    this.ringCount.fill(0);
    this.empty = 0;
    for (let i = 0; i < this.N; i++) {
      if (this.ring[i] < 0) this.empty++;
      else this.ringCount[this.ring[i]]++;
    }
  }

  // Continuous track position (in rows) of ring cell i.
  cellPos(i) {
    const p = i + this.offset + this.phase;
    return p >= this.N ? p - this.N : p;
  }

  step(dt) {
    this.phase += this.rows * dt;
    while (this.phase >= 1) {
      this.phase -= 1;
      this.advance();
    }
  }

  advance() {
    const N = this.N;
    const sim = this.sim;
    this.offset = (this.offset + 1) % N;
    const i = (N - this.offset) % N; // the cell now at the spout
    const c = this.ring[i];
    if (c >= 0) {
      const s = sim.claim(c, 1, sim.time + BEAD_FLIGHT * sim.ts);
      if (s >= 0) {
        this.ring[i] = -1;
        this.ringCount[c]--;
        this.empty++;
        sim.events.push({ type: 'extract', slot: s, color: c, cell: i });
      }
    }
    for (let f = 0; f < 2; f++) {
      const j = (this.mouth[f] - this.offset + N) % N;
      const fd = this.feeders[f];
      if (this.ring[j] < 0 && fd.head < fd.colors.length) {
        const col = fd.colors[fd.head++];
        this.revealFront(f);
        this.ring[j] = col;
        this.ringCount[col]++;
        this.empty--;
        sim.events.push({ type: 'inject', feeder: f, cell: j, color: col });
      }
    }
  }

  revealFront(f) {
    const fd = this.feeders[f];
    if (fd.head < fd.colors.length) {
      const sg = fd.seg[fd.head];
      if (fd.hidden[sg]) {
        fd.hidden[sg] = false;
        this.sim.events.push({ type: 'feederReveal', feeder: f, seg: sg, color: fd.colors[fd.head] });
      }
    }
  }

  // The rows that can still enter the ring without an extraction: the next E feeder rows
  // (right feeder first), E = empty ring cells.
  canFeed(colours) {
    for (const c of colours) if (this.ringCount[c] > 0) return true;
    let e = this.empty;
    for (const fd of this.feeders) {
      for (let h = fd.head; h < fd.colors.length && e > 0; h++, e--) if (colours.includes(fd.colors[h])) return true;
    }
    return false;
  }

  idle(colours) {
    for (const c of colours) if (this.ringCount[c] > 0) return false;
    return !(this.empty > 0 && this.feeders.some((f) => f.head < f.colors.length));
  }

  // Fill booster: pull rows of colour c from the ring first, then the feeders (front first).
  take(c, max, onUnit, slot) {
    let n = 0;
    for (let i = 0; i < this.N && n < max; i++) {
      if (this.ring[i] === c) {
        this.ring[i] = -1;
        this.ringCount[c]--;
        this.empty++;
        n++;
        onUnit(1);
        this.sim.events.push({ type: 'fillBead', cell: i, slot, color: c });
      }
    }
    for (let f = 0; f < 2 && n < max; f++) {
      const fd = this.feeders[f];
      const colors = fd.colors.slice(0, fd.head);
      const seg = fd.seg.slice(0, fd.head);
      let took = 0;
      for (let h = fd.head; h < fd.colors.length; h++) {
        if (n < max && fd.colors[h] === c) {
          n++;
          took++;
          onUnit(1);
        } else {
          colors.push(fd.colors[h]);
          seg.push(fd.seg[h]);
        }
      }
      fd.colors = colors;
      fd.seg = seg;
      if (took) this.revealFront(f);
    }
    return n;
  }

  count(c) {
    let n = this.ringCount[c];
    for (const fd of this.feeders) for (let h = fd.head; h < fd.colors.length; h++) if (fd.colors[h] === c) n++;
    return n;
  }

  total() {
    let n = this.N - this.empty;
    for (const fd of this.feeders) n += fd.colors.length - fd.head;
    return n;
  }

  serialize() {
    return {
      ring: Array.from(this.ring),
      offset: this.offset,
      phase: this.phase,
      feeders: this.feeders.map((f) => ({ colors: f.colors.slice(f.head), seg: f.seg.slice(f.head), hidden: f.hidden.slice() })),
    };
  }

  load(d) {
    this.ring = Int8Array.from(d.ring);
    this.recount();
    this.offset = d.offset;
    this.phase = d.phase;
    this.feeders = d.feeders.map((f) => ({ ...f, head: 0 }));
  }
}

// Abstract supply model for the solver (spec 8.2): only multisets matter, in whole segments.
// State: segment counts per colour in the ring, empty segment slots, feeder pointers.
export const ringModel = {
  init(level, ncolors = 32) {
    const ring = new Int16Array(ncolors);
    let empty = 0;
    const rows = new Int16Array(ncolors);
    for (const c of level.ring.cells) {
      if (c < 0) empty++;
      else rows[c]++;
    }
    for (let c = 0; c < ncolors; c++) {
      if (rows[c] % SEG_ROWS) throw new Error('ring rows must come in whole segments');
      ring[c] = rows[c] / SEG_ROWS;
    }
    return { ring, empty: empty / SEG_ROWS, pR: 0, pL: 0, R: level.feeders[0].map((s) => s.c), L: level.feeders[1].map((s) => s.c) };
  },
  clone: (s) => ({ ...s, ring: s.ring.slice() }),
  // Run to a fixed point: slotted crates (leftmost first) take matching ring segments up to
  // cap; each taken segment leaves a gap that takes the next feeder segment (right first).
  closure(s, slots, fill, cap) {
    let progress = true;
    while (progress) {
      progress = false;
      for (let k = 0; k < slots.length; k++) {
        const c = slots[k];
        if (c < 0) continue;
        while (s.ring[c] > 0 && fill[k] < cap) {
          s.ring[c]--;
          s.empty++;
          fill[k]++;
          progress = true;
        }
      }
      while (s.empty > 0 && (s.pR < s.R.length || s.pL < s.L.length)) {
        const c = s.pR < s.R.length ? s.R[s.pR++] : s.L[s.pL++];
        s.ring[c]++;
        s.empty--;
        progress = true;
      }
    }
  },
  key: (s) => [s.pR, s.pL, s.empty],
  // How soon colour c can arrive: 0 if in the ring, else 1 + its distance in the feeders.
  distance(s, c) {
    if (s.ring[c] > 0) return 0;
    for (let i = s.pR; i < s.R.length; i++) if (s.R[i] === c) return 1 + i - s.pR;
    for (let i = s.pL; i < s.L.length; i++) if (s.L[i] === c) return 1 + (s.R.length - s.pR) + i - s.pL;
    return 999;
  },
};

// Turn an intended pick order into ring + feeders (spec 8.4 steps 4-5): each crate gives two
// segments keyed near its place in the order, jittered by J; the first ringSegs form the ring
// (shuffled), the rest go to the right feeder (drains first), then the left.
export function streamFromOrder(order, { jitter, ringSegs, hidden }, rng) {
  const segs = [];
  order.forEach((c, i) => {
    segs.push({ c, key: i - rng.next() * jitter });
    segs.push({ c, key: i + rng.next() * jitter });
  });
  segs.sort((a, b) => a.key - b.key);
  const ring = rng.shuffle(segs.slice(0, ringSegs).map((s) => s.c));
  const rest = segs.slice(ringSegs).map((s) => ({ c: s.c, hidden: false }));
  const half = Math.ceil(rest.length / 2);
  const feeders = [rest.slice(0, half), rest.slice(half)];
  for (const f of feeders) {
    for (let i = 1; i < f.length; i++) f[i].hidden = !f[i - 1].hidden && rng.chance(hidden * 1.6);
  }
  return { ring, feeders };
}
