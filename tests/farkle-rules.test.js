// Farkle rules: every scoring combination under every toggle, the farkle check, keeps, banking (entry minimum,
// hot dice), the final round and the save-shape check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../core/rng.js';
import { normRules, scoreDice, hasScore, keepOptions, kindScore, newGame, newTurn, roll, bank, endFarkle, canBank, keepScore, isHot, winners, validGame, lastRound } from '../games/farkle/rules.js';

const STD = normRules();
const DOUBLE = normRules({ kinds: 'double' });

test('normRules: defaults, settings strings, junk', () => {
  assert.deepEqual(STD, { target: 10000, threePairs: 1500, kinds: 'fixed', hotDice: 'may', entry: 0 });
  assert.deepEqual(normRules({ target: '5000', threePairs: 'off', kinds: 'double', hotDice: 'must', entry: '500' }), { target: 5000, threePairs: 0, kinds: 'double', hotDice: 'must', entry: 500 });
  assert.deepEqual(normRules({ target: 7, threePairs: 'x', kinds: 3, hotDice: null, entry: -1 }), STD);
  assert.deepEqual(normRules(null ?? undefined), STD);
});

test('singles: 1 is 100, 5 is 50, other faces alone score nothing', () => {
  assert.equal(scoreDice([1], STD), 100);
  assert.equal(scoreDice([5], STD), 50);
  assert.equal(scoreDice([1, 1], STD), 200);
  assert.equal(scoreDice([1, 5, 5], STD), 200);
  for (const f of [2, 3, 4, 6]) assert.equal(scoreDice([f], STD), 0);
  assert.equal(scoreDice([1, 2], STD), 0, 'every kept die must score');
  assert.equal(scoreDice([], STD), 0);
});

test('three of a kind: 1s 1000, others 100 x face', () => {
  assert.equal(scoreDice([1, 1, 1], STD), 1000);
  for (const f of [2, 3, 4, 5, 6]) assert.equal(scoreDice([f, f, f], STD), f * 100);
  assert.equal(scoreDice([3, 3, 3, 1, 5], STD), 450, 'the example on the cited page');
  assert.equal(scoreDice([2, 2, 2, 3, 3, 3], STD), 500, 'two triples add up');
});

test('four, five, six of a kind: fixed 1000 / 2000 / 3000', () => {
  assert.equal(scoreDice([2, 2, 2, 2], STD), 1000);
  assert.equal(scoreDice([6, 6, 6, 6, 6], STD), 2000);
  assert.equal(scoreDice([4, 4, 4, 4, 4, 4], STD), 3000);
  // 1s and 5s score their best reading: four 1s as three 1s plus a single (1100) beats 1000
  assert.equal(scoreDice([1, 1, 1, 1], STD), 1100);
  assert.equal(scoreDice([1, 1, 1, 1, 1], STD), 2000);
  assert.equal(scoreDice([5, 5, 5, 5], STD), 1000);
  assert.equal(scoreDice([2, 2, 2, 2, 5], STD), 1050);
});

test('four, five, six of a kind: doubling', () => {
  assert.deepEqual([3, 4, 5, 6].map((k) => kindScore(1, k, DOUBLE)), [1000, 2000, 4000, 8000], 'the cited example');
  assert.deepEqual([3, 4, 5, 6].map((k) => kindScore(2, k, DOUBLE)), [200, 400, 800, 1600]);
  assert.equal(scoreDice([3, 3, 3, 3], DOUBLE), 600);
  assert.equal(scoreDice([2, 2, 2, 2, 2, 2], DOUBLE), 1600);
  assert.equal(scoreDice([5, 5, 5, 5], DOUBLE), 1000);
});

test('run 1-6 is 2500 under every toggle', () => {
  for (const r of [STD, DOUBLE, normRules({ threePairs: 'off' })]) assert.equal(scoreDice([4, 2, 6, 1, 3, 5], r), 2500);
  assert.equal(scoreDice([1, 2, 3, 4, 5], STD), 0, 'a five-dice run is no combination');
  assert.equal(Math.max(...keepOptions([1, 2, 3, 4, 5], STD).map((o) => o.score)), 150, 'only its 1 and 5 score');
});

test('three pairs: 1500, 750 or off; needs three different pairs', () => {
  const dice = [2, 2, 3, 3, 4, 4];
  assert.equal(scoreDice(dice, STD), 1500);
  assert.equal(scoreDice(dice, normRules({ threePairs: '750' })), 750);
  assert.equal(scoreDice(dice, normRules({ threePairs: 'off' })), 0);
  assert.equal(scoreDice([1, 1, 5, 5, 6, 6], normRules({ threePairs: 'off' })), 0, 'a 6 pair cannot be kept without three pairs');
  assert.equal(scoreDice([1, 1, 5, 5, 6, 6], STD), 1500);
  assert.equal(scoreDice([1, 1, 5, 5, 3, 3], normRules({ threePairs: '750' })), 750, 'best reading: 750 beats 300');
  assert.equal(scoreDice([2, 2, 2, 2, 3, 3], STD), 0, 'four of a kind and a pair is not three pairs');
  assert.equal(scoreDice([1, 1, 1, 1, 5, 5], STD), 1200, 'nor here: 1100 + 100');
});

