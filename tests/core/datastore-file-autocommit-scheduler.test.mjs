import assert from 'node:assert/strict';
import { mkdir, readFile, rm } from 'node:fs/promises';
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

const createDeferred = () => {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });

  return {
    promise,
    resolve,
  };
};

const waitWithTimeout = async (promise, timeoutMs, label) => {
  const timeout = sleep(timeoutMs).then(() => {
    throw new Error(`Timed out while waiting for ${label}.`);
  });

  await Promise.race([promise, timeout]);
};

test('scheduled auto-commit coalesces triggers and runs follow-up commit for pending writes', async () => {
  const { Datastore } = await loadCore();
  const sandbox = await createSandboxDirectory('file-autocommit-coalescing');
  const filePath = path.join(sandbox, 'events.fpdb');
  const firstCommitAfterSnapshot = createDeferred();
  const releaseFirstCommit = createDeferred();

  let commitCallCount = 0;
  let datastore;

  try {
    datastore = new Datastore({
      location: 'file',
      filePath,
      autoCommit: {
        frequency: 20,
      },
      __testHooks: {
        beforeCommit: () => {
          commitCallCount += 1;
        },
        afterCommit: async () => {
          if (commitCallCount === 1) {
            firstCommitAfterSnapshot.resolve();
            await releaseFirstCommit.promise;
          }
        },
      },
    });

    await datastore.insert({
      timestamp: 1735689600000,
      payload: { id: 'a' },
    });

    await waitWithTimeout(
      firstCommitAfterSnapshot.promise,
      500,
      'first commit snapshot completion',
    );

    await datastore.insert({
      timestamp: 1735689600001,
      payload: { id: 'b' },
    });

    // Ensure periodic scheduler tick fires while first commit is still in-flight.
    await sleep(80);
    releaseFirstCommit.resolve();

    await sleep(180);
    await datastore.close();

    assert.equal(commitCallCount, 2);

    const sidecarPath = `${filePath}.meta.json`;
    const sidecar = JSON.parse(await readFile(sidecarPath, 'utf8'));
    assert.equal(sidecar.commitId, 2);
  } finally {
    releaseFirstCommit.resolve();
    if (datastore !== undefined) {
      await datastore.close();
    }
    await rm(sandbox, { recursive: true, force: true });
  }
});

test('background auto-commit failure emits one error event per failed attempt and retries pending changes', async () => {
  const { Datastore, StorageEngineError } = await loadCore();
  const sandbox = await createSandboxDirectory('file-autocommit-error-channel');
  const filePath = path.join(sandbox, 'events.fpdb');

  const events = [];
  let commitAttemptCount = 0;
  let datastore;

  try {
    datastore = new Datastore({
      location: 'file',
      filePath,
      autoCommit: {
        frequency: 20,
      },
      __testHooks: {
        beforeCommit: () => {
          commitAttemptCount += 1;
          if (commitAttemptCount <= 2) {
            throw new Error('forced background commit failure');
          }
        },
      },
    });

    datastore.on('error', (event) => {
      events.push(event);
    });

    await datastore.insert({
      timestamp: 1735689600000,
      payload: { id: 'retry-target' },
    });

    await sleep(180);
    await datastore.close();

    assert.equal(events.length, 2);
    assert.equal(commitAttemptCount, 3);

    for (const event of events) {
      assert.equal(event.source, 'autoCommit');
      assert.ok(event.error instanceof StorageEngineError);
      assert.equal(typeof event.occurredAt, 'number');
      assert.ok(Number.isSafeInteger(event.occurredAt));
    }

    const reopened = new Datastore({ location: 'file', filePath });
    const rows = await reopened.select({
      start: 1735689600000,
      end: 1735689600000,
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].payload.id, 'retry-target');
    await reopened.close();
  } finally {
    if (datastore !== undefined) {
      await datastore.close();
    }
    await rm(sandbox, { recursive: true, force: true });
  }
});
