// Ludo bots: every level plays only legal moves to a finished game under every rule mix, and
// Hard really beats Easy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../core/rng.js';
import { newGame, normRules, applyRoll, applyMove, legalMoves, HOME } from '../games/ludo/rules.js';
import { botMove, LEVELS } from '../games/ludo/bot.js';

function play(levels, rules, rng) {
  const g = newGame(levels.length, rules);
  let rolls = 0;
  while (g.phase !== 'over') {
    assert.ok(++rolls < 8000, 'game does not end');
    const r = applyRoll(g, 1 + rng.int(6));
    if (r.kind !== 'move') continue;
    const m = botMove(levels[g.turn], g, rng, r.moves);
    assert.ok(legalMoves(g).some((x) => x.token === m.token && x.to === m.to));
    applyMove(g, m); // throws on an illegal move
  }
  assert.ok(g.tokens[g.winner].every((rel) => rel === HOME));
  assert.equal(g.places.length, levels.length, 'every seat is placed');
  return g.winner;
}

const MIXES = [{}, { exit: '16' }, { safe: 'off' }, { blockades: 'on' }, { exact: 'off' }, { captureBonus: 'on', homeBonus: 'on' }, { exit: '16', safe: 'off', blockades: 'on', exact: 'off' }].map(normRules);

test('bots play legal moves to a winner under every rule mix and seat count', () => {
  const rng = makeRng(17);
  for (const rules of MIXES) {
    play(LEVELS, rules, rng);
    play(['hard', 'easy'], rules, rng);
    play(['medium', 'hard', 'easy', 'hard'], rules, rng);
  }
});

test('Hard beats Easy most of the time', () => {
  const rng = makeRng(23);
  const N = 300;
  let wins = 0;
  for (let i = 0; i < N; i++) {
    const hardFirst = i % 2 === 0;
    const w = play(hardFirst ? ['hard', 'easy'] : ['easy', 'hard'], normRules(), rng);
    if (w === (hardFirst ? 0 : 1)) wins++;
  }
  assert.ok(wins / N > 0.8, `Hard won ${wins} of ${N}`); // ~92 % over 4000 games
});
