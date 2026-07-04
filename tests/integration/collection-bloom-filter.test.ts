import assert from 'node:assert/strict';
import test from 'node:test';

import { Database, DuplicateIdError } from '../../src/index.js';

interface UserDocument {
  _id?: string;
  name: string;
}

void test('reject policy with bloom filter: inserts unique IDs and rejects duplicates', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users', {
    duplicateKeys: 'reject',
  });

  try {
    const ids: string[] = [];
    for (let i = 0; i < 100; i++) {
      const id = await users.insert({ _id: `user-${i}`, name: `User ${i}` });
      ids.push(id);
    }

    assert.equal(ids.length, 100);
    assert.equal(await users.count(), 100);

    await assert.rejects(
      () => users.insert({ _id: 'user-0', name: 'Duplicate' }),
      DuplicateIdError,
    );

    await assert.rejects(
      () => users.insert({ _id: 'user-99', name: 'Duplicate' }),
      DuplicateIdError,
    );

    assert.equal(await users.count(), 100);
  } finally {
    await database.close();
  }
});

void test('reject policy with bloom filter: works correctly after removals', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users', {
    duplicateKeys: 'reject',
  });

  try {
    await users.insert({ _id: 'u1', name: 'Alice' });
    await users.insert({ _id: 'u2', name: 'Bob' });

    await users.remove({ _id: 'u1' });

    // After removal, bloom filter still says "maybe" for u1,
    // but the has() fallback confirms it is gone. Insert should succeed.
    const reinsertedId = await users.insert({
      _id: 'u1',
      name: 'Alice Reinserted',
    });
    assert.equal(reinsertedId, 'u1');

    const doc = await users.findOne({ _id: 'u1' });
    assert.equal(doc?.name, 'Alice Reinserted');
  } finally {
    await database.close();
  }
});
