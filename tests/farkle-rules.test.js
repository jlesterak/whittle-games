// Farkle rules: every scoring combination and house toggle, keeps that don't score, Farkle detection, the
// turn (hot dice, the entry minimum, dice spent) and the end of the game. See docs/games/farkle.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normRules, scoreKeep, keepOptions, isFarkle, newTurn, keep, canRoll, canBank, stuck, bankMin, reached, gameOver, kindScore } from '../games/farkle/rules.js';

const base = normRules();
const dbl = normRules({ fourKind: 'double' });
const noPairs = normRules({ threePairs: 'off' });

test('defaults and toggles normalise', () => {
  assert.deepEqual(base, { target: 10000, threePairs: true, fourKind: 'flat', hotDice: true, entry: 0 });
  assert.deepEqual(normRules({ target: '5000', threePairs: 'off', fourKind: 'double', hotDice: 'off', entry: '500' }), {
    target: 5000,
    threePairs: false,
    fourKind: 'double',
    hotDice: false,
    entry: 500,
  });
  assert.deepEqual(normRules({ target: 7, entry: 300, fourKind: 'x', threePairs: 'on' }), base);
  assert.equal(normRules({ entry: 1000 }).entry, 1000);
});

test('singles and three of a kind', () => {
  assert.equal(scoreKeep([1], base), 100);
  assert.equal(scoreKeep([5], base), 50);
  assert.equal(scoreKeep([1, 5], base), 150);
  assert.equal(scoreKeep([1, 1], base), 200);
  assert.equal(scoreKeep([1, 1, 1], base), 1000);
  for (const f of [2, 3, 4, 5, 6]) assert.equal(scoreKeep([f, f, f], base), f * 100, `three ${f}s`);
  assert.equal(scoreKeep([5, 5, 5, 1], base), 600);
  assert.equal(scoreKeep([2, 2, 2, 5, 5], base), 300);
  assert.equal(scoreKeep([3, 3, 3, 4, 4, 4], base), 700, 'two triples score as two triples');
});

test('dice that do not score make the whole keep score nothing', () => {
  for (const d of [[], [2], [3, 4], [1, 2], [5, 5, 6], [2, 2], [1, 1, 1, 2], [2, 3, 4, 5, 6], [2, 2, 3, 3, 4]]) assert.equal(scoreKeep(d, base), 0, `${d}`);
});

test('four, five and six of a kind: flat (base table) and doubling', () => {
  assert.equal(scoreKeep([2, 2, 2, 2], base), 1000);
  assert.equal(scoreKeep([6, 6, 6, 6, 6], base), 2000);
  assert.equal(scoreKeep([3, 3, 3, 3, 3, 3], base), 3000);
  // four 1s: 1000 flat, but three 1s and a single 1 is better, and the best split counts
  assert.equal(scoreKeep([1, 1, 1, 1], base), 1100);
  assert.equal(scoreKeep([1, 1, 1, 1, 1, 1], base), 3000);
  assert.equal(scoreKeep([5, 5, 5, 5], base), 1000);
  assert.equal(scoreKeep([2, 2, 2, 2], dbl), 400);
  assert.equal(scoreKeep([2, 2, 2, 2, 2], dbl), 800);
  assert.equal(scoreKeep([2, 2, 2, 2, 2, 2], dbl), 1600);
  assert.equal(scoreKeep([1, 1, 1, 1], dbl), 2000);
  assert.equal(scoreKeep([1, 1, 1, 1, 1, 1], dbl), 8000);
  assert.equal(scoreKeep([6, 6, 6, 6, 1], dbl), 1300);
  assert.equal(kindScore(4, 3, dbl), 400);
});

test('the run and three pairs, and three pairs off', () => {
  assert.equal(scoreKeep([3, 1, 4, 6, 5, 2], base), 2500);
  assert.equal(scoreKeep([2, 2, 3, 3, 6, 6], base), 1500);
  assert.equal(scoreKeep([1, 1, 5, 5, 3, 3], base), 1500);
  assert.equal(scoreKeep([1, 1, 5, 5, 3, 3], noPairs), 0, 'without three pairs the 3s do not score');
  assert.equal(scoreKeep([2, 2, 3, 3, 6, 6], noPairs), 0);
  assert.equal(scoreKeep([1, 1, 5, 5], noPairs), 300);
  assert.equal(scoreKeep([2, 2, 2, 2, 3, 3], base), 0, 'four and a pair is not three pairs');
  assert.equal(scoreKeep([1, 1, 1, 1, 5, 5], base), 1200, 'nor here: 1000 + 100 + 50 + 50');
  assert.equal(scoreKeep([1, 1, 1, 1, 5, 5], dbl), 2100);
  assert.equal(scoreKeep([3, 1, 4, 6, 5, 2], noPairs), 2500, 'the run is not a toggle');
});