test('farkle check', () => {
  assert.equal(hasScore([2, 3, 4, 6, 6, 2], STD), false);
  assert.equal(hasScore([2, 3], STD), false);
  assert.equal(hasScore([5], STD), true);
  assert.equal(hasScore([4, 4, 4], STD), true);
  assert.equal(hasScore([2, 2, 3, 3, 4, 4], STD), true, 'three pairs score');
  assert.equal(hasScore([2, 2, 3, 3, 4, 4], normRules({ threePairs: 'off' })), false);
  // brute force: hasScore agrees with "some keep scores" for every roll of 1-6 dice
  for (const r of [STD, normRules({ threePairs: 'off' })]) {
    for (let n = 1; n <= 6; n++) {
      for (let x = 0; x < 6 ** n; x++) {
        const dice = Array.from({ length: n }, (_, i) => 1 + (Math.floor(x / 6 ** i) % 6));
        assert.equal(hasScore(dice, r), keepOptions(dice, r).length > 0, dice.join(''));
      }
    }
  }
});

function pickGame(dice, rules = STD, n = 2) {
  const g = newGame(n, rules);
  g.turn.dice = dice.slice();
  g.turn.phase = 'pick';
  return g;
}

test('a keep must be free dice that all score', () => {
  const g = pickGame([1, 5, 2, 3, 3, 3]);
  assert.equal(keepScore(g.turn, [0], STD), 100);
  assert.equal(keepScore(g.turn, [0, 1, 3, 4, 5], STD), 450);
  assert.equal(keepScore(g.turn, [0, 2], STD), 0);
  assert.equal(keepScore(g.turn, [0, 0], STD), 0, 'no die twice');
  assert.equal(keepScore(g.turn, [], STD), 0);
  assert.equal(keepScore(g.turn, [9], STD), 0);
  g.turn.aside[0] = true;
  assert.equal(keepScore(g.turn, [0], STD), 0, 'a die set aside earlier is not free');
});

test('combinations count only within one roll', () => {
  // two 5s set aside, then a third 5 rolled: 50, not part of a triple (the cited example)
  const rng = makeRng(1);
  const g = pickGame([5, 5, 2, 3, 4, 6]);
  roll(g, rng, [0, 1]);
  assert.equal(g.turn.pts, 100);
  g.turn.dice = [5, 5, 5, 2, 3, 4];
  g.turn.phase = 'pick';
  assert.equal(keepScore(g.turn, [2], STD), 50);
});

test('roll, keep, bank: points move from the turn to the score and play passes on', () => {
  const rng = makeRng(5);
  const g = pickGame([1, 1, 1, 2, 3, 4]);
  roll(g, rng, [0, 1, 2]);
  assert.equal(g.turn.pts, 1000);
  assert.deepEqual(g.turn.aside, [true, true, true, false, false, false]);
  assert.deepEqual(g.turn.dice.slice(0, 3), [1, 1, 1], 'set-aside dice stay put');
  g.turn.dice = [1, 1, 1, 5, 2, 2];
  g.turn.phase = 'pick';
  const r = bank(g, [3]);
  assert.deepEqual(r, { score: 50, banked: 1050 });
  assert.deepEqual(g.scores, [1050, 0]);
  assert.equal(g.cur, 1);
  assert.deepEqual(g.turn, newTurn());
  assert.deepEqual(g.turns, [1, 0]);
});

