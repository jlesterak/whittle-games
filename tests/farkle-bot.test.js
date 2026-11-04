// Farkle bots: only legal keeps and banks under every rule mix, Hard's computed turn value, and Hard beats
// Easy in at least 70% of 1000 seeded games (docs/games/farkle.md records the number).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../core/rng.js';
import { rollDice } from '../core/dice.js';
import { normRules, newTurn, keep, isFarkle, scoreKeep, canRoll, canBank, stuck, reached, gameOver } from '../games/farkle/rules.js';
import { botKeep, botBank, turnValue, LEVELS } from '../games/farkle/bot.js';

// One turn, checking every choice is legal. Returns the points banked.
function playTurn(level, score, rules, rng, sit) {
  const turn = newTurn();
  for (;;) {
    turn.roll = rollDice(rng, turn.left);
    if (isFarkle(turn.roll, rules)) return 0;
    const mask = botKeep(level, turn, score, rules, sit);
    assert.equal(mask.length, turn.roll.length);
    assert.ok(scoreKeep(turn.roll.filter((_, i) => mask[i]), rules) > 0, `${level} kept dice that do not score`);
    keep(turn, mask, rules);
    if (stuck(turn, score, rules)) return 0;
    const bank = botBank(level, turn, score, rules, sit);
    if (bank) {
      assert.ok(canBank(turn, score, rules), `${level} banked ${turn.pts} under the minimum`);
      return turn.pts;
    }
    assert.ok(canRoll(turn), `${level} rolled with no dice left`);
  }
}

function playGame(levels, rules, rng) {
  const sc = levels.map(() => 0);
  let cur = 0;
  let finalFrom = -1;
  for (let k = 0; ; k++) {
    assert.ok(k < 5000, 'game never ended');
    const sit = { lastTurn: finalFrom >= 0, toBeat: Math.max(...sc.filter((_, i) => i !== cur)) };
    sc[cur] += playTurn(levels[cur], sc[cur], rules, rng, sit);
    if (finalFrom < 0 && reached(sc[cur], rules)) finalFrom = cur;
    const next = (cur + 1) % levels.length;
    if (gameOver(finalFrom, next, levels.length)) return sc;
    cur = next;
  }
}

const MIXES = [
  {},
  { target: 5000 },
  { threePairs: 'off' },
  { fourKind: 'double' },
  { hotDice: 'off' },
  { entry: 500 },
  { entry: 1000, hotDice: 'off', threePairs: 'off', fourKind: 'double' },
].map(normRules);

test('bots make only legal keeps and banks under every rule mix', () => {
  const rng = makeRng(7);
  for (const rules of MIXES) for (let g = 0; g < 6; g++) playGame([...LEVELS, LEVELS[g % 3]], rules, rng);
});

test('Hard: a fresh turn is worth about 600 points, less with hot dice off or behind an entry minimum', () => {
  const v = turnValue(normRules());
  assert.ok(v > 590 && v < 610, `${v}`);
  assert.ok(turnValue(normRules({ hotDice: 'off' })) < v);
  assert.ok(turnValue(normRules({ entry: 1000 }), 0) < v);
});

test('on the last turn every bot plays on until it leads', () => {
  const rules = normRules();
  const turn = { ...newTurn(), pts: 1500, left: 2, roll: [] };
  for (const level of LEVELS) {
    assert.equal(botBank(level, turn, 8000, rules, { lastTurn: true, toBeat: 10200 }), false);
    assert.equal(botBank(level, turn, 9000, rules, { lastTurn: true, toBeat: 10200 }), true);
  }
});

test('Hard beats Easy in at least 70% of 1000 seeded games', () => {
  const rules = normRules();
  const rng = makeRng(2026);
  let wins = 0;
  for (let g = 0; g < 1000; g++) {
    const hardFirst = g % 2 === 0;
    const sc = playGame(hardFirst ? ['hard', 'easy'] : ['easy', 'hard'], rules, rng);
    const [h, e] = hardFirst ? sc : [sc[1], sc[0]];
    if (h > e) wins++;
  }
  assert.ok(wins >= 700, `Hard won ${wins} of 1000`);
});
