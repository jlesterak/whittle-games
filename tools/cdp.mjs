// A minimal Chrome DevTools-protocol client for headless checks (tools/smoke.mjs).
// No npm packages: Node 22's built-in WebSocket, child_process and fs.
//
//   const browser = await launch();
//   const page = await browser.newPage({ width: 412, height: 915, dpr: 3, mobile: true });
//   await page.goto('http://localhost:8000/#/yacht');
//   await page.eval('document.title');
//   await browser.close();
//
// Every page gets its own browser context, so pages never share localStorage (saves) or caches.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

// $CHROME, then Playwright's browser folders (Claude cloud sandboxes keep Chromium in /opt/pw-browsers),
// then the usual install paths.
export function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const found = [];
  for (const base of ['/opt/pw-browsers', join(homedir(), '.cache/ms-playwright')]) {
    let dirs = [];
    try {
      dirs = readdirSync(base).filter((d) => /^chromium-\d+$/.test(d));
    } catch {
      continue;
    }
    dirs.sort((a, b) => b.split('-')[1] - a.split('-')[1]);
    for (const d of dirs) found.push(join(base, d, 'chrome-linux/chrome'), join(base, d, 'chrome-linux64/chrome'));
  }
  found.push(
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  );
  return found.find((p) => existsSync(p));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ chrome = findChrome(), args = [] } = {}) {
  if (!chrome) throw new Error('No Chrome or Chromium found: set CHROME=/path/to/chrome');
  const profile = mkdtempSync(join(tmpdir(), 'whittle-cdp-'));
  const proc = spawn(
    chrome,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      '--mute-audio',
      // no sync, update or push-messaging traffic: offline-style runs, fewer stray connections
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      '--no-pings',
      // CI containers run as root without a sandbox namespace
      ...(process.getuid?.() === 0 || process.env.CI ? ['--no-sandbox'] : []),
      ...args,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let log = '';
  const wsUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Chrome did not start:\n${log.slice(-800)}`)), 30000);
    proc.stderr.on('data', (d) => {
      log += d;
      const m = log.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Chrome exited (${code}):\n${log.slice(-800)}`));
    });
  });
  const conn = await connect(wsUrl);
  return {
    ...conn,
    newPage: (opts) => newPage(conn, opts),
    async close() {
      const exited = new Promise((r) => (proc.exitCode != null ? r() : proc.once('exit', r)));
      // ask Chrome to quit so its helper processes stop writing to the profile; kill it if it doesn't
      await Promise.race([conn.send('Browser.close').catch(() => {}), sleep(3000)]);
      conn.ws.close();
      const timer = setTimeout(() => proc.kill('SIGKILL'), 3000);
      await exited;
      clearTimeout(timer);
      try {
        rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      } catch (e) {
        console.warn(`cdp: could not remove ${profile} (${e.code}); it is only a temp folder`);
      }
    },
  };
}

// One WebSocket to the browser; pages talk through it with flat sessions (sessionId on each message).
export async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error(`cannot connect to ${url}`));
  });
  let lastId = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
      else p.resolve(msg.result);
    } else for (const fn of listeners) fn(msg);
  };
  ws.onclose = () => {
    for (const p of pending.values()) p.reject(new Error(`${p.method}: connection closed`));
    pending.clear();
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++lastId;
      pending.set(id, { resolve, reject, method });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  const on = (fn) => (listeners.add(fn), () => listeners.delete(fn));
  return { ws, send, on };
}


// A tab in a fresh browser context with a phone or desktop viewport.
// sameContextAs: another page, to open a second tab of the same browser profile (shared storage and workers).
async function newPage(conn, { width = 412, height = 915, dpr = 1, mobile = false, touch = mobile, sameContextAs } = {}) {
  const ownContext = !sameContextAs;
  const { browserContextId } = ownContext
    ? await conn.send('Target.createBrowserContext', { disposeOnDetach: true })
    : { browserContextId: sameContextAs.contextId };
  const { targetId } = await conn.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await conn.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => conn.send(method, params, sessionId);
  const handlers = new Map(); // method -> Set(fn)
  const off = conn.on((msg) => {
    if (msg.sessionId !== sessionId) return;
    for (const fn of handlers.get(msg.method) || []) fn(msg.params);
  });
  const on = (method, fn) => {
    if (!handlers.has(method)) handlers.set(method, new Set());
    handlers.get(method).add(fn);
    return () => handlers.get(method).delete(fn);
  };
  const once = (method, ms = 30000) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => (stop(), reject(new Error(`timed out waiting for ${method}`))), ms);
      const stop = on(method, (p) => (clearTimeout(t), stop(), resolve(p)));
    });

  await Promise.all([send('Page.enable'), send('Runtime.enable'), send('Log.enable'), send('Network.enable')]);
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile });
  if (touch) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  // headless tabs count as focused and visible, so rAF keeps running in every page at once
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });

  const page = {
    contextId: browserContextId,
    width,
    height,
    dpr,
    touch,
    send,
    on,
    once,
    async goto(url) {
      const loaded = once('Page.loadEventFired');
      const res = await send('Page.navigate', { url });
      if (res.errorText) throw new Error(`navigate ${url}: ${res.errorText}`);
      await loaded;
    },
    // Evaluate an expression (or an async function body via `(async () => ...)()`) and return its value.
    async eval(expression) {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) {
        const d = r.exceptionDetails;
        throw new Error(`eval failed: ${d.exception?.description || d.text}`);
      }
      return r.result.value;
    },
    // PNG of the viewport. scale < 1 shrinks it (1 / dpr gives one pixel per CSS pixel).
    async screenshot(path, { scale = 1 } = {}) {
      const clip = { x: 0, y: 0, width, height, scale };
      const { data } = await send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: false });
      writeFileSync(path, Buffer.from(data, 'base64'));
    },
    // A tap (touch pages) or a click (desktop) at CSS pixel (x, y).
    async tap(x, y) {
      if (touch) {
        const points = [{ x, y }];
        await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points });
        await sleep(40);
        await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else {
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
        await sleep(40);
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      }
    },
    // A key press (Tab, Enter, Escape, ' ' for Space), with Shift if asked.
    async key(key, { shift = false } = {}) {
      const codes = { Tab: ['Tab', 9], Enter: ['Enter', 13], Escape: ['Escape', 27], ' ': ['Space', 32] };
      const [code, vk] = codes[key];
      const base = { key, code, windowsVirtualKeyCode: vk, modifiers: shift ? 8 : 0 };
      await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...(key === 'Enter' && { text: '\r' }), ...(key === ' ' && { text: ' ' }) });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    },
    async close() {
      off();
      await conn.send('Target.closeTarget', { targetId }).catch(() => {});
      if (ownContext) await conn.send('Target.disposeBrowserContext', { browserContextId }).catch(() => {});
    },
  };
  return page;
}
