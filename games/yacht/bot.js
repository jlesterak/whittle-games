// Yacht bots (docs/yacht-spec.md 3.1). Pure and DOM-free.
//
// Hard and Medium search the hold choices exactly for the rest of the turn ("one-turn optimal"):
// over the 252 distinct rolls of five dice and the 462 hold multisets, with 4368 hold -> roll
// transitions built once. They differ only in the end-of-turn value function: Hard charges each box
// its opportunity cost (its average under optimal play) and shapes for the upper bonus; Medium is
// greedy for points. Easy plays a rule of thumb.

import { counts } from '../../core/dice.js';
import { legalBoxes, boxScore, bonusFor, multipliers, upperSum, isUpper, rawScore, UPPER_NEED, UPPER_BONUS, FULL, LARGE, YACHT, CHANCE } from './rules.js';

export const LEVELS = ['easy', 'medium', 'hard'];

// Average score of each box under optimal solitaire play (Verhoeff), the opportunity cost of
// using it now.
const PAR = [1.88, 5.28, 8.57, 12.16, 15.69, 19.19, 21.66, 13.1, 22.59, 29.46, 32.71, 16.87, 22.01];
const SPREAD = 0.7; // sd of an upper box's score, in dice of that face (tuned by simulation, spec 6)
const PARK = 16; // open boxes over which the cost slides from one-turn to full-game averages (tuned)

// ---- tables ----
let T = null;
function tables() {
  if (T) return T;
  const keeps = []; // count vectors (faces 1..6 at 0..5), 0-5 dice
  const rec = (c, face, left) => {
    if (face === 6) return keeps.push(c.slice());
    for (let k = 0; k <= left; k++) {
      c[face] = k;
      rec(c, face + 1, left - k);
    }
    c[face] = 0;
  };
  rec([0, 0, 0, 0, 0, 0], 0, 5);
  const key = (c) => c.reduce((a, v, i) => a + v * 6 ** i, 0);
  const size = (c) => c.reduce((a, b) => a + b, 0);
  const fact = [1, 1, 2, 6, 24, 120];
  const rolls = keeps.filter((c) => size(c) === 5);
  const rollIdx = new Map(rolls.map((c, i) => [key(c), i]));
  const keepIdx = new Map(keeps.map((c, i) => [key(c), i]));
  const rollDice = rolls.map((c) => c.flatMap((n, f) => new Array(n).fill(f + 1)));
  // keep -> [(roll, p)]: reroll the other 5 - n dice
  const outStart = new Int32Array(keeps.length + 1);
  const outRoll = [];
  const outP = [];
  keeps.forEach((c, k) => {
    outStart[k] = outRoll.length;
    const m = 5 - size(c);
    for (const o of keeps) {
      if (size(o) !== m) continue;
      const p = fact[m] / o.reduce((a, v) => a * fact[v], 1) / 6 ** m;
      outRoll.push(rollIdx.get(key(c.map((v, i) => v + o[i]))));
      outP.push(p);
    }
  });
  outStart[keeps.length] = outRoll.length;
  // roll -> its distinct sub-holds
  const subs = rolls.map((c) => keeps.filter((k) => k.every((v, i) => v <= c[i])).map((k) => keepIdx.get(key(k))));
  const full = rolls.map((c) => keepIdx.get(key(c)));
  T = { keeps, rolls, rollIdx, rollDice, outStart, outRoll: Int16Array.from(outRoll), outP: Float64Array.from(outP), subs, full, key };
  return T;
}

// ---- value functions: (card, rules, col, cat, dice) -> end-of-turn value ----
function hardValue(card, rules, col, cat, dice) {
  const m = multipliers(rules)[col];
  const score = boxScore(card, col, cat, dice);
  let v = m * (score - cost(card, cat)) + bonusFor(card, cat, dice, rules);
  if (isUpper(cat)) v += m * upperShape(card.cols[col], cat, score);
  return v;
}

// A box's opportunity cost: its optimal-play average early on, sliding to what one turn aimed
// only at it scores on average (ONE) as the open boxes run out.
function cost(card, cat) {
  const open = card.cols.reduce((n, b) => n + b.filter((v) => v === null).length, 0);
  const a = Math.min(1, (open - 1) / PARK);
  const one = oneTurn()[cat];
  return one + (PAR[cat] - one) * a;
}

let ONE = null;
function oneTurn() {
  if (ONE) return ONE;
  const { rollDice, keeps } = tables();
  const empty = keeps.findIndex((k) => k.every((v) => v === 0));
  ONE = PAR.map((_, cat) => {
    let E = holdEV(Float64Array.from(rollDice, (d) => rawScore(cat, d)));
    E = holdEV(rollMax(E));
    E = holdEV(rollMax(E));
    return E[empty];
  });
  return ONE;
}

// The upper bonus: 35 x the change in P(reaching 63) this box makes. P is a normal estimate from
// the open upper boxes' average scores (PAR) and a spread of about one die per box.
function upperShape(boxes, cat, score) {
  const u = upperSum(boxes);
  if (u >= UPPER_NEED) return 0;
  return UPPER_BONUS * (pBonus(boxes, u + score, cat) - pBonus(boxes, u, -1));
}

