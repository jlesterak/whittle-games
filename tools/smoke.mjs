// Headless smoke check: opens the shelf and every game in Chromium at phone and desktop sizes, lets each
// game play itself (?autoplay=1), and fails on errors or a broken layout. Screenshots land in .work/shots/
// so a person or an agent can look at them.
//
//   node tools/smoke.mjs                          everything (shelf + all games x 3 viewports)
//   node tools/smoke.mjs --game dotwork --viewport 360x740
//   node tools/smoke.mjs --game beadloom --params "level=40" --wait 8
//   node tools/smoke.mjs --sw                     offline start and a whole update, on a temporary copy
//   node tools/smoke.mjs --saves                  every game over broken and odd saves
//   node tools/smoke.mjs --sweep                  Beadloom, Purl, Dotwork over many levels and phone sizes: the
//                                                 drawn level must stay on the stage, the HUD on screen and apart
//
// Flags: --game id[,id] (shelf counts as a game), --viewport WxH[,WxH], --params "a=1&b=2" (added to the
// URL; autoplay=1 unless --no-autoplay), --wait seconds after load (default 5), --out dir, --jobs n,
// --hires (full device-pixel screenshots; default is one pixel per CSS pixel).
// Exit code 1 if any page had a problem. Needs Chrome or Chromium (see tools/cdp.mjs findChrome).

