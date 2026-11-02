// Farkle bots: legal keeps and banks under every rule mix, the Hard table matches what Hard really scores, and
// Hard beats Easy in at least 70 % of 1000 seeded two-player games (docs/games/farkle.md records the numbers).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../core/rng.js';
import { normRules, newGame, roll, bank, endFarkle, winners, canBank, keepScore } from '../games/farkle/rules.js';
import { botMove, rollValue, LEVELS } from '../games/farkle/bot.js';

// Play a game of bots to the end. Every move is checked before it is made (bank()/roll() also throw on an
// illegal one).
export function playGame(levels, rules, seed) {
  const rng = makeRng(seed);
  const g = newGame(levels.length, rules);
  for (let steps = 0; !g.over; steps++) {
    assert.ok(steps < 100000, 'game did not end');
    if (g.turn.phase === 'roll') roll(g, rng);
    else if (g.turn.phase === 'farkle') endFarkle(g);
    else {
      const m = botMove(levels[g.cur], g, rng);
      assert.ok(keepScore(g.turn, m.keep, g.rules) > 0);
      if (m.bank) {
        assert.ok(canBank(g, m.keep));
        bank(g, m.keep);
      } else roll(g, rng, m.keep);
    }
  }
  return g;
}

const MIXES = [
  {},
  { threePairs: '750' },
  { threePairs: 'off' },
  { kinds: 'double' },
  { hotDice: 'must' },
  { entry: '500' },
  { entry: '1000', hotDice: 'must', kinds: 'double', threePairs: 'off' },
  { target: '2500' },
].map(normRules);

test('bots make only legal moves and finish games under every rule mix', () => {
  let seed = 1;
  for (const rules of MIXES) {
    for (const level of LEVELS) playGame([level, level], rules, seed++);
    playGame(['easy', 'medium', 'hard'], rules, seed++);
    playGame(['hard'], rules, seed++);
  }
});

test('the last round: a bot behind the leader keeps rolling, one ahead banks', () => {
  const rules = normRules({ target: '2500' });
  for (const level of LEVELS) {
    const g = newGame(2, rules);
    g.scores = [3000, 0];
    g.entered = [true, true];
    g.final = 0;
    g.cur = 1;
    g.turn = { dice: [1, 1, 1, 2, 3, 4], aside: new Array(6).fill(false), pts: 1500, phase: 'pick' };
    assert.equal(botMove(level, g, makeRng(1)).bank, false, `${level} banked 2500 behind 3000`);
    g.turn.pts = 2500;
    assert.equal(botMove(level, g, makeRng(1)).bank, true, `${level} did not bank a winning 3500`);
  }
});

test('Hard: the computed expected turn score matches play', () => {
  // Hard's own value for a turn from scratch vs the mean of 20000 played turns (within 4 standard errors)
  for (const rules of [normRules(), normRules({ hotDice: 'must', threePairs: 'off' })]) {
    const rng = makeRng(77);
    const want = rollValue(rules, 0, 0, 6);
    const N = 20000;
    let sum = 0;
    let sq = 0;
    for (let k = 0; k < N; k++) {
      const g = newGame(2, rules);
      g.entered = [true, true];
      let r = roll(g, rng);
      let got = 0;
      while (!r.farkle) {
        const m = botMove('hard', g, rng);
        if (m.bank) {
          got = bank(g, m.keep).banked;
          break;
        }
        r = roll(g, rng, m.keep);
      }
      sum += got;
      sq += got * got;
    }
    const mean = sum / N;
    const se = Math.sqrt((sq / N - mean * mean) / N);
    assert.ok(Math.abs(mean - want) < 4 * se, `played ${mean.toFixed(1)} ± ${se.toFixed(1)}, table ${want.toFixed(1)}`);
  }
});

// Win share of `a` against `b` over n games from seed s, seats swapped every game; a tie counts half.
export function winShare(a, b, n, rules = normRules(), s = 1000) {
  let w = 0;
  for (let i = 0; i < n; i++) {
    const flip = i % 2;
    const g = playGame(flip ? [b, a] : [a, b], rules, s + i);
    const top = winners(g);
    if (top.length > 1) w += 0.5;
    else if (top[0] === flip) w++;
  }
  return w / n;
}

test('Hard beats Easy in at least 70 % of 1000 seeded games', () => {
  const share = winShare('hard', 'easy', 1000);
  assert.ok(share >= 0.7, `Hard won ${share}`);
});
