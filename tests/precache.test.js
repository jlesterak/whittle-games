// The service worker must precache every app file, or the game breaks offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { appFiles } from '../tools/precache.mjs';

test('sw.js precache list matches the files on disk (fix: node tools/precache.mjs)', () => {
  const src = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const listed = [...src.matchAll(/^ {2}'(\.\/[^']*)',$/gm)].map((m) => m[1]);
  assert.deepEqual(listed, appFiles());
  for (const f of listed) if (f !== './') assert.ok(existsSync(new URL(`../${f}`, import.meta.url)), `missing ${f}`);
});
