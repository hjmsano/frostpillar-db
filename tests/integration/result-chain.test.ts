import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ClosedDatabaseError,
  Database,
  ValidationError,
} from '../../src/index.js';
import type { Collection } from '../../src/index.js';

interface UserDocument {
  _id?: string;
  age?: number;
  city?: string | null;
  dept?: string;
  name: string;
  profile?: {
    city?: string;
    score?: number | string;
  };
  salary?: number | string;
  status?: string;
}

const seedUsers = async (users: Collection<UserDocument>): Promise<void> => {
  await users.insertMany([
    {
      _id: 'u1',
      age: 30,
      dept: 'eng',
      name: 'Alice',
      profile: { city: 'Tokyo', score: 2 },
      salary: 100,
      status: 'active',
    },
    {
      _id: 'u2',
      age: 24,
      dept: 'eng',
      name: 'Bob',
      profile: { city: 'Osaka', score: 5 },
      salary: 80,
      status: 'inactive',
    },
    {
      _id: 'u3',
      age: 28,
      dept: 'eng',
      name: 'Carol',
      profile: { city: 'Tokyo', score: 'high' },
      salary: '90',
      status: 'active',
    },
    {
      _id: 'u4',
      age: 28,
      dept: 'design',
      name: 'Dave',
      profile: { city: 'Nagoya' },
      status: 'active',
    },
    {
      _id: 'u5',
      age: 35,
      dept: 'eng',
      name: 'Erin',
      profile: { city: 'Tokyo', score: 1 },
      salary: 200,
      status: 'active',
    },
  ]);
};

void test('result chain supports sort, skip, limit, and reuse', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);
    const activeUsers = users
      .find({ status: 'active' })
      .sort({ age: -1, name: 1 });

    const page1 = await activeUsers.skip(0).limit(2).toArray();
    const page2 = await activeUsers.skip(2).limit(2).toArray();
    const total = await activeUsers.count();

    assert.deepEqual(
      page1.map((document) => document._id),
      ['u5', 'u1'],
    );
    assert.deepEqual(
      page2.map((document) => document._id),
      ['u3', 'u4'],
    );
    assert.equal(total, 4);
  } finally {
    await database.close();
  }
});

void test('count respects skip and limit', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);

    // 4 eng users total
    const totalEng = await users.find({ dept: 'eng' }).count();
    assert.equal(totalEng, 4);

    // skip 1 → 3 remaining
    const skipped = await users.find({ dept: 'eng' }).skip(1).count();
    assert.equal(skipped, 3);

    // limit 2 → 2
    const limited = await users.find({ dept: 'eng' }).limit(2).count();
    assert.equal(limited, 2);

    // skip 1 + limit 1 → 1
    const skipAndLimit = await users
      .find({ dept: 'eng' })
      .sort({ age: 1 })
      .skip(1)
      .limit(1)
      .project({ _id: 0, name: 1 })
      .count();
    assert.equal(skipAndLimit, 1);

    // skip past all → 0
    const skipAll = await users.find({ dept: 'eng' }).skip(100).count();
    assert.equal(skipAll, 0);

    // limit larger than total → total
    const limitLarger = await users.find({ dept: 'eng' }).limit(100).count();
    assert.equal(limitLarger, 4);
  } finally {
    await database.close();
  }
});

void test('project supports include/exclude with dot notation and _id rules', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);

    const included = await users
      .find({ _id: 'u1' })
      .project({ 'profile.city': 1, name: 1 })
      .toArray();
    assert.deepEqual(included[0], {
      _id: 'u1',
      name: 'Alice',
      profile: {
        city: 'Tokyo',
      },
    });

    const excluded = await users
      .find({ _id: 'u1' })
      .project({ age: 0, 'profile.score': 0 })
      .toArray();
    assert.equal(excluded[0]?._id, 'u1');
    assert.equal(excluded[0]?.age, undefined);
    assert.deepEqual(excluded[0]?.profile, { city: 'Tokyo' });

    const withoutId = await users
      .find({ _id: 'u1' })
      .project({ _id: 0, name: 1 })
      .toArray();
    assert.deepEqual(withoutId[0], { name: 'Alice' });
  } finally {
    await database.close();
  }
});

