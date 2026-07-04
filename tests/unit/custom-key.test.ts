import assert from 'node:assert/strict';
import test from 'node:test';

import { ConfigurationError, Database } from '../../src/index.js';
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

void test('collection accepts custom key definition', async () => {
  const db = new Database();
  const col = db.collection<TestDoc>('items', { key: numericKey });
  await col.insert({ _id: '42', value: 1 });
  const result = await col.findOne({ _id: '42' });
  assert.notEqual(result, null);
  assert.equal(result?.value, 1);
  await db.close();
});

void test('collection with custom key stores and retrieves multiple documents', async () => {
  const db = new Database();
  const col = db.collection<TestDoc>('items', { key: numericKey });
  await col.insert({ _id: '1', value: 10 });
  await col.insert({ _id: '2', value: 20 });
  await col.insert({ _id: '3', value: 30 });
  const count = await col.count();
  assert.equal(count, 3);
  await db.close();
});

void test('re-accessing collection with same key definition returns same collection', async () => {
  const db = new Database();
  const col1 = db.collection<TestDoc>('items', { key: numericKey });
  const col2 = db.collection<TestDoc>('items', { key: numericKey });
  assert.equal(col1, col2);
  await db.close();
});

void test('re-accessing collection with different key definition throws ConfigurationError', () => {
  const db = new Database();
  const otherKey: DatastoreKeyDefinition<unknown, unknown> = {
    normalize: (v: unknown) => Number(v),
    compare: (a: unknown, b: unknown) => (b as number) - (a as number),
    serialize: (k: unknown) => String(k),
    deserialize: (s: string) => Number(s),
  };
  db.collection<TestDoc>('items', { key: numericKey });
  assert.throws(
    () => db.collection<TestDoc>('items', { key: otherKey }),
    ConfigurationError,
  );
});

void test('bare re-access after key config throws ConfigurationError', async () => {
  const db = new Database();
  db.collection<TestDoc>('items', { key: numericKey });
  assert.throws(() => db.collection<TestDoc>('items'), ConfigurationError);
  await db.close();
});

void test('collection without key and collection with key are different', () => {
  const db = new Database();
  db.collection<TestDoc>('items');
  assert.throws(
    () => db.collection<TestDoc>('items', { key: numericKey }),
    ConfigurationError,
  );
});

void test('different collections can have different key definitions', async () => {
  const db = new Database();
  const reverseKey: DatastoreKeyDefinition<unknown, unknown> = {
    normalize: (v: unknown) => Number(v),
    compare: (a: unknown, b: unknown) => (b as number) - (a as number),
    serialize: (k: unknown) => String(k),
    deserialize: (s: string) => Number(s),
  };
  const col1 = db.collection<TestDoc>('a', { key: numericKey });
  const col2 = db.collection<TestDoc>('b', { key: reverseKey });
  await col1.insert({ _id: '1', value: 10 });
  await col2.insert({ _id: '2', value: 20 });
  assert.notEqual(await col1.findOne({ _id: '1' }), null);
  assert.notEqual(await col2.findOne({ _id: '2' }), null);
  await db.close();
});
