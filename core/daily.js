// Daily puzzles (E2): one level a day per puzzle game, the same on every phone because it is generated on the device
// from the local date. Results live in save.daily, apart from campaign progress (level, best, cleared, inProgress):
// a daily never moves those and never awards coins. Coins and boosters are one wallet, so a player may spend them in
// a daily as anywhere else. Pure: no DOM, no clock unless one is passed in.

export const DAILY_KEEP = 30; // days of results kept

export function freshDaily() {
  return { streak: 0, lastDate: '', last: {}, inProgress: null };
}

// 'YYYY-MM-DD' in the player's own time zone (a new puzzle at local midnight, not UTC).
export function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function isDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

// The day before `date` ('YYYY-MM-DD'), by the calendar (no time zone or DST involved).
export function dayBefore(date) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d - 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

// A save.daily from a save that may be old, hand-edited or broken: never throws, drops what doesn't fit.
export function cleanDaily(x) {
  const out = freshDaily();
  if (!x || typeof x !== 'object' || Array.isArray(x)) return out;
  if (Number.isInteger(x.streak) && x.streak > 0) out.streak = x.streak;
  if (isDate(x.lastDate)) out.lastDate = x.lastDate;
  if (x.last && typeof x.last === 'object' && !Array.isArray(x.last)) {
    const days = Object.keys(x.last).filter((k) => isDate(k) && Number.isInteger(x.last[k]) && x.last[k] >= 1 && x.last[k] <= 3);
    for (const k of days.sort().slice(-DAILY_KEEP)) out.last[k] = x.last[k];
  }
  if (x.inProgress && typeof x.inProgress === 'object' && isDate(x.inProgress.date)) out.inProgress = x.inProgress;
  if (!out.lastDate) out.streak = 0;
  return out;
}

// The save after winning `date`'s puzzle with `stars` (1-3). Only save.daily changes: the campaign never moves.
// The streak counts consecutive days won; replaying a day keeps its best stars and doesn't count twice.
export function winDaily(save, date, stars) {
  const d = cleanDaily(save.daily);
  // an older day played late (only reachable through ?daily=) records its stars but leaves the streak alone
  if (!d.lastDate || date > d.lastDate) {
    d.streak = d.lastDate === dayBefore(date) ? d.streak + 1 : 1;
    d.lastDate = date;
  }
  const st = Number.isFinite(stars) ? Math.max(1, Math.min(3, Math.round(stars))) : 1;
  d.last[date] = Math.max(d.last[date] || 0, st);
  for (const k of Object.keys(d.last).sort().slice(0, -DAILY_KEEP)) delete d.last[k];
  d.inProgress = null;
  return { ...save, daily: d };
}

// The streak as it stands on `today`: it lapses once a whole day has gone by unplayed.
export function currentStreak(daily, today) {
  const d = cleanDaily(daily);
  return d.lastDate === today || d.lastDate === dayBefore(today) ? d.streak : 0;
}

// Ends the in-progress record of the level being played: the daily's own slot for a daily (level.daily set), the
// campaign's otherwise. Every game clears progress through this, so a daily can never clear the campaign's
// (tests/daily.test.js checks the games don't write save.inProgress = null themselves).
export function clearInProgress(save, level) {
  if (level?.daily) save.daily.inProgress = null;
  else save.inProgress = null;
}
