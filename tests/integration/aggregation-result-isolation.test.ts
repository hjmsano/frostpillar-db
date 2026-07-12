// Spec 03 §1.3 / ADR-026: aggregation terminals resolve field paths on the
// stored documents themselves, so every object/array value they hand back is
// cloned out of storage first. Without the clone, mutating a `distinct()`
// element or a `groupBy()` `_key` rewrote the stored record in place — with no
// validation, no payload-limit check, and no watch event.
import assert from 'node:assert/strict';
import test from 'node:test';

import { Database } from '../../src/index.js';

interface Doc {
  _id?: string;
  name: string;
  profile: { city: string; tags: string[] };
}

void test('distinct() returns cloned values: mutating one cannot alter the stored document', async () => {
  const database = new Database({});
  const collection = database.collection<Doc>('docs');

  try {
    await collection.insert({
      name: 'Alice',
      profile: { city: 'Tokyo', tags: ['a'] },
    });

    const profiles = await collection.find().distinct('profile');
    assert.equal(profiles.length, 1);

    const profile = profiles[0] as { city: string; tags: string[] };
    profile.city = 'Osaka';
    profile.tags.push('injected');

    const stored = await collection.findOne({ name: 'Alice' });
    assert.deepEqual(stored?.profile, { city: 'Tokyo', tags: ['a'] });
  } finally {
    await database.close();
  }
});

void test('groupBy() returns a cloned _key: mutating it cannot alter the stored document', async () => {
  const database = new Database({});
  const collection = database.collection<Doc>('docs');

  try {
    await collection.insert({
      name: 'Alice',
      profile: { city: 'Tokyo', tags: ['a'] },
    });

    const groups = await collection
      .find()
      .groupBy('profile', { count: { $count: true } });
    assert.equal(groups.length, 1);

    const key = groups[0]._key as { city: string; tags: string[] };
    key.city = 'Osaka';
    key.tags.push('injected');

    const stored = await collection.findOne({ name: 'Alice' });
    assert.deepEqual(stored?.profile, { city: 'Tokyo', tags: ['a'] });
  } finally {
    await database.close();
  }
});

void test('groupBy() composite _key dimensions are cloned independently', async () => {
  const database = new Database({});
  const collection = database.collection<Doc>('docs');

  try {
    await collection.insert({
      name: 'Alice',
      profile: { city: 'Tokyo', tags: ['a'] },
    });

    const groups = await collection
      .find()
      .groupBy(['profile', 'profile.tags'], { count: { $count: true } });
    assert.equal(groups.length, 1);

    const key = groups[0]._key as Record<string, unknown>;
    (key.profile as { city: string }).city = 'Osaka';
    (key['profile.tags'] as string[]).push('injected');

    const stored = await collection.findOne({ name: 'Alice' });
    assert.deepEqual(stored?.profile, { city: 'Tokyo', tags: ['a'] });
  } finally {
    await database.close();
  }
});
