import assert from 'node:assert/strict';
import test from 'node:test';

import { Database } from '../../src/index.js';
import { ValidationError } from '../../src/errors.js';

interface RangeTestDocument {
  _id?: string;
  name: string;
  status?: string;
}

void test('find with _id range ($gte/$lte) returns matching documents', async () => {
  const database = new Database({});
  const items = database.collection<RangeTestDocument>('items');

  try {
    await items.insertMany([
      { _id: 'a', name: 'Alpha' },
      { _id: 'b', name: 'Beta' },
      { _id: 'c', name: 'Charlie' },
      { _id: 'd', name: 'Delta' },
      { _id: 'e', name: 'Echo' },
    ]);

    const result = await items
      .find({ _id: { $gte: 'b', $lte: 'd' } })
      .toArray();
    assert.equal(result.length, 3);
    assert.deepEqual(result.map((d) => d._id).sort(), ['b', 'c', 'd']);
  } finally {
    await database.close();
  }
});

void test('find with _id range ($gt/$lt) excludes boundaries', async () => {
  const database = new Database({});
  const items = database.collection<RangeTestDocument>('items');

  try {
    await items.insertMany([
      { _id: 'a', name: 'Alpha' },
      { _id: 'b', name: 'Beta' },
      { _id: 'c', name: 'Charlie' },
      { _id: 'd', name: 'Delta' },
      { _id: 'e', name: 'Echo' },
    ]);

    const result = await items.find({ _id: { $gt: 'a', $lt: 'e' } }).toArray();
    assert.equal(result.length, 3);
    assert.deepEqual(result.map((d) => d._id).sort(), ['b', 'c', 'd']);
  } finally {
    await database.close();
  }
});

void test('find with _id range and additional filter narrows results', async () => {
  const database = new Database({});
  const items = database.collection<RangeTestDocument>('items');

  try {
    await items.insertMany([
      { _id: 'a', name: 'Alpha', status: 'active' },
      { _id: 'b', name: 'Beta', status: 'inactive' },
      { _id: 'c', name: 'Charlie', status: 'active' },
      { _id: 'd', name: 'Delta', status: 'inactive' },
    ]);

    const result = await items
      .find({ _id: { $gte: 'a', $lte: 'd' }, status: 'active' })
      .toArray();
    assert.equal(result.length, 2);
    assert.deepEqual(result.map((d) => d._id).sort(), ['a', 'c']);
  } finally {
    await database.close();
  }
});

// ---------------------------------------------------------------------------
// Edge cases: type mismatch throws ValidationError; inverted range returns empty
// ---------------------------------------------------------------------------

void test('find with _id range throws ValidationError when start/end types differ', async () => {
  const database = new Database({});
  const items = database.collection<RangeTestDocument>('items');

  try {
    await items.insertMany([
      { _id: 'a', name: 'Alpha' },
      { _id: 'b', name: 'Beta' },
    ]);

    // Number start, string end — mixed-type bounds throw ValidationError
    await assert.rejects(
      () => items.find({ _id: { $gte: 1, $lte: 'z' } }).toArray(),
      ValidationError,
    );
  } finally {
    await database.close();
  }
});

void test('find with _id range returns empty when start > end', async () => {
  const database = new Database({});
  const items = database.collection<RangeTestDocument>('items');

  try {
    await items.insertMany([
      { _id: 'a', name: 'Alpha' },
      { _id: 'b', name: 'Beta' },
    ]);

    // Inverted range should return empty, not throw
    const result = await items
      .find({ _id: { $gte: 'z', $lte: 'a' } })
      .toArray();
    assert.equal(result.length, 0);
  } finally {
    await database.close();
  }
});

void test('count with _id range returns correct count', async () => {
  const database = new Database({});
  const items = database.collection<RangeTestDocument>('items');

  try {
    await items.insertMany([
      { _id: 'a', name: 'Alpha' },
      { _id: 'b', name: 'Beta' },
      { _id: 'c', name: 'Charlie' },
    ]);

    const count = await items.count({ _id: { $gte: 'a', $lte: 'b' } });
    assert.equal(count, 2);
  } finally {
    await database.close();
  }
});
