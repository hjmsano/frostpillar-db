import assert from 'node:assert/strict';
import test from 'node:test';
import { loadCoreModule } from './load-core-module.mjs';

const loadCore = async () => await loadCoreModule();

test('memory commit resolves as no-op and preserves visible data', async () => {
  const { Datastore } = await loadCore();
  const datastore = new Datastore({ location: 'memory' });

  await datastore.commit();

  await datastore.insert({
    timestamp: 1735689600000,
    payload: { id: 'a' },
  });
  await datastore.insert({
    timestamp: 1735689600001,
    payload: { id: 'b' },
  });

  await datastore.commit();

  const rows = await datastore.select({
    start: 1735689600000,
    end: 1735689600001,
  });

  assert.deepEqual(
    rows.map((row) => row.payload.id),
    ['a', 'b'],
  );
});

test('error listener registration and removal are baseline-safe in memory mode', async () => {
  const { Datastore } = await loadCore();
  const datastore = new Datastore({ location: 'memory' });

  const events = [];
  const listener = (event) => {
    events.push(event);
  };

  const unsubscribe = datastore.on('error', listener);
  datastore.off('error', listener);
  unsubscribe();
  datastore.off('error', listener);

  assert.equal(events.length, 0);
});

test('on/off reject unsupported event names with ValidationError', async () => {
  const { Datastore, ValidationError } = await loadCore();
  const datastore = new Datastore({ location: 'memory' });
  const listener = () => {};

  assert.throws(
    () => {
      datastore.on('warn', listener);
    },
    ValidationError,
  );

  assert.throws(
    () => {
      datastore.off('warn', listener);
    },
    ValidationError,
  );
});
