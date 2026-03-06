import assert from 'node:assert/strict';
import test from 'node:test';
import { loadCoreModule } from './load-core-module.mjs';

const loadCore = async () => await loadCoreModule();

const createFilterEngine = (language) => {
  return {
    language,
    toNativeQuery: (queryText, options) => {
      if (
        queryText !== 'sensor=a' &&
        queryText !== 'sensor:a' &&
        queryText !== 'value>10'
      ) {
        throw new Error(`Unexpected queryText in test engine: ${queryText}`);
      }

      const where =
        queryText === 'value>10'
          ? { field: 'value', operator: '>', value: 10 }
          : { field: 'sensor', operator: '=', value: 'a' };

      return {
        where,
        select: options?.select,
        orderBy: options?.orderBy,
        limit: options?.limit,
        distinct: options?.distinct,
      };
    },
  };
};

test('strict capacity rejects overflow insert with QuotaExceededError', async () => {
  const { Datastore, QuotaExceededError } = await loadCore();
  const datastore = new Datastore({
    location: 'memory',
    capacity: {
      maxSize: '1B',
      policy: 'strict',
    },
  });

  await assert.rejects(
    async () => {
      await datastore.insert({
        timestamp: 1735689600000,
        payload: { id: 'too-large' },
      });
    },
    QuotaExceededError,
  );
});

test('turnover capacity evicts oldest records deterministically before insert', async () => {
  const { Datastore } = await loadCore();
  const datastore = new Datastore({
    location: 'memory',
    capacity: {
      maxSize: '500B',
      policy: 'turnover',
    },
  });

  await datastore.insert({
    timestamp: 1735689600000,
    payload: {
      id: 'a',
      blob: 'x'.repeat(300),
    },
  });
  await datastore.insert({
    timestamp: 1735689600001,
    payload: {
      id: 'b',
      blob: 'y'.repeat(300),
    },
  });

  const rows = await datastore.select({
    start: 1735689600000,
    end: 1735689600001,
  });

  assert.deepEqual(
    rows.map((row) => row.payload.id),
    ['b'],
  );
});

test('integrated query path keeps parity with native query and runQueryWithEngine', async () => {
  const {
    Datastore,
    QueryEngineNotRegisteredError,
    runQueryWithEngine,
  } = await loadCore();
  const datastore = new Datastore({ location: 'memory' });

  await datastore.insert({
    timestamp: 1735689600000,
    payload: { sensor: 'a', value: 11 },
  });
  await datastore.insert({
    timestamp: 1735689600001,
    payload: { sensor: 'b', value: 20 },
  });
  await datastore.insert({
    timestamp: 1735689600002,
    payload: { sensor: 'a', value: 5 },
  });

  await assert.rejects(
    async () => {
      await datastore.query('sql', 'sensor=a');
    },
    QueryEngineNotRegisteredError,
  );

  const sqlEngine = createFilterEngine('sql');
  const luceneEngine = createFilterEngine('lucene');
  datastore.registerQueryEngine(sqlEngine);
  datastore.registerQueryEngine(luceneEngine);

  const options = {
    select: ['timestamp', 'sensor', 'value'],
    orderBy: [{ field: 'timestamp', direction: 'asc' }],
    limit: 1,
  };

  const nativeRequest = sqlEngine.toNativeQuery('sensor=a', options);
  const nativeRows = await datastore.queryNative(nativeRequest);
  const sqlRows = await datastore.query('sql', 'sensor=a', options);
  const luceneRows = await datastore.query('lucene', 'sensor:a', options);
  const runnerRows = await runQueryWithEngine(
    datastore,
    sqlEngine,
    'sensor=a',
    options,
  );

  assert.deepEqual(sqlRows, nativeRows);
  assert.deepEqual(luceneRows, nativeRows);
  assert.deepEqual(runnerRows, nativeRows);
});

test('query registry and query operations reject with ClosedDatastoreError after close', async () => {
  const { ClosedDatastoreError, Datastore } = await loadCore();
  const datastore = new Datastore({ location: 'memory' });
  const sqlEngine = createFilterEngine('sql');

  await datastore.close();

  assert.throws(
    () => {
      datastore.registerQueryEngine(sqlEngine);
    },
    ClosedDatastoreError,
  );

  assert.throws(
    () => {
      datastore.unregisterQueryEngine('sql');
    },
    ClosedDatastoreError,
  );

  await assert.rejects(
    async () => {
      await datastore.query('sql', 'sensor=a');
    },
    ClosedDatastoreError,
  );
});
