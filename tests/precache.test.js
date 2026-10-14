// The service worker must precache every app file, or the game breaks offline, and its VERSION must match
// the files, or an update never reaches the phone (sw.js installs a new cache only when sw.js changes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { appFiles, render, version } from '../tools/precache.mjs';

const src = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

test('sw.js precache list matches the files on disk (fix: node tools/precache.mjs)', () => {
  const listed = [...src.matchAll(/^ {2}'(\.\/[^']*)',$/gm)].map((m) => m[1]);
  assert.deepEqual(listed, appFiles());
  for (const f of listed) if (f !== './') assert.ok(existsSync(new URL(`../${f}`, import.meta.url)), `missing ${f}`);
});

test('sw.js VERSION is the hash of the current files (fix: node tools/precache.mjs)', () => {
  assert.match(src, new RegExp(`^const VERSION = '${version()}';$`, 'm'));
  assert.equal(render(src), src);
});
