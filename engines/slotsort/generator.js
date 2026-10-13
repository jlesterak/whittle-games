// Slot-sort engine level generator (Beadloom spec 8.4, generalised). Level n is deterministic.
//
// 1. Knobs from the level number (game.knobs).
// 2. Board: shape, crate colours (1-2 crates per colour), then dispensers, swap pairs, locks,
//    hidden "?" tiles.
// 3. A "competent player" clears the board alone; its pick order is the intended order.
// 4. The game turns that order into its supply (game.supply), e.g. a jittered bead stream.
// 5. Verify: the solver must clear it with k.slotsToSolve slots, the solution must win in the
//    real sim, and a random player's win rate should sit in k.band. Up to MAX_ATTEMPTS tries,
//    keeping the best winnable candidate.
//
// game = {
//   cols, ncolors, model, cap, makeSim,      // see solver.js
//   dispZone: 'below' | 'facing' | 'side' or a list of them, // 'below': up to 3 cells in the row
//                                            // below; 'facing': 1 neighbour (Purl); 'side': at
//                                            // the board edge, facing in (Beadloom recording C)
//   unitsPerCrate?,                          // sim units a crate holds (ice thresholds)
//   dispVanish: true | false,
//   knobs(n, rng) -> { d, crates, colours, maxPerColour?, swaps, dispensers, dispSize(), locks,
//                      hiddenTiles, ice, iceUnits(), slotsToSolve, band: [lo, hi], ...game-specific },
//                      maxPerColour: crates per colour go 1..max at random (Purl 5); without
//                      it each colour gets 1-2 (Beadloom)
//   mask?(cells, cols, rng) -> { rows, mask } | null,  // board outline with voids (default makeMask)
//   calm?(k, attempt),                        // ease knobs on later attempts
//   supply(order, k, rng) -> supply fields for the level,
//   assemble({ n, seed, board, supply, k }) -> level,
// }

import { makeRng, hashSeed } from '../../core/rng.js';
import { createBoard, computeReach, canPick, applyPick, runDispensers, boardCleared, thawBoard } from './board.js';
import { solve, randomWinRate, replay } from './solver.js';

const MAX_ATTEMPTS = 24;

// Board outline for `cells` cells: 3 wide (centred) for small boards, else full width with the
// remainder as a centred bottom row or symmetric single-cell pockets (like levels 2796, 2414).
export function makeMask(cells, cols, rng) {
  const mask = [];
  const mid = (cols - 1) / 2;
  if (cells <= 9 && cols >= 5) {
    const lo = Math.floor(mid) - 1;
    const rows = Math.ceil(cells / 3);
    const rem = cells - (rows - 1) * 3;
    for (let r = 0; r < rows; r++) {
      const last = r === rows - 1;
      const use = !last || rem === 3 ? [lo, lo + 1, lo + 2] : rem === 1 ? [lo + 1] : [lo, lo + 2];
      for (let c = 0; c < cols; c++) mask.push(use.includes(c));
    }
    return { rows, mask };
  }
  const full = Math.floor(cells / cols);
  const rem = cells % cols;
  const rows = full + (rem ? 1 : 0);
  for (let i = 0; i < full * cols; i++) mask.push(true);
  if (rem) {
    let use;
    if (cols === 5) use = { 1: [2], 2: rng.chance(0.5) ? [1, 3] : [0, 4], 3: [1, 2, 3], 4: rng.chance(0.5) ? [0, 1, 3, 4] : [1, 2, 3, 4] }[rem];
    else if (cols === 6) use = { 1: [rng.chance(0.5) ? 2 : 3], 2: [2, 3], 3: rng.chance(0.5) ? [1, 2, 3] : [2, 3, 4], 4: [1, 2, 3, 4], 5: rng.chance(0.5) ? [0, 1, 2, 3, 4] : [1, 2, 3, 4, 5] }[rem];
    // any other width: a centred contiguous block of `rem` cells
    if (!use) use = Array.from({ length: rem }, (_, i) => i + Math.floor((cols - rem) / 2));
    else {
      const start = Math.round(mid - (rem - 1) / 2);
      use = [...Array(rem).keys()].map((x) => x + start);
    }
    for (let c = 0; c < cols; c++) mask.push(use.includes(c));
  }
  return { rows, mask };
}

