// Farkle rules: scoring a set of dice, the farkle check, and the turn and game flow (roll, set aside, bank,
// hot dice, entry minimum, the final round). Pure and DOM-free; dice come from a seeded rng. See
// docs/games/farkle.md for the rules and their source.
//
// A game is { v, rules, scores, entered, cur, final, over, turns, turn }. turn is { dice, aside, pts, phase }:
// dice are six faces (0 = not rolled), aside[i] marks a die set aside earlier this turn, pts is what the turn
// has set aside so far, and phase is 'roll' (the turn has not rolled yet), 'pick' (dice are showing and score)
// or 'farkle' (the last roll scored nothing).

import { counts, rollDie } from '../../core/dice.js';

export const DICE = 6;

export const DEFAULT_RULES = { target: 10000, threePairs: 1500, kinds: 'fixed', hotDice: 'may', entry: 0 };
const TARGETS = [10000, 5000, 2500];
const PAIRS = [1500, 750, 0];
const ENTRIES = [0, 500, 1000];

// Rules from settings strings or an old save, made safe. Unknown values fall back to the defaults.
export function normRules(r = {}) {
  const pick = (v, list, d) => (list.includes(Number(v)) ? Number(v) : d);
  return {
    target: pick(r.target, TARGETS, 10000),
    threePairs: r.threePairs === 'off' ? 0 : pick(r.threePairs, PAIRS, 1500),
    kinds: r.kinds === 'double' ? 'double' : 'fixed',
    hotDice: r.hotDice === 'must' ? 'must' : 'may',
    entry: pick(r.entry, ENTRIES, 0),
  };
}

export const single = (face) => (face === 1 ? 100 : face === 5 ? 50 : 0);
export const triple = (face) => (face === 1 ? 1000 : face * 100);

// k of a kind (k = 3..6) of one face. Fixed: 1000 / 2000 / 3000 for four, five, six. Double: each die past three
// doubles the three-of-a-kind score.
export function kindScore(face, k, rules) {
  if (k === 3) return triple(face);
  if (rules.kinds === 'double') return triple(face) * 2 ** (k - 3);
  return [1000, 2000, 3000][k - 4];
}

// Best score for n dice of one face, split into singles (1s and 5s only) and groups of three or more, or
// -Infinity if some die can't score (a lone 2, say).
function faceScore(face, n, rules) {
  const best = [0];
  for (let j = 1; j <= n; j++) {
    best[j] = -Infinity;
    if (single(face)) best[j] = single(face) + best[j - 1];
    for (let k = 3; k <= j; k++) best[j] = Math.max(best[j], kindScore(face, k, rules) + best[j - k]);
  }
  return best[n];
}

// The score of a set of dice (counts c[1..6]) where every die must score, or 0 when it doesn't. Six dice can
// also make a run (1-6) or three pairs; the best reading counts.
export function scoreCounts(c, rules) {
  let s = 0;
  for (let f = 1; f <= 6; f++) s += c[f] ? faceScore(f, c[f], rules) : 0;
  const n = c.reduce((a, b) => a + b, 0);
  if (n === 6) {
    if (c.slice(1).every((k) => k === 1)) s = Math.max(s, 2500);
    if (rules.threePairs && c.filter((k) => k === 2).length === 3) s = Math.max(s, rules.threePairs);
  }
  return n && s > 0 ? s : 0;
}

export const scoreDice = (dice, rules) => scoreCounts(counts(dice), rules);

// Does any die in this roll score? No: a farkle.
export function hasScore(dice, rules) {
  const c = counts(dice);
  if (c[1] || c[5] || c.some((k) => k >= 3)) return true;
  return dice.length === 6 && !!rules.threePairs && c.filter((k) => k === 2).length === 3;
}

// Every way to set aside part of a roll that scores, by counts: [{ c, n, score }], one entry per distinct
// sub-multiset. Bots choose from these; keepIndices() maps one back to dice positions.
export function keepOptions(dice, rules) {
  const c = counts(dice);
  const out = [];
  const sub = new Array(7).fill(0);
  (function walk(f) {
    if (f > 6) {
      const score = scoreCounts(sub, rules);
      if (score) out.push({ c: sub.slice(), n: sub.reduce((a, b) => a + b, 0), score });
      return;
    }
    for (let k = 0; k <= c[f]; k++) {
      sub[f] = k;
      walk(f + 1);
    }
    sub[f] = 0;
  })(1);
  return out;
}

// ---- a turn ----

export const newTurn = () => ({ dice: new Array(DICE).fill(0), aside: new Array(DICE).fill(false), pts: 0, phase: 'roll' });
export const free = (turn) => turn.dice.map((_, i) => i).filter((i) => !turn.aside[i]);
export const rolledDice = (turn) => free(turn).map((i) => turn.dice[i]);

// Positions of the free dice that make up the counts c (from keepOptions).
export function keepIndices(turn, c) {
  const want = c.slice();
  return free(turn).filter((i) => want[turn.dice[i]] > 0 && want[turn.dice[i]]--);
}

