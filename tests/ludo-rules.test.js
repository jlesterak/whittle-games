// Ludo move rules and house-rule switches (docs/ludo-spec.md 1-2): yard exit, captures, safe
// squares, blockades, exact finish, extra rolls, three 6s, the win.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, normRules, legalMoves, distinctMoves, applyRoll, applyMove, absOf, standings, loadGame, YARD, HOME } from '../games/ludo/rules.js';

// Two players sit opposite: seat 0 is red (corner 0), seat 1 yellow (corner 2, 26 squares round).
function game(rules = {}, red = [YARD, YARD, YARD, YARD], yellow = [YARD, YARD, YARD, YARD]) {
  const g = newGame(2, normRules(rules));
  g.tokens = [red.slice(), yellow.slice()];
  return g;
}
const yel = (abs) => (abs - 26 + 52) % 52; // yellow's relative position on an absolute square
const tos = (g, die) => legalMoves(g, die).map((m) => `${m.token}:${m.to}`);

test('two players sit opposite and squares map round the track', () => {
  const g = newGame(2);
  assert.deepEqual(g.corners, [0, 2]);
  assert.equal(absOf(2, 0), 26);
  assert.equal(absOf(3, 12), 51);
  assert.equal(absOf(1, 50), 11);
  assert.equal(absOf(0, 51), -1); // home column is off the shared track
  assert.deepEqual(newGame(3).corners, [0, 1, 2]);
});

test('only a 6 leaves the yard (or a 1 under the house rule), onto the start square', () => {
  for (let d = 1; d <= 5; d++) {
    const g = game();
    assert.deepEqual(applyRoll(g, d), { kind: 'none', extra: false });
    assert.equal(g.turn, 1, 'no move: the turn passes');
  }
  const g = game();
  const r = applyRoll(g, 6);
  assert.equal(r.kind, 'move');
  assert.equal(r.moves.length, 4);
  assert.equal(distinctMoves(r.moves).length, 1, 'yard tokens are one choice');
  const m = applyMove(g, r.moves[0]);
  assert.equal(m.to, 0);
  assert.ok(m.extra, 'a 6 rolls again');
  assert.equal(g.turn, 0);

  const h = game({ exit: '16' });
  assert.equal(applyRoll(h, 1).kind, 'move');
  assert.equal(applyMove(h, { token: 2 }).extra, false, 'a 1 brings a token out without an extra roll');
  assert.equal(h.turn, 1);
  assert.equal(applyRoll(game({ exit: '16' }), 3).kind, 'none');
});

test('landing on an opponent sends it home; a whole unprotected stack goes', () => {
  const g = game({}, [10, YARD, YARD, YARD], [yel(14), yel(14), yel(20), YARD]);
  applyRoll(g, 4);
  const m = applyMove(g, { token: 0 });
  assert.deepEqual(m.captures, [[1, 0], [1, 1]]);
  assert.deepEqual(g.tokens[1], [YARD, YARD, yel(20), YARD]);
  assert.equal(g.tokens[0][0], 14);
  assert.equal(m.extra, false);
  assert.equal(g.turn, 1);
});

test('start and star squares are safe unless the house rule turns them off', () => {
  // abs 8 is red's star, abs 13 is green's start (safe even with no green player)
  for (const [from, die, abs] of [[4, 4, 8], [10, 3, 13]]) {
    const g = game({}, [from, YARD, YARD, YARD], [yel(abs), YARD, YARD, YARD]);
    applyRoll(g, die);
    assert.deepEqual(applyMove(g, { token: 0 }).captures, []);
    assert.equal(g.tokens[1][0], yel(abs), 'both tokens share the safe square');

    const off = game({ safe: 'off' }, [from, YARD, YARD, YARD], [yel(abs), YARD, YARD, YARD]);
    applyRoll(off, die);
    assert.deepEqual(applyMove(off, { token: 0 }).captures, [[1, 0]]);
  }
  // leaving the yard onto your own start square: safe there by default, a capture with safe squares off
  const g = game({}, [YARD, YARD, YARD, YARD], [yel(0), YARD, YARD, YARD]);
  applyRoll(g, 6);
  assert.deepEqual(applyMove(g, { token: 0 }).captures, []);
  const off = game({ safe: 'off' }, [YARD, YARD, YARD, YARD], [yel(0), YARD, YARD, YARD]);
  applyRoll(off, 6);
  assert.deepEqual(applyMove(off, { token: 0 }).captures, [[1, 0]]);
});

