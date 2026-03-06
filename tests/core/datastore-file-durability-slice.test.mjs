import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { loadCoreModule } from './load-core-module.mjs';

const loadCore = async () => await loadCoreModule();

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

const runIndependentOpenAttempt = (coreModuleHref, filePath) => {
  const script = `
const coreModuleHref = process.argv[1];
const filePath = process.argv[2];
const { Datastore } = await import(coreModuleHref);

try {
  const datastore = new Datastore({ location: 'file', filePath });
  await datastore.close();
  process.stdout.write('OPEN_OK');
} catch (error) {
  const errorName = error instanceof Error ? error.name : 'UnknownError';
  process.stdout.write(\`OPEN_ERROR:\${errorName}\`);
}
`;

  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', script, coreModuleHref, filePath],
    {
      encoding: 'utf8',
    },
  );
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `Independent process open attempt failed unexpectedly.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  }

  return result.stdout.trim();
};

test('file backend rejects independent-process open while locked and allows reopen after close', async () => {
  const { Datastore } = await loadCore();
  const sandbox = await createSandboxDirectory('file-durability-lock-lifecycle');
  const filePath = path.join(sandbox, 'events.fpdb');
  const coreModuleHref = pathToFileURL(
    path.resolve(process.cwd(), 'dist/core/index.js'),
  ).href;

  try {
    const first = new Datastore({ location: 'file', filePath });

    const conflictAttempt = runIndependentOpenAttempt(coreModuleHref, filePath);
    assert.equal(
      conflictAttempt,
      'OPEN_ERROR:DatabaseLockedError',
    );

    await first.close();

    const reopenAttempt = runIndependentOpenAttempt(coreModuleHref, filePath);
    assert.equal(reopenAttempt, 'OPEN_OK');
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test('file backend keeps in-process exclusive lock and persists records across commit/reopen', async () => {
  const { DatabaseLockedError, Datastore } = await loadCore();
  const sandbox = await createSandboxDirectory('file-durability-lock');
  const filePath = path.join(sandbox, 'events.fpdb');

  try {
    const first = new Datastore({ location: 'file', filePath });
    assert.throws(() => {
      new Datastore({ location: 'file', filePath });
    }, DatabaseLockedError);

    await first.insert({
      timestamp: '2025-01-01T00:00:00.000Z',
      payload: { id: 'a' },
    });
    await first.insert({
      timestamp: '2025-01-01T00:00:01.000Z',
      payload: { id: 'b' },
    });
    await first.commit();
    await first.close();

    const reopened = new Datastore({ location: 'file', filePath });
    const rows = await reopened.select({
      start: '2025-01-01T00:00:00.000Z',
      end: '2025-01-01T00:00:01.000Z',
    });
    assert.deepEqual(
      rows.map((row) => row.payload.id),
      ['a', 'b'],
    );
    await reopened.close();

    const reopenedAfterClose = new Datastore({ location: 'file', filePath });
    await reopenedAfterClose.close();
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test('file open ignores or removes interrupted-commit temp files and keeps committed state', async () => {
  const { Datastore } = await loadCore();
  const sandbox = await createSandboxDirectory('file-durability-temp-recovery');
  const filePath = path.join(sandbox, 'events.fpdb');
  const tempGenerationPath = `${filePath}.g.999.tmp`;
  const tempSidecarPath = `${filePath}.meta.json.tmp`;

  try {
    const first = new Datastore({ location: 'file', filePath });
    await first.insert({
      timestamp: 1735689600000,
      payload: { id: 'seed' },
    });
    await first.commit();
    await first.close();

    await writeFile(tempGenerationPath, 'interrupted-generation', 'utf8');
    await writeFile(tempSidecarPath, '{"interrupted":true}', 'utf8');

    const reopened = new Datastore({ location: 'file', filePath });
    const rows = await reopened.select({
      start: 1735689600000,
      end: 1735689600000,
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].payload.id, 'seed');
    await reopened.close();

    assert.equal(await pathExists(tempGenerationPath), false);
    assert.equal(await pathExists(tempSidecarPath), false);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test('file open fails with typed corruption error for sidecar corrupt header magic', async () => {
  const { Datastore, PageCorruptionError } = await loadCore();
  const sandbox = await createSandboxDirectory('file-durability-sidecar-magic');
  const filePath = path.join(sandbox, 'events.fpdb');
  const sidecarPath = `${filePath}.meta.json`;

  try {
    const first = new Datastore({ location: 'file', filePath });
    await first.insert({
      timestamp: 1735689600000,
      payload: { id: 'seed' },
    });
    await first.commit();
    await first.close();

    const sidecarSource = await readFile(sidecarPath, 'utf8');
    const sidecarJson = JSON.parse(sidecarSource);
    sidecarJson.magic = 'FPGE_META_CORRUPT';
    await writeFile(sidecarPath, JSON.stringify(sidecarJson, null, 2), 'utf8');

    assert.throws(() => {
      new Datastore({ location: 'file', filePath });
    }, PageCorruptionError);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test('file open fails with typed corruption error for unsupported sidecar version', async () => {
  const { Datastore, PageCorruptionError } = await loadCore();
  const sandbox = await createSandboxDirectory(
    'file-durability-sidecar-version',
  );
  const filePath = path.join(sandbox, 'events.fpdb');
  const sidecarPath = `${filePath}.meta.json`;

  try {
    const first = new Datastore({ location: 'file', filePath });
    await first.insert({
      timestamp: 1735689600000,
      payload: { id: 'seed' },
    });
    await first.commit();
    await first.close();

    const sidecarSource = await readFile(sidecarPath, 'utf8');
    const sidecarJson = JSON.parse(sidecarSource);
    sidecarJson.version = 999;
    await writeFile(sidecarPath, JSON.stringify(sidecarJson, null, 2), 'utf8');

    assert.throws(() => {
      new Datastore({ location: 'file', filePath });
    }, PageCorruptionError);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test('file open fails with typed corruption error when sidecar points to missing active generation', async () => {
  const { Datastore, PageCorruptionError } = await loadCore();
  const sandbox = await createSandboxDirectory('file-durability-corruption');
  const filePath = path.join(sandbox, 'events.fpdb');
  const sidecarPath = `${filePath}.meta.json`;

  try {
    const first = new Datastore({ location: 'file', filePath });
    await first.insert({
      timestamp: 1735689600000,
      payload: { id: 'seed' },
    });
    await first.commit();
    await first.close();

    const sidecarSource = await readFile(sidecarPath, 'utf8');
    const sidecarJson = JSON.parse(sidecarSource);
    sidecarJson.activeDataFile = 'events.fpdb.g.999999';
    await writeFile(sidecarPath, JSON.stringify(sidecarJson, null, 2), 'utf8');

    assert.throws(
      () => {
        new Datastore({ location: 'file', filePath });
      },
      PageCorruptionError,
    );
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test('file open fails with typed corruption error when sidecar activeDataFile is invalid type', async () => {
  const { Datastore, PageCorruptionError } = await loadCore();
  const sandbox = await createSandboxDirectory(
    'file-durability-active-data-file-invalid-type',
  );
  const filePath = path.join(sandbox, 'events.fpdb');
  const sidecarPath = `${filePath}.meta.json`;

  try {
    const first = new Datastore({ location: 'file', filePath });
    await first.insert({
      timestamp: 1735689600000,
      payload: { id: 'seed' },
    });
    await first.commit();
    await first.close();

    const sidecarSource = await readFile(sidecarPath, 'utf8');
    const sidecarJson = JSON.parse(sidecarSource);
    sidecarJson.activeDataFile = 12345;
    await writeFile(sidecarPath, JSON.stringify(sidecarJson, null, 2), 'utf8');

    assert.throws(() => {
      new Datastore({ location: 'file', filePath });
    }, PageCorruptionError);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test('file open fails when sidecar mirrored metadata does not match active generation metadata', async () => {
  const { Datastore, PageCorruptionError } = await loadCore();
  const sandbox = await createSandboxDirectory(
    'file-durability-sidecar-metadata-mismatch',
  );
  const filePath = path.join(sandbox, 'events.fpdb');
  const sidecarPath = `${filePath}.meta.json`;

  try {
    const first = new Datastore({ location: 'file', filePath });
    await first.insert({
      timestamp: 1735689600000,
      payload: { id: 'seed' },
    });
    await first.commit();
    await first.close();

    const sidecarSource = await readFile(sidecarPath, 'utf8');
    const sidecarJson = JSON.parse(sidecarSource);
    sidecarJson.nextPageId += 1;
    await writeFile(sidecarPath, JSON.stringify(sidecarJson, null, 2), 'utf8');

    assert.throws(() => {
      new Datastore({ location: 'file', filePath });
    }, PageCorruptionError);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test('file backend restart resumes insertion-order allocator from sidecar metadata', async () => {
  const { Datastore } = await loadCore();
  const sandbox = await createSandboxDirectory(
    'file-durability-insertion-order-continuity',
  );
  const filePath = path.join(sandbox, 'events.fpdb');

  try {
    const first = new Datastore({ location: 'file', filePath });
    await first.insert({
      timestamp: '2025-01-01T00:00:00.000Z',
      payload: { id: 'a' },
    });
    await first.insert({
      timestamp: '2025-01-01T00:00:00.000Z',
      payload: { id: 'b' },
    });
    await first.commit();
    await first.close();

    const second = new Datastore({ location: 'file', filePath });
    await second.insert({
      timestamp: '2025-01-01T00:00:00.000Z',
      payload: { id: 'c' },
    });
    await second.commit();
    await second.close();

    const reopened = new Datastore({ location: 'file', filePath });
    const rows = await reopened.select({
      start: '2025-01-01T00:00:00.000Z',
      end: '2025-01-01T00:00:00.000Z',
    });
    assert.deepEqual(
      rows.map((row) => row.payload.id),
      ['a', 'b', 'c'],
    );
    await reopened.close();
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});
