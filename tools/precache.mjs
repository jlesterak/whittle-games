// Regenerates the FILES list in sw.js from the files on disk, and VERSION from their contents.
// Usage: node tools/precache.mjs        (rewrites sw.js)
//        node tools/precache.mjs --check (exit 1 if sw.js is out of date)
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '../..');
const TOP = ['index.html', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];
const DIRS = ['core', 'engines', 'games'];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

// root: the app folder (default this repo; tools/smoke.mjs --sw passes a temporary copy).
export function appFiles(root = ROOT) {
  const files = DIRS.flatMap((d) => walk(join(root, d))).map((p) => relative(root, p));
  return ['./', ...TOP, ...files.sort()].map((f) => (f === './' ? f : `./${f}`));
}

// A short hash of every precached file's path and bytes: any change to any app file changes it.
export function version(files = appFiles(), root = ROOT) {
  const h = createHash('sha256');
  for (const f of files) {
    if (f === './') continue;
    h.update(`${f}\0`);
    h.update(readFileSync(join(root, f)));
  }
  return h.digest('hex').slice(0, 12);
}

export { TOP, DIRS };

export function render(src, root = ROOT) {
  const files = appFiles(root);
  const list = files.map((f) => `  '${f}',`).join('\n');
  return src
    .replace(/( *\/\/ @precache-start\n)[\s\S]*?( *\/\/ @precache-end)/, `$1${list}\n$2`)
    .replace(/^const VERSION = '[^']*';/m, `const VERSION = '${version(files, root)}';`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = join(ROOT, 'sw.js');
  const src = readFileSync(path, 'utf8');
  const out = render(src);
  if (process.argv.includes('--check')) {
    if (out !== src) {
      console.error('sw.js FILES or VERSION is out of date: run node tools/precache.mjs');
      process.exit(1);
    }
  } else {
    writeFileSync(path, out);
    console.log(`sw.js: ${appFiles().length} files, version ${version()}`);
  }
}