test('keep options list every scoring sub-keep; a roll with none is a Farkle', () => {
  const opts = keepOptions([1, 5, 2, 3, 4, 6], base);
  const byScore = opts.map((o) => `${o.n}:${o.score}`).sort();
  assert.deepEqual(byScore, ['1:100', '1:50', '2:150', '6:2500'].sort());
  assert.deepEqual(keepOptions([2, 2, 2, 3], base).map((o) => o.score), [200]);
  for (const r of [[2], [3, 4], [2, 3, 4, 6], [2, 2, 3, 3, 4, 6], [6, 6, 4, 4, 3, 2]]) assert.ok(isFarkle(r, base), `${r}`);
  assert.ok(isFarkle([2, 2, 3, 3, 6, 6], noPairs));
  assert.ok(!isFarkle([2, 2, 3, 3, 6, 6], base));
  for (const r of [[1], [5, 2], [4, 4, 4], [2, 3, 4, 6, 6, 6]]) assert.ok(!isFarkle(r, base), `${r}`);
});

test('a turn: keeps add up, dice run out, hot dice give six back', () => {
  const t = newTurn();
  t.roll = [1, 2, 3, 4, 6, 6];
  keep(t, [true, false, false, false, false, false], base);
  assert.equal(t.pts, 100);
  assert.equal(t.left, 5);
  assert.deepEqual(t.roll, [2, 3, 4, 6, 6]);
  assert.throws(() => keep(t, [true, false, false, false, false], base), /scores nothing/);
  t.roll = [5, 5, 5, 1, 1];
  keep(t, [true, true, true, true, true], base);
  assert.equal(t.pts, 800);
  assert.equal(t.left, 6, 'hot dice');
  assert.equal(t.hot, 1);
  assert.ok(canRoll(t));
  assert.equal(t.kept.length, 2);

  const off = normRules({ hotDice: 'off' });
  const u = newTurn();
  u.roll = [1, 1, 1, 5, 5, 5];
  keep(u, u.roll.map(() => true), off);
  assert.equal(u.left, 0);
  assert.ok(!canRoll(u));
  assert.ok(canBank(u, 0, off));
});

test('the entry minimum holds a player off the board until one bank reaches it', () => {
  const r = normRules({ entry: 500 });
  assert.equal(bankMin(0, r), 500);
  assert.equal(bankMin(450, r), 1);
  assert.equal(bankMin(0, base), 1);
  assert.equal(bankMin(0, normRules({ entry: 1000 })), 1000);
  const t = { ...newTurn(), pts: 450, left: 2 };
  assert.ok(!canBank(t, 0, r));
  assert.ok(canBank(t, 0, base));
  assert.ok(canBank(t, 600, r));
  assert.ok(canBank({ ...t, pts: 500 }, 0, r));
  assert.ok(!canBank({ ...t, pts: 0 }, 600, r));
  // dice spent with hot dice off while under the minimum: the turn is lost
  const off = normRules({ entry: 1000, hotDice: 'off' });
  assert.ok(stuck({ ...t, left: 0, pts: 700 }, 0, off));
  assert.ok(!stuck({ ...t, left: 0, pts: 700 }, 50, off));
  assert.ok(!stuck({ ...t, left: 1, pts: 700 }, 0, off));
});

test('the end: reaching the target gives everyone else one last turn', () => {
  assert.ok(reached(10000, base));
  assert.ok(!reached(9950, base));
  assert.ok(reached(5000, normRules({ target: 5000 })));
  assert.ok(!gameOver(-1, 0, 3));
  assert.ok(!gameOver(1, 2, 3));
  assert.ok(!gameOver(1, 0, 3));
  assert.ok(gameOver(1, 1, 3));
  assert.ok(gameOver(0, 0, 1), 'solo ends when the target is reached');
});