function dispenserOptions(mask, rows, cols, taken, mode) {
  if (Array.isArray(mode)) return mode.flatMap((m) => dispenserOptions(mask, rows, cols, taken, m));
  const options = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (!mask[i] || taken.includes(i)) continue;
      let zones;
      if (mode === 'side') {
        if (c !== 0 && c !== cols - 1) continue;
        zones = [[r * cols + (c === 0 ? 1 : cols - 2)]];
      } else if (mode === 'facing') {
        zones = [[r, c - 1], [r, c + 1], [r + 1, c]]
          .filter(([rr, cc]) => rr < rows && cc >= 0 && cc < cols)
          .map(([rr, cc]) => [rr * cols + cc]);
      } else {
        if (r >= rows - 1) continue;
        zones = [[c - 1, c, c + 1].filter((x) => x >= 0 && x < cols).map((x) => (r + 1) * cols + x)];
      }
      for (const zone of zones) {
        const z = zone.filter((j) => mask[j] && !taken.includes(j));
        if (z.length && !taken.some((t) => zone.includes(t))) options.push([i, z, r]);
      }
    }
  }
  return options;
}

export function buildBoard(k, game, rng) {
  const cols = k.cols || game.cols;
  const palette = rng.shuffle([...Array(game.ncolors).keys()]).slice(0, k.colours);
  const list = [];
  if (k.maxPerColour) {
    const counts = palette.map(() => 1);
    for (let left = Math.min(k.crates, k.colours * k.maxPerColour) - k.colours; left > 0; ) {
      const i = rng.int(counts.length);
      if (counts[i] < k.maxPerColour) {
        counts[i]++;
        left--;
      }
    }
    palette.forEach((c, i) => {
      for (let j = 0; j < counts[i]; j++) list.push(c);
    });
  } else {
    palette.forEach((c, i) => {
      list.push(c);
      if (i < k.crates - k.colours) list.push(c);
    });
  }
  rng.shuffle(list);

  const queues = [];
  for (let d = 0; d < k.dispensers; d++) queues.push(k.dispSize());
  const queued = queues.reduce((a, b) => a + b, 0);
  const cellsNeeded = k.crates - queued + k.dispensers;
  if (cellsNeeded > cols * (game.maxRows || 5) || cellsNeeded < 3) return null;
  const shape = (game.mask || makeMask)(cellsNeeded, cols, rng);
  if (!shape) return null;
  const { rows, mask } = shape;
  if (k.dispensers && rows < 3) return null;

  const cells = mask.map((m) => (m ? { c: -1 } : null));
  const taken = [];
  for (const q of queues) {
    const options = dispenserOptions(mask, rows, cols, taken, game.dispZone);
    if (!options.length) return null;
    const pref = options.filter((o) => o[2] >= 1);
    const [i, zone] = rng.pick(pref.length ? pref : options);
    taken.push(i);
    cells[i] = { disp: new Array(q), zone };
  }
  let next = 0;
  cells.forEach((cell) => {
    if (cell && !cell.disp) cell.c = list[next++];
  });
  for (const cell of cells) if (cell && cell.disp) for (let j = 0; j < cell.disp.length; j++) cell.disp[j] = list[next++];

  const plain = () =>
    cells
      .map((c, i) => (c && !c.disp && c.alt === undefined && c.lock === undefined && c.key === undefined && !c.hidden && !c.ice ? i : -1))
      .filter((i) => i >= 0);
  for (let p = 0; p < (k.swaps || 0); p++) {
    const opts = plain();
    const i = rng.pick(opts);
    const others = opts.filter((j) => j !== i && cells[j].c !== cells[i].c);
    if (opts.length < 2 || !others.length) break;
    const j = rng.pick(others);
    cells[i].alt = cells[j].c;
    cells[j].alt = cells[i].c;
    cells[i].pair = cells[j].pair = p;
  }
  for (let l = 0; l < (k.locks || 0); l++) {
    const opts = plain();
    const lockable = opts.filter((i) => i >= cols); // never lock a top-row crate
    if (!lockable.length || opts.length < 2) break;
    const li = rng.pick(lockable);
    const ki = rng.pick(opts.filter((j) => j !== li));
    cells[li].lock = l;
    cells[ki].key = l;
  }
  for (let f = 0; f < (k.ice || 0); f++) {
    const opts = plain().filter((i) => i >= cols); // never freeze a top-row crate
    if (!opts.length) break;
    cells[rng.pick(opts)].ice = k.iceUnits();
  }
  const board = { cols, rows, cells };
  if (game.dispVanish === false) board.dispVanish = false;
  if (k.hiddenTiles) {
    // only where the crate is not pickable at the start (it would reveal at once)
    const b = createBoard(board);
    runDispensers(b, null);
    const reach = computeReach(b, new Uint8Array(b.n));
    for (let h = 0; h < k.hiddenTiles; h++) {
      const opts = plain().filter((i) => i >= cols && !reach[i]);
      if (!opts.length) break;
      cells[rng.pick(opts)].hidden = true;
    }
  }
  return board;
}

