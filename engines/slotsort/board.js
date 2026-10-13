// Slot-sort engine: the pick board, shared by the simulation and the solver. Pure, no DOM.
// "Crate" is the generic name for a pickable item (Beadloom crate, Purl bobbin).
//
// Level board format: { cols, rows, cells: [...], dispVanish? } in row-major order, row 0 at
// the top. dispVanish (default true): an exhausted dispenser disappears and leaves floor
// (Beadloom); false: it stays as a blocker (Purl).
//   null                         no cell (outside the board shape / void, blocks paths)
//   0                            empty floor
//   { c, alt?, pair?, lock?, key?, hidden?, ice? }  a crate of colour c; a swap crate shows c
//                                with alt arrows; pair links the two swap crates; lock/key ids
//                                link a padlock (on this crate) to the key (on another crate);
//                                hidden = shown as "?" until it first becomes pickable;
//                                ice = frozen until this many more units have been collected into
//                                any crates (not pickable, blocks paths; Beadloom ice crates)
//   { disp: [colours], zone: [cell indices] }  a dispenser and the cells it ejects into, in
//                                order (Beadloom: up to 3 cells below; Purl: 1 facing cell)
//
// Runtime board: typed arrays so the solver can clone it cheaply.

export const WALL = -1;
export const EMPTY = 0;
export const CRATE = 1;
export const DISP = 2;

export function createBoard(def) {
  const n = def.cols * def.rows;
  const b = {
    cols: def.cols,
    rows: def.rows,
    n,
    kind: new Int8Array(n),
    color: new Int8Array(n).fill(-1),
    alt: new Int8Array(n).fill(-1),
    pair: new Int8Array(n).fill(-1),
    lock: new Int8Array(n).fill(-1),
    key: new Int8Array(n).fill(-1),
    dispAt: new Int8Array(n).fill(-1), // dispenser index at a cell
    disps: [], // static: { cell, zone, queue }
    dispIdx: null, // Int8Array: next queue position per dispenser
    hid: new Int8Array(n), // 1 = hidden "?" crate not yet revealed (cosmetic for the solver)
    ice: new Int16Array(n), // > 0 = frozen: units still to collect before it thaws
    dispVanish: def.dispVanish !== false,
    picks: 0,
  };
  def.cells.forEach((d, i) => {
    if (d === null || d === undefined) b.kind[i] = WALL;
    else if (d === 0) b.kind[i] = EMPTY;
    else if (d.disp) {
      b.kind[i] = DISP;
      b.dispAt[i] = b.disps.length;
      b.disps.push({ cell: i, zone: d.zone.slice(), queue: d.disp.slice() });
    } else {
      b.kind[i] = CRATE;
      b.color[i] = d.c;
      if (d.alt !== undefined && d.alt !== null) {
        b.alt[i] = d.alt;
        b.pair[i] = d.pair;
      }
      if (d.lock !== undefined && d.lock !== null) b.lock[i] = d.lock;
      if (d.key !== undefined && d.key !== null) b.key[i] = d.key;
      if (d.hidden) b.hid[i] = 1;
      if (d.ice > 0) b.ice[i] = d.ice;
    }
  });
  b.dispIdx = new Int8Array(b.disps.length);
  return b;
}

export function cloneBoard(b) {
  return {
    ...b,
    kind: b.kind.slice(),
    color: b.color.slice(),
    alt: b.alt.slice(),
    pair: b.pair.slice(),
    lock: b.lock.slice(),
    key: b.key.slice(),
    dispAt: b.dispAt.slice(),
    dispIdx: b.dispIdx.slice(),
    hid: b.hid.slice(),
    ice: b.ice.slice(),
  };
}

let queue = new Int16Array(64);

// reach[i] = 1 if the crate at i is in the top row or touches an empty cell connected
// through empty cells to the top edge (spec 3.2). Locks and dispensers block paths.
export function computeReach(b, reach) {
  reach.fill(0);
  if (queue.length < b.n) queue = new Int16Array(b.n);
  const seen = new Uint8Array(b.n);
  let head = 0;
  let tail = 0;
  for (let c = 0; c < b.cols; c++) {
    if (b.kind[c] === EMPTY) {
      seen[c] = 1;
      queue[tail++] = c;
    } else if (b.kind[c] === CRATE) reach[c] = 1;
  }
  while (head < tail) {
    const i = queue[head++];
    const r = (i / b.cols) | 0;
    const c = i - r * b.cols;
    for (let k = 0; k < 4; k++) {
      const rr = r + (k === 0 ? -1 : k === 1 ? 1 : 0);
      const cc = c + (k === 2 ? -1 : k === 3 ? 1 : 0);
      if (rr < 0 || rr >= b.rows || cc < 0 || cc >= b.cols) continue;
      const j = rr * b.cols + cc;
      if (b.kind[j] === EMPTY) {
        if (!seen[j]) {
          seen[j] = 1;
          queue[tail++] = j;
        }
      } else if (b.kind[j] === CRATE) reach[j] = 1;
    }
  }
  return reach;
}