import { createServer } from 'node:http';
import { appendFileSync, cpSync, createReadStream, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './cdp.mjs';
import { render, TOP, DIRS } from './precache.mjs';
import { games } from '../games/index.js';

const ROOT = join(fileURLToPath(import.meta.url), '../..');

// Phones get touch and a high DPR (canvas sizing depends on it); wide screens get a mouse.
export const VIEWPORTS = ['360x740', '412x915', '1440x900'];
const device = (vp) => {
  const [width, height] = vp.split('x').map(Number);
  const mobile = Math.min(width, height) < 600;
  return { width, height, mobile, touch: mobile, dpr: mobile ? 3 : 1 };
};

// What to do after load to get from a setup screen into play (taps a button by its text).
const STEPS = {
  yacht: [{ tap: 'Start' }],
  ludo: [{ tap: 'Start' }],
};

// Messages that are not bugs in the app.
const IGNORE = [
  /favicon\.ico/, // browsers ask for it; the manifest has the real icons
];

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

// A static server for the repo root (what `python3 -m http.server` does), on a free port.
// While net.offline is true every request fails like a dropped network connection.
export function serve(root = ROOT, net = { offline: false }) {
  const server = createServer((req, res) => {
    if (net.offline) {
      req.socket.destroy();
      return;
    }
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(root, path));
    let ok = file.startsWith(root + sep);
    try {
      ok = ok && statSync(file).isFile();
    } catch {
      ok = false;
    }
    if (!ok) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` })),
  );
}

// Collects everything that went wrong in a page: exceptions, console errors, browser errors, failed requests.
export function watchErrors(page) {
  const errors = [];
  const urls = new Map();
  const add = (msg) => {
    if (!IGNORE.some((re) => re.test(msg)) && !errors.includes(msg)) errors.push(msg);
  };
  page.on('Runtime.exceptionThrown', ({ exceptionDetails: d }) =>
    add(`exception: ${d.exception?.description?.split('\n').slice(0, 3).join(' | ') || d.text}`),
  );
  page.on('Runtime.consoleAPICalled', ({ type, args }) => {
    if (type === 'error' || type === 'assert')
      add(`console.${type}: ${args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
  });
  page.on('Log.entryAdded', ({ entry }) => {
    if (entry.level === 'error') add(`browser: ${entry.text}${entry.url ? ` (${entry.url})` : ''}`);
  });
  page.on('Network.requestWillBeSent', ({ requestId, request }) => urls.set(requestId, request.url));
  page.on('Network.loadingFailed', ({ requestId, errorText, canceled }) => {
    if (!canceled) add(`request failed: ${urls.get(requestId)} ${errorText}`);
  });
  page.on('Network.responseReceived', ({ response }) => {
    if (response.status >= 400) add(`HTTP ${response.status}: ${response.url}`);
  });
  return errors;
}

// Layout checks run inside the page; each returns a list of problems (strings).
// Controls: a visible control outside the viewport (and not in something that scrolls) is cut off or lost.
// A bar parked out of view on purpose must also be hidden (visibility: hidden), so it can't be focused.
export const CONTROLS_CHECK = `(() => {
  const problems = [];
  const vw = innerWidth, vh = innerHeight;
  const doc = document.scrollingElement;
  const opacity = (el) => { let o = 1; for (let a = el; a; a = a.parentElement) o *= +getComputedStyle(a).opacity; return o; };
  const scrollsY = (el) => {
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(a).overflowY) && a.scrollHeight > a.clientHeight + 1) return true;
    }
    return doc.scrollHeight > vh + 1 && getComputedStyle(document.body).overflowY !== 'hidden';
  };
  const name = (el) => (el.getAttribute('aria-label') || el.textContent.trim().replace(/\\s+/g, ' ').slice(0, 30)
    || el.className || el.tagName).toString();
  for (const el of document.querySelectorAll('button, a[href], [role=button], input:not([type=hidden]), select')) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || getComputedStyle(el).visibility === 'hidden' || opacity(el) < 0.05) continue;
    if (el.closest('[hidden]')) continue;
    const where = Math.round(r.left) + ',' + Math.round(r.top) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height);
    if (r.left < -1 || r.right > vw + 1) problems.push('control cut off at the side: "' + name(el) + '" at ' + where);
    else if ((r.top < -1 || r.bottom > vh + 1) && !scrollsY(el)) problems.push('control cut off: "' + name(el) + '" at ' + where);
  }
  if (doc.scrollWidth > vw + 1) problems.push('page scrolls sideways (' + doc.scrollWidth + ' > ' + vw + ')');
  const err = document.querySelector('.error');
  if (err) problems.push('error shown: ' + err.textContent);
  if (!document.getElementById('app')?.children.length) problems.push('app is empty');
  const game = document.querySelector('.game-root');
  if (game && !game.children.length) problems.push('game drew nothing (empty .game-root)');
  return problems;
})()`;

// Canvases: one flat colour means nothing is drawn. Polled from load until it passes, because a finished level
// may legitimately leave a near-empty canvas behind its end screen later on.
export const CANVAS_CHECK = `(() => {
  const problems = [];
  for (const c of document.querySelectorAll('canvas')) {
    const r = c.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || !c.width || !c.height) continue;
    const t = document.createElement('canvas');
    t.width = t.height = 24;
    const g = t.getContext('2d');
    g.drawImage(c, 0, 0, 24, 24);
    const d = g.getImageData(0, 0, 24, 24).data;
    const seen = new Set();
    for (let i = 0; i < d.length; i += 4) seen.add(((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4));
    if (seen.size < 3) problems.push('canvas looks blank (' + seen.size + ' colours)');
  }
  return problems;
})()`;

// True once the shelf or a game has put something on screen.
const MOUNTED = `(() => { const g = document.querySelector('.game-root'); return g ? g.children.length > 0 : !!document.getElementById('app')?.children.length; })()`;

// Centre of the first visible button whose text (or aria-label) is `text`, in CSS px, or null.
export async function findButton(page, text) {
  return page.eval(`(() => {
    for (const b of document.querySelectorAll('button, a[href], [role=button]')) {
      const t = (b.getAttribute('aria-label') || b.textContent).trim();
      const r = b.getBoundingClientRect();
      if (t === ${JSON.stringify(text)} && r.width > 0 && r.height > 0) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    return null;
  })()`);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One game at one viewport: load, step into play, wait, check, screenshot.
async function runOne(browser, base, { id, vp, params, wait, out, hires }) {
  const dev = device(vp);
  const page = await browser.newPage(dev);
  const errors = watchErrors(page);
  const problems = [];
  const dir = join(out, vp);
  mkdirSync(dir, { recursive: true });
  const shot = (name) => page.screenshot(join(dir, `${name}.png`), { scale: hires ? 1 : 1 / dev.dpr });
  try {
    await page.goto(`${base}${params ? `?${params}` : ''}${id === 'shelf' ? '' : `#/${id}`}`);
    await sleep(800);
    const steps = id === 'shelf' ? [] : STEPS[id] || [];
    if (steps.length) await shot(`${id}-setup`);
    for (const step of steps) {
      const at = await findButton(page, step.tap);
      if (!at) {
        problems.push(`no "${step.tap}" button to tap`);
        break;
      }
      await page.tap(at.x, at.y);
      await sleep(300);
    }
    // the game has up to 8 s to mount and draw (slow runners, big generated levels)
    let blank = [];
    for (let t = 0; t < 8000; t += 400) {
      blank = await page.eval(`(${MOUNTED}) && ${CANVAS_CHECK}`);
      if (Array.isArray(blank) && !blank.length) break;
      await sleep(400);
    }
    if (!Array.isArray(blank)) problems.push('game never mounted (empty .game-root after 8 s)');
    else problems.push(...blank);
    problems.push(...(await page.eval(CONTROLS_CHECK)));
    await sleep(Math.max(0, wait - 1) * 1000);
    for (const p of await page.eval(CONTROLS_CHECK)) if (!problems.includes(p)) problems.push(p);
    await shot(id);
  } catch (e) {
    problems.push(`smoke: ${e.message}`);
  } finally {
    await page.close();
  }
  return [...errors, ...problems];
}

// --sw: install, start offline, then take a whole update. Runs on a temporary copy of the app, since it edits a
// file and regenerates sw.js there. Returns a list of problems.
async function swCheck(browser, out) {
  const dir = mkdtempSync(join(tmpdir(), 'whittle-sw-'));
  for (const f of [...TOP, 'sw.js', ...DIRS]) cpSync(join(ROOT, f), join(dir, f), { recursive: true });
  const net = { offline: false };
  const { server, url } = await serve(dir, net);
  const page = await browser.newPage(device('412x915'));
  const errors = watchErrors(page);
  const problems = [];
  const until = async (expr, ms, what) => {
    for (let t = 0; t < ms; t += 250) {
      if (await page.eval(expr).catch(() => false)) return true;
      await sleep(250);
    }
    problems.push(`timed out: ${what}`);
    return false;
  };
  let tab = null;
  const cacheNames = () => page.eval('caches.keys()');
  const uiHasMarker = () => page.eval(`fetch('./core/ui.js').then((r) => r.text()).then((t) => t.includes('sw-check marker'))`);
  try {
    // 1. first visit: the worker installs the whole app and takes control
    await page.goto(url);
    if (!(await until('!!navigator.serviceWorker.controller', 15000, 'service worker controls the page'))) return problems;
    const first = await cacheNames();
    if (first.length !== 1) problems.push(`expected one cache after install, got ${JSON.stringify(first)}`);

    // 2. offline: the shelf and a game never opened before load from the cache
    net.offline = true;
    const before = errors.length;
    await page.goto(url);
    await until(`document.querySelector('.shelf') !== null`, 5000, 'shelf offline');
    await page.eval(`location.hash = '#/dotwork'`);
    await until(`document.querySelector('.game-root canvas') !== null`, 8000, 'Dotwork opens offline');
    // the browser's own update check for sw.js fails while offline; that is expected, nothing else may fail
    const offlineErrors = errors.splice(before).filter((e) => !/sw\.js/.test(e));
    problems.push(...offlineErrors.map((e) => `offline: ${e}`));
    await page.eval(`location.hash = ''`);
    net.offline = false;

    // 3. a new version arrives while a game is open: no bar mid-game, and a second tab sits in another game
    appendFileSync(join(dir, 'core/ui.js'), '\n// sw-check marker\n');
    writeFileSync(join(dir, 'sw.js'), render(readFileSync(join(dir, 'sw.js'), 'utf8'), dir));
    await page.goto(`${url}?step=3#/dotwork`); // a new query: a full load, not a same-page hash change
    if (!(await until(`navigator.serviceWorker.getRegistration().then((r) => !!(r && r.waiting))`, 15000, 'new version installed and waiting'))) return problems;
    if (await page.eval(`!!document.querySelector('.update-bar')`)) problems.push('the update bar showed during a game');
    tab = await browser.newPage({ ...device('412x915'), sameContextAs: page });
    errors.push(...watchErrors(tab));
    await tab.goto(`${url}#/yacht`);
    await sleep(800);
    await tab.eval('window.__tabB = 1');

    // 4. back on the shelf the update is offered; the running page still gets old files until it is taken
    await page.eval(`location.hash = ''`);
    if (!(await until(`document.querySelector('.update-bar') !== null`, 5000, 'shelf offers the update'))) return problems;
    mkdirSync(out, { recursive: true });
    await page.screenshot(join(out, 'sw-update-bar.png'), { scale: 1 / page.dpr });
    if (await uiHasMarker()) problems.push('the running page already sees new files before the update was taken');
    if ((await cacheNames()).length !== 2) problems.push('the new version should wait in its own cache next to the old one');

    // 5. take it: this page reloads onto the new version only, and the old cache is gone
    const at = await findButton(page, 'Reload');
    if (!at) return [...problems, 'no Reload button on the update bar'];
    await page.tap(at.x, at.y);
    await sleep(1500);
    await until(`document.querySelector('.shelf') !== null && !document.querySelector('.update-bar')`, 8000, 'reloaded shelf without the bar');
    if (!(await uiHasMarker())) problems.push('after the update the page still gets old files');
    const after = await cacheNames();
    if (after.length !== 1 || after[0] === first[0]) problems.push(`expected only the new cache, got ${JSON.stringify(after)}`);

    // 6. the other tab: its game is not interrupted, and it starts over on the new version when it leaves the game
    if ((await tab.eval('window.__tabB')) !== 1) problems.push('the other tab reloaded in the middle of its game');
    await tab.eval(`location.hash = ''`);
    let fresh = false;
    for (let t = 0; t < 8000 && !fresh; t += 250) {
      fresh = await tab.eval(`window.__tabB === undefined && !!document.querySelector('.shelf')`).catch(() => false);
      if (!fresh) await sleep(250);
    }
    if (!fresh) problems.push('the other tab did not reload when it left its game');
    else if (!(await tab.eval(`fetch('./core/ui.js').then((r) => r.text()).then((t) => t.includes('sw-check marker'))`))) {
      problems.push('the other tab still gets old files after reloading');
    }
  } catch (e) {
    problems.push(`smoke --sw: ${e.message}`);
  } finally {
    await tab?.close();
    await page.close();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
  return [...errors, ...problems];
}

// --saves: blobs a game's save could hold after a bug, an old version or a hand-edited import. Each must open
// to a playable screen with no errors. The whole-record cases break the shared save record itself.
export const BAD_SAVES = {
  'a string': 'garbage',
  'a number': 42,
  'an array': [],
  'an empty object': {},
  'wrong types': { level: 'x', coins: 'y', boosters: null, cleared: 'z', best: 7, inProgress: 'zzz', setup: 'x', game: 5, high: 'x' },
  'odd values': { level: -5, coins: -1, boosters: { slot: 'a', hint: -2 }, inProgress: { level: 1 }, setup: { players: [] }, game: { v: 1 }, high: { classic: 'x' } },
  'a stale level': { level: 3, coins: 10, inProgress: { level: 3, gen: 0, sim: {}, board: {} } },
  'a broken resume': { level: 1, coins: 10, inProgress: { level: 1, gen: 99, sim: { tick: 'x' }, board: { gone: 'x' } } },
  'broken seats': { setup: { players: [{ name: 5, kind: 'alien', level: 'x' }, null] }, game: null },
  'a broken game': { setup: { players: [{ name: 'A', kind: 'human', level: 'medium' }] }, game: { v: 1, rules: null, seats: 3, cards: 'x', tokens: 'x', phase: 'play' } },
};
export const BAD_RECORDS = {
  'not JSON': '{oops',
  'settings and games as arrays': JSON.stringify({ v: 1, settings: [], games: [] }),
  'games as null': JSON.stringify({ v: 1, settings: { sound: 'loud' }, games: null }),
};
const KEY = 'whittle:v1';

async function savesCheck(browser, base, out, jobs, only) {
  const ids = games.map((g) => g.id).filter((id) => !only || only.includes(id));
  const queue = [
    ...ids.flatMap((id) => Object.entries(BAD_SAVES).map(([name, blob]) => ({ id, name, raw: JSON.stringify({ v: 1, settings: {}, games: { [id]: blob } }) }))),
    ...['shelf', ...ids].filter((id) => !only || only.includes(id)).flatMap((id) => Object.entries(BAD_RECORDS).map(([name, raw]) => ({ id, name: `record ${name}`, raw }))),
  ];
  let failed = 0;
  const worker = async () => {
    for (let job; (job = queue.shift()); ) {
      const page = await browser.newPage(device('412x915'));
      const errors = watchErrors(page);
      const problems = [];
      try {
        await page.goto(base); // same origin first, so the record can be planted before the app reads it
        await page.eval(`localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(job.raw)})`);
        await page.goto(`${base}?autoplay=1&saves=${encodeURIComponent(job.name)}${job.id === 'shelf' ? '' : `#/${job.id}`}`);
        let ok = false;
        for (let t = 0; t < 6000 && !ok; t += 300) {
          ok = await page.eval(MOUNTED);
          if (!ok) await sleep(300);
        }
        if (!ok) problems.push('never mounted');
        for (const step of job.id === 'shelf' ? [] : STEPS[job.id] || []) {
          const at = await findButton(page, step.tap);
          if (!at) problems.push(`no "${step.tap}" button`);
          else await page.tap(at.x, at.y);
          await sleep(300);
        }
        await sleep(2500);
        problems.push(...(await page.eval(CONTROLS_CHECK)));
      } catch (e) {
        problems.push(`smoke: ${e.message}`);
      } finally {
        await page.close();
      }
      const all = [...errors, ...problems];
      if (all.length) failed++;
      console.log(`${all.length ? 'FAIL' : 'ok  '} ${job.id.padEnd(9)} ${job.name}`);
      for (const p of all) console.log(`       ${p}`);
    }
  };
  await Promise.all(Array.from({ length: jobs }, worker));
  for (const [id, damage] of Object.entries(DAMAGE).filter(([id]) => !only || only.includes(id))) {
    const problems = await damagedResumeCheck(browser, base, id, damage);
    if (problems.length) failed++;
    console.log(`${problems.length ? 'FAIL' : 'ok  '} ${id.padEnd(9)} a real in-progress save with damage`);
    for (const p of problems) console.log(`       ${p}`);
  }
  if (only && !only.includes('purl')) return failed;
  const fallback = await mountFailCheck(browser, base);
  console.log(`${fallback.length ? 'FAIL' : 'ok  '} purl      a game that throws while starting`);
  for (const p of fallback) console.log(`       ${p}`);
  return failed + (fallback.length ? 1 : 0);
}

// Damage done to a real in-progress save (played for a few seconds first), per puzzle game.
const DAMAGE = {
  beadloom: (ip) => (delete ip.sim.board.kind, delete ip.sim.supply.offset),
  purl: (ip) => (delete ip.sim.board.kind, delete ip.sim.board.pair),
  dotwork: (ip) => ((ip.hint = 99999), (ip.board.stars = 'x')),
};

// Play a puzzle level for a few seconds, damage its saved in-progress state, reopen it: the game must refuse the
// damaged state (restart the level) with no errors, and keep a copy of what it dropped.
async function damagedResumeCheck(browser, base, id, damage) {
  const page = await browser.newPage(device('412x915'));
  const errors = watchErrors(page);
  const problems = [];
  try {
    await page.goto(`${base}?level=${id === 'dotwork' ? 40 : 3}&autoplay=1#/${id}`); // a Dotwork level that lasts
    await sleep(id === 'dotwork' ? 1500 : 4000);
    await page.eval(`location.hash = ''`); // leaving saves the level in progress
    await sleep(300);
    const record = await page.eval(`JSON.parse(localStorage.getItem('whittle:v1'))`);
    const ip = record?.games?.[id]?.inProgress;
    if (!ip) return [...errors, 'no level in progress was saved'];
    damage(ip);
    await page.eval(`localStorage.setItem('whittle:v1', ${JSON.stringify(JSON.stringify(record))})`);
    await page.goto(`${base}?damaged=1#/${id}`);
    await sleep(3000);
    problems.push(...(await page.eval(CONTROLS_CHECK)));
    if (!(await page.eval(MOUNTED))) problems.push('never mounted');
  } catch (e) {
    problems.push(`smoke: ${e.message}`);
  } finally {
    await page.close();
  }
  return [...errors, ...problems];
}

// The shell's last line of defence: a game whose mount() throws gets the "could not start" card, and Start fresh
// sets its save aside as '<id>.broken'. The browser is handed a stand-in Purl module that always throws.
async function mountFailCheck(browser, base) {
  const page = await browser.newPage(device('412x915'));
  const errors = watchErrors(page);
  const problems = [];
  try {
    await page.send('Fetch.enable', { patterns: [{ urlPattern: '*/games/purl/game.js' }] });
    page.on('Fetch.requestPaused', ({ requestId }) =>
      page.send('Fetch.fulfillRequest', {
        requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'content-type', value: 'text/javascript' }],
        body: Buffer.from("export default { mount() { throw new Error('mount-fail check'); } };").toString('base64'),
      }),
    );
    await page.goto(base);
    await page.eval(`localStorage.setItem('whittle:v1', JSON.stringify({ v: 1, settings: {}, games: { purl: { level: 7 } } }))`);
    await page.goto(`${base}?mountfail=1#/purl`);
    let shown = false;
    for (let t = 0; t < 5000 && !shown; t += 250) {
      shown = await page.eval(`!!document.querySelector('.load-fail')`);
      if (!shown) await sleep(250);
    }
    if (!shown) problems.push('no "could not start" card');
    const at = await findButton(page, 'Start fresh');
    if (!at) problems.push('no Start fresh button');
    else {
      await page.tap(at.x, at.y);
      await sleep(800);
      const games = await page.eval(`JSON.parse(localStorage.getItem('whittle:v1')).games`);
      if (games.purl !== undefined || games['purl.broken']?.[0]?.blob?.level !== 7) problems.push(`save not set aside: ${JSON.stringify(games)}`);
    }
    problems.push(...(await page.eval(CONTROLS_CHECK)));
  } catch (e) {
    problems.push(`smoke: ${e.message}`);
  } finally {
    await page.close();
  }
  // the stand-in's own error is expected; anything else is not
  return [...errors.filter((e) => !e.includes('mount-fail check')), ...problems];
}

// --sweep: each renderer reports boxes for what the level drew (renderer.bounds(), CSS px in the canvas). They
// must stay inside the canvas (or the box's own `inside` area), and the HUD (the game's DOM controls and labels)
// must stay on screen, apart from each other and off the drawn level. Splashes meant to cover the level for a
// moment carry data-over-level; a tab drawn onto another HUD element on purpose carries data-tab. Writes a contact sheet to <out>/index.html.
export const SWEEP = {
  games: { beadloom: '__bo', purl: '__ck', dotwork: '__po' },
  levels: [1, 2, 5, 10, 11, 20, 22, 25, 30, 40, 50, 55, 60],
  extra: { dotwork: [80, 208] },
  viewports: ['360x740', '384x693', '384x780', '412x915', '915x412'],
};

const SWEEP_CHECK = (hook) => `(() => {
  const problems = [];
  const canvas = document.querySelector('.game-root canvas');
  const r = window.${hook}?.().renderer;
  if (!canvas || !r?.bounds) return ['no renderer bounds (debug hook ${hook})'];
  const c = canvas.getBoundingClientRect();
  const boxes = r.bounds();
  const px = (v) => Math.round(v);
  for (const b of boxes) {
    const a = b.inside || { x0: 0, y0: 0, x1: c.width, y1: c.height };
    const over = { left: a.x0 - b.x0, top: a.y0 - b.y0, right: b.x1 - a.x1, bottom: b.y1 - a.y1 };
    for (const [edge, d] of Object.entries(over)) if (d > 1) problems.push(b.name + ' cut off at the ' + edge + ' by ' + px(d) + ' px');
  }
  const vw = innerWidth, vh = innerHeight;
  const seen = (el) => {
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || el.closest('[hidden]')) return false;
    for (let a = el; a; a = a.parentElement) if (+getComputedStyle(a).opacity < 0.05) return false;
    const q = el.getBoundingClientRect();
    return q.width >= 1 && q.height >= 1;
  };
  const name = (el) => (el.getAttribute('aria-label') || el.textContent.trim().replace(/\\s+/g, ' ').slice(0, 24) || el.className || el.tagName).toString();
  const root = document.querySelector('.game-root');
  const hud = [...root.querySelectorAll('button, [role=button], div, span, em, b, strong, small, p, h1, h2, h3, label, output')]
    .filter((el) => !el.closest('.modal, dialog, [role=dialog]') && seen(el) && (el.matches('button, [role=button]') || [...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim())))
    .filter((el) => !el.parentElement.closest('button, [role=button]'));
  const rects = hud.map((el) => [el, el.getBoundingClientRect()]);
  for (const [el, q] of rects) {
    if (q.left < -1 || q.top < -1 || q.right > vw + 1 || q.bottom > vh + 1) problems.push('HUD "' + name(el) + '" off screen at ' + px(q.left) + ',' + px(q.top));
  }
  const cut = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2;
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const [ea, a] = rects[i], [eb, b] = rects[j];
    if (ea.contains(eb) || eb.contains(ea) || ea.closest('[data-tab]') || eb.closest('[data-tab]')) continue;
    if (cut(a, b)) problems.push('HUD "' + name(ea) + '" overlaps "' + name(eb) + '"');
  }
  for (const b of boxes) {
    if (b.hudOk) continue; // the HUD may sit over this part (it must still stay on the stage)
    const box = { left: c.left + b.x0, top: c.top + b.y0, right: c.left + b.x1, bottom: c.top + b.y1 };
    for (const [el, q] of rects) if (!el.closest('[data-over-level]') && cut(q, box)) problems.push('HUD "' + name(el) + '" covers the ' + b.name);
  }
  return problems;
})()`;

async function sweepCheck(browser, base, out, jobs, only) {
  const queue = [];
  for (const vp of SWEEP.viewports)
    for (const [id, hook] of Object.entries(SWEEP.games))
      if (!only || only.includes(id)) for (const level of [...SWEEP.levels, ...(SWEEP.extra[id] || [])]) queue.push({ vp, id, hook, level });
  const results = [];
  const one = async ({ vp, id, hook, level }) => {
    const dev = device(vp);
    const page = await browser.newPage(dev);
    const errors = watchErrors(page);
    const problems = [];
    const file = `${vp}/${id}-${level}.png`;
    mkdirSync(join(out, vp), { recursive: true });
    try {
      await page.goto(`${base}?debug&level=${level}#/${id}`);
      let ok = false;
      for (let t = 0; t < 8000 && !ok; t += 300) {
        await sleep(300);
        ok = await page.eval(`!!window.${hook}?.().renderer?.level && (${MOUNTED})`);
      }
      if (!ok) problems.push('game never mounted');
      // entrance animations settle and any splash over the level goes away (up to 6 s)
      const SPLASH = `[...document.querySelectorAll('[data-over-level]')].some((el) => el.isConnected && getComputedStyle(el).display !== 'none' && (+getComputedStyle(el).opacity > 0.05 || el.getAnimations().some((a) => a.playState === 'running')))`;
      await sleep(1000); // a splash may start a moment after the level
      for (let t = 0; t < 6000 && (await page.eval(SPLASH)); t += 300) await sleep(300);
      if (await page.eval(SPLASH)) problems.push('a splash still covers the level after 7 s');
      await sleep(700);
      problems.push(...(await page.eval(SWEEP_CHECK(hook))));
      await page.screenshot(join(out, file), { scale: 1 / dev.dpr });
    } catch (e) {
      problems.push(`smoke: ${e.message}`);
    } finally {
      await page.close();
    }
    results.push({ vp, id, level, file, problems: [...errors, ...problems] });
  };
  await Promise.all(Array.from({ length: jobs }, async () => {
    for (let job; (job = queue.shift()); ) await one(job);
  }));
  const order = (r) => [SWEEP.viewports.indexOf(r.vp), Object.keys(SWEEP.games).indexOf(r.id), r.level];
  results.sort((a, b) => { const x = order(a), y = order(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; });
  const esc = (t) => t.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]);
  const cells = results.map((r) => `<figure class="${r.problems.length ? 'bad' : ''}"><a href="${r.file}"><img src="${r.file}" loading="lazy"></a>` +
    `<figcaption>${r.vp} ${r.id} ${r.level}${r.problems.map((p) => `<br>${esc(p)}`).join('')}</figcaption></figure>`);
  writeFileSync(join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><title>sweep</title><style>
body{font:12px system-ui;margin:8px;background:#222;color:#ddd}figure{display:inline-block;margin:4px;vertical-align:top;width:200px}
img{width:100%;border:2px solid #444}.bad img{border-color:#e33}.bad figcaption{color:#f88}</style>${cells.join('\n')}\n`);
  return results;
}

function num(flag, v, min) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min) throw new Error(`${flag} wants a number >= ${min}, got ${v}`);
  return n;
}

function parseArgs(argv) {
  const opts = { games: null, viewports: VIEWPORTS, params: '', autoplay: true, wait: 5, out: join(ROOT, '.work/shots'), jobs: 3, hires: false, sw: false, saves: false, sweep: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--game') opts.games = next().split(',');
    else if (a === '--viewport') opts.viewports = next().split(',');
    else if (a === '--params') opts.params = next();
    else if (a === '--no-autoplay') opts.autoplay = false;
    else if (a === '--wait') opts.wait = num(a, next(), 0);
    else if (a === '--out') opts.out = next();
    else if (a === '--jobs') opts.jobs = num(a, next(), 1);
    else if (a === '--hires') opts.hires = true;
    else if (a === '--sw') opts.sw = true;
    else if (a === '--saves') opts.saves = true;
    else if (a === '--sweep') opts.sweep = true;
    else throw new Error(`unknown flag ${a} (see the header of tools/smoke.mjs)`);
  }
  const known = ['shelf', ...games.map((g) => g.id)];
  opts.games ??= known;
  for (const g of opts.games) if (!known.includes(g)) throw new Error(`unknown game ${g} (known: ${known.join(', ')})`);
  for (const v of opts.viewports) if (!/^\d+x\d+$/.test(v)) throw new Error(`bad viewport ${v} (want WxH)`);
  opts.params = [opts.autoplay && 'autoplay=1', opts.params].filter(Boolean).join('&');
  return opts;
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  const t0 = Date.now();
  if (opts.sw) {
    const browser = await launch();
    const problems = await swCheck(browser, opts.out).finally(() => browser.close());
    console.log(problems.length ? 'FAIL service worker' : 'ok   service worker: installs, starts offline, updates whole (also mid-game, two tabs)');
    for (const p of problems) console.log(`       ${p}`);
    process.exit(problems.length ? 1 : 0);
  }
  const { server, url } = await serve();
  const browser = await launch();
  if (opts.saves) {
    const only = opts.games.length === games.length + 1 ? null : opts.games;
    const failed = await savesCheck(browser, url, opts.out, opts.jobs, only).finally(() => (browser.close(), server.close()));
    console.log(`${failed ? `${failed} save case(s) failed` : 'all save cases ok'} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    process.exit(failed ? 1 : 0);
  }
  if (opts.sweep) {
    const only = opts.games.length === games.length + 1 ? null : opts.games;
    const results = await sweepCheck(browser, url, opts.out, opts.jobs, only).finally(() => (browser.close(), server.close()));
    const bad = results.filter((r) => r.problems.length);
    for (const r of bad) {
      console.log(`FAIL ${r.vp.padEnd(9)} ${r.id} ${r.level}`);
      for (const p of r.problems) console.log(`       ${p}`);
    }
    console.log(`${bad.length ? `${bad.length} of ${results.length} shot(s) failed` : `all ${results.length} shots ok`} in ${((Date.now() - t0) / 1000).toFixed(1)} s; contact sheet ${join(opts.out, 'index.html')}`);
    process.exit(bad.length ? 1 : 0);
  }
  const queue = opts.viewports.flatMap((vp) => opts.games.map((id) => ({ ...opts, id, vp })));
  let failed = 0;
  const worker = async () => {
    for (let job; (job = queue.shift()); ) {
      const problems = await runOne(browser, url, job);
      if (problems.length) failed++;
      console.log(`${problems.length ? 'FAIL' : 'ok  '} ${job.vp.padEnd(9)} ${job.id}`);
      for (const p of problems) console.log(`       ${p}`);
    }
  };
  try {
    await Promise.all(Array.from({ length: opts.jobs }, worker));
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`${failed ? `${failed} page(s) failed` : 'all pages ok'} in ${((Date.now() - t0) / 1000).toFixed(1)} s; shots in ${opts.out}`);
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
