// Shelf progress labels (E1): each game's summary(blob) on a fresh, a mid-game and a malformed save.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { games } from '../games/index.js';

const summary = (id) => games.find((g) => g.id === id).summary;
const MALFORMED = [null, undefined, 7, 'x', [], { level: 'nine' }, { level: -3 }, { game: [] }, { high: 'x' }, { high: { classic: [{ score: 'a' }, null] } }];

for (const id of ['beadloom', 'purl', 'dotwork']) {
  test(`${id}: no label on level 1, "Level N" later, none for a broken save`, () => {
    const s = summary(id);
    assert.equal(s({ level: 1, coins: 0, inProgress: null }), null);
    assert.equal(s({ level: 23, coins: 40, inProgress: { level: 23 } }), 'Level 23');
    for (const b of MALFORMED) assert.equal(s(b), null);
  });
}

test('yacht: game in progress first, then the best Classic score, else the best Triple', () => {
  const s = summary('yacht');
  assert.equal(s({ game: null, high: { classic: [], triple: [] } }), null);
  assert.equal(s({ game: { over: false }, high: { classic: [{ score: 300 }] } }), 'Game in progress');
  assert.equal(s({ game: { over: true }, high: { classic: [{ score: 212 }, { score: 190 }], triple: [{ score: 687 }] } }), 'Best 212');
  assert.equal(s({ game: null, high: { classic: [], triple: [{ score: 687 }, { score: 500 }] } }), 'Best 687 (Triple)');
  for (const b of MALFORMED) assert.equal(s(b), null);
});

test('ludo: a game in progress, nothing once it is over', () => {
  const s = summary('ludo');
  assert.equal(s({ game: null }), null);
  assert.equal(s({ game: { phase: 'roll' } }), 'Game in progress');
  assert.equal(s({ game: { phase: 'over' } }), null);
  for (const b of MALFORMED) assert.equal(s(b), null);
});
