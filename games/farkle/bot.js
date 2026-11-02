// Farkle bots. botMove(level, g, rng) -> { keep: [die positions], bank } for a turn in phase 'pick'.
// Every level keeps a legal scoring set and only banks when canBank() allows it. In the last round (someone
// has reached the target) every level keeps rolling until it is ahead, then banks.
//
// Easy: a greedy beginner: keeps every die that scores and pushes for a big turn (banks at 800, 1000 or 1200,
// picked at random each time). Measured: a timid Easy (bank at 200-400) lost to Hard only 59-66 % of the time.
// Medium: rules of thumb: a die left to roll is worth about 150, bank at a threshold that rises with the dice left.
// Hard: maximises the expected points of the turn, computed exactly. V(t, n) is the expected final turn score
// with t points set aside and n dice to roll, played perfectly: max(bank t, roll), where roll averages over every
// roll of n dice (by multinomial probability) the best keep. Scores move in steps of 50 and every keep scores,
// so t only grows and the table fills from the top down. Above CAP points it banks (no turn gets near it in
// practice). The table depends on the rules and on whether the entry minimum is still to meet.
import { DICE, keepOptions, keepIndices, keepScore, canBank, free, rolledDice, scoreCounts, lastRound } from './rules.js';

export const LEVELS = ['easy', 'medium', 'hard'];
const STEP = 50;
const CAP = 20000;

// ---- Hard: the value table ----

const fact = [1, 1, 2, 6, 24, 120, 720];

// Every roll of n dice as counts, with its probability and the best score keepable with u dice (u = 1..n).
function outcomes(n, rules) {
  const out = [];
  const c = new Array(7).fill(0);
  (function walk(f, left) {
    if (f === 6) {
      c[6] = left;
      const p = fact[n] / c.slice(1).reduce((a, k) => a * fact[k], 1) / 6 ** n;
      const best = new Array(n + 1).fill(0);
      const sub = new Array(7).fill(0);
      (function pick(g) {
        if (g > 6) {
          const u = sub.reduce((a, b) => a + b, 0);
          const s = u ? scoreCounts(sub, rules) : 0;
          if (s > best[u]) best[u] = s;
          return;
        }
        for (let k = 0; k <= c[g]; k++) {
          sub[g] = k;
          pick(g + 1);
        }
        sub[g] = 0;
      })(1);
      if (best.some(Boolean)) out.push({ p, best }); // a farkle adds 0
      return;
    }
    for (let k = 0; k <= left; k++) {
      c[f] = k;
      walk(f + 1, left - k);
    }
  })(1, n);
  return out;
}

const cache = new Map();

// { V, R } for these rules and minimum bank m: flat arrays indexed [t / STEP * 7 + n].
export function valueTable(rules, m = 0) {
  const key = JSON.stringify([rules.threePairs, rules.kinds, rules.hotDice, m]);
  if (cache.has(key)) return cache.get(key);
  const T = CAP / STEP;
  const V = new Float64Array((T + 1) * 7);
  const R = new Float64Array((T + 1) * 7);
  const outs = [null, 1, 2, 3, 4, 5, 6].map((n) => n && outcomes(n, rules));
  // value of ending a keep at t2 steps with n2 dice left (0 = hot dice: six again)
  const after = (t2, n2) => {
    if (t2 > T) return t2 * STEP;
    if (n2 === 0) return rules.hotDice === 'must' ? R[t2 * 7 + 6] : V[t2 * 7 + 6];
    return V[t2 * 7 + n2];
  };
  for (let t = T; t >= 0; t--) {
    for (let n = 1; n <= DICE; n++) {
      let r = 0;
      for (const o of outs[n]) {
        let best = 0;
        for (let u = 1; u <= n; u++) if (o.best[u]) best = Math.max(best, after(t + o.best[u] / STEP, n - u));
        r += o.p * best;
      }
      R[t * 7 + n] = r;
      V[t * 7 + n] = t * STEP >= m ? Math.max(t * STEP, r) : r;
    }
  }
  const table = { V, R };
  cache.set(key, table);
  return table;
}

// Expected turn score of rolling n dice with t points set aside (t a multiple of 50).
export function rollValue(rules, m, t, n) {
  if (t > CAP) return t;
  return valueTable(rules, m).R[(t / STEP) * 7 + n];
}

// ---- moves ----

// The keep options for this roll as { keep, score, left } (left = dice to roll next; 6 after hot dice).
function options(g) {
  const t = g.turn;
  const n = free(t).length;
  return keepOptions(rolledDice(t), g.rules).map((o) => ({ keep: keepIndices(t, o.c), score: o.score, left: n - o.n || DICE }));
}

const MEDIUM_BANK = [Infinity, 300, 300, 400, 600, 1500, Infinity]; // by dice left to roll

export function botMove(level, g, rng) {
  if (g.turn.phase !== 'pick') throw new Error('bot moves only after a roll');
  const opts = options(g);
  const t = g.turn.pts;
  let choice;
  let bank;
  if (level === 'hard') {
    const m = g.entered[g.cur] ? 0 : g.rules.entry;
    let best = -1;
    for (const o of opts) {
      const t2 = t + o.score;
      const roll = rollValue(g.rules, m, t2, o.left);
      const bankable = canBank(g, o.keep);
      for (const [v, b] of [[roll, false], bankable ? [t2, true] : null].filter(Boolean)) {
        // ties: bank (a sure thing), then fewer dice kept
        if (v > best + 1e-9 || (Math.abs(v - best) <= 1e-9 && b && !bank)) {
          best = v;
          choice = o;
          bank = b;
        }
      }
    }
  } else if (level === 'medium') {
    choice = maxBy(opts, (o) => o.score + 150 * o.left);
    bank = t + choice.score >= MEDIUM_BANK[choice.left];
  } else {
    choice = maxBy(opts, (o) => o.score * 10 + (DICE - o.left)); // everything that scores
    bank = choice.left < DICE && t + choice.score >= 800 + 200 * rng.int(3);
  }
  if (lastRound(g)) {
    // last turn: only a lead is worth banking
    const others = Math.max(...g.scores.filter((_, i) => i !== g.cur));
    const lead = (o) => g.scores[g.cur] + t + o.score > others;
    const winning = opts.filter((o) => lead(o) && canBank(g, o.keep));
    if (winning.length) return { keep: maxBy(winning, (o) => o.score).keep, bank: true };
    bank = false;
  }
  if (bank && !canBank(g, choice.keep)) bank = false;
  if (!keepScore(g.turn, choice.keep, g.rules)) throw new Error('bot chose an illegal keep');
  return { keep: choice.keep, bank };
}

function maxBy(list, f) {
  let best = list[0];
  for (const x of list) if (f(x) > f(best)) best = x;
  return best;
}