test('blockades stop opponents passing or landing, not their owner', () => {
  const yellowPair = [yel(12), yel(12), YARD, YARD];
  // without the rule: pass freely, landing captures both
  assert.deepEqual(tos(game({}, [10, YARD, YARD, YARD], yellowPair), 4), ['0:14']);
  assert.deepEqual(tos(game({}, [10, YARD, YARD, YARD], yellowPair), 2), ['0:12']);
  // with it: neither
  assert.deepEqual(tos(game({ blockades: 'on' }, [10, YARD, YARD, YARD], yellowPair), 4), []);
  assert.deepEqual(tos(game({ blockades: 'on' }, [10, YARD, YARD, YARD], yellowPair), 2), []);
  assert.deepEqual(tos(game({ blockades: 'on' }, [10, YARD, YARD, YARD], yellowPair), 1), ['0:11']);
  // a single token is no blockade
  assert.deepEqual(tos(game({ blockades: 'on' }, [10, YARD, YARD, YARD], [yel(12), YARD, YARD, YARD]), 4), ['0:14']);
  // the owner passes its own pair
  assert.deepEqual(tos(game({ blockades: 'on' }, [10, 12, 12, YARD]), 4), ['0:14', '1:16', '2:16']);
  // a pair on your start square keeps you in the yard
  const g = game({ blockades: 'on' }, [YARD, YARD, YARD, YARD], [yel(0), yel(0), YARD, YARD]);
  assert.deepEqual(applyRoll(g, 6), { kind: 'none', extra: true });
});

test('finishing needs the exact roll unless overshoot is allowed', () => {
  assert.deepEqual(tos(game({}, [53, HOME, HOME, HOME]), 4), []);
  assert.deepEqual(tos(game({}, [53, HOME, HOME, HOME]), 2), ['0:55']);
  assert.deepEqual(tos(game({ exact: 'off' }, [53, HOME, HOME, HOME]), 6), ['0:56']);
  // the home column is entered from step 50, never a second lap
  assert.deepEqual(tos(game({}, [48, HOME, HOME, HOME]), 5), ['0:53']);
});

test('reaching home with the last token wins; with one player left the game ends', () => {
  const g = game({}, [53, HOME, HOME, HOME], [10, YARD, YARD, YARD]);
  applyRoll(g, 3);
  const m = applyMove(g, { token: 0 });
  assert.ok(m.finished && m.home && m.over);
  assert.equal(m.place, 1);
  assert.equal(m.extra, false);
  assert.equal(g.phase, 'over');
  assert.equal(g.winner, 0);
  assert.deepEqual(g.places, [0, 1], 'the last player left takes last place');
  assert.throws(() => applyRoll(g, 6));
  // three seats, one already home: the second to finish leaves one, who comes last
  const h = newGame(3);
  h.tokens = [[53, HOME, HOME, HOME], [HOME, HOME, HOME, HOME], [5, YARD, YARD, YARD]];
  h.places = [1];
  h.winner = 1;
  applyRoll(h, 3);
  const r = applyMove(h, { token: 0 });
  assert.ok(r.finished && r.over);
  assert.equal(r.place, 2);
  assert.deepEqual(h.places, [1, 0, 2]);
});

test('finished players are skipped in the turn order, and play goes on', () => {
  const g = newGame(3);
  g.tokens = [[10, YARD, YARD, YARD], [50, HOME, HOME, HOME], [20, YARD, YARD, YARD]];
  g.turn = 1;
  applyRoll(g, 6); // the 6 finishes: no extra roll for a player who is out
  const m = applyMove(g, { token: 0 });
  assert.ok(m.finished && !m.over && !m.extra);
  assert.equal(m.place, 1);
  assert.equal(g.phase, 'roll');
  assert.equal(g.turn, 2);
  applyRoll(g, 1);
  applyMove(g, { token: 0 });
  assert.equal(g.turn, 0, 'seat 2 hands on to seat 0');
  applyRoll(g, 1);
  applyMove(g, { token: 0 });
  assert.equal(g.turn, 2, 'seat 1 is skipped');
  // a three-6s forfeit skips them too
  applyRoll(g, 6);
  applyMove(g, { token: 0 });
  applyRoll(g, 6);
  applyMove(g, { token: 0 });
  assert.deepEqual(applyRoll(g, 6), { kind: 'forfeit' });
  assert.equal(g.turn, 0);
});

