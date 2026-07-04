import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ConfigurationError,
  Database,
  QuotaExceededError,
} from '../../src/index.js';

interface ItemDoc {
  _id?: string;
  data: string;
}

void test('collection with strict capacity rejects inserts when full', async () => {
  const database = new Database({});
  const items = database.collection<ItemDoc>('items', {
    capacity: { maxSize: '1KB', policy: 'strict' },
  });

  try {
    // Insert documents until capacity is exceeded
    const largeData = 'x'.repeat(512);
    await items.insert({ data: largeData });

    await assert.rejects(async () => {
      // Keep inserting until we exceed capacity
      for (let i = 0; i < 100; i++) {
        await items.insert({ data: largeData });
      }
    }, QuotaExceededError);
  } finally {
    await database.close();
  }
});

void test('collection with turnover capacity evicts oldest entries', async () => {
  const database = new Database({});
  const items = database.collection<ItemDoc>('items', {
    capacity: { maxSize: '1KB', policy: 'turnover' },
  });

  try {
    const largeData = 'x'.repeat(512);

    const firstId = await items.insert({ _id: 'first', data: largeData });
    assert.equal(firstId, 'first');

    // Insert enough large documents to exceed 1KB and trigger eviction of 'first'
    for (let i = 0; i < 20; i++) {
      await items.insert({ data: largeData });
    }

    // The first document should have been evicted
    const firstDoc = await items.findOne({ _id: 'first' });
    assert.equal(firstDoc, null);
  } finally {
    await database.close();
  }
});

void test('per-collection capacity overrides database-level capacity', async () => {
  const database = new Database({
    capacity: { maxSize: '100KB', policy: 'strict' },
  });

  // This collection has a much smaller capacity limit
  const items = database.collection<ItemDoc>('items', {
    capacity: { maxSize: '1KB', policy: 'strict' },
  });

  try {
    const largeData = 'x'.repeat(512);
    await items.insert({ data: largeData });

    // Should reject because per-collection limit (1KB) is exceeded,
    // even though database-level limit (100KB) would allow it
    await assert.rejects(async () => {
      for (let i = 0; i < 100; i++) {
        await items.insert({ data: largeData });
      }
    }, QuotaExceededError);
  } finally {
    await database.close();
  }
});

void test('collection without capacity inherits database-level capacity', async () => {
  const database = new Database({
    capacity: { maxSize: '1KB', policy: 'strict' },
  });

  // No per-collection capacity — should inherit database-level 1KB
  const items = database.collection<ItemDoc>('items');

  try {
    const largeData = 'x'.repeat(512);
    await items.insert({ data: largeData });

    await assert.rejects(async () => {
      for (let i = 0; i < 100; i++) {
        await items.insert({ data: largeData });
      }
    }, QuotaExceededError);
  } finally {
    await database.close();
  }
});

void test('collection rejects conflicting capacity options on re-access', () => {
  const database = new Database({});

  database.collection('items', {
    capacity: { maxSize: '1KB', policy: 'strict' },
  });

  assert.throws(
    () =>
      database.collection('items', {
        capacity: { maxSize: '2KB', policy: 'strict' },
      }),
    ConfigurationError,
  );
});

void test('collection allows re-access with same capacity options', () => {
  const database = new Database({});

  const first = database.collection('items', {
    capacity: { maxSize: '1KB', policy: 'strict' },
  });

  const second = database.collection('items', {
    capacity: { maxSize: '1KB', policy: 'strict' },
  });

  assert.equal(second, first);
});

void test('bare re-access after capacity config throws ConfigurationError', () => {
  const database = new Database({});

  database.collection('items', {
    capacity: { maxSize: '1KB', policy: 'strict' },
  });

  assert.throws(() => database.collection('items'), ConfigurationError);
});
