// Farkle rules: scoring a set of kept dice, whether a roll scores at all, the turn (keep, roll on, hot dice,
// bank, Farkle) and the end of the game. Pure and DOM-free; see docs/games/farkle.md.
//
// Scores are for dice kept from one roll: every kept die must be part of a scoring combination, and dice
// kept from different rolls never combine. When dice can be split more than one way, the best split counts.

import { counts } from '../../core/dice.js';

export const DICE = 6;
export const SINGLE = { 1: 100, 5: 50 };
export const RUN = 2500; // 1-2-3-4-5-6, the base table's "Run"
export const THREE_PAIRS = 1500;
const FLAT_KIND = { 4: 1000, 5: 2000, 6: 3000 }; // the base table's four, five, six of a kind

export const DEFAULT_RULES = { target: 10000, threePairs: true, fourKind: 'flat', hotDice: true, entry: 0 };

export function normRules(r = {}) {
  const target = Number(r.target);
  const entry = Number(r.entry);
  return {
    target: target === 5000 ? 5000 : 10000,
    threePairs: r.threePairs !== false && r.threePairs !== 'off',
    fourKind: r.fourKind === 'double' ? 'double' : 'flat',
    hotDice: r.hotDice !== false && r.hotDice !== 'off',
    entry: entry === 500 || entry === 1000 ? entry : 0,
  };
}

const triple = (face) => (face === 1 ? 1000 : face * 100);

// n of a kind (n >= 3) of one face.
export function kindScore(face, n, rules) {
  if (n === 3) return triple(face);
  return rules.fourKind === 'double' ? triple(face) * 2 ** (n - 3) : FLAT_KIND[n];
}

// Best score using every die in the count vector c (c[1..6]), or -Infinity if some die can't score.
const memo = new Map();
function best(c, rules) {
  const total = c.reduce((a, b) => a + b, 0);
  if (!total) return 0;
  const key = `${rules.fourKind}${rules.threePairs ? 'p' : ''}${c.join('')}`;
  if (memo.has(key)) return memo.get(key);
  let b = -Infinity;
  if (total === 6) {
    if (c.slice(1).every((n) => n === 1)) b = RUN;
    if (rules.threePairs && c.filter((n) => n === 2).length === 3) b = Math.max(b, THREE_PAIRS);
  }
  // the lowest face still present must be used by something: a single, or n of a kind
  const f = c.findIndex((n, i) => i > 0 && n > 0);
  if (SINGLE[f]) {
    c[f]--;
    b = Math.max(b, SINGLE[f] + best(c, rules));
    c[f]++;
  }
  for (let n = 3; n <= c[f]; n++) {
    c[f] -= n;
    b = Math.max(b, kindScore(f, n, rules) + best(c, rules));
    c[f] += n;
  }
  memo.set(key, b);
  return b;
}

// What these kept dice score (values 1-6), 0 if any of them doesn't count or none are kept.
export function scoreKeep(dice, rules) {
  if (!dice.length) return 0;
  const s = best(counts(dice), rules);
  return s > 0 ? s : 0;
}

// Every distinct scoring keep from a roll: [{ counts, score, n }] with counts[1..6] a sub-multiset of the roll.
export function keepOptions(roll, rules) {
  const c = counts(roll);
  const out = [];
  const rec = (face, k) => {
    if (face === 7) {
      const n = k.reduce((a, b) => a + b, 0);
      if (!n) return;
      const s = best(k.slice(), rules);
      if (s > 0) out.push({ counts: k.slice(), score: s, n });
      return;
    }
    for (let m = 0; m <= c[face]; m++) {
      k[face] = m;
      rec(face + 1, k);
    }
    k[face] = 0;
  };
  rec(1, [0, 0, 0, 0, 0, 0, 0]);
  return out;
}

// A roll with nothing to keep is a Farkle.
export const isFarkle = (roll, rules) => keepOptions(roll, rules).length === 0;

// The dice of a roll picked by a counts vector, as a mask over the roll (first matches first).
export function maskFor(roll, keepCounts) {
  const left = keepCounts.slice();
  return roll.map((d) => (left[d] > 0 ? (left[d]--, true) : false));
}

// ---- the turn ----
// A turn: { roll: [values], pts: points kept so far this turn, left: dice not yet set aside,
//           kept: [{ dice, score }] set aside this turn, hot: times the dice came back }

export const newTurn = () => ({ roll: [], pts: 0, left: DICE, kept: [], hot: 0 });

// The least a turn must hold before it may be banked (the entry minimum until a player is on the board).
export const bankMin = (score, rules) => (score > 0 ? 1 : Math.max(1, rules.entry));

// Keep the dice of the current roll picked by mask. Throws if that keep doesn't score. Mutates and returns the
// turn; afterwards left === 0 means the dice are spent (hot dice off): the turn can only be banked.
export function keep(turn, mask, rules) {
  const dice = turn.roll.filter((_, i) => mask[i]);
  const score = scoreKeep(dice, rules);
  if (!score) throw new Error(`keep scores nothing: ${dice}`);
  turn.pts += score;
  turn.kept.push({ dice, score });
  turn.left -= dice.length;
  turn.roll = turn.roll.filter((_, i) => !mask[i]);
  if (turn.left === 0 && rules.hotDice) {
    turn.left = DICE;
    turn.hot++;
  }
  return turn;
}

// After a keep: may this turn roll on, and may it bank (a player's banked score decides the entry minimum).
export const canRoll = (turn) => turn.left > 0;
export const canBank = (turn, score, rules) => turn.pts >= bankMin(score, rules);

// ---- the end of the game ----
// Once a player banks to the target (that seat is the game's finalFrom), every other player has one last turn.
export const reached = (score, rules) => score >= rules.target;

// The game is over when play comes back round to finalFrom (or at once with one seat).
export const gameOver = (finalFrom, nextSeat, seats) => finalFrom >= 0 && (seats === 1 || nextSeat === finalFrom);

// Dice spent (hot dice off) while still under the entry minimum: the turn ends with nothing, like a Farkle.
export const stuck = (turn, score, rules) => !canRoll(turn) && !canBank(turn, score, rules);
