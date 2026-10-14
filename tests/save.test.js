// Saves outlive code: a damaged or odd save record must never crash the app or be thrown away silently
// (core/save.js), and seat lists read back from a save are made safe (core/seats.js cleanPlayers).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanPlayers } from '../core/seats.js';

const KEY = 'whittle:v1';

// A fresh copy of core/save.js over a fake localStorage holding `stored`.
let copies = 0;
async function loadSave(stored = {}) {
  const map = new Map(Object.entries(stored));
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
  const mod = await import(`../core/save.js?copy=${copies++}`);
  return { mod, map, record: () => JSON.parse(map.get(KEY)) };
}

test('a good record loads as it is, with nothing set aside (past bug: every record read as unreadable)', async () => {
  const good = { v: 1, settings: { sound: false }, games: { dotwork: { level: 12, coins: 40 } } };
  const { mod, map } = await loadSave({ [KEY]: JSON.stringify(good) });
  assert.deepEqual(mod.allSettings(), { sound: false });
  assert.deepEqual(mod.store('dotwork').get(), { level: 12, coins: 40 });
  assert.equal(map.has(mod.BROKEN_KEY), false);
});

test('an unreadable record is kept aside before a fresh one replaces it', async () => {
  const { mod, map, record } = await loadSave({ [KEY]: '{oops' });
  assert.deepEqual(mod.allSettings(), {});
  assert.equal(map.get(mod.BROKEN_KEY), '{oops');
  mod.setSetting('sound', false);
  assert.equal(record().settings.sound, false);
  assert.equal(map.get(mod.BROKEN_KEY), '{oops', 'the copy survives the next write');
});

test('a record with the wrong shapes is repaired, and games only ever get plain objects', async () => {
  const raw = JSON.stringify({ v: 1, settings: [], games: { a: 'text', b: [1], c: 7, d: { level: 3 } } });
  const { mod } = await loadSave({ [KEY]: raw });
  assert.deepEqual(mod.allSettings(), {});
  for (const id of ['a', 'b', 'c', 'missing']) assert.equal(mod.store(id).get(), null, id);
  assert.deepEqual(mod.store('d').get(), { level: 3 });
  const nullGames = await loadSave({ [KEY]: JSON.stringify({ v: 1, settings: {}, games: null }) });
  assert.equal(nullGames.mod.store('beadloom').get(), null);
});

test('cleanSave keeps what fits the fresh shape and resets the rest', async () => {
  const { mod } = await loadSave();
  const fresh = { level: 1, coins: 0, boosters: { slot: 3, lift: 3 }, best: {}, zoomTip: false, inProgress: null };
  assert.deepEqual(mod.cleanSave(null, fresh), fresh);
  assert.deepEqual(mod.cleanSave('garbage', fresh), fresh);
  const out = mod.cleanSave(
    { level: 'x', coins: -4, boosters: { slot: 2.5, lift: 7 }, best: { 3: 2 }, zoomTip: 'yes', inProgress: 'zzz', extra: [1] },
    fresh,
  );
  assert.deepEqual(out, { level: 1, coins: 0, boosters: { slot: 3, lift: 7 }, best: { 3: 2 }, zoomTip: false, inProgress: null, extra: [1] });
  assert.deepEqual(mod.cleanSave({ inProgress: { level: 2 }, boosters: null }, fresh).inProgress, { level: 2 });
  assert.deepEqual(mod.cleanSave({ boosters: null }, fresh).boosters, { slot: 3, lift: 3 });
  const saved = { level: 4, boosters: { slot: 1 } };
  mod.cleanSave(saved, fresh);
  assert.deepEqual(saved, { level: 4, boosters: { slot: 1 } }, 'the input is not changed');
});

test('importSave takes only Whittle save files', async () => {
  const { mod, record } = await loadSave();
  const file = (text) => ({ text: async () => text });
  for (const bad of ['not json', '[]', JSON.stringify({ app: 'other', games: {} }), JSON.stringify({ app: 'whittle', games: 'x' })]) {
    await assert.rejects(mod.importSave(file(bad)), /not a Whittle save file/);
  }
  await mod.importSave(file(JSON.stringify({ app: 'whittle', settings: 5, games: { yacht: { game: null } } })));
  assert.deepEqual(record(), { v: 1, settings: {}, games: { yacht: { game: null } } });
});

test('quarantine sets a game blob aside and the game starts fresh', async () => {
  const { mod, record } = await loadSave({ [KEY]: JSON.stringify({ v: 1, settings: {}, games: { purl: { level: 'x' } } }) });
  mod.quarantine('purl');
  assert.equal(mod.store('purl').get(), null);
  assert.deepEqual(record().games, { 'purl.broken': { level: 'x' } });
});

test('cleanPlayers: known kinds and levels, short names, a count the game can play', () => {
  const fallback = [{ name: 'Player 1', kind: 'human', level: 'medium' }];
  assert.deepEqual(cleanPlayers('x', { fallback }), fallback);
  assert.deepEqual(cleanPlayers([], { fallback }), fallback);
  assert.deepEqual(cleanPlayers([{ name: 5, kind: 'alien' }, null, 'p'], { fallback }), fallback);
  const out = cleanPlayers(
    [{ name: '  A very long player name  ', kind: 'human', level: 'x' }, { kind: 'bot', level: 'hard' }, { name: 'C', kind: 'bot' }],
    { min: 2, max: 2, fallback },
  );
  assert.deepEqual(out, [
    { name: 'A very long ', kind: 'human', level: 'medium' },
    { name: 'Pip', kind: 'bot', level: 'hard' },
  ]);
  assert.deepEqual(cleanPlayers([{ name: 'Solo', kind: 'human', level: 'easy' }], { min: 2, fallback }), fallback);
});
