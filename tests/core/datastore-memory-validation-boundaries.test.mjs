import assert from 'node:assert/strict';
import test from 'node:test';
import { loadCoreModule } from './load-core-module.mjs';

const loadCore = async () => await loadCoreModule();

const createNestedPayload = (depth) => {
  const payload = {};
  let cursor = payload;

  for (let index = 0; index < depth; index += 1) {
    const key = `k${index}`;
    cursor[key] = {};
    cursor = cursor[key];
  }

  cursor.leaf = 'ok';
  return payload;
};

test('insert normalizes timestamp input from number/string/date to epoch milliseconds', async () => {
  const { Datastore } = await loadCore();
  const datastore = new Datastore({ location: 'memory' });

  await datastore.insert({
    timestamp: '2025-01-01T00:00:00.000Z',
    payload: { id: 's' },
  });
  await datastore.insert({
    timestamp: new Date('2025-01-01T00:00:00.000Z'),
    payload: { id: 'd' },
  });
  await datastore.insert({
    timestamp: 1735689600000,
    payload: { id: 'n' },
  });

  const rows = await datastore.select({
    start: 1735689600000,
    end: 1735689600000,
  });

  assert.deepEqual(
    rows.map((row) => row.timestamp),
    [1735689600000, 1735689600000, 1735689600000],
  );
});

test('insert rejects invalid timestamp formats and safe-integer overflow', async () => {
  const { Datastore, TimestampParseError, ValidationError } = await loadCore();
  const datastore = new Datastore({ location: 'memory' });

  await assert.rejects(
    async () => {
      await datastore.insert({
        timestamp: '2025-01-01T00:00:00',
        payload: { id: 'timezone-missing' },
      });
    },
    TimestampParseError,
  );

  await assert.rejects(
    async () => {
      await datastore.insert({
        timestamp: 'not-a-date',
        payload: { id: 'invalid' },
      });
    },
    TimestampParseError,
  );

  await assert.rejects(
    async () => {
      await datastore.insert({
        timestamp: Number.MAX_SAFE_INTEGER + 1,
        payload: { id: 'unsafe' },
      });
    },
    ValidationError,
  );
});

test('insert rejects user-provided insertionOrder metadata', async () => {
  const { Datastore, ValidationError } = await loadCore();
  const datastore = new Datastore({ location: 'memory' });

  await assert.rejects(
    async () => {
      await datastore.insert({
        timestamp: 1735689600000,
        payload: { id: 'manual-order' },
        insertionOrder: 42n,
      });
    },
    ValidationError,
  );
});

test('insert enforces payload boundaries for depth, key/value length and value types', async () => {
  const { Datastore, ValidationError } = await loadCore();
  const datastore = new Datastore({ location: 'memory' });

  await assert.doesNotReject(async () => {
    await datastore.insert({
      timestamp: 1735689600000,
      payload: createNestedPayload(64),
    });
  });

  await assert.rejects(
    async () => {
      await datastore.insert({
        timestamp: 1735689600001,
        payload: createNestedPayload(65),
      });
    },
    ValidationError,
  );

  await assert.rejects(
    async () => {
      await datastore.insert({
        timestamp: 1735689600002,
        payload: { arr: [] },
      });
    },
    ValidationError,
  );

  await assert.rejects(
    async () => {
      await datastore.insert({
        timestamp: 1735689600003,
        payload: { id: 1n },
      });
    },
    ValidationError,
  );

  await assert.rejects(
    async () => {
      await datastore.insert({
        timestamp: 1735689600004,
        payload: { value: Number.POSITIVE_INFINITY },
      });
    },
    ValidationError,
  );

  await assert.rejects(
    async () => {
      await datastore.insert({
        timestamp: 1735689600005,
        payload: { '': 'empty-key' },
      });
    },
    ValidationError,
  );

  await assert.rejects(
    async () => {
      await datastore.insert({
        timestamp: 1735689600006,
        payload: { [new Array(1026).join('k')]: 'too-long-key' },
      });
    },
    ValidationError,
  );

  await assert.rejects(
    async () => {
      await datastore.insert({
        timestamp: 1735689600007,
        payload: { value: new Array(65537).join('x') },
      });
    },
    ValidationError,
  );

  const circularPayload = {};
  circularPayload.self = circularPayload;

  await assert.rejects(
    async () => {
      await datastore.insert({
        timestamp: 1735689600008,
        payload: circularPayload,
      });
    },
    ValidationError,
  );
});
