// E2 daily puzzles: the date seed, the streak, and that a daily win never touches campaign progress.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cleanDaily, currentStreak, dayBefore, freshDaily, isDate, localDate, winDaily, DAILY_KEEP } from '../core/daily.js';
import { generateDaily, DAILY_N } from '../games/dotwork/generator.js';
import { peel } from '../games/dotwork/board.js';
import * as beadloom from '../games/beadloom/rules.js';
import * as purl from '../games/purl/rules.js';

const hash = (lvl) => createHash('sha256').update(JSON.stringify(lvl.arrows)).digest('hex').slice(0, 16);

test('Dotwork: a fixed date gives the same level every time, a different date a different one', () => {
  const a = generateDaily('2026-01-01');
  assert.equal(hash(a), hash(generateDaily('2026-01-01')));
  assert.equal(a.daily, '2026-01-01');
  assert.notEqual(hash(a), hash(generateDaily('2026-01-02')));
  // pinned, so a generator change that would hand everyone a different puzzle today shows up here
  assert.equal(hash(a), DAILY_2026_01_01);
});
const DAILY_2026_01_01 = 'ff35d15ab7e43fcf';

test('Dotwork: daily levels are winnable and mid difficulty', () => {
  for (const date of ['2026-01-01', '2026-02-28', '2026-07-04', '2026-10-19', '2027-12-31']) {
    const lvl = generateDaily(date);
    assert.ok(peel(lvl).ok, `${date} not winnable`);
    assert.equal(lvl.n, DAILY_N);
    assert.equal(lvl.hard, false);
  }
});

for (const [name, rules] of [['Beadloom', beadloom], ['Purl', purl]]) {
  test(`${name}: the daily level is fixed per date, differs by date, is not the campaign level, and was solved`, () => {
    const a = rules.generateDaily('2026-01-01');
    const key = (l) => JSON.stringify(l.board);
    assert.equal(key(a), key(rules.generateDaily('2026-01-01')));
    assert.notEqual(key(a), key(rules.generateDaily('2026-01-02')));
    assert.notEqual(key(a), key(rules.generateLevel(rules.DAILY_N)));
    assert.equal(a.daily, '2026-01-01');
    assert.ok(a.meta.solution?.length > 0 && !a.meta.fallback, 'the solver found a winning order');
  });
}

test('dates: local calendar day, validation, day before across month and year ends', () => {
  assert.equal(localDate(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  assert.ok(isDate('2024-02-29'));
  for (const bad of ['2026-02-29', '2026-13-01', '26-01-01', '2026-1-1', '', null, 5]) assert.ok(!isDate(bad), String(bad));
  assert.equal(dayBefore('2026-03-01'), '2026-02-28');
  assert.equal(dayBefore('2027-01-01'), '2026-12-31');
});

test('a daily win changes save.daily and nothing else', () => {
  const save = { level: 57, coins: 340, boosters: { hint: 2 }, best: { 3: 2, 56: 3 }, zoomTip: true, inProgress: { level: 57 }, daily: freshDaily() };
  const before = structuredClone(save);
  const after = winDaily(save, '2026-01-01', 2);
  for (const k of Object.keys(before)) if (k !== 'daily') assert.deepEqual(after[k], before[k], k);
  assert.deepEqual(save, before, 'the input save was not mutated');
  assert.deepEqual(after.daily.last, { '2026-01-01': 2 });
});

test('streak: consecutive days count, a gap restarts it, replaying a day keeps the best stars', () => {
  let s = { daily: freshDaily() };
  s = winDaily(s, '2026-01-01', 1);
  s = winDaily(s, '2026-01-02', 3);
  s = winDaily(s, '2026-01-02', 2);
  assert.equal(s.daily.streak, 2);
  assert.equal(s.daily.last['2026-01-02'], 3);
  assert.equal(currentStreak(s.daily, '2026-01-03'), 2);
  assert.equal(currentStreak(s.daily, '2026-01-04'), 0);
  s = winDaily(s, '2026-01-05', 1);
  assert.equal(s.daily.streak, 1);
  s = winDaily(s, '2026-01-03', 1); // an old date played late doesn't rewind lastDate
  assert.equal(s.daily.lastDate, '2026-01-05');
});

test(`only the last ${DAILY_KEEP} days are kept; broken saves clean up without throwing`, () => {
  let s = { daily: freshDaily() };
  for (let i = 0; i < 40; i++) {
    const t = new Date(Date.UTC(2026, 2, 1 + i)); // 1 Mar .. 9 Apr
    s = winDaily(s, t.toISOString().slice(0, 10), 1);
  }
  assert.equal(Object.keys(s.daily.last).length, DAILY_KEEP);
  assert.equal(Object.keys(s.daily.last).sort()[0], '2026-03-11');
  assert.equal(s.daily.streak, 40);
  for (const bad of [null, 7, [], 'x', { streak: -3, lastDate: 'yesterday', last: { nope: 3, '2026-01-01': 9 }, inProgress: { date: 'x' } }]) {
    const d = cleanDaily(bad);
    assert.deepEqual(Object.keys(d).sort(), ['inProgress', 'last', 'lastDate', 'streak']);
    assert.equal(d.streak, 0);
    assert.deepEqual(d.last, {});
  }
});
