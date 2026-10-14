// One localStorage record holds everything: global settings plus one blob per game.
// Export/import moves that record as a JSON file.
//
// Saves outlive code, so nothing read from here is trusted: the record is repaired on read, a game only ever
// gets a plain object (or null) back, and cleanSave() checks a game's blob against the shape of a fresh save.
// Nothing is thrown away: an unreadable record is copied to BROKEN_KEY before it is replaced, and a game's
// unusable blob can be set aside with quarantine().

import { toast } from './ui.js';

const KEY = 'whittle:v1';
export const BROKEN_KEY = 'whittle:v1:broken';

export const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function blank() {
  return { v: 1, settings: {}, games: {} };
}

function read() {
  let raw = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return blank(); // no storage at all (private mode, tests)
  }
  if (raw === null) return blank();
  try {
    const d = JSON.parse(raw);
    if (isPlain(d)) return repair(d);
  } catch {
    /* fall through */
  }
  try {
    localStorage.setItem(BROKEN_KEY, raw);
  } catch {
    /* nowhere to keep it */
  }
  console.warn('whittle: the save record was unreadable; a copy is kept under', BROKEN_KEY);
  return blank();
}

function repair(d) {
  return { ...blank(), ...d, settings: isPlain(d.settings) ? d.settings : {}, games: isPlain(d.games) ? d.games : {} };
}

// After the helpers above: read() uses isPlain (a const, so it must be defined first).
let data = read();
let warned = false;

function write() {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('whittle: save failed', e);
    if (!warned && globalThis.document) toast('Could not save: storage is full or blocked', 3000);
    warned = true;
  }
}

export const allSettings = () => data.settings;

export function setSetting(key, value) {
  data.settings[key] = value;
  write();
}

// A game's own storage: get() returns its blob (a plain object) or null, set(obj) replaces it.
export function store(gameId) {
  return {
    get: () => (isPlain(data.games[gameId]) ? data.games[gameId] : null),
    set(value) {
      data.games[gameId] = value;
      write();
    },
  };
}

// Set a game's blob aside as '<id>.broken' (kept in exports) so the game can start fresh.
export function quarantine(gameId) {
  if (gameId in data.games) data.games[`${gameId}.broken`] = data.games[gameId];
  delete data.games[gameId];
  write();
}

// A saved blob checked against the shape of a fresh one. Each field of `fresh` keeps the saved value only when it
// has the same kind: whole numbers >= 0, strings, booleans; plain objects are checked field by field (an empty
// fresh object accepts any plain object); a null field accepts a plain object or null. Fields the fresh save
// doesn't know are kept, so a newer version's save survives an older build.
export function cleanSave(saved, fresh) {
  const out = isPlain(saved) ? { ...saved } : {};
  for (const [k, v] of Object.entries(fresh)) {
    const s = out[k];
    let ok;
    if (typeof v === 'number') ok = Number.isInteger(s) && s >= 0;
    else if (typeof v === 'string' || typeof v === 'boolean') ok = typeof s === typeof v;
    else if (v === null) ok = s === null || isPlain(s);
    else if (Array.isArray(v)) ok = Array.isArray(s);
    else if (isPlain(v)) ok = isPlain(s);
    else ok = false;
    if (!ok) out[k] = structuredClone(v);
    else if (isPlain(v) && Object.keys(v).length) out[k] = cleanSave(s, v);
  }
  return out;
}

export function exportSave() {
  const out = { app: 'whittle', exportedAt: new Date().toISOString(), ...data };
  const blob = new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `whittle-save-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// file: anything with a text() method (a File from <input type=file>). Throws a readable Error on a bad file.
export async function importSave(file) {
  let d;
  try {
    d = JSON.parse(await file.text());
  } catch {
    throw new Error('That is not a Whittle save file.');
  }
  if (!isPlain(d) || d.app !== 'whittle' || !isPlain(d.games)) {
    throw new Error('That is not a Whittle save file.');
  }
  data = { v: 1, settings: isPlain(d.settings) ? d.settings : {}, games: d.games };
  write();
}
