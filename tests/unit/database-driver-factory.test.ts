import assert from 'node:assert/strict';
import test from 'node:test';

import type { DatastoreDriver } from '@frostpillar/frostpillar-storage-engine';

import { ConfigurationError, Database } from '../../src/index.js';
import type { DatabaseDriverFactory } from '../../src/index.js';

interface ItemDoc {
  _id?: string;
  data: string;
}

// Minimal in-memory DatastoreDriver stub. Each instance is an isolated
// namespace, mirroring the contract of the real durable drivers.
const createStubDriver = (): DatastoreDriver => ({
  init: () => ({
    controller: {
      handleRecordAppended: (): Promise<void> => Promise.resolve(),
      handleCleared: (): Promise<void> => Promise.resolve(),
      commitNow: (): Promise<void> => Promise.resolve(),
      close: (): Promise<void> => Promise.resolve(),
    },
    initialTreeJSON: null,
    initialCurrentSizeBytes: 0,
  }),
});

void test('driver factory is invoked once per collection with the collection name', async () => {
  const calls: string[] = [];
  const factory: DatabaseDriverFactory = (collectionName) => {
    calls.push(collectionName);
    return createStubDriver();
  };
  const database = new Database({ driver: factory });

  try {
    database.collection<ItemDoc>('alpha');
    database.collection<ItemDoc>('beta');
    // Re-access must reuse the existing datastore, not re-invoke the factory.
    database.collection<ItemDoc>('alpha');

    assert.deepEqual(calls, ['alpha', 'beta']);
  } finally {
    await database.close();
  }
});

void test('collections created via driver factory operate independently', async () => {
  const database = new Database({
    driver: () => createStubDriver(),
  });

  try {
    const alpha = database.collection<ItemDoc>('alpha');
    const beta = database.collection<ItemDoc>('beta');

    await alpha.insert({ data: 'a' });
    await beta.insert({ data: 'b1' });
    await beta.insert({ data: 'b2' });

    assert.equal(await alpha.find({}).count(), 1);
    assert.equal(await beta.find({}).count(), 2);
    await database.commit();
  } finally {
    await database.close();
  }
});

void test('plain shared driver throws ConfigurationError on second collection', async () => {
  const database = new Database({ driver: createStubDriver() });

  try {
    const first = database.collection<ItemDoc>('first');
    await first.insert({ data: 'ok' });

    assert.throws(
      () => database.collection<ItemDoc>('second'),
      (error: unknown) => {
        assert.ok(error instanceof ConfigurationError);
        assert.match(error.message, /driver/i);
        assert.match(error.message, /factory/i);
        return true;
      },
    );

    // The first collection must remain fully usable after the rejection.
    assert.equal(await first.find({}).count(), 1);
  } finally {
    await database.close();
  }
});

void test('plain driver can back a new collection after the previous one is dropped', async () => {
  const database = new Database({ driver: createStubDriver() });

  try {
    const first = database.collection<ItemDoc>('first');
    await first.insert({ data: 'ok' });
    await database.dropCollection('first');

    const second = database.collection<ItemDoc>('second');
    await second.insert({ data: 'ok too' });
    assert.equal(await second.find({}).count(), 1);
  } finally {
    await database.close();
  }
});

void test('in-memory database (no driver) supports multiple collections', async () => {
  const database = new Database();

  try {
    const alpha = database.collection<ItemDoc>('alpha');
    const beta = database.collection<ItemDoc>('beta');
    await alpha.insert({ data: 'a' });
    await beta.insert({ data: 'b' });

    assert.deepEqual(await database.listCollections(), ['alpha', 'beta']);
  } finally {
    await database.close();
  }
});
