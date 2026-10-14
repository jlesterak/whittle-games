// Ludo powerups (docs/games/ludo.md 2.1): which squares carry one, which effects exist and how often.
// Pure data and placement; the effects themselves are applied in rules.js. Squares are absolute track
// squares (0..51); placement and respawns come from a seed stored in the game, so a save restores them.
import { makeRng, hashSeed } from '../../core/rng.js';

// w = weight when a square is rolled (good effects slightly outweigh bad ones: 17 vs 10),
// ev = rough worth in steps to the player who lands (the bots add it to a move's score).
export const KINDS = {
  jump3: { w: 4, good: true, name: 'Jump +3', text: 'Jump ahead 3 squares', ev: 3 },
  jump6: { w: 3, good: true, name: 'Jump +6', text: 'Jump ahead 6 squares', ev: 6 },
  swap: { w: 3, good: true, name: 'Swap!', text: 'Swap places with the nearest opponent token ahead', ev: 6 },
  shield: { w: 3, good: true, name: 'Shield!', text: 'Immune to capture until this token moves again', ev: 5 },
  extra: { w: 4, good: true, name: 'Roll again!', text: 'Extra roll', ev: 7 },
  start: { w: 3, good: false, name: 'Back to start!', text: 'Back to the yard', ev: -20 },
  back: { w: 4, good: false, name: 'Back!', text: 'Back to where this token was before the move', ev: -4 },
  freeze: { w: 3, good: false, name: 'Frozen!', text: 'Skip your next turn', ev: -8 },
};
export const KIND_ORDER = Object.keys(KINDS);

export function pickKind(rng) {
  let r = rng.next() * KIND_ORDER.reduce((a, k) => a + KINDS[k].w, 0);
  for (const k of KIND_ORDER) if ((r -= KINDS[k].w) < 0) return k;
  return KIND_ORDER[0];
}

// Squares that may carry a powerup: never a start or star square (abs % 13 is 0 or 8) nor the three
// squares in front of a yard exit (1-3). The 32 left are the middle of each quarter.
export const eligible = (abs) => ![0, 1, 2, 3, 8].includes(abs % 13);
const gap = (a, b) => Math.min((a - b + 52) % 52, (b - a + 52) % 52);

// Pick `count` squares from `squares`, at least `spread` apart where possible, none in `taken`.
function choose(rng, squares, count, spread, taken = []) {
  const out = [];
  for (const sq of rng.shuffle(squares.slice())) {
    if (out.length >= count) break;
    if (taken.some((t) => gap(t, sq) < spread) || out.some((o) => gap(o, sq) < spread)) continue;
    out.push(sq);
  }
  return out;
}

export function placePowerups(seed) {
  const rng = makeRng(hashSeed('pu', seed));
  const all = Array.from({ length: 52 }, (_, a) => a).filter(eligible);
  return choose(rng, all, rng.range(8, 10), 3).map((sq) => ({ sq, kind: pickKind(rng) }));
}

// A fresh powerup elsewhere after one is used (`n` = how many respawns so far): not on a live
// powerup, and away from them when it can be.
export function respawnPowerup(seed, n, pu, usedSq) {
  const rng = makeRng(hashSeed('pu-respawn', seed, n));
  const taken = pu.map((p) => p.sq);
  const free = Array.from({ length: 52 }, (_, a) => a).filter((a) => eligible(a) && a !== usedSq && !taken.includes(a));
  const near = choose(rng, free, 1, 3, taken);
  const sq = near.length ? near[0] : rng.pick(free);
  return { sq, kind: pickKind(rng) };
}
