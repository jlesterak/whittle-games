// Ludo powerups (docs/games/ludo.md 2.1): placement, each effect, no chaining, saves, bots.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../core/rng.js';
import { newGame, normRules, applyRoll, applyMove, legalMoves, loadGame, YARD } from '../games/ludo/rules.js';
import { placePowerups, eligible, KINDS } from '../games/ludo/powerups.js';
import { botMove } from '../games/ludo/bot.js';

// Red (seat 0, corner 0) has a token at rel 12 and plays a 5 onto abs 17; yellow (seat 1, corner 2) is
// the opponent. `pu` are the powerup squares; `yellow` is yellow's tokens (relative positions).
function setup(kind, { pu = [], yellow = [YARD, YARD, YARD, YARD], red = [12, YARD, YARD, YARD], rules = {} } = {}) {
  const g = newGame(2, normRules({ powerups: 'on', ...rules }), null, 7);
  g.pu = [{ sq: 17, kind }, ...pu];
  g.tokens = [red, yellow];
  applyRoll(g, 5);
  return g;
}
const play = (g) => applyMove(g, legalMoves(g).find((m) => m.token === 0));
const yel = (abs) => (abs - 26 + 52) % 52;

test('placement: 8-10 legal, spread-out track squares, the same for a seed', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const pu = placePowerups(seed);
    assert.ok(pu.length >= 8 && pu.length <= 10, `${pu.length} squares`);
    assert.equal(new Set(pu.map((p) => p.sq)).size, pu.length);
    for (const p of pu) {
      assert.ok(eligible(p.sq) && p.sq % 13 !== 0 && p.sq % 13 !== 8 && p.sq % 13 > 3, `square ${p.sq}`);
      assert.ok(p.kind in KINDS);
    }
  }
  assert.deepEqual(placePowerups(5), placePowerups(5));
  assert.equal(newGame(2, normRules()).pu.length, 0, 'off by default');
  assert.equal(newGame(2, normRules({ powerups: 'on' }), null, 3).pu.length, placePowerups(3).length);
});

test('back to start and back to where it was', () => {
  let g = setup('start');
  assert.equal(play(g).power.kind, 'start');
  assert.equal(g.tokens[0][0], YARD);
  g = setup('back');
  play(g);
  assert.equal(g.tokens[0][0], 12);
});

test('jumps: +3, +6, stopping at the column entry, capturing what they land on', () => {
  let g = setup('jump3');
  play(g);
  assert.equal(g.tokens[0][0], 20);
  g = setup('jump6');
  play(g);
  assert.equal(g.tokens[0][0], 23);
  g = newGame(2, normRules({ powerups: 'on' }), null, 7);
  g.pu = [{ sq: (46 + 2) % 52, kind: 'jump6' }];
  g.tokens = [[46, YARD, YARD, YARD], [YARD, YARD, YARD, YARD]];
  applyRoll(g, 2);
  play(g);
  assert.equal(g.tokens[0][0], 50, 'stops at the foot of the home column');
  g = setup('jump3', { yellow: [yel(20), YARD, YARD, YARD] });
  const r = play(g);
  assert.deepEqual(r.power.captures, [[1, 0]]);
  assert.equal(g.tokens[1][0], YARD);
});

test('swap with the nearest opponent token ahead, none behind', () => {
  let g = setup('swap', { yellow: [yel(30), yel(21), YARD, YARD] });
  const r = play(g);
  assert.deepEqual(r.power.swapped, [1, 1]);
  assert.equal(g.tokens[0][0], 21);
  assert.equal(g.tokens[1][1], yel(17));
  g = setup('swap', { yellow: [yel(10), YARD, YARD, YARD] }); // only one behind
  play(g);
  assert.equal(g.tokens[0][0], 17);
  assert.equal(g.tokens[1][0], yel(10));
});

test('shield blocks captures until the token moves again', () => {
  const g = setup('shield', { yellow: [yel(14), YARD, YARD, YARD] });
  play(g);
  assert.ok(g.shield[0][0]);
  g.tokens[1] = [yel(14), YARD, YARD, YARD];
  g.turn = 1;
  g.phase = 'roll';
  applyRoll(g, 3); // yellow lands on abs 17: the shielded red token stays
  const m = legalMoves(g).find((x) => x.token === 0);
  assert.deepEqual(m.captures, []);
  g.turn = 0;
  g.phase = 'roll';
  applyRoll(g, 2);
  play(g);
  assert.ok(!g.shield[0][0], 'moving drops the shield');
});

test('freeze skips the next turn once; extra roll keeps the turn', () => {
  const g = setup('freeze');
  play(g);
  assert.equal(g.turn, 1);
  applyRoll(g, 3); // yellow has no move: red is frozen, so yellow goes again
  assert.equal(g.turn, 1);
  assert.deepEqual(g.skipped, [0]);
  applyRoll(g, 3);
  assert.equal(g.turn, 0, 'only one turn is lost');
  const h = setup('extra');
  assert.ok(play(h).extra);
  assert.equal(h.turn, 0);
});

test('a used square respawns elsewhere, and effects never chain', () => {
  const g = setup('jump6', { pu: [{ sq: 23, kind: 'start' }] });
  const n = g.pu.length;
  const r = play(g);
  assert.equal(g.tokens[0][0], 23, 'landed on the start square after the jump, nothing happens');
  assert.equal(g.pu.length, n);
  assert.ok(g.pu.some((p) => p.sq === 23 && p.kind === 'start'), 'the square it jumped onto stays');
  assert.ok(!g.pu.some((p) => p.sq === 17) && eligible(r.power.respawn.sq));
  assert.equal(new Set(g.pu.map((p) => p.sq)).size, n);
});

test('powerups survive a save and play on identically', () => {
  const a = setup('jump3');
  const b = loadGame(JSON.parse(JSON.stringify(a)));
  assert.deepEqual(b, a);
  play(a);
  play(b);
  assert.deepEqual(b, a, 'the respawn is the same too');
});

test('bots play to the end with powerups on, every rule mix', () => {
  const rng = makeRng(31);
  for (const extra of [{}, { blockades: 'on' }, { safe: 'off', exit: '16', captureBonus: 'on' }]) {
    const g = newGame(4, normRules({ powerups: 'on', ...extra }), null, rng.int(1e9));
    const levels = ['easy', 'medium', 'hard', 'hard'];
    let rolls = 0;
    while (g.phase !== 'over') {
      assert.ok(++rolls < 12000, 'game does not end');
      const r = applyRoll(g, 1 + rng.int(6));
      if (r.kind !== 'move') continue;
      const m = botMove(levels[g.turn], g, rng, r.moves);
      assert.ok(legalMoves(g).some((x) => x.token === m.token));
      applyMove(g, m);
      assert.equal(new Set(g.pu.map((p) => p.sq)).size, g.pu.length);
    }
    assert.equal(g.places.length, 4);
  }
});
