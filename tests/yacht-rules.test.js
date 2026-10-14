// Yacht rules: every box's scoring, the Joker cases (forced and free), the upper and Yacht
// bonuses, and the Triple card. See docs/games/yacht.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATS, rawScore, legalBoxes, applyScore, boxScore, totals, newCard, normRules, cardFull,
  ONES, SIXES, THREE, FOUR, FULL, SMALL, LARGE, YACHT, CHANCE,
} from '../games/yacht/rules.js';

const classic = normRules();
const cat = (name) => CATS.indexOf(name);
const legal = (card, dice, rules = classic) => legalBoxes(card, dice, rules).map((b) => `${b.col}:${CATS[b.cat]}`);
// A classic card with the named boxes filled (value 0 unless given).
function cardWith(fill, rules = classic) {
  const c = newCard(rules);
  for (const [name, v = 0, col = 0] of fill) c.cols[col][cat(name)] = v;
  return c;
}

test('every box scores the plain dice correctly', () => {
  const cases = [
    // dice, [ones..sixes], three, four, full, small, large, yacht, chance
    [[1, 1, 2, 3, 1], [3, 2, 3, 0, 0, 0], 8, 0, 0, 0, 0, 0, 8],
    [[3, 3, 3, 5, 5], [0, 0, 9, 0, 10, 0], 19, 0, 25, 0, 0, 0, 19],
    [[4, 4, 4, 4, 2], [0, 2, 0, 16, 0, 0], 18, 18, 0, 0, 0, 0, 18],
    [[1, 2, 3, 4, 6], [1, 2, 3, 4, 0, 6], 0, 0, 0, 30, 0, 0, 16],
    [[3, 4, 2, 5, 3], [0, 2, 6, 4, 5, 0], 0, 0, 0, 30, 0, 0, 17], // straight with a pair
    [[6, 5, 4, 3, 2], [0, 2, 3, 4, 5, 6], 0, 0, 0, 30, 40, 0, 20],
    [[1, 2, 3, 5, 6], [1, 2, 3, 0, 5, 6], 0, 0, 0, 0, 0, 0, 17], // gap: no straight
    [[6, 6, 6, 6, 6], [0, 0, 0, 0, 0, 30], 30, 30, 0, 0, 0, 50, 30], // five alike is not a full house
  ];
  for (const [dice, upper, ...lower] of cases) {
    const got = CATS.map((_, c) => rawScore(c, dice));
    assert.deepEqual(got, [...upper, ...lower], `dice ${dice}`);
  }
});

test('Yacht with the YACHT box open: ordinary dice, every open box legal', () => {
  const c = cardWith([['fives', 15]]);
  const dice = [5, 5, 5, 5, 5];
  assert.equal(legal(c, dice).length, 12);
  assert.equal(boxScore(c, 0, FULL, dice), 0);
  assert.deepEqual(applyScore(c, 0, YACHT, dice, classic), { score: 50, bonus: 0 });
});

test('forced Joker: matching upper box first, then any lower box at full value, then a 0 upstairs', () => {
  const dice = [4, 4, 4, 4, 4];
  // 1. Fours open: only Fours, and the bonus applies there too
  let c = cardWith([['yacht', 50]]);
  assert.deepEqual(legal(c, dice), ['0:fours']);
  assert.deepEqual(applyScore(c, 0, cat('fours'), dice, classic), { score: 20, bonus: 100 });
  // 2. Fours filled: any open lower box; FH/SS/LS score 25/30/40, the rest the dice total
  c = cardWith([['yacht', 50], ['fours', 12], ['chance', 20]]);
  assert.deepEqual(legal(c, dice), ['0:three', '0:four', '0:full', '0:small', '0:large']);
  assert.deepEqual([THREE, FOUR, FULL, SMALL, LARGE].map((k) => boxScore(c, 0, k, dice)), [20, 20, 25, 30, 40]);
  assert.deepEqual(applyScore(c, 0, LARGE, dice, classic), { score: 40, bonus: 100 });
  assert.equal(c.ybonus, 1);
  assert.throws(() => applyScore(c, 0, ONES, dice, classic), /illegal/);
  // 3. Fours and every lower box filled: a 0 in any open upper box
  c = cardWith([['fours', 8], ...['three', 'four', 'full', 'small', 'large', 'yacht', 'chance'].map((n) => [n, n === 'yacht' ? 50 : 10])]);
  assert.deepEqual(legal(c, dice), ['0:ones', '0:twos', '0:threes', '0:fives', '0:sixes']);
  assert.deepEqual(applyScore(c, 0, SIXES, dice, classic), { score: 0, bonus: 100 });
});

test('a 0 in the YACHT box: Joker still applies, no bonus; bonus off; free Joker', () => {
  const dice = [2, 2, 2, 2, 2];
  let c = cardWith([['yacht', 0], ['twos', 6]]);
  assert.deepEqual(applyScore(c, 0, FULL, dice, classic), { score: 25, bonus: 0 });

  const noBonus = normRules({ bonus: 'off' });
  c = cardWith([['yacht', 50], ['twos', 6]]);
  assert.deepEqual(applyScore(c, 0, SMALL, dice, noBonus), { score: 30, bonus: 0 });

  const free = normRules({ joker: 'free' });
  c = cardWith([['yacht', 50]]); // Twos open, yet any box is legal under the free Joker
  assert.equal(legal(c, dice, free).length, 12);
  assert.equal(boxScore(c, 0, ONES, dice), 0);
  assert.deepEqual(applyScore(c, 0, LARGE, dice, free), { score: 40, bonus: 100 });
});

test('upper bonus at 63, Yacht bonuses, totals, full card', () => {
  const c = cardWith([['ones', 3], ['twos', 6], ['threes', 9], ['fours', 12], ['fives', 15], ['sixes', 17]]);
  assert.equal(totals(c, classic).cols[0].bonus, 0); // 62
  c.cols[0][SIXES] = 18; // 63
  for (const k of [THREE, FOUR, FULL, SMALL, LARGE, YACHT, CHANCE]) c.cols[0][k] = 10;
  c.ybonus = 2;
  assert.deepEqual(totals(c, classic), { cols: [{ upper: 63, bonus: 35, lower: 70, total: 168 }], ybonus: 200, total: 368 });
  assert.ok(cardFull(c));
});

test('Triple card: Joker per column, bonus from any 50, columns multiplied', () => {
  const triple = normRules({ variant: 'triple' });
  const c = newCard(triple);
  assert.equal(c.cols.length, 3);
  const dice = [3, 3, 3, 3, 3];
  c.cols[1][YACHT] = 50;
  c.cols[1][cat('threes')] = 9;
  const l = legal(c, dice, triple);
  // columns 0 and 2 have open YACHT boxes (ordinary dice); column 1 is a forced Joker -> its lower boxes
  assert.equal(l.filter((b) => b.startsWith('0:')).length, 13);
  assert.deepEqual(l.filter((b) => b.startsWith('1:')), ['1:three', '1:four', '1:full', '1:small', '1:large', '1:chance']);
  assert.deepEqual(applyScore(c, 2, YACHT, dice, triple), { score: 50, bonus: 0 }); // into a YACHT box: no bonus
  assert.deepEqual(applyScore(c, 0, FULL, dice, triple), { score: 0, bonus: 100 }); // column 0's YACHT is open: FH = 0
  const t = totals(c, triple);
  assert.deepEqual(t.cols.map((x) => x.total), [0, 9 * 2 + 50 * 2, 50 * 3]);
  assert.equal(t.total, 0 + 118 + 150 + 100);
});