test('with only bots left the game ends at once, the bots ranked by steps travelled', () => {
  const g = newGame(4, normRules(), [true, false, false, true]);
  g.tokens = [[53, HOME, HOME, HOME], [10, 4, YARD, YARD], [30, YARD, YARD, YARD], [HOME, HOME, HOME, HOME]];
  g.places = [3];
  g.winner = 3;
  applyRoll(g, 3);
  const m = applyMove(g, { token: 0 });
  assert.ok(m.finished && m.over);
  assert.equal(g.phase, 'over');
  assert.deepEqual(g.places, [3, 0, 2, 1], 'bot 2 (31 steps) ahead of bot 1 (16)');
  assert.deepEqual(standings(g), [3, 0, 2, 1]);
  // a solo human who finishes first ends the game too
  const solo = newGame(2, normRules(), [true, false]);
  solo.tokens[0] = [53, HOME, HOME, HOME];
  applyRoll(solo, 3);
  assert.ok(applyMove(solo, { token: 0 }).over);
});

test('a v1 save (no places) loads: an over game keeps its winner first, a live one plays on', () => {
  const over = { v: 1, rules: {}, corners: [0, 2], tokens: [[HOME, HOME, HOME, HOME], [10, HOME, YARD, YARD]], turn: 1, die: 3, sixes: 0, phase: 'over', winner: 0 };
  loadGame(over);
  assert.deepEqual(over.places, [0]);
  assert.deepEqual(standings(over), [0, 1]);
  const live = loadGame({ v: 1, rules: { safe: 'off' }, corners: [0, 1, 2], tokens: [[10, YARD, YARD, YARD], [YARD, YARD, YARD, YARD], [YARD, YARD, YARD, YARD]], turn: 0, die: 0, sixes: 0, phase: 'roll', winner: -1 });
  assert.deepEqual(live.places, []);
  assert.equal(live.rules.safe, false);
  applyRoll(live, 2);
  applyMove(live, { token: 0 });
  assert.equal(live.turn, 1);
});

test('three 6s in a row forfeit the turn; the count resets on any other roll', () => {
  const g = game({}, [10, 20, YARD, YARD]);
  applyRoll(g, 6);
  applyMove(g, { token: 0 });
  applyRoll(g, 6);
  applyMove(g, { token: 0 });
  assert.equal(g.turn, 0);
  assert.deepEqual(applyRoll(g, 6), { kind: 'forfeit' });
  assert.deepEqual(g.tokens[0], [22, 20, YARD, YARD], 'the third 6 is not played');
  assert.equal(g.turn, 1);
  assert.equal(g.sixes, 0);
  // 6, 6, then a 4: the streak is over and the turn passes normally
  const h = game({}, [10, YARD, YARD, YARD]);
  applyRoll(h, 6);
  applyMove(h, { token: 0 });
  applyRoll(h, 6);
  applyMove(h, { token: 0 });
  applyRoll(h, 4);
  applyMove(h, { token: 0 });
  assert.equal(h.turn, 1);
  assert.equal(h.sixes, 0);
});

test('extra rolls on capture and on home are house rules', () => {
  const setup = (rules) => game(rules, [10, 53, YARD, YARD], [yel(14), YARD, YARD, YARD]);
  for (const [rules, capture, home] of [[{}, false, false], [{ captureBonus: 'on' }, true, false], [{ homeBonus: 'on' }, false, true]]) {
    const a = setup(rules);
    applyRoll(a, 4);
    assert.equal(applyMove(a, { token: 0 }).extra, capture, `capture ${JSON.stringify(rules)}`);
    assert.equal(a.turn, capture ? 0 : 1);
    const b = setup(rules);
    applyRoll(b, 3);
    assert.equal(applyMove(b, { token: 1 }).extra, home, `home ${JSON.stringify(rules)}`);
  }
  // a capture bonus after a non-6 starts the six count again
  const g = game({ captureBonus: 'on' }, [10, YARD, YARD, YARD], [yel(14), YARD, YARD, YARD]);
  g.sixes = 2;
  applyRoll(g, 4);
  applyMove(g, { token: 0 });
  assert.equal(g.sixes, 0);
  assert.equal(g.turn, 0);
});

test('illegal moves and out-of-phase calls throw', () => {
  const g = game({}, [53, YARD, YARD, YARD]);
  applyRoll(g, 6); // 53+6 overshoots; only yard exits
  assert.throws(() => applyMove(g, { token: 0 }));
  assert.throws(() => applyRoll(g, 2));
});
