// Regenerates the FILES list in sw.js from the files on disk.
// Usage: node tools/precache.mjs        (rewrites sw.js)
//        node tools/precache.mjs --check (exit 1 if sw.js is out of date)
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

export function appFiles() {
  const files = DIRS.flatMap((d) => walk(join(ROOT, d))).map((p) => relative(ROOT, p));
  return ['./', ...TOP, ...files.sort()].map((f) => (f === './' ? f : `./${f}`));
}

export function render(src) {
  const list = appFiles().map((f) => `  '${f}',`).join('\n');
  return src.replace(/( *\/\/ @precache-start\n)[\s\S]*?( *\/\/ @precache-end)/, `$1${list}\n$2`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = join(ROOT, 'sw.js');
  const src = readFileSync(path, 'utf8');
  const out = render(src);
  if (process.argv.includes('--check')) {
    if (out !== src) {
      console.error('sw.js FILES is out of date: run node tools/precache.mjs');
      process.exit(1);
    }
  } else {
    writeFileSync(path, out);
    console.log(`sw.js: ${appFiles().length} files`);
  }
}