void test('include projection returns deep copies that do not mutate stored data', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await users.insert({
      _id: 'u1',
      name: 'Alice',
      profile: { city: 'Tokyo' },
    });

    const viaArray = await users
      .find({ _id: 'u1' })
      .project({ profile: 1 })
      .toArray();
    assert.ok(viaArray[0]?.profile);
    viaArray[0].profile.city = 'Osaka';

    const afterArray = await users.findOne({ _id: 'u1' });
    assert.equal(afterArray?.profile?.city, 'Tokyo');

    for await (const doc of users
      .find({ _id: 'u1' })
      .project({ profile: 1 })
      .cursor()) {
      assert.ok(doc.profile);
      doc.profile.city = 'Nagoya';
    }

    const afterCursor = await users.findOne({ _id: 'u1' });
    assert.equal(afterCursor?.profile?.city, 'Tokyo');
  } finally {
    await database.close();
  }
});

void test('result chain validates sort, skip, limit, and projection inputs', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    const invalidSort = { age: 0 } as unknown as Record<string, 1 | -1>;
    assert.throws(() => users.find().sort(invalidSort), ValidationError);

    assert.throws(() => users.find().skip(-1), ValidationError);
    assert.throws(() => users.find().skip(1.5), ValidationError);
    assert.throws(() => users.find().limit(0), ValidationError);
    assert.throws(() => users.find().limit(-2), ValidationError);

    const invalidProjection = { age: 2 } as unknown as Record<string, 0 | 1>;
    assert.throws(
      () => users.find().project(invalidProjection),
      ValidationError,
    );
    assert.throws(
      () => users.find().project({ name: 1, age: 0 }),
      ValidationError,
    );
  } finally {
    await database.close();
  }
});

void test('aggregation terminals use filtered set and skip non-numeric values', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);
    const chain = users
      .find({ status: 'active' })
      .sort({ age: 1 })
      .skip(1)
      .limit(1)
      .project({ _id: 0, name: 1 });

    // count respects skip/limit
    assert.equal(await chain.count(), 1);
    // sum/avg/min/max/percentile/median operate on the full filtered set
    // (ignoring skip/limit): active salaries are [100, 200]
    assert.equal(await chain.sum('salary'), 300);
    assert.equal(await chain.avg('salary'), 150);
    assert.equal(await chain.min('salary'), 100);
    assert.equal(await chain.max('salary'), 200);
    assert.equal(await chain.median('salary'), 150);
    assert.equal(await chain.percentile('salary', 0), 100);
    assert.equal(await chain.percentile('salary', 1), 200);
  } finally {
    await database.close();
  }
});

void test('sort places documents with missing field before existing values in ascending order', async () => {
  const database = new Database({});
  const items = database.collection<{
    _id?: string;
    name: string;
    score?: number;
  }>('items');

  try {
    await items.insertMany([
      { _id: 'a', name: 'A', score: 30 },
      { _id: 'b', name: 'B' },
      { _id: 'c', name: 'C', score: 10 },
      { _id: 'd', name: 'D' },
    ]);

    // Ascending: missing first, then by value
    const ascending = await items.find().sort({ score: 1 }).toArray();
    assert.deepEqual(
      ascending.map((d) => d._id),
      ['b', 'd', 'c', 'a'],
    );

    // Descending: existing first by value, then missing last
    const descending = await items.find().sort({ score: -1 }).toArray();
    assert.deepEqual(
      descending.map((d) => d._id),
      ['a', 'c', 'b', 'd'],
    );
  } finally {
    await database.close();
  }
});