function pBonus(boxes, u, closed) {
  let mean = u;
  let varc = 0;
  for (let c = 0; c < 6; c++) {
    if (c === closed || boxes[c] !== null) continue;
    mean += PAR[c];
    varc += (SPREAD * (c + 1)) ** 2;
  }
  if (!varc) return u >= UPPER_NEED ? 1 : 0;
  return 1 / (1 + Math.exp((-1.702 * (mean - UPPER_NEED + 0.5)) / Math.sqrt(varc)));
}

function mediumValue(card, rules, col, cat, dice) {
  const m = multipliers(rules)[col];
  const score = boxScore(card, col, cat, dice);
  const boxes = card.cols[col];
  const u = upperSum(boxes);
  const cross = isUpper(cat) && u < UPPER_NEED && u + score >= UPPER_NEED ? UPPER_BONUS : 0;
  return m * (score + cross) + bonusFor(card, cat, dice, rules);
}

const VALUE = { hard: hardValue, medium: mediumValue };

// Best box for these dice under a value function.
function bestBox(card, rules, dice, value) {
  let best = null;
  let bv = -Infinity;
  for (const b of legalBoxes(card, dice, rules)) {
    const v = value(card, rules, b.col, b.cat, dice);
    if (v > bv) [best, bv] = [b, v];
  }
  return { box: best, value: bv };
}

// Expected value of each hold, given the value of each roll after the reroll.
function holdEV(V) {
  const { keeps, outStart, outRoll, outP } = tables();
  const E = new Float64Array(keeps.length);
  for (let k = 0; k < keeps.length; k++) {
    let e = 0;
    for (let j = outStart[k]; j < outStart[k + 1]; j++) e += outP[j] * V[outRoll[j]];
    E[k] = e;
  }
  return E;
}

function rollMax(E) {
  const { subs } = tables();
  return Float64Array.from(subs, (s) => s.reduce((a, k) => Math.max(a, E[k]), -Infinity));
}

// E[hold] with `rollsLeft` rolls still to come (1 or 2).
function holdValues(card, rules, value, rollsLeft) {
  const { rollDice } = tables();
  let V = Float64Array.from(rollDice, (d) => bestBox(card, rules, d, value).value);
  let E = holdEV(V);
  for (let r = 1; r < rollsLeft; r++) E = holdEV(rollMax(E));
  return E;
}

const rollOf = (dice) => {
  const t = tables();
  return t.rollIdx.get(t.key(counts(dice).slice(1)));
};

// Turn a hold multiset into a held mask over the actual dice.
function maskFor(dice, keepCounts) {
  const left = keepCounts.slice();
  return dice.map((d) => (left[d - 1] > 0 ? (left[d - 1]--, true) : false));
}

// ---- Easy: rule of thumb ----
function easyHold(dice, card, rng) {
  const c = counts(dice);
  const sorted = [...new Set(dice)].sort((a, b) => a - b);
  const open = (cat) => card.cols.some((b) => b[cat] === null);
  const made = (cat) => rawScore(cat, dice) > 0 && open(cat);
  if (rawScore(YACHT, dice) || made(LARGE) || made(FULL)) return dice.map(() => true);
  // a 4-run: go for the straight half the time
  for (const lo of [1, 2, 3]) {
    if ([0, 1, 2, 3].every((i) => sorted.includes(lo + i)) && rng.chance(0.5)) {
      const want = new Set([lo, lo + 1, lo + 2, lo + 3]);
      return dice.map((d) => (want.has(d) ? (want.delete(d), true) : false));
    }
  }
  let face = 6;
  for (let v = 6; v >= 1; v--) if (c[v] > c[face]) face = v;
  return dice.map((d) => d === face);
}

function easyBox(card, dice, rules, rng) {
  const legal = legalBoxes(card, dice, rules);
  const scored = legal.map((b) => ({ b, s: boxScore(card, b.col, b.cat, dice) * multipliers(rules)[b.col] }));
  const positive = scored.filter((x) => x.s > 0);
  if (positive.length && rng.chance(0.2)) return rng.pick(positive).b;
  const top = Math.max(...scored.map((x) => x.s));
  // among the best, avoid wasting Chance when something else scores as much
  const best = scored.filter((x) => x.s === top);
  return (best.find((x) => x.b.cat !== CHANCE) || best[0]).b;
}

// ---- public ----
// Which dice to hold before the next roll (rollsLeft = 1 or 2). All true means stop and score.
export function botHold(level, dice, rollsLeft, card, rules, rng) {
  if (level === 'easy') return easyHold(dice, card, rng);
  const t = tables();
  const E = holdValues(card, rules, VALUE[level] || hardValue, rollsLeft);
  const r = rollOf(dice);
  let best = t.full[r];
  for (const k of t.subs[r]) if (E[k] > E[best] + 1e-9) best = k;
  return maskFor(dice, t.keeps[best]);
}

// Which box to score the dice in: { col, cat }.
export function botBox(level, dice, card, rules, rng) {
  if (level === 'easy') return easyBox(card, dice, rules, rng);
  return bestBox(card, rules, dice, VALUE[level] || hardValue).box;
}
