import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
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

test('file backend uses durable immediate auto-commit default when autoCommit is omitted', async () => {
  const { Datastore } = await loadCore();
  const sandbox = await createSandboxDirectory('file-autocommit-default-omitted');
  const filePath = path.join(sandbox, 'events.fpdb');

  try {
    const first = new Datastore({ location: 'file', filePath });
    await first.insert({
      timestamp: '2025-01-01T00:00:00.000Z',
      payload: { id: 'persisted' },
    });
    await first.close();

    const reopened = new Datastore({ location: 'file', filePath });
    const rows = await reopened.select({
      start: '2025-01-01T00:00:00.000Z',
      end: '2025-01-01T00:00:00.000Z',
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].payload.id, 'persisted');
    await reopened.close();
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test('file backend uses durable immediate auto-commit default when autoCommit is empty object', async () => {
  const { Datastore } = await loadCore();
  const sandbox = await createSandboxDirectory('file-autocommit-default-empty');
  const filePath = path.join(sandbox, 'events.fpdb');

  try {
    const first = new Datastore({ location: 'file', filePath, autoCommit: {} });
    await first.insert({
      timestamp: '2025-01-01T00:00:00.000Z',
      payload: { id: 'persisted' },
    });
    await first.close();

    const reopened = new Datastore({ location: 'file', filePath });
    const rows = await reopened.select({
      start: '2025-01-01T00:00:00.000Z',
      end: '2025-01-01T00:00:00.000Z',
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].payload.id, 'persisted');
    await reopened.close();
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test('file backend supports periodic auto-commit for non-immediate frequency', async () => {
  const { Datastore } = await loadCore();
  const sandbox = await createSandboxDirectory('file-autocommit-periodic');
  const filePath = path.join(sandbox, 'events.fpdb');

  try {
    const first = new Datastore({
      location: 'file',
      filePath,
      autoCommit: { frequency: 20 },
    });
    await first.insert({
      timestamp: '2025-01-01T00:00:00.000Z',
      payload: { id: 'periodic' },
    });

    await sleep(80);
    await first.close();

    const reopened = new Datastore({ location: 'file', filePath });
    const rows = await reopened.select({
      start: '2025-01-01T00:00:00.000Z',
      end: '2025-01-01T00:00:00.000Z',
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].payload.id, 'periodic');
    await reopened.close();
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test('file backend supports size-threshold auto-commit with non-immediate frequency', async () => {
  const { Datastore } = await loadCore();
  const sandbox = await createSandboxDirectory('file-autocommit-size-threshold');
  const filePath = path.join(sandbox, 'events.fpdb');

  try {
    const first = new Datastore({
      location: 'file',
      filePath,
      autoCommit: {
        frequency: '1h',
        maxPendingBytes: 1,
      },
    });
    await first.insert({
      timestamp: '2025-01-01T00:00:00.000Z',
      payload: { id: 'threshold' },
    });
    await first.close();

    const reopened = new Datastore({ location: 'file', filePath });
    const rows = await reopened.select({
      start: '2025-01-01T00:00:00.000Z',
      end: '2025-01-01T00:00:00.000Z',
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].payload.id, 'threshold');
    await reopened.close();
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});
