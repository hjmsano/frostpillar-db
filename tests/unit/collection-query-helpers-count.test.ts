import assert from 'node:assert/strict';
import test from 'node:test';

import { Database } from '../../src/database.js';

// Integration tests for countMatchedRecords (via Collection.count())
// and the executeCount fast/slow paths.

interface Doc {
  _id?: string;
  value: number;
}

// --- 1. Filtered count returns correct number of matching documents ---

void test('count() with filter returns number of matching documents', async () => {
  const db = new Database();
  const col = db.collection<Doc>('count-filtered');
  for (let i = 0; i < 10; i++) {
    await col.insert({ _id: `d${String(i)}`, value: i });
  }
  // value >= 5 → docs d5..d9 = 5 matches
  const count = await col.count({ value: { $gte: 5 } });
  assert.equal(count, 5);
  await db.close();
});

// --- 2. Count on a TTL collection EXCLUDES expired documents ---

void test('count() on a TTL collection excludes expired documents', async () => {
  const db = new Database();
  // ttl: 1 second. `_createdAt` is server-controlled on TTL collections
  // (ADR-016) and can no longer be forged to simulate an already-expired
  // document, so "expired" documents are created by letting real time
  // elapse past the TTL before inserting the live documents.
  const col = db.collection<Doc>('count-ttl', { ttl: 1 });

  for (let i = 0; i < 3; i++) {
    await col.insert({ _id: `expired${String(i)}`, value: i });
  }
  await new Promise((resolve) => setTimeout(resolve, 1500));
  // Insert 4 live documents
  for (let i = 0; i < 4; i++) {
    await col.insert({ _id: `live${String(i)}`, value: 100 + i });
  }

  // Empty-filter count on a TTL collection goes through the slow path
  // (the fast path is only used when ttl === undefined).
  const total = await col.count();
  assert.equal(total, 4, 'should count only non-expired documents');

  // Filtered count also excludes expired
  const filtered = await col.count({ value: { $gte: 100 } });
  assert.equal(
    filtered,
    4,
    'filtered count should only include live documents',
  );

  await db.close();
});

// --- 3. Count on a duplicateKeys:'allow' collection with empty filter
//         returns the TOTAL record count including duplicates ---

void test('count() on duplicateKeys:allow collection with empty filter includes duplicates', async () => {
  const db = new Database();
  const col = db.collection<Doc>('count-dupes', { duplicateKeys: 'allow' });

  // Insert the same _id three times → 3 records stored
  await col.insert({ _id: 'dup', value: 1 });
  await col.insert({ _id: 'dup', value: 2 });
  await col.insert({ _id: 'dup', value: 3 });

  const count = await col.count();
  assert.equal(
    count,
    3,
    'empty-filter count must include all duplicate records',
  );

  await db.close();
});

// --- 4. Count does NOT throw when matched set exceeds maxMatchedDocuments ---

void test('count() resolves even when matched set exceeds maxMatchedDocuments', async () => {
  const db = new Database({ maxMatchedDocuments: 3 });
  const col = db.collection<Doc>('count-cap');
  for (let i = 0; i < 10; i++) {
    await col.insert({ _id: `d${String(i)}`, value: i });
  }
  // Empty-filter on a plain collection hits the fast Datastore.count() path,
  // so force the slow countMatchedRecords path via a filter.
  const count = await col.count({ value: { $gte: 0 } });
  assert.equal(
    count,
    10,
    'count must not throw and must return full matched count',
  );
  await db.close();
});

// Confirm the empty-filter path also does not throw (it uses Datastore.count())
void test('count() with no filter does not throw when exceeding maxMatchedDocuments', async () => {
  const db = new Database({ maxMatchedDocuments: 3 });
  const col = db.collection<Doc>('count-cap-nofilt');
  for (let i = 0; i < 10; i++) {
    await col.insert({ _id: `d${String(i)}`, value: i });
  }
  const count = await col.count();
  assert.equal(count, 10);
  await db.close();
});