// Can the crate at i be picked? lift = the "lift any crate" booster (ignores paths, not locks
// or ice).
export function canPick(b, i, reach, lift = false) {
  return b.kind[i] === CRATE && b.lock[i] < 0 && b.ice[i] <= 0 && (lift || reach[i] === 1);
}

// n more units were collected into crates: every ice counter drops by n. Returns the cells that
// thawed just now (or []).
export function thawBoard(b, n) {
  const out = [];
  for (let i = 0; i < b.n; i++) {
    if (b.ice[i] > 0) {
      b.ice[i] = Math.max(0, b.ice[i] - n);
      if (b.ice[i] === 0) out.push(i);
    }
  }
  return out;
}

// Remove the crate at i and apply every side effect of a pick, in order:
// freeze the swap partner, toggle all remaining swap pairs, unlock the key's lock,
// let dispensers refill empty zone cells. Returns the picked colour.
// info (optional) collects { partner, unlocked, ejects: [{disp, to, color}], gone: [disp] }.
export function applyPick(b, i, info) {
  const color = b.color[i];
  const pair = b.pair[i];
  const key = b.key[i];
  b.kind[i] = EMPTY;
  b.color[i] = -1;
  b.alt[i] = -1;
  b.pair[i] = -1;
  b.key[i] = -1;
  b.hid[i] = 0;
  b.picks++;
  if (pair >= 0) {
    for (let j = 0; j < b.n; j++) {
      if (b.pair[j] === pair) {
        b.pair[j] = -1; // partner becomes a plain crate of its current colour
        b.alt[j] = -1;
        if (info) info.partner = j;
      }
    }
  }
  for (let j = 0; j < b.n; j++) {
    if (b.pair[j] >= 0) {
      const t = b.color[j];
      b.color[j] = b.alt[j];
      b.alt[j] = t;
      if (info) info.toggled = true;
    }
  }
  if (key >= 0) {
    for (let j = 0; j < b.n; j++) {
      if (b.lock[j] === key) {
        b.lock[j] = -1;
        if (info) {
          info.unlocked = j;
          info.lockId = key;
        }
      }
    }
  }
  runDispensers(b, info);
  return color;
}

// Every live dispenser fills its empty zone cells, left to right, while it has crates.
// An exhausted dispenser vanishes and its cell becomes floor.
export function runDispensers(b, info) {
  for (let d = 0; d < b.disps.length; d++) {
    const disp = b.disps[d];
    if (b.kind[disp.cell] !== DISP) continue;
    for (const z of disp.zone) {
      if (b.dispIdx[d] >= disp.queue.length) break;
      if (b.kind[z] !== EMPTY) continue;
      const color = disp.queue[b.dispIdx[d]++];
      b.kind[z] = CRATE;
      b.color[z] = color;
      if (info) info.ejects.push({ disp: d, from: disp.cell, to: z, color });
    }
    if (b.dispIdx[d] >= disp.queue.length && b.dispVanish) {
      b.kind[disp.cell] = EMPTY;
      b.dispAt[disp.cell] = -1;
      if (info) info.gone.push(d);
    }
  }
}

export function newPickInfo() {
  return { partner: -1, unlocked: -1, lockId: -1, toggled: false, ejects: [], gone: [] };
}

// Reveal hidden crates that have become pickable. Returns the revealed cells (or []).
export function revealReachable(b, reach) {
  const out = [];
  for (let i = 0; i < b.n; i++) {
    if (b.hid[i] && reach[i]) {
      b.hid[i] = 0;
      out.push(i);
    }
  }
  return out;
}

// Cleared = no crate left anywhere (exhausted, persisting dispensers don't count).
export function boardCleared(b) {
  for (let i = 0; i < b.n; i++) if (b.kind[i] === CRATE) return false;
  for (let d = 0; d < b.disps.length; d++) {
    if (b.kind[b.disps[d].cell] === DISP && b.dispIdx[d] < b.disps[d].queue.length) return false;
  }
  return true;
}

// Crates still to be picked, including those waiting inside dispensers.
export function cratesLeft(b) {
  let n = 0;
  for (let i = 0; i < b.n; i++) if (b.kind[i] === CRATE) n++;
  for (let d = 0; d < b.disps.length; d++) {
    if (b.kind[b.disps[d].cell] === DISP) n += b.disps[d].queue.length - b.dispIdx[d];
  }
  return n;
}