void test('aggregation supports dot notation and empty result defaults', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);

    const scoreChain = users.find({ status: 'active' });
    assert.equal(await scoreChain.sum('profile.score'), 3);
    assert.equal(await scoreChain.avg('profile.score'), 1.5);
    assert.equal(await scoreChain.min('profile.score'), 1);
    assert.equal(await scoreChain.max('profile.score'), 2);

    assert.equal(await scoreChain.median('profile.score'), 1.5);
    assert.equal(await scoreChain.percentile('profile.score', 0), 1);
    assert.equal(await scoreChain.percentile('profile.score', 1), 2);

    const noMatch = users.find({ status: 'suspended' });
    assert.equal(await noMatch.sum('salary'), 0);
    assert.equal(await noMatch.avg('salary'), null);
    assert.equal(await noMatch.min('salary'), null);
    assert.equal(await noMatch.max('salary'), null);
    assert.equal(await noMatch.median('salary'), null);
    assert.equal(await noMatch.percentile('salary', 0.5), null);
  } finally {
    await database.close();
  }
});

void test('project({ _id: 1 }) returns only _id (no information leak)', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await users.insert({
      _id: 'u1',
      name: 'Alice',
      salary: 100,
      status: 'active',
    });

    const result = await users
      .find({ _id: 'u1' })
      .project({ _id: 1 })
      .toArray();
    assert.equal(result.length, 1);
    assert.deepEqual(result[0], { _id: 'u1' });
  } finally {
    await database.close();
  }
});

void test('terminal methods throw ClosedDatabaseError after close', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');
  await users.insert({ _id: 'u1', name: 'Alice', salary: 100 });

  const chain = users.find();
  await database.close();

  await assert.rejects(() => chain.toArray(), ClosedDatabaseError);
  await assert.rejects(() => chain.count(), ClosedDatabaseError);
  await assert.rejects(() => chain.sum('salary'), ClosedDatabaseError);
  await assert.rejects(() => chain.avg('salary'), ClosedDatabaseError);
  await assert.rejects(() => chain.min('salary'), ClosedDatabaseError);
  await assert.rejects(() => chain.max('salary'), ClosedDatabaseError);
  await assert.rejects(() => chain.median('salary'), ClosedDatabaseError);
  await assert.rejects(
    () => chain.percentile('salary', 0.5),
    ClosedDatabaseError,
  );
  await assert.rejects(() => chain.stdDevPop('salary'), ClosedDatabaseError);
  await assert.rejects(() => chain.stdDevSamp('salary'), ClosedDatabaseError);
  await assert.rejects(
    () => chain.variancePop('salary'),
    ClosedDatabaseError,
  );
  await assert.rejects(
    () => chain.varianceSamp('salary'),
    ClosedDatabaseError,
  );
  await assert.rejects(() => chain.distinct('name'), ClosedDatabaseError);
  await assert.rejects(
    () => chain.groupBy('name', { count: { $count: true } }),
    ClosedDatabaseError,
  );
  // cursor() returns synchronously but throws when iteration starts
  const cursor = chain.cursor();
  await assert.rejects(async () => {
    for await (const _ of cursor) {
      void _;
    }
  }, ClosedDatabaseError);
});

void test('sort array form preserves integer-like field name precedence', async () => {
  const database = new Database({});
  const col = database.collection<{ _id?: string; [key: string]: unknown }>(
    'intkeys',
  );

  try {
    await col.insertMany([
      { _id: 'a', '2': 1, '1': 3 },
      { _id: 'b', '2': 2, '1': 2 },
      { _id: 'c', '2': 3, '1': 1 },
    ]);

    // Array form: '2' is primary key — ascending order of '2' gives a, b, c
    const result = await col
      .find()
      .sort([
        ['2', 1],
        ['1', 1],
      ])
      .toArray();
    assert.deepEqual(
      result.map((doc) => doc._id),
      ['a', 'b', 'c'],
    );
  } finally {
    await database.close();
  }
});