// What keeping these positions would score, or 0 if it isn't a legal keep (empty, not free, or a die that
// doesn't score).
export function keepScore(turn, keep, rules) {
  if (turn.phase !== 'pick' || !keep.length || new Set(keep).size !== keep.length) return 0;
  if (!keep.every((i) => Number.isInteger(i) && i >= 0 && i < DICE && !turn.aside[i])) return 0;
  return scoreDice(keep.map((i) => turn.dice[i]), rules);
}

// Would keeping these dice use the last free one (hot dice)?
export const isHot = (turn, keep) => free(turn).length === keep.length;

// May the player bank after keeping these dice? Needs a legal keep, the entry minimum (until the player
// has banked once), and with hot dice set to 'must', not all six dice used.
export function canBank(g, keep) {
  const s = keepScore(g.turn, keep, g.rules);
  if (!s) return false;
  if (g.rules.hotDice === 'must' && isHot(g.turn, keep)) return false;
  return g.entered[g.cur] || g.turn.pts + s >= g.rules.entry;
}

function commit(g, keep) {
  const s = keepScore(g.turn, keep, g.rules);
  if (!s) throw new Error(`illegal keep ${JSON.stringify(keep)}`);
  const hot = isHot(g.turn, keep);
  g.turn.pts += s;
  for (const i of keep) g.turn.aside[i] = true;
  return { score: s, hot };
}

// Roll the free dice. At the start of a turn keep is empty; after a roll it is the dice set aside first.
// Scoring all six (hot dice) frees them all again. Returns { score, hot, farkle }.
export function roll(g, rng, keep = []) {
  const t = g.turn;
  if (g.over) throw new Error('game over');
  let r = { score: 0, hot: false };
  if (t.phase === 'pick') r = commit(g, keep);
  else if (t.phase !== 'roll' || keep.length) throw new Error(`can't roll in phase ${t.phase}`);
  if (free(t).length === 0) t.aside.fill(false);
  for (const i of free(t)) t.dice[i] = rollDie(rng);
  t.phase = hasScore(rolledDice(t), g.rules) ? 'pick' : 'farkle';
  return { ...r, farkle: t.phase === 'farkle' };
}

// Keep these dice and bank the turn. Returns { score, banked }.
export function bank(g, keep) {
  if (!canBank(g, keep)) throw new Error(`can't bank ${JSON.stringify(keep)}`);
  const { score } = commit(g, keep);
  const banked = g.turn.pts;
  g.scores[g.cur] += banked;
  g.entered[g.cur] = true;
  if (g.final < 0 && g.scores[g.cur] >= g.rules.target) g.final = g.cur;
  endTurn(g);
  return { score, banked };
}

// After a farkle: the turn's points are lost and play moves on.
export function endFarkle(g) {
  if (g.turn.phase !== 'farkle') throw new Error('not a farkle');
  endTurn(g);
}

// Next seat. Once a player reaches the target, everyone else has one more turn; the game ends when play
// comes back round to that player.
function endTurn(g) {
  g.turns[g.cur]++;
  g.cur = (g.cur + 1) % g.scores.length;
  g.turn = newTurn();
  if (g.final >= 0 && g.cur === g.final) g.over = true;
}

export function newGame(n, rules) {
  return { v: 1, rules, scores: new Array(n).fill(0), entered: new Array(n).fill(false), cur: 0, final: -1, over: false, turns: new Array(n).fill(0), turn: newTurn() };
}

export const lastRound = (g) => g.final >= 0;

// Seats with the top score once the game is over.
export function winners(g) {
  const top = Math.max(...g.scores);
  return g.scores.map((s, i) => i).filter((i) => g.scores[i] === top);
}

// A game read back from a save: true if its shape is one this code can play.
export function validGame(g, n) {
  const arr = (a, ok) => Array.isArray(a) && a.length === n && a.every(ok);
  const t = g && g.turn;
  return (
    !!g &&
    arr(g.scores, Number.isFinite) &&
    arr(g.entered, (e) => typeof e === 'boolean') &&
    arr(g.turns, Number.isInteger) &&
    Number.isInteger(g.cur) && g.cur >= 0 && g.cur < n &&
    Number.isInteger(g.final) && g.final >= -1 && g.final < n &&
    typeof g.over === 'boolean' &&
    !!t &&
    Array.isArray(t.dice) && t.dice.length === DICE && t.dice.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) &&
    Array.isArray(t.aside) && t.aside.length === DICE && t.aside.every((a) => typeof a === 'boolean') &&
    Number.isFinite(t.pts) &&
    ['roll', 'pick', 'farkle'].includes(t.phase) &&
    (t.phase === 'roll' || free(t).every((i) => t.dice[i] > 0)) &&
    (t.phase !== 'pick' || hasScore(rolledDice(t), g.rules)) &&
    (t.phase !== 'farkle' || !hasScore(rolledDice(t), g.rules))
  );
}
