import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
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

test('queryNative like/regexp enforce pattern safety guardrails', async () => {
  const { Datastore, QueryValidationError } = await loadCore();
  const datastore = new Datastore({ location: 'memory' });

  await datastore.insert({
    timestamp: 1735689600000,
    payload: {
      code: 'sensor-42',
      message: 'error.alpha',
    },
  });

  const likeRows = await datastore.queryNative({
    where: {
      field: 'message',
      operator: 'like',
      value: 'error.%',
    },
  });
  assert.equal(likeRows.length, 1);
  assert.equal(likeRows[0].message, 'error.alpha');

  const regexpRows = await datastore.queryNative({
    where: {
      field: 'code',
      operator: 'regexp',
      value: '^sensor-[0-9]+$',
    },
  });
  assert.equal(regexpRows.length, 1);
  assert.equal(regexpRows[0].code, 'sensor-42');

  await assert.rejects(
    async () => {
      await datastore.queryNative({
        where: {
          field: 'code',
          operator: 'regexp',
          value: '(a+)+$',
        },
      });
    },
    QueryValidationError,
  );

  await assert.rejects(
    async () => {
      await datastore.queryNative({
        where: {
          field: 'code',
          operator: 'regexp',
          value: 'a(?=b)',
        },
      });
    },
    QueryValidationError,
  );

  await assert.rejects(
    async () => {
      await datastore.queryNative({
        where: {
          field: 'message',
          operator: 'like',
          value: 'a'.repeat(257),
        },
      });
    },
    QueryValidationError,
  );
});

test('file datastore rejects path traversal and path escape outside cwd', async () => {
  const { ConfigurationError, Datastore } = await loadCore();
  const sandbox = await createSandboxDirectory('security-hardening-paths');
  const safeFilePath = path.join(sandbox, 'safe.fpdb');
  const escapedTargetPath = path.resolve('/tmp', 'frostpillar-security-escape.fpdb');
  const nestedDirectory = path.join(sandbox, 'nested');

  try {
    const safe = new Datastore({ location: 'file', filePath: safeFilePath });
    await safe.close();

    assert.throws(
      () => {
        new Datastore({
          location: 'file',
          target: {
            kind: 'directory',
            directory: nestedDirectory,
            fileName: '../escape',
          },
        });
      },
      ConfigurationError,
    );

    assert.throws(
      () => {
        new Datastore({
          location: 'file',
          target: {
            kind: 'directory',
            directory: nestedDirectory,
            filePrefix: '..\\',
            fileName: 'events',
          },
        });
      },
      ConfigurationError,
    );

    assert.throws(
      () => {
        new Datastore({
          location: 'file',
          filePath: escapedTargetPath,
        });
      },
      ConfigurationError,
    );
  } finally {
    await rm(sandbox, { recursive: true, force: true });
    await rm(escapedTargetPath, { force: true });
    await rm(`${escapedTargetPath}.lock`, { force: true });
    await rm(`${escapedTargetPath}.meta.json`, { force: true });
    await rm(`${escapedTargetPath}.g.0`, { force: true });
  }
});