// Clear the board alone, top rows first-ish. Returns the colours in pick order, or null if the
// board can jam (a key behind its own lock, ice that can't thaw). Each pick is assumed to
// collect perPick units (a full crate) for the ice counters.
export function competentOrder(boardDef, rng, perPick = 0) {
  const b = createBoard(boardDef);
  runDispensers(b, null);
  const reach = new Uint8Array(b.n);
  const order = [];
  while (!boardCleared(b)) {
    computeReach(b, reach);
    const opts = [];
    let total = 0;
    for (let i = 0; i < b.n; i++) {
      if (!canPick(b, i, reach)) continue;
      const w = (b.rows - Math.floor(i / b.cols)) ** 2 + (b.key[i] >= 0 ? 4 : 0);
      opts.push([i, w]);
      total += w;
    }
    if (!opts.length) return null;
    let x = rng.next() * total;
    let pick = opts[opts.length - 1][0];
    for (const [i, w] of opts) {
      if ((x -= w) <= 0) {
        pick = i;
        break;
      }
    }
    order.push(applyPick(b, pick, null));
    if (perPick) thawBoard(b, perPick);
  }
  return order;
}

export function generate(n, game) {
  const seed = hashSeed(game.id, n);
  const rng = makeRng(seed);
  let best = null;
  let bestGap = Infinity;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const k = game.knobs(n, rng);
    game.calm?.(k, attempt);
    const board = buildBoard(k, game, rng);
    if (!board) continue;
    const order = competentOrder(board, rng, game.unitsPerCrate || 0);
    if (!order) continue;
    const level = game.assemble({ n, seed, board, supply: game.supply(order, k, rng), k });
    const sol = solve(level, game, { slots: k.slotsToSolve, maxNodes: 40000 });
    if (!sol.ok) continue;
    if (!replay(level, sol.picks, game, { slots: k.slotsToSolve }).ok) continue;
    const rate = randomWinRate(level, game, { slots: level.slots, playouts: 40, rng });
    const gap = rate < k.band[0] ? k.band[0] - rate : rate > k.band[1] ? rate - k.band[1] : 0;
    level.meta = { attempt, d: +k.d.toFixed(3), randomWinRate: rate, solution: sol.picks, solvedWith: k.slotsToSolve };
    if (gap < bestGap) {
      best = level;
      bestGap = gap;
    }
    if (gap === 0) break;
  }
  if (!best) best = fallback(n, seed, game, rng);
  return best;
}

// Never needed in practice: a plain board with the game's easiest supply is always solvable.
function fallback(n, seed, game, rng) {
  const k = { ...game.knobs(1, rng), crates: 10, colours: 6, swaps: 0, dispensers: 0, locks: 0, hiddenTiles: 0, jitter: 0 };
  const board = buildBoard(k, game, rng);
  const order = competentOrder(board, rng);
  const level = game.assemble({ n, seed, board, supply: game.supply(order, k, rng), k });
  level.meta = { fallback: true, solution: solve(level, game).picks, solvedWith: 4 };
  return level;
}
