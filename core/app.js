// Whittle shell: the shelf (home screen), hash routing to games, the settings panel,
// and service-worker registration. Games are lazy-loaded ES modules (see games/index.js).

import { games } from '../games/index.js';
import * as settings from './settings.js';
import * as save from './save.js';
import { audio } from './audio.js';
import { haptics } from './haptics.js';
import { el, modal, toast, switchRow, choiceRow } from './ui.js';

const app = document.getElementById('app');
let current = null; // { meta, game, instance }
let opening = 0;

function closeCurrent() {
  if (!current) return;
  try {
    current.instance?.unmount?.();
  } catch (e) {
    console.error(e);
  }
  current = null;
}

function route() {
  const id = location.hash.replace(/^#\/?/, '');
  const meta = games.find((g) => g.id === id);
  if (meta) openGame(meta);
  else showShelf();
}

function showShelf() {
  closeCurrent();
  document.body.dataset.view = 'shelf';
  checkForUpdate();
  app.replaceChildren(
    el(
      'div',
      { class: 'shelf' },
      el(
        'header',
        {},
        el('h1', {}, 'Whittle'),
        el('button', { class: 'icon-btn', 'aria-label': 'Settings', onclick: () => openSettings() }, '⚙'),
      ),
      update.waiting &&
        el(
          'div',
          { class: 'update-bar', role: 'status' },
          el('span', {}, 'Update ready'),
          el('button', { class: 'btn btn-primary', onclick: applyUpdate }, 'Reload'),
        ),
      el(
        'div',
        { class: 'cards' },
        games.map((g) =>
          el(
            'a',
            { class: 'card', href: `#/${g.id}` },
            el('div', { class: 'card-icon', html: g.icon }),
            el('div', {}, el('h3', {}, g.title), el('p', {}, g.blurb)),
          ),
        ),
      ),
      el('footer', {}, 'Offline. No ads, no accounts.'),
    ),
  );
}

async function openGame(meta) {
  const token = ++opening;
  closeCurrent();
  document.body.dataset.view = 'game';
  const root = el('div', { class: 'game-root' });
  app.replaceChildren(root);
  let mod;
  try {
    mod = await meta.load();
  } catch (e) {
    console.error(e);
    root.append(el('p', { class: 'error' }, `Could not load ${meta.title}.`));
    return;
  }
  if (token !== opening) return; // navigated away while loading
  const game = mod.default;
  const ctx = {
    root,
    meta,
    store: save.store(meta.id),
    settings,
    audio,
    haptics,
    ui: { el, modal, toast },
    exit: () => {
      location.hash = '';
    },
    openSettings: (extra) => openSettings({ meta, game, extra }),
  };
  try {
    current = { meta, game, instance: game.mount(root, ctx) };
  } catch (e) {
    console.error(e);
    current = { meta, game, instance: null };
    showLoadFail(root, meta);
  }
}

// A game that throws while starting is most likely tripping over its save. Offer a way out that keeps the save:
// export it, or start the game fresh with the old blob set aside as '<id>.broken' (it stays in exports).
function showLoadFail(root, meta) {
  root.replaceChildren(
    el(
      'div',
      { class: 'load-fail' },
      el('h2', {}, `${meta.title} could not start`),
      el('p', {}, "This game's save could not be loaded. Export a copy to keep it, or start the game fresh."),
      el(
        'div',
        { class: 'load-fail-actions' },
        el('button', { class: 'btn', onclick: () => save.exportSave() }, 'Export save'),
        el(
          'button',
          {
            class: 'btn btn-primary',
            onclick: () => {
              save.quarantine(meta.id);
              openGame(meta);
            },
          },
          'Start fresh',
        ),
        el('button', { class: 'btn', onclick: () => (location.hash = '') }, 'Back to shelf'),
      ),
    ),
  );
}

// The settings panel: global toggles, the open game's own settings, save export/import.
function openSettings({ meta, game, extra } = {}) {
  const rows = [
    switchRow('Sound', settings.get('sound'), (v) => settings.set('sound', v)),
    switchRow('Haptics', settings.get('haptics'), (v) => {
      settings.set('haptics', v);
      haptics.buzz(20);
    }),
    switchRow('Reduced motion', settings.get('reducedMotion'), (v) => settings.set('reducedMotion', v)),
    switchRow('Colourblind symbols', settings.get('colourblind'), (v) => settings.set('colourblind', v)),
  ];
  for (const s of game?.settings || []) {
    const key = `${meta.id}.${s.key}`;
    rows.push(choiceRow(s.label, settings.get(key, s.default), s.options, (v) => settings.set(key, v)));
  }
  const file = el('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  file.addEventListener('change', async () => {
    if (!file.files[0]) return;
    try {
      await save.importSave(file.files[0]);
      toast('Save imported');
      setTimeout(() => location.reload(), 600);
    } catch (e) {
      toast(e.message || 'Import failed');
    }
  });
  rows.push(
    el(
      'div',
      { class: 'row' },
      el('span', {}, 'Save file'),
      el(
        'div',
        { class: 'seg' },
        el('button', { onclick: () => save.exportSave() }, 'Export'),
        el('button', { onclick: () => file.click() }, 'Import'),
      ),
    ),
    file,
  );
  const actions = [];
  if (extra) actions.push(...extra);
  if (meta) actions.push({ label: 'Back to shelf', onClick: (close) => (close(), (location.hash = '')) });
  actions.push({ label: 'Done', primary: true });
  modal({ title: 'Settings', body: rows, actions, className: 'settings' });
}

// ---- updates ----
// A new version installs in the background and waits (sw.js). The shelf offers it; it never interrupts a game.
// Reload asks the waiting worker to take over, and the page reloads once it has.
const update = { reg: null, waiting: null, applying: false, checked: 0 };

function updateFound(worker) {
  update.waiting = worker;
  if (document.body.dataset.view === 'shelf') showShelf();
}

function applyUpdate() {
  if (!update.waiting) return;
  update.applying = true;
  update.waiting.postMessage('skip-waiting');
}

// The installed app can stay open for days: look for a new version each time the shelf shows (at most every
// 10 minutes). Offline this fails quietly.
function checkForUpdate() {
  if (!update.reg || Date.now() - update.checked < 600000) return;
  update.checked = Date.now();
  update.reg.update().catch(() => {});
}

// A body class games can style against (no animations, no lifts) when reduced motion is on.
const applyMotion = () => document.body.classList.toggle('reduced-motion', !!settings.get('reducedMotion'));
settings.onChange((key) => key === 'reducedMotion' && applyMotion());
applyMotion();

// Audio needs a user gesture before it can start.
window.addEventListener('pointerdown', () => audio.unlock(), { once: true, capture: true });
window.addEventListener('hashchange', route);
route();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (update.applying) location.reload();
  });
  navigator.serviceWorker
    .register('./sw.js')
    .then((reg) => {
      update.reg = reg;
      update.checked = Date.now(); // registering just checked
      // an update that finished installing earlier and is still waiting (needs a controller: not the first install)
      if (reg.waiting && navigator.serviceWorker.controller) updateFound(reg.waiting);
      const watch = (w) =>
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) updateFound(w);
        });
      watch(reg.installing); // an update already under way
      reg.addEventListener('updatefound', () => watch(reg.installing));
    })
    .catch((e) => console.warn('SW registration failed', e));
}
