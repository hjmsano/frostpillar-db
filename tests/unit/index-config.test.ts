import assert from 'node:assert/strict';
import test from 'node:test';

import { ConfigurationError, Database } from '../../src/index.js';

interface TestDoc {
  _id?: string;
  value?: number;
  x?: number;
}

void test('database with default config enables auto-scale implicitly', async () => {
  const db = new Database();
  const col = db.collection<TestDoc>('items');
  await col.insert({ value: 1 });
  const result = await col.findOne({ value: 1 });
  assert.notEqual(result, null);
  await db.close();
});

void test('database accepts explicit index config with autoScale true', async () => {
  const db = new Database({ index: { autoScale: true } });
  const col = db.collection<TestDoc>('items');
  await col.insert({ value: 1 });
  const result = await col.findOne({ value: 1 });
  assert.notEqual(result, null);
  await db.close();
});

void test('database accepts index config with autoScale false and fixed sizes', async () => {
  const db = new Database({
    index: { autoScale: false, maxLeafEntries: 128, maxBranchChildren: 32 },
  });
  const col = db.collection<TestDoc>('items');
  await col.insert({ value: 1 });
  const result = await col.findOne({ value: 1 });
  assert.notEqual(result, null);
  await db.close();
});

void test('database rejects maxLeafEntries when autoScale is true', () => {
  const db = new Database({ index: { autoScale: true, maxLeafEntries: 128 } });
  assert.throws(() => db.collection('items'), ConfigurationError);
});

void test('database rejects maxBranchChildren when autoScale is true', () => {
  const db = new Database({
    index: { autoScale: true, maxBranchChildren: 32 },
  });
  assert.throws(() => db.collection('items'), ConfigurationError);
});

void test('database rejects maxLeafEntries below minimum (3)', () => {
  const db = new Database({ index: { autoScale: false, maxLeafEntries: 2 } });
  assert.throws(() => db.collection('items'), ConfigurationError);
});

void test('database rejects maxLeafEntries above maximum (16384)', () => {
  const db = new Database({
    index: { autoScale: false, maxLeafEntries: 16385 },
  });
  assert.throws(() => db.collection('items'), ConfigurationError);
});

void test('database rejects non-integer maxLeafEntries', () => {
  const db = new Database({
    index: { autoScale: false, maxLeafEntries: 10.5 },
  });
  assert.throws(() => db.collection('items'), ConfigurationError);
});

// --- Per-collection index config ---

void test('collection accepts per-collection index config', async () => {
  const db = new Database();
  const col = db.collection<TestDoc>('items', {
    index: { autoScale: false, maxLeafEntries: 64, maxBranchChildren: 32 },
  });
  await col.insert({ value: 1 });
  const result = await col.findOne({ value: 1 });
  assert.notEqual(result, null);
  await db.close();
});

void test('per-collection index config overrides database-level config', async () => {
  const db = new Database({ index: { autoScale: true } });
  const col = db.collection<TestDoc>('items', {
    index: { autoScale: false, maxLeafEntries: 64, maxBranchChildren: 32 },
  });
  await col.insert({ value: 1 });
  const result = await col.findOne({ value: 1 });
  assert.notEqual(result, null);
  await db.close();
});

void test('different collections can have different index configs', async () => {
  const db = new Database();
  const col1 = db.collection<TestDoc>('a', {
    index: { autoScale: false, maxLeafEntries: 64, maxBranchChildren: 32 },
  });
  const col2 = db.collection<TestDoc>('b', {
    index: { autoScale: false, maxLeafEntries: 128, maxBranchChildren: 64 },
  });
  await col1.insert({ x: 1 });
  await col2.insert({ x: 2 });
  assert.notEqual(await col1.findOne({ x: 1 }), null);
  assert.notEqual(await col2.findOne({ x: 2 }), null);
  await db.close();
});

void test('re-accessing collection with same index config returns same collection', async () => {
  const db = new Database();
  const indexOpts = {
    autoScale: false,
    maxLeafEntries: 64,
    maxBranchChildren: 32,
  } as const;
  const col1 = db.collection<TestDoc>('items', { index: indexOpts });
  const col2 = db.collection<TestDoc>('items', { index: indexOpts });
  assert.equal(col1, col2);
  await db.close();
});

void test('re-accessing collection with different index config throws ConfigurationError', () => {
  const db = new Database();
  db.collection<TestDoc>('items', {
    index: { autoScale: false, maxLeafEntries: 64, maxBranchChildren: 32 },
  });
  assert.throws(
    () =>
      db.collection<TestDoc>('items', {
        index: { autoScale: false, maxLeafEntries: 128, maxBranchChildren: 32 },
      }),
    ConfigurationError,
  );
});

void test('re-accessing collection with same deleteRebalancePolicy returns same collection', async () => {
  const db = new Database();
  const col1 = db.collection<TestDoc>('items', {
    index: { deleteRebalancePolicy: 'lazy' },
  });
  const col2 = db.collection<TestDoc>('items', {
    index: { deleteRebalancePolicy: 'lazy' },
  });
  assert.equal(col1, col2);
  await db.close();
});

void test('re-accessing collection with different deleteRebalancePolicy throws ConfigurationError', () => {
  const db = new Database();
  db.collection<TestDoc>('items', {
    index: { deleteRebalancePolicy: 'standard' },
  });
  assert.throws(
    () =>
      db.collection<TestDoc>('items', {
        index: { deleteRebalancePolicy: 'lazy' },
      }),
    ConfigurationError,
  );
});

void test('bare re-access after index config throws ConfigurationError', async () => {
  const db = new Database();
  db.collection<TestDoc>('items', {
    index: { autoScale: false, maxLeafEntries: 64, maxBranchChildren: 32 },
  });
  assert.throws(() => db.collection<TestDoc>('items'), ConfigurationError);
  await db.close();
});

void test('collection index config with autoScale true rejects maxLeafEntries', () => {
  const db = new Database();
  assert.throws(
    () =>
      db.collection('items', {
        index: { autoScale: true, maxLeafEntries: 128 },
      }),
    ConfigurationError,
  );
});

void test('index config is shared across collections in same database', async () => {
  const db = new Database({
    index: { autoScale: false, maxLeafEntries: 64, maxBranchChildren: 64 },
  });
  const col1 = db.collection<TestDoc>('a');
  const col2 = db.collection<TestDoc>('b');
  await col1.insert({ x: 1 });
  await col2.insert({ x: 2 });
  assert.notEqual(await col1.findOne({ x: 1 }), null);
  assert.notEqual(await col2.findOne({ x: 2 }), null);
  await db.close();
});
