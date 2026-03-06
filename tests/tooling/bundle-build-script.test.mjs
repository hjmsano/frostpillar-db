import assert from 'node:assert/strict';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const readJson = async (filePath) => {
  const source = await readFile(filePath, 'utf8');
  return JSON.parse(source);
};

const createSandboxDirectory = async (name) => {
  const baseDir = path.resolve(process.cwd(), 'tests/.tmp');
  await mkdir(baseDir, { recursive: true });
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const directory = path.join(baseDir, `${name}-${uniqueSuffix}`);
  await mkdir(directory, { recursive: true });
  return directory;
};

const pathExists = async (targetPath) => {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
};

const writeFixtureDist = async (sandboxRoot) => {
  const files = {
    'dist/core/index.js': "export * from './types.js';\n",
    'dist/core/types.js': "export const FROSTPILLAR_FIXTURE = true;\n",
    'dist/core/index.d.ts': "export * from './types.js';\n",
    'dist/core/types.d.ts': 'export declare const FROSTPILLAR_FIXTURE: boolean;\n',
    'dist/queryEngine/runQueryWithEngine.js':
      'export const runQueryWithEngine = () => [];\n',
    'dist/queryEngine/runQueryWithEngine.d.ts':
      'export declare const runQueryWithEngine: () => unknown[];\n',
  };

  await Promise.all(
    Object.entries(files).map(async ([relativePath, source]) => {
      const absolutePath = path.resolve(sandboxRoot, relativePath);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, source, 'utf8');
    }),
  );
};

test('package.json defines build:bundle script wiring', async () => {
  const packageJsonPath = path.resolve(process.cwd(), 'package.json');
  const packageJson = await readJson(packageJsonPath);
  const scripts = packageJson.scripts ?? {};

  assert.equal(scripts['build:bundle'], 'node ./scripts/build-bundles.mjs');
});

test('build bundle script emits core profile entry files and manifest', async () => {
  const bundleScriptHref = pathToFileURL(
    path.resolve(process.cwd(), 'scripts/build-bundles.mjs'),
  ).href;
  const { buildBundleArtifacts } = await import(bundleScriptHref);

  const sandbox = await createSandboxDirectory('bundle-build-script');

  try {
    await writeFixtureDist(sandbox);

    const result = await buildBundleArtifacts({
      cwd: sandbox,
    });

    assert.equal(typeof result.manifestPath, 'string');

    const bundleEntryPath = path.resolve(
      sandbox,
      'dist/bundles/core/frostpillar-core.js',
    );
    const bundleEntryTypesPath = path.resolve(
      sandbox,
      'dist/bundles/core/frostpillar-core.d.ts',
    );
    const manifestPath = path.resolve(sandbox, 'dist/bundles/manifest.json');

    assert.equal(await pathExists(bundleEntryPath), true);
    assert.equal(await pathExists(bundleEntryTypesPath), true);
    assert.equal(await pathExists(manifestPath), true);

    const bundleEntrySource = await readFile(bundleEntryPath, 'utf8');
    assert.match(bundleEntrySource, /export \* from '\.\/core\/index\.js';/);
    assert.match(
      bundleEntrySource,
      /export \* from '\.\/queryEngine\/runQueryWithEngine\.js';/,
    );

    const manifestSource = await readFile(manifestPath, 'utf8');
    const manifestJson = JSON.parse(manifestSource);

    assert.equal(manifestJson.profiles[0]?.name, 'core');
    assert.equal(
      manifestJson.profiles[0]?.entry,
      'dist/bundles/core/frostpillar-core.js',
    );
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test('build bundle script fails with actionable error when dist input is missing', async () => {
  const bundleScriptHref = pathToFileURL(
    path.resolve(process.cwd(), 'scripts/build-bundles.mjs'),
  ).href;
  const { buildBundleArtifacts } = await import(bundleScriptHref);

  const sandbox = await createSandboxDirectory('bundle-build-script-missing-input');

  try {
    await assert.rejects(
      async () => {
        await buildBundleArtifacts({
          cwd: sandbox,
        });
      },
      /run `pnpm build` first/i,
    );
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});
