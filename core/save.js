// One localStorage record holds everything: global settings plus one blob per game.
// Export/import moves that record as a JSON file.
//
// Saves outlive code, so nothing read from here is trusted: the record is repaired on read, a game only ever
// gets a plain object (or null) back, and cleanSave() checks a game's blob against the shape of a fresh save.
// Nothing is thrown away: an unreadable record is copied to BROKEN_KEY before it is replaced, a game keeps a
// copy of a blob it had to repair or can't use (store.keep, quarantine) under '<id>.broken', and an import
// first copies the current record to BEFORE_IMPORT_KEY. The last three copies of each kind are kept, and an
// export includes them all.

import { toast } from './ui.js';

const KEY = 'whittle:v1';
export const BROKEN_KEY = 'whittle:v1:broken';
export const BEFORE_IMPORT_KEY = 'whittle:v1:before-import';
const KEEP = 3; // copies of each kind
const stamp = () => new Date().toISOString();

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
    let kept = JSON.parse(localStorage.getItem(BROKEN_KEY));
    if (!Array.isArray(kept)) kept = [];
    localStorage.setItem(BROKEN_KEY, JSON.stringify([{ at: stamp(), raw }, ...kept].slice(0, KEEP)));
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

// A game's own storage: get() returns its blob (a plain object) or null, set(obj) replaces it, keep(obj) files a
// copy under '<id>.broken' (newest first, the last three) before the game repairs or drops something.
export function store(gameId) {
  return {
    get: () => (isPlain(data.games[gameId]) ? data.games[gameId] : null),
    set(value) {
      data.games[gameId] = value;
      write();
    },
    keep(value) {
      keepCopy(gameId, value);
      write();
    },
  };
}

function keepCopy(gameId, value) {
  const key = `${gameId}.broken`;
  const prev = data.games[key];
  const list = Array.isArray(prev) ? prev : prev === undefined ? [] : [{ at: null, blob: prev }];
  data.games[key] = [{ at: stamp(), blob: value }, ...list].slice(0, KEEP);
}

// Set a game's blob aside under '<id>.broken' (kept in exports) so the game can start fresh. Pass the blob as it
// was before the failed start, in case the game wrote over it first.
export function quarantine(gameId, blob = data.games[gameId]) {
  if (blob !== undefined && blob !== null) keepCopy(gameId, blob);
  delete data.games[gameId];
  write();
}

// A saved blob checked against the shape of a fresh one. Each field of `fresh` keeps the saved value only when it
// has the same kind: whole numbers >= 0 (a numeric string or a fraction is read as one, rounded down), strings,
// booleans; plain objects are checked field by field (an empty fresh object accepts any plain object); a null field
// accepts a plain object or null. Fields the fresh save doesn't know are kept, so a newer version's save survives
// an older build. `changed` collects the paths of fields that were there but had to be reset or rewritten: when it
// isn't empty, keep a copy of the original (store.keep) before saving over it.
export function cleanSave(saved, fresh, changed = [], path = '') {
  const out = isPlain(saved) ? { ...saved } : {};
  if (saved !== null && saved !== undefined && !isPlain(saved)) changed.push(path || '(blob)');
  for (const [k, v] of Object.entries(fresh)) {
    const s = out[k];
    const here = path ? `${path}.${k}` : k;
    let ok;
    if (typeof v === 'number') {
      const n = typeof s === 'string' && s.trim() !== '' ? Number(s) : s;
      ok = typeof n === 'number' && Number.isFinite(n) && n >= 0;
      if (ok && n !== s) (out[k] = Math.floor(n)), changed.push(here);
      else if (ok && !Number.isInteger(n)) (out[k] = Math.floor(n)), changed.push(here);
    } else if (typeof v === 'string' || typeof v === 'boolean') ok = typeof s === typeof v;
    else if (v === null) ok = s === null || isPlain(s);
    else if (Array.isArray(v)) ok = Array.isArray(s);
    else if (isPlain(v)) ok = isPlain(s);
    else ok = false;
    if (!ok) {
      if (s !== undefined) changed.push(here);
      out[k] = structuredClone(v);
    } else if (isPlain(v) && Object.keys(v).length) out[k] = cleanSave(s, v, changed, here);
  }
  return out;
}

export function exportSave() {
  const out = { app: 'whittle', exportedAt: new Date().toISOString(), ...data };
  // the kept copies of whole records travel with the export (game copies are already inside data.games)
  try {
    const broken = JSON.parse(localStorage.getItem(BROKEN_KEY));
    if (Array.isArray(broken)) out.unreadableRecords = broken;
    const before = localStorage.getItem(BEFORE_IMPORT_KEY);
    if (before) out.beforeImport = JSON.parse(before);
  } catch {
    /* nothing kept */
  }
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
  try {
    localStorage.setItem(BEFORE_IMPORT_KEY, JSON.stringify(data));
  } catch {
    /* no room for the backup: the import still goes ahead, as asked */
  }
  data = { v: 1, settings: isPlain(d.settings) ? d.settings : {}, games: d.games };
  write();
}
