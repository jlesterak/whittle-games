// Farkle bots (docs/games/farkle.md). Pure and DOM-free.
//
// Hard maximises the expected points of the turn, computed exactly: for every (dice left, points held) it
// knows the value of banking and of rolling on, over every roll of the dice left and every scoring keep of
// that roll (hot dice included). Points are tracked in steps of 50; at CAP and above it banks. Medium keeps a
// triple or better, else one single, and banks at a fixed threshold by dice left; Easy keeps its best-scoring
// keep and banks early. Every level plays its last turn (someone has reached the target) to beat the leader.
// No level is random: the same dice and scores give the same choice.

import { counts } from '../../core/dice.js';
import { keepOptions, maskFor, canRoll, canBank, DICE } from './rules.js';

export const LEVELS = ['easy', 'medium', 'hard'];

const STEP = 50;
const CAP = 8000; // points held at which Hard always banks (rolling on there gains next to nothing)

// ---- tables ----
// For n dice: the distinct rolls with their probability and their keeps as [{ k: dice used, s: best score }].
let ROLLS = null;
function rollTable() {
  if (ROLLS) return ROLLS;
  ROLLS = [null];
  const fact = [1, 1, 2, 6, 24, 120, 720];
  for (let n = 1; n <= DICE; n++) {
    const list = [];
    const rec = (face, left, roll) => {
      if (face === 6) {
        const r = roll.concat(new Array(left).fill(6));
        const c = counts(r);
        const p = fact[n] / c.reduce((a, v) => a * fact[v], 1) / 6 ** n;
        list.push({ roll: r, p });
        return;
      }
      for (let m = 0; m <= left; m++) rec(face + 1, left - m, roll.concat(new Array(m).fill(face)));
    };
    rec(1, n, []);
    ROLLS.push(list);
  }
  return ROLLS;
}

const tableCache = new Map();
// { bank(n, t), roll(n, t) } expected end-of-turn points for a player who is (onBoard) or is not on the board.
function valueTable(rules, onBoard) {
  const key = `${rules.threePairs}${rules.fourKind}${rules.hotDice}${onBoard ? 0 : rules.entry}`;
  if (tableCache.has(key)) return tableCache.get(key);
  const min = onBoard ? 1 : Math.max(1, rules.entry);
  const steps = CAP / STEP;
  const R = Array.from({ length: DICE + 1 }, () => new Float64Array(steps + 1)); // value of rolling n dice at t
  const V = Array.from({ length: DICE + 1 }, () => new Float64Array(steps + 1)); // best of bank and roll
  const rolls = rollTable();
  const opts = rolls.map((list, n) =>
    n === 0
      ? null
      : list.map(({ roll, p }) => {
          const byK = new Map();
          for (const o of keepOptions(roll, rules)) byK.set(o.n, Math.max(byK.get(o.n) || 0, o.score));
          return { p, keeps: [...byK] };
        }),
  );
  const bankV = (t) => (t >= min ? t : 0);
  // after a keep: m dice left with t held
  const after = (m, t) => {
    if (t >= CAP) return t;
    const i = t / STEP;
    if (m === 0) return rules.hotDice ? V[DICE][i] : bankV(t);
    return V[m][i];
  };
  for (let i = steps; i >= 0; i--) {
    const t = i * STEP;
    for (let n = 1; n <= DICE; n++) {
      let r = 0;
      for (const { p, keeps } of opts[n]) {
        let b = 0; // a Farkle scores nothing
        for (const [k, s] of keeps) b = Math.max(b, after(n - k, t + s));
        r += p * b;
      }
      R[n][i] = i === steps ? 0 : r;
      V[n][i] = i === steps ? t : Math.max(bankV(t), r);
    }
  }
  const table = { roll: (n, t) => (t >= CAP ? 0 : R[n][t / STEP]), value: after };
  tableCache.set(key, table);
  return table;
}

// The game situation a bot plays in: lastTurn true when someone has reached the target and this is the
// bot's final turn; toBeat is then the best other score.
const NONE = { lastTurn: false, toBeat: 0 };

// ---- keeps ----
function hardKeep(turn, score, rules) {
  const tab = valueTable(rules, score > 0);
  let best = null;
  let bv = -1;
  for (const o of keepOptions(turn.roll, rules)) {
    const v = tab.value(turn.roll.length - o.n, turn.pts + o.score);
    if (v > bv + 1e-9 || (Math.abs(v - bv) <= 1e-9 && o.n < best.n)) [best, bv] = [o, v];
  }
  return best;
}

function mediumKeep(turn, rules) {
  const options = keepOptions(turn.roll, rules);
  const all = options.find((o) => o.n === turn.roll.length);
  if (all) return all; // hot dice, or every die scores
  const top = options.reduce((a, o) => (o.score > a.score ? o : a));
  if (top.score >= 200) return top; // a triple or better
  // only singles: keep one (a 1 before a 5) and roll the rest
  return options.filter((o) => o.n === 1).reduce((a, o) => (o.score > a.score ? o : a));
}

function easyKeep(turn, rules) {
  const options = keepOptions(turn.roll, rules);
  return options.reduce((a, o) => (o.score > a.score || (o.score === a.score && o.n > a.n) ? o : a));
}

// ---- bank or roll ----
const MEDIUM_BANK = [0, 250, 300, 400, 500, 1000, Infinity]; // by dice left to roll

function wantsBank(level, turn, score, rules, sit) {
  if (sit.lastTurn) return score + turn.pts > sit.toBeat;
  if (level === 'hard') {
    const tab = valueTable(rules, score > 0);
    return turn.pts >= tab.roll(turn.left, turn.pts);
  }
  if (level === 'medium') return turn.pts >= MEDIUM_BANK[turn.left];
  // easy: a timid beginner, it banks 300 or more, or anything once four dice or fewer are left
  return turn.pts >= 300 || turn.left <= 4;
}

// ---- public ----
// Which dice of turn.roll to keep (a mask). The roll must not be a Farkle.
export function botKeep(level, turn, score, rules, sit = NONE) {
  const o = level === 'easy' ? easyKeep(turn, rules) : level === 'medium' ? mediumKeep(turn, rules) : hardKeep(turn, score, rules);
  return maskFor(turn.roll, o.counts);
}

// After a keep: true to bank (or end a turn that can't go on), false to roll the dice left.
export function botBank(level, turn, score, rules, sit = NONE) {
  if (!canRoll(turn)) return true;
  if (!canBank(turn, score, rules)) return false;
  return wantsBank(level, turn, score, rules, sit);
}

// Expected points of a fresh turn under Hard play (for the doc and tests).
export const turnValue = (rules, score = 1) => valueTable(rules, score > 0).roll(DICE, 0);