void test('find().sort().limit(k) is stable and matches sort().toArray().slice(k)', async () => {
  interface TiedDoc {
    _id?: string;
    score: number;
  }
  const database = new Database({});
  const col = database.collection<TiedDoc>('tied');

  try {
    await col.insertMany([
      { _id: 'a', score: 1 },
      { _id: 'b', score: 1 },
      { _id: 'c', score: 1 },
      { _id: 'd', score: 2 },
      { _id: 'e', score: 2 },
      { _id: 'f', score: 2 },
    ]);

    const fullSorted = await col
      .find()
      .sort([['score', 1]])
      .toArray();

    for (const k of [1, 2, 3, 4, 5]) {
      const limited = await col
        .find()
        .sort([['score', 1]])
        .limit(k)
        .toArray();
      assert.deepEqual(
        limited.map((doc) => doc._id),
        fullSorted.slice(0, k).map((doc) => doc._id),
        `limit(${String(k)}) should match full-sort slice`,
      );
    }
  } finally {
    await database.close();
  }
});

void test('percentile validates p (and field) eagerly before checking closed database', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');
  await users.insert({ _id: 'u1', name: 'Alice', salary: 100 });

  const chain = users.find();
  await database.close();

  // Invalid p/field must surface as ValidationError, not ClosedDatabaseError,
  // proving validation runs before the closed-database check -- the same
  // eager-validation ordering as the other numeric terminals.
  await assert.rejects(() => chain.percentile('salary', 1.5), ValidationError);
  await assert.rejects(() => chain.percentile('', 0.5), ValidationError);
  const arrayP = [0.5, 0.95] as unknown as number;
  await assert.rejects(
    () => chain.percentile('salary', arrayP),
    ValidationError,
  );
  await assert.rejects(() => chain.median(''), ValidationError);
});

void test('result chain supports percentile/median reuse across multiple calls', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);
    const activeUsers = users.find({ status: 'active' });

    const median1 = await activeUsers.median('salary');
    const p95 = await activeUsers.percentile('salary', 0.95);
    const median2 = await activeUsers.median('salary');

    assert.equal(median1, median2);
    assert.equal(median1, 150);
    assert.ok(p95 !== null);
  } finally {
    await database.close();
  }
});

void test('same chain used for toArray and groupBy: sort-aware groupBy order matches sorted toArray order (ADR-020)', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);
    // Storage order dept: eng(u1), eng(u2), eng(u3), design(u4), eng(u5).
    const chain = users.find({}).sort({ dept: 1 });

    const sortedDocs = await chain.toArray();
    assert.deepEqual(
      sortedDocs.map((doc) => doc._id),
      ['u4', 'u1', 'u2', 'u3', 'u5'],
    );

    const grouped = await chain.groupBy('dept', {
      count: { $count: true },
    });
    // 'design' < 'eng' lexicographically, so the group order flips relative
    // to storage order ('eng' first in storage) once the chain's .sort() is
    // honored -- this is the ADR-020 behavior change.
    assert.deepEqual(
      grouped.map((entry) => entry._key),
      ['design', 'eng'],
    );

    // The two results are mutually consistent: groupBy's group order equals
    // the first-occurrence order of `dept` within the sorted toArray() output.
    const firstOccurrenceOrder: unknown[] = [];
    for (const doc of sortedDocs) {
      if (!firstOccurrenceOrder.includes(doc.dept)) {
        firstOccurrenceOrder.push(doc.dept);
      }
    }
    assert.deepEqual(
      grouped.map((entry) => entry._key),
      firstOccurrenceOrder,
    );

    // Reusing the same chain instance did not mutate its state.
    const sortedDocsAgain = await chain.toArray();
    assert.deepEqual(sortedDocsAgain, sortedDocs);
  } finally {
    await database.close();
  }
});
