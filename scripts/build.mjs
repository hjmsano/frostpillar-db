import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = resolve(ROOT, 'dist');

const run = (cmd) => execSync(cmd, { cwd: ROOT, stdio: 'inherit' });

// --- Entry points --------------------------------------------------------- //

const CJS_ENTRIES = [
  'src/core.ts',
  'src/drivers/file.ts',
  'src/drivers/localStorage.ts',
  'src/drivers/indexedDB.ts',
  'src/drivers/opfs.ts',
  'src/drivers/syncStorage.ts',
];

// --- Steps ---------------------------------------------------------------- //

function emitESMAndDeclarations() {
  run('pnpm exec tsc --project tsconfig.json');
}

function buildCJS() {
  // Bundle each entry point individually (packages stay external)
  run(
    [
      'pnpm exec esbuild',
      ...CJS_ENTRIES,
      '--bundle',
      '--packages=external',
      '--platform=node',
      '--format=cjs',
      '--target=es2022',
      '--outdir=dist',
      '--outbase=src',
      '--out-extension:.js=.cjs',
    ].join(' '),
  );

  // index.cjs — thin re-export of core.cjs (avoids duplicating the entire bundle)
  writeFileSync(
    resolve(DIST, 'index.cjs'),
    `"use strict";\nmodule.exports = require("./core.cjs");\n`,
  );
}

function buildBrowserBundle() {
  run(
    [
      'pnpm exec esbuild src/browser.ts',
      '--bundle --minify',
      '--target=es2020',
      '--platform=browser',
      '--format=iife',
      '--global-name=FrostpillarDB',
      '--outfile=dist/frostpillar-db.min.js',
    ].join(' '),
  );
}

function buildBrowserCoreBundle() {
  run(
    [
      'pnpm exec esbuild src/browser-core.ts',
      '--bundle --minify',
      '--target=es2020',
      '--platform=browser',
      '--format=iife',
      '--global-name=FrostpillarDBCore',
      '--outfile=dist/frostpillar-db-core.min.js',
    ].join(' '),
  );
}

// --- CLI ------------------------------------------------------------------ //

const mode = process.argv[2] ?? 'default';

switch (mode) {
  case 'default':
    emitESMAndDeclarations();
    buildCJS();
    break;
  case 'all':
    emitESMAndDeclarations();
    buildCJS();
    buildBrowserBundle();
    buildBrowserCoreBundle();
    break;
  case 'bundle':
    buildBrowserBundle();
    break;
  case 'bundle:core':
    buildBrowserCoreBundle();
    break;
  default:
    console.error(`Unknown build mode: ${mode}`);
    process.exit(1);
}
