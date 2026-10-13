// One localStorage record holds everything: global settings plus one blob per game.
// Export/import moves that record as a JSON file.

const KEY = 'whittle:v1';
let data = read();

function blank() {
  return { v: 1, settings: {}, games: {} };
}

function read() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d && typeof d === 'object') return { ...blank(), ...d };
  } catch {
    /* no storage or bad JSON: start fresh */
  }
  return blank();
}

function write() {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('whittle: save failed', e);
  }
}

export const allSettings = () => data.settings;

export function setSetting(key, value) {
  data.settings[key] = value;
  write();
}

// A game's own storage: get() returns its blob (or null), set(obj) replaces it.
export function store(gameId) {
  return {
    get: () => data.games[gameId] ?? null,
    set(value) {
      data.games[gameId] = value;
      write();
    },
  };
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

export async function importSave(file) {
  const d = JSON.parse(await file.text());
  if (!d || typeof d !== 'object' || d.app !== 'whittle' || typeof d.games !== 'object') {
    throw new Error('That is not a Whittle save file.');
  }
  data = { v: 1, settings: d.settings || {}, games: d.games || {} };
  write();
}