test('illegal moves throw', () => {
  const rng = makeRng(2);
  const g = newGame(2, STD);
  assert.throws(() => bank(g, [0]), /can't bank/);
  assert.throws(() => roll(g, rng, [0]), /can't roll/);
  assert.throws(() => endFarkle(g), /not a farkle/);
  const p = pickGame([1, 2, 3, 4, 6, 6]);
  assert.throws(() => roll(p, rng, []), /illegal keep/, 'must set something aside before rolling again');
  assert.throws(() => roll(p, rng, [1]), /illegal keep/);
  assert.throws(() => bank(p, [1]), /can't bank/);
});

test('a farkle loses the turn points', () => {
  const g = pickGame([1, 2, 3, 4, 6, 6]);
  g.turn.pts = 800;
  g.turn.phase = 'farkle';
  g.turn.dice = [2, 3, 4, 6, 6, 2];
  endFarkle(g);
  assert.deepEqual(g.scores, [0, 0]);
  assert.equal(g.cur, 1);
  // and roll() reports one: find a seed that farkles a single die
  const rng = makeRng(3);
  let farkled = false;
  for (let k = 0; k < 50 && !farkled; k++) {
    const h = pickGame([1, 1, 1, 1, 1, 2]);
    farkled = roll(h, rng, [0, 1, 2, 3, 4]).farkle;
    if (farkled) assert.equal(h.turn.phase, 'farkle');
  }
  assert.ok(farkled);
});

test('hot dice: scoring all six frees them; "must" forbids banking then', () => {
  const rng = makeRng(9);
  const g = pickGame([1, 1, 1, 5, 5, 5]);
  assert.ok(isHot(g.turn, [0, 1, 2, 3, 4, 5]));
  assert.ok(canBank(g, [0, 1, 2, 3, 4, 5]));
  const r = roll(g, rng, [0, 1, 2, 3, 4, 5]);
  assert.equal(r.hot, true);
  assert.equal(g.turn.pts, 1500);
  assert.deepEqual(g.turn.aside, new Array(6).fill(false), 'all six roll again');
  assert.ok(g.turn.dice.every((d) => d >= 1 && d <= 6));

  const m = pickGame([1, 1, 1, 5, 5, 5], normRules({ hotDice: 'must' }));
  assert.equal(canBank(m, [0, 1, 2, 3, 4, 5]), false);
  assert.equal(canBank(m, [0, 1, 2]), true, 'keeping fewer may still bank');
  assert.throws(() => bank(m, [0, 1, 2, 3, 4, 5]));
  // hot dice after earlier keeps: the last free dice scored
  const h = pickGame([1, 2, 2, 2, 3, 4]);
  h.turn.aside = [false, true, true, true, true, true];
  assert.ok(isHot(h.turn, [0]));
});

test('entry minimum: no bank under it until the first bank', () => {
  const rules = normRules({ entry: '500' });
  const g = pickGame([1, 5, 2, 3, 4, 6], rules);
  assert.equal(canBank(g, [0, 1]), false);
  g.turn.pts = 400;
  assert.equal(canBank(g, [0]), true);
  bank(g, [0]);
  assert.deepEqual(g.entered, [true, false]);
  g.cur = 0;
  g.turn = { ...newTurn(), dice: [5, 2, 3, 4, 6, 6], phase: 'pick' };
  assert.equal(canBank(g, [0]), true, 'entered players bank any amount');
  const k = pickGame([1, 1, 1, 5, 2, 3], normRules({ entry: '1000' }));
  assert.equal(canBank(k, [3]), false, '50 is under 1,000');
  assert.equal(canBank(k, [0, 1, 2]), true, 'three 1s make exactly 1,000');
});

test('final round: everyone else gets one more turn, then the top score wins', () => {
  const rules = normRules({ target: '2500' });
  const g = newGame(3, rules);
  g.scores = [2000, 2400, 100];
  g.turn = { ...newTurn(), dice: [1, 1, 1, 2, 3, 4], phase: 'pick' };
  bank(g, [0, 1, 2]);
  assert.equal(g.final, 0);
  assert.ok(lastRound(g));
  assert.equal(g.over, false);
  g.turn = { ...newTurn(), dice: [1, 1, 1, 2, 3, 4], phase: 'pick' };
  bank(g, [0, 1, 2]); // seat 1 overtakes: 3400; does not start another round
  assert.equal(g.final, 0);
  g.turn = { ...newTurn(), dice: [2, 3, 4, 6, 6, 2], phase: 'farkle' };
  endFarkle(g);
  assert.equal(g.over, true);
  assert.deepEqual(winners(g), [1]);
  assert.deepEqual(g.turns, [1, 1, 1]);
});

test('solo: reaching the target ends the game at once', () => {
  const g = newGame(1, normRules({ target: '2500' }));
  g.scores = [2000];
  g.turn = { ...newTurn(), dice: [5, 5, 5, 2, 3, 4], phase: 'pick' };
  bank(g, [0, 1, 2]);
  assert.equal(g.over, true);
  assert.deepEqual(g.turns, [1]);
});

test('validGame: a fresh game and mid-turn states pass; broken shapes fail', () => {
  const rng = makeRng(4);
  const g = newGame(2, STD);
  assert.ok(validGame(g, 2));
  roll(g, rng);
  assert.ok(validGame(JSON.parse(JSON.stringify(g)), 2));
  assert.equal(validGame(g, 3), false);
  for (const bad of [null, {}, { ...g, scores: 'x' }, { ...g, cur: 5 }, { ...g, turn: { ...g.turn, phase: 'zz' } }, { ...g, turn: { ...g.turn, dice: [9, 9, 9, 9, 9, 9] } }, { ...g, turn: null }]) {
    assert.equal(validGame(bad, 2), false);
  }
  // a 'pick' phase whose dice farkled can't be resumed
  assert.equal(validGame({ ...g, turn: { ...g.turn, dice: [2, 3, 4, 6, 6, 2], aside: new Array(6).fill(false), phase: 'pick' } }, 2), false);
});
