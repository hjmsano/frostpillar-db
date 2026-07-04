import assert from 'node:assert/strict';
import test from 'node:test';

import { Database } from '../../src/index.js';

interface UserDocument {
  _id?: string;
  name: string;
  status?: string;
}

// count consistency on duplicateKeys: 'allow'
// Verifies that count() returns the same result with and without a filter
// on collections with duplicateKeys: 'allow' (the fast path should not be used)
void test('count returns consistent results on duplicateKeys: allow collections regardless of filter', async () => {
  const database = new Database({});
  const logs = database.collection<UserDocument>('logs', {
    duplicateKeys: 'allow',
  });

  try {
    await logs.insert({ _id: 'dup', name: 'first' });
    await logs.insert({ _id: 'dup', name: 'second' });
    await logs.insert({ _id: 'dup', name: 'third' });

    const countNoFilter = await logs.count();
    assert.equal(countNoFilter, 3, 'count() with no filter should return 3');

    const countEmptyFilter = await logs.count({});
    assert.equal(countEmptyFilter, 3, 'count({}) should return 3');

    assert.equal(
      countNoFilter,
      countEmptyFilter,
      'count() and count({}) must return the same value on duplicateKeys: allow collections',
    );
  } finally {
    await database.close();
  }
});

void test('$in and $nin match scalar document field values against a list of candidates', async () => {
  const database = new Database({});
  const items = database.collection<{
    _id?: string;
    name: string;
    status?: string;
  }>('items');

  try {
    await items.insertMany([
      { _id: 'i1', name: 'Alpha', status: 'featured' },
      { _id: 'i2', name: 'Beta', status: 'sale' },
      { _id: 'i3', name: 'Gamma', status: 'featured' },
      { _id: 'i4', name: 'Delta' },
    ]);

    const featured = await items
      .find({ status: { $in: ['featured'] } })
      .toArray();
    assert.equal(featured.length, 2);
    assert.deepEqual(featured.map((d) => d._id).sort(), ['i1', 'i3']);

    const notFeatured = await items
      .find({ status: { $nin: ['featured'] } })
      .toArray();
    assert.equal(notFeatured.length, 2);
    assert.deepEqual(notFeatured.map((d) => d._id).sort(), ['i2', 'i4']);

    const featuredOrSale = await items
      .find({ status: { $in: ['featured', 'sale'] } })
      .toArray();
    assert.equal(featuredOrSale.length, 3);
  } finally {
    await database.close();
  }
});
