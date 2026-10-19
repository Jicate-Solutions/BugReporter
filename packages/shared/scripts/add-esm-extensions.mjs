/*
  Give the compiled output the file extensions Node's ESM loader requires.

  TypeScript rewrites import specifiers for nobody: whatever the source says is
  what lands in dist. The source has to say `./types`, because this package is
  also consumed here as raw TypeScript through a `file:` dependency and
  Turbopack will not resolve `./types.js` to `types.ts` — writing it the other
  way breaks `next build` with the barrel's exports silently missing.

  Bundlers do not care either way. Node does: an extensionless specifier in a
  published ESM file answers ERR_MODULE_NOT_FOUND on the first hop out of
  index.js. Since the package is published for an SDK whose bundling we do not
  control, the shipped artifact gets real paths and the source keeps the ones
  this repo can build.

  Only relative specifiers are touched, and only those without an extension, so
  running it twice is a no-op.
*/
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not URL.pathname: on Windows the latter yields "/D:/…", which
// join() then turns into "D:\D:\…".
const DIST = fileURLToPath(new URL('../dist/', import.meta.url));

/** `from './x'` / `from '../y/z'` — but not `'./x.js'` and not `'pkg'`. */
const SPECIFIER = /(\bfrom\s*['"])(\.{1,2}\/[^'"]*?)(['"])/g;

async function* jsFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* jsFiles(path);
    else if (entry.name.endsWith('.js')) yield path;
  }
}

let changed = 0;

for await (const file of jsFiles(DIST)) {
  const before = await readFile(file, 'utf8');
  const after = before.replace(SPECIFIER, (match, open, spec, close) => {
    // Already carries an extension, or points at a directory index we would
    // have to guess at — leave both alone rather than guess wrong.
    if (/\.[a-z]+$/i.test(spec)) return match;
    return `${open}${spec}.js${close}`;
  });

  if (after !== before) {
    await writeFile(file, after);
    changed += 1;
  }
}

console.log(`add-esm-extensions: rewrote ${changed} file(s) in dist`);
