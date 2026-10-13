// Yacht bots: every hold and box is legal under every rule mix (Joker cases included), games
// run to a full card, and Hard really is stronger than Easy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../core/rng.js';
import { rollDice, reroll } from '../core/dice.js';
import { newCard, normRules, applyScore, legalBoxes, totals, turnsPerGame, cardFull, CATS, YACHT } from '../games/yacht/rules.js';
import { botHold, botBox, LEVELS } from '../games/yacht/bot.js';

function playGame(level, rules, rng) {
  const card = newCard(rules);
  for (let t = 0; t < turnsPerGame(rules); t++) {
    let dice = rollDice(rng, 5);
    for (let left = 2; left > 0; left--) {
      const held = botHold(level, dice, left, card, rules, rng);
      assert.equal(held.length, 5);
      assert.ok(held.every((h) => typeof h === 'boolean'));
      if (held.every(Boolean)) break;
      const before = dice;
      dice = reroll(rng, dice, held);
      held.forEach((h, i) => h && assert.equal(dice[i], before[i]));
    }
    const b = botBox(level, dice, card, rules, rng);
    applyScore(card, b.col, b.cat, dice, rules); // throws on an illegal box
  }
  assert.ok(cardFull(card));
  return totals(card, rules).total;
}

const MIXES = [{}, { joker: 'free' }, { bonus: 'off' }, { variant: 'triple' }, { variant: 'triple', joker: 'free' }].map(normRules);

test('bots play only legal holds and boxes, to a full card, under every rule mix', () => {
  const rng = makeRng(7);
  for (const rules of MIXES) for (const level of LEVELS) playGame(level, rules, rng);
});

test('bots respect the forced Joker and pick a box from the legal list in Joker spots', () => {
  const rng = makeRng(3);
  const dice = [6, 6, 6, 6, 6];
  for (const joker of ['forced', 'free']) {
    const rules = normRules({ joker });
    for (const fill of [[YACHT], [YACHT, 5], [YACHT, 5, 6, 7, 8, 9, 10, 12]]) {
      const card = newCard(rules);
      for (const c of fill) card.cols[0][c] = c === YACHT ? 50 : 0;
      const legal = legalBoxes(card, dice, rules).map((b) => CATS[b.cat]);
      for (const level of LEVELS) {
        const b = botBox(level, dice, card, rules, rng);
        assert.ok(legal.includes(CATS[b.cat]), `${level} ${joker} chose ${CATS[b.cat]}`);
      }
    }
  }
});

test('Hard outscores Easy on average', () => {
  const rules = normRules();
  const avg = (level) => {
    const rng = makeRng(11);
    let s = 0;
    for (let g = 0; g < 40; g++) s += playGame(level, rules, rng);
    return s / 40;
  };
  const easy = avg('easy');
  const hard = avg('hard');
  assert.ok(hard > easy + 30, `hard ${hard} vs easy ${easy}`);
});
