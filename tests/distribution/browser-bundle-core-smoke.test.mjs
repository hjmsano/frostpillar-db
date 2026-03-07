import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { loadCoreModule } from '../core/load-core-module.mjs';

const PROFILE_NAMES = [
  'core',
  'core-indexeddb',
  'core-opfs',
  'core-localstorage',
  'full-browser',
];

const createSandboxDirectory = async (name) => {
  const baseDirectory = path.resolve(process.cwd(), 'tests/.tmp');
  await mkdir(baseDirectory, { recursive: true });
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const sandboxDirectory = path.join(baseDirectory, `${name}-${uniqueSuffix}`);
  await mkdir(sandboxDirectory, { recursive: true });
  return sandboxDirectory;
};

const copyDirectoryRecursive = async (sourceDirectory, targetDirectory) => {
  await mkdir(targetDirectory, { recursive: true });
  const entries = await readdir(sourceDirectory, { withFileTypes: true });

  await Promise.all(
    entries.map(async (entry) => {
      const sourcePath = path.join(sourceDirectory, entry.name);
      const targetPath = path.join(targetDirectory, entry.name);

      if (entry.isDirectory()) {
        await copyDirectoryRecursive(sourcePath, targetPath);
        return;
      }

      if (entry.isFile()) {
        await copyFile(sourcePath, targetPath);
      }
    }),
  );
};

const readJson = async (filePath) => {
  const source = await readFile(filePath, 'utf8');
  return JSON.parse(source);
};

test('browser core bundle smoke verifies runtime import path and profile matrix metadata', async () => {
  await loadCoreModule();

  const bundleScriptHref = pathToFileURL(
    path.resolve(process.cwd(), 'scripts/build-bundles.mjs'),
  ).href;
  const { buildBundleArtifacts } = await import(bundleScriptHref);

  const sandbox = await createSandboxDirectory('browser-bundle-core-smoke');
  const sandboxDistDirectory = path.resolve(sandbox, 'dist');

  try {
    await copyDirectoryRecursive(
      path.resolve(process.cwd(), 'dist/core'),
      path.resolve(sandboxDistDirectory, 'core'),
    );
    await copyDirectoryRecursive(
      path.resolve(process.cwd(), 'dist/queryEngine'),
      path.resolve(sandboxDistDirectory, 'queryEngine'),
    );

    const result = await buildBundleArtifacts({ cwd: sandbox });
    const manifest = await readJson(result.manifestPath);

    const coreProfile = manifest.profiles.find((profile) => profile.name === 'core');
    assert.equal(coreProfile !== undefined, true);

    const bundleEntryUrl = pathToFileURL(path.resolve(sandbox, coreProfile.entry)).href;
    const bundleModule = await import(bundleEntryUrl);

    assert.equal(typeof bundleModule.Datastore, 'function');
    assert.equal(typeof bundleModule.runQueryWithEngine, 'function');

    const datastore = new bundleModule.Datastore({ location: 'memory' });
    await datastore.insert({ timestamp: 10, payload: { value: 100 } });
    const selected = await datastore.select({ start: 10, end: 10 });
    assert.equal(selected.length, 1);
    await datastore.close();

    assert.deepEqual(
      manifest.profileMatrix.map((profile) => profile.name),
      PROFILE_NAMES,
    );

    const publishedProfileNames = manifest.profileMatrix
      .filter((profile) => profile.availability === 'published')
      .map((profile) => profile.name);

    assert.equal(publishedProfileNames.includes('core'), true);

    const publishedProfileSet = new Set(publishedProfileNames);
    for (const profile of manifest.profiles) {
      assert.equal(publishedProfileSet.has(profile.name), true);
    }

    for (const profileName of PROFILE_NAMES) {
      const matrixEntry = manifest.profileMatrix.find(
        (profile) => profile.name === profileName,
      );
      assert.equal(Array.isArray(matrixEntry.backends), true);
      assert.equal(typeof matrixEntry.note, 'string');
      assert.match(matrixEntry.availability, /^(published|planned)$/);
    }
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});
