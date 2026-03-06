import assert from 'node:assert/strict';
import test from 'node:test';
import { loadCoreModule } from './load-core-module.mjs';

const loadCore = async () => await loadCoreModule();

test('memory datastore initializes and rejects out-of-scope backend configs in M1', async () => {
  const {
    Datastore,
    ConfigurationError,
    UnsupportedBackendError,
  } = await loadCore();

  assert.doesNotThrow(() => {
    new Datastore({ location: 'memory' });
  });

  assert.throws(
    () => {
      new Datastore({
        location: 'memory',
        autoCommit: { frequency: 'immediate' },
      });
    },
    ConfigurationError,
  );

  assert.throws(
    () => {
      new Datastore({ location: 'file' });
    },
    UnsupportedBackendError,
  );

  assert.throws(
    () => {
      new Datastore({ location: 'browser' });
    },
    UnsupportedBackendError,
  );
});

test('insert/select returns inclusive range in deterministic timestamp and insertion order', async () => {
  const { Datastore } = await loadCore();
  const datastore = new Datastore({ location: 'memory' });

  await datastore.insert({
    timestamp: '2025-01-01T00:00:01.000Z',
    payload: { id: 'b1' },
  });
  await datastore.insert({
    timestamp: '2025-01-01T00:00:00.000Z',
    payload: { id: 'a1' },
  });
  await datastore.insert({
    timestamp: new Date('2025-01-01T00:00:01.000Z'),
    payload: { id: 'b2' },
  });
  await datastore.insert({
    timestamp: 1735689600000,
    payload: { id: 'a2' },
  });

  const rows = await datastore.select({
    start: '2025-01-01T00:00:00.000Z',
    end: '2025-01-01T00:00:01.000Z',
  });

  assert.equal(rows.length, 4);
  assert.deepEqual(
    rows.map((row) => row.timestamp),
    [1735689600000, 1735689600000, 1735689601000, 1735689601000],
  );
  assert.deepEqual(
    rows.map((row) => row.payload.id),
    ['a1', 'a2', 'b1', 'b2'],
  );
  assert.equal('insertionOrder' in rows[0], false);
});

test('close is idempotent and operations reject with ClosedDatastoreError', async () => {
  const { ClosedDatastoreError, Datastore } = await loadCore();
  const datastore = new Datastore({ location: 'memory' });

  await datastore.insert({
    timestamp: 1735689600000,
    payload: { id: 'seed' },
  });

  await datastore.close();
  await datastore.close();

  await assert.rejects(
    async () => {
      await datastore.insert({
        timestamp: 1735689600000,
        payload: { id: 'after-close' },
      });
    },
    ClosedDatastoreError,
  );
  await assert.rejects(
    async () => {
      await datastore.select({
        start: 1735689600000,
        end: 1735689600000,
      });
    },
    ClosedDatastoreError,
  );
  await assert.rejects(
    async () => {
      await datastore.commit();
    },
    ClosedDatastoreError,
  );
});

test('select rejects invalid range when start is greater than end', async () => {
  const { Datastore, InvalidQueryRangeError } = await loadCore();
  const datastore = new Datastore({ location: 'memory' });

  await datastore.insert({
    timestamp: 1735689600000,
    payload: { id: 'seed' },
  });

  await assert.rejects(
    async () => {
      await datastore.select({
        start: 1735689600001,
        end: 1735689600000,
      });
    },
    InvalidQueryRangeError,
  );
});
