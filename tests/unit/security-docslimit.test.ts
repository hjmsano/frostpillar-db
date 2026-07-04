// Defensive regression tests for frostpillar-db's input-validation layer.
// The hostile-looking inputs below are fixtures that MUST be rejected (or
// safely handled) by the library; they verify the document-count-cap and
// filter-shape guards in src/internal/ continue to block these shapes.
// No code here produces a usable payload.

import assert from 'node:assert/strict';
import test from 'node:test';

import { Database } from '../../src/database.js';
import { ValidationError } from '../../src/errors.js';
import type { Filter } from '../../src/types.js';
import { DEFAULT_MAX_MATCHED_DOCUMENTS } from '../../src/internal/limits.js';

// --- #13 maxMatchedDocuments limit ---

void test('find().toArray() throws when exceeding maxMatchedDocuments', async () => {
  const db = new Database({ maxMatchedDocuments: 5 });
  const col = db.collection<{ _id?: string; value: number }>('test');
  for (let i = 0; i < 10; i++) {
    await col.insert({ _id: `d${String(i)}`, value: i });
  }
  await assert.rejects(() => col.find().toArray(), ValidationError);
  await db.close();
});

void test('find() with limit() below cap succeeds', async () => {
  const db = new Database({ maxMatchedDocuments: 5 });
  const col = db.collection<{ _id?: string; value: number }>('test');
  for (let i = 0; i < 10; i++) {
    await col.insert({ _id: `d${String(i)}`, value: i });
  }
  const results = await col.find().limit(3).toArray();
  assert.equal(results.length, 3);
  await db.close();
});

void test('DEFAULT_MAX_MATCHED_DOCUMENTS is a positive safe integer', () => {
  assert.ok(Number.isSafeInteger(DEFAULT_MAX_MATCHED_DOCUMENTS));
  assert.ok(DEFAULT_MAX_MATCHED_DOCUMENTS > 0);
});

void test('Database constructor throws on invalid maxMatchedDocuments', () => {
  assert.throws(
    () => new Database({ maxMatchedDocuments: 0 }),
    (err: unknown) =>
      err instanceof Error && err.message.includes('maxMatchedDocuments'),
  );
  assert.throws(
    () => new Database({ maxMatchedDocuments: -1 }),
    (err: unknown) =>
      err instanceof Error && err.message.includes('maxMatchedDocuments'),
  );
  assert.throws(
    () => new Database({ maxMatchedDocuments: 1.5 }),
    (err: unknown) =>
      err instanceof Error && err.message.includes('maxMatchedDocuments'),
  );
});

void test('count() succeeds even when exceeding maxMatchedDocuments', async () => {
  const db = new Database({ maxMatchedDocuments: 5 });
  const col = db.collection<{ _id?: string; value: number }>('test-count');
  for (let i = 0; i < 10; i++) {
    await col.insert({ _id: `d${String(i)}`, value: i });
  }
  const count = await col.count();
  assert.equal(count, 10);
  await db.close();
});

void test('filtered count() succeeds even when exceeding maxMatchedDocuments', async () => {
  const db = new Database({ maxMatchedDocuments: 3 });
  const col = db.collection<{ _id?: string; value: number }>(
    'test-filtered-count',
  );
  for (let i = 0; i < 10; i++) {
    await col.insert({ _id: `d${String(i)}`, value: i });
  }
  const count = await col.count({ value: { $gte: 0 } });
  assert.equal(count, 10);
  await db.close();
});

// --- #B4 limit() above cap ---

void test('find() with limit() above cap succeeds', async () => {
  const db = new Database({ maxMatchedDocuments: 5 });
  const col = db.collection<{ _id?: string; value: number }>('test-b4-basic');
  for (let i = 0; i < 20; i++) {
    await col.insert({ _id: `d${String(i)}`, value: i });
  }
  const results = await col.find().limit(10).toArray();
  assert.equal(results.length, 10);
  await db.close();
});

void test('find() with filter and limit() above cap succeeds', async () => {
  const db = new Database({ maxMatchedDocuments: 5 });
  const col = db.collection<{ _id?: string; value: number }>('test-b4-filter');
  for (let i = 0; i < 20; i++) {
    await col.insert({ _id: `d${String(i)}`, value: i });
  }
  const results = await col
    .find({ value: { $gte: 0 } })
    .limit(10)
    .toArray();
  assert.equal(results.length, 10);
  await db.close();
});

// Guard: sort + limit above cap still throws because a sort must collect all
// matching documents before ordering, so the scan limit hint is not applied.
void test('find() with sort and limit() above cap still throws', async () => {
  const db = new Database({ maxMatchedDocuments: 5 });
  const col = db.collection<{ _id?: string; value: number }>('test-b4-sort');
  for (let i = 0; i < 20; i++) {
    await col.insert({ _id: `d${String(i)}`, value: i });
  }
  await assert.rejects(
    () => col.find().sort({ value: 1 }).limit(10).toArray(),
    ValidationError,
  );
  await db.close();
});

// --- #14 Filter shape validation ---

void test('remove() rejects null filter with ValidationError', async () => {
  const db = new Database();
  const col = db.collection('test-filter');
  await assert.rejects(
    () => col.remove(null as unknown as Filter),
    ValidationError,
  );
  await db.close();
});

void test('remove() rejects array filter with ValidationError', async () => {
  const db = new Database();
  const col = db.collection('test-filter');
  await assert.rejects(
    () => col.remove([] as unknown as Filter),
    ValidationError,
  );
  await db.close();
});

void test('remove() rejects string filter with ValidationError', async () => {
  const db = new Database();
  const col = db.collection('test-filter');
  await assert.rejects(
    () => col.remove('bad' as unknown as Filter),
    ValidationError,
  );
  await db.close();
});

void test('find() accepts undefined filter without error', async () => {
  const db = new Database();
  const col = db.collection('test-filter');
  assert.doesNotThrow(() => col.find(undefined));
  await db.close();
});

void test('update() rejects undefined filter with ValidationError', async () => {
  const db = new Database();
  const col = db.collection('test-filter');
  await assert.rejects(
    () => col.update(undefined as unknown as Filter, { $set: { x: 1 } }),
    ValidationError,
  );
  await db.close();
});
