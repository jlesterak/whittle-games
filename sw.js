// Service worker: precache every app file on install, then serve them from that cache, so the app runs with
// zero network after the first load and always runs one consistent version.
// The FILES list and VERSION are generated: run `node tools/precache.mjs` after changing any app file
// (tests/precache.test.js fails if either is out of date). VERSION is a hash of every precached file, so any
// change makes a new worker, which fetches a whole new cache. It waits until the page asks it to take over
// (the shelf's "Update ready" button) or until every tab of the old version has closed: a running page never
// mixes old and new files.

const VERSION = 'a52573c13c90';
const CACHE = `whittle-${VERSION}`;
// prettier-ignore
const FILES = [
  // @precache-start
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './core/app.js',
  './core/audio.js',
  './core/dice-sounds.js',
  './core/dice-view.js',
  './core/dice.js',
  './core/haptics.js',
  './core/icons.js',
  './core/rng.js',
  './core/save.js',
  './core/seats-ui.js',
  './core/seats.js',
  './core/settings.js',
  './core/stage.js',
  './core/style.css',
  './core/ui.js',
  './engines/slotsort/board.js',
  './engines/slotsort/generator.js',
  './engines/slotsort/sim.js',
  './engines/slotsort/solver.js',
  './games/beadloom/colors.js',
  './games/beadloom/game.js',
  './games/beadloom/render.js',
  './games/beadloom/ring.js',
  './games/beadloom/rules.js',
  './games/beadloom/sounds.js',
  './games/beadloom/sprites.js',
  './games/beadloom/track.js',
  './games/dotwork/board.js',
  './games/dotwork/colors.js',
  './games/dotwork/game.js',
  './games/dotwork/generator.js',
  './games/dotwork/render.js',
  './games/dotwork/sounds.js',
  './games/index.js',
  './games/ludo/board.js',
  './games/ludo/bot.js',
  './games/ludo/game.js',
  './games/ludo/powerups.js',
  './games/ludo/rules.js',
  './games/ludo/sounds.js',
  './games/purl/colors.js',
  './games/purl/columns.js',
  './games/purl/game.js',
  './games/purl/render.js',
  './games/purl/rules.js',
  './games/purl/sounds.js',
  './games/purl/sprites.js',
  './games/yacht/bot.js',
  './games/yacht/game.js',
  './games/yacht/rules.js',
  './games/yacht/sounds.js',
  // @precache-end
];

self.addEventListener('install', (e) => {
  // cache: 'reload' skips the HTTP cache, so a stale copy of one file can't slip into a new version
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// The shelf's Reload button: take over now (the page reloads on controllerchange).
self.addEventListener('message', (e) => {
  if (e.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      try {
        return await fetch(req);
      } catch {
        if (req.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
        return Response.error();
      }
    }),
  );
});
