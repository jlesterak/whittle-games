// Every app module must parse and link (imports resolve, named exports exist). Most game.js and
// render.js files have no unit tests, so a typo in an import would otherwise only show on the phone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appFiles } from '../tools/precache.mjs';

const modules = appFiles().filter((f) => f.endsWith('.js'));

test('every app module parses and links', async () => {
  assert.ok(modules.length > 40);
  for (const f of modules) {
    try {
      await import(new URL(`.${f.slice(1)}`, new URL('../', import.meta.url)));
    } catch (e) {
      // core/app.js starts the shell and needs a DOM: a ReferenceError there means it linked fine.
      if (f === './core/app.js' && e instanceof ReferenceError) continue;
      assert.fail(`${f}: ${e.message}`);
    }
  }
});
