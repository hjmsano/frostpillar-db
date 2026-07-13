import assert from 'node:assert/strict';
import test from 'node:test';

import { Database } from '../../src/index.js';
import type { DatastoreKeyDefinition } from '../../src/index.js';

interface TestDoc {
  _id?: string;
  value?: number;
}

const numericKey: DatastoreKeyDefinition<unknown, unknown> = {
  normalize: (v: unknown) => Number(v),
  compare: (a: unknown, b: unknown) => (a as number) - (b as number),
  serialize: (k: unknown) => String(k),
  deserialize: (s: string) => Number(s),
};

// `normalize: Number` collapses "01" and "1" onto the same storage key, so every
// index lookup ("1") reaches the record stored as "01". `_id` identity is string
// equality (see spec 01 section 2.11), so the key-index fast paths must confirm
// the stored `_id` before reporting a hit.

void test('findOne with custom key does not report a normalize-collision hit', async () => {
  const db = new Database();
  const col = db.collection<TestDoc>('items', { key: numericKey });
  await col.insert({ _id: '01', value: 1 });

  assert.deepEqual(await col.find({ _id: '1' }).toArray(), []);
  assert.equal(await col.findOne({ _id: '1' }), null);
  assert.equal((await col.findOne({ _id: '01' }))?._id, '01');
  await db.close();
});

void test('exists with custom key compares the stored _id, not the storage key', async () => {
  const db = new Database();
  const col = db.collection<TestDoc>('items', { key: numericKey });
  await col.insert({ _id: '01', value: 1 });

  assert.equal(await col.exists('1'), false);
  assert.equal(await col.exists('01'), true);
  await db.close();
});

void test('exists with custom key and ttl compares the stored _id', async () => {
  const db = new Database();
  const col = db.collection<TestDoc>('items', { key: numericKey, ttl: 3600 });
  await col.insert({ _id: '01', value: 1 });

  assert.equal(await col.exists('1'), false);
  assert.equal(await col.exists('01'), true);
  await db.close();
});

void test('ids with custom key returns stored _id strings', async () => {
  const db = new Database();
  const col = db.collection<TestDoc>('items', { key: numericKey });
  await col.insert({ _id: '01', value: 1 });

  assert.deepEqual(await col.ids(), ['01']);
  await db.close();
});

void test('remove with custom key does not delete a normalize-collision match', async () => {
  const db = new Database();
  const col = db.collection<TestDoc>('items', { key: numericKey });
  await col.insert({ _id: '01', value: 1 });
  const removedIds: string[] = [];
  col.watch((event) => {
    if (event.type === 'remove') removedIds.push(event.documentId);
  });

  assert.equal(await col.remove({ _id: '1' }), 0);
  assert.equal(await col.count(), 1);
  assert.deepEqual(removedIds, []);

  assert.equal(await col.remove({ _id: '01' }), 1);
  assert.equal(await col.count(), 0);
  assert.deepEqual(removedIds, ['01']);
  await db.close();
});

void test('remove with custom key and $in only deletes exact _id matches', async () => {
  const db = new Database();
  const col = db.collection<TestDoc>('items', { key: numericKey });
  await col.insert({ _id: '01', value: 1 });
  await col.insert({ _id: '2', value: 2 });
  const removedIds: string[] = [];
  col.watch((event) => {
    if (event.type === 'remove') removedIds.push(event.documentId);
  });

  assert.equal(await col.remove({ _id: { $in: ['1', '2'] } }), 1);
  assert.deepEqual(removedIds, ['2']);
  assert.deepEqual(await col.ids(), ['01']);
  await db.close();
});

void test('range filter with custom key matches every document the filter accepts', async () => {
  const db = new Database();
  const col = db.collection<TestDoc>('items', { key: numericKey });
  await col.insert({ _id: '10', value: 10 });
  await col.insert({ _id: '2', value: 2 });

  // String order, not the key definition's numeric order, decides the match.
  const ids = (await col.find({ _id: { $gte: '1', $lte: '3' } }).toArray()).map(
    (doc) => doc._id,
  );
  assert.deepEqual(ids.sort(), ['10', '2']);
  await db.close();
});

// A `key` on the DatabaseConfig is inherited by every collection's datastore,
// so it has exactly the same normalize-collision hazard as a per-collection
// `key` — but the collection was only told about the latter, leaving these
// collections on the fast paths that trust the storage key for `_id` identity.

void test('database-level key: findOne does not report a normalize-collision hit', async () => {
  const db = new Database({ key: numericKey });
  const col = db.collection<TestDoc>('items');
  await col.insert({ _id: '01', value: 1 });

  assert.equal(await col.findOne({ _id: '1' }), null);
  assert.equal((await col.findOne({ _id: '01' }))?._id, '01');
  await db.close();
});

void test('database-level key: exists compares the stored _id, not the storage key', async () => {
  const db = new Database({ key: numericKey });
  const col = db.collection<TestDoc>('items');
  await col.insert({ _id: '01', value: 1 });

  assert.equal(await col.exists('1'), false);
  assert.equal(await col.exists('01'), true);
  await db.close();
});

void test('database-level key: remove does not delete a normalize collision', async () => {
  const db = new Database({ key: numericKey });
  const col = db.collection<TestDoc>('items');
  await col.insert({ _id: '01', value: 1 });
  const removedIds: string[] = [];
  col.watch((event) => {
    if (event.type === 'remove') removedIds.push(event.documentId);
  });

  assert.equal(await col.remove({ _id: '1' }), 0);
  assert.equal(await col.count(), 1);
  assert.deepEqual(removedIds, []);

  assert.equal(await col.remove({ _id: '01' }), 1);
  assert.deepEqual(removedIds, ['01']);
  await db.close();
});

void test('database-level key: ids returns stored _id strings', async () => {
  const db = new Database({ key: numericKey });
  const col = db.collection<TestDoc>('items');
  await col.insert({ _id: '01', value: 1 });

  assert.deepEqual(await col.ids(), ['01']);
  await db.close();
});

void test('default string keys keep the index fast paths intact', async () => {
  const db = new Database();
  const col = db.collection<TestDoc>('items');
  await col.insert({ _id: '01', value: 1 });

  assert.equal(await col.exists('1'), false);
  assert.equal(await col.exists('01'), true);
  assert.equal((await col.findOne({ _id: '01' }))?.value, 1);
  assert.deepEqual(await col.ids(), ['01']);
  assert.equal(await col.remove({ _id: '01' }), 1);
  await db.close();
});
