import assert from 'node:assert/strict';
import test from 'node:test';

import { Database, ValidationError } from '../../src/index.js';
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

void test('distinct returns unique values for a field', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await users.insertMany([
      { _id: 'd1', name: 'A', city: 'Tokyo' },
      { _id: 'd2', name: 'B', city: 'Osaka' },
      { _id: 'd3', name: 'C', city: 'Tokyo' },
    ]);

    const result = await users.find().distinct('city');
    assert.deepEqual(result, ['Tokyo', 'Osaka']);
  } finally {
    await database.close();
  }
});

void test('distinct with dot notation', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);

    const result = await users.find().distinct('profile.city');
    assert.deepEqual(result, ['Tokyo', 'Osaka', 'Nagoya']);
  } finally {
    await database.close();
  }
});

void test('distinct skips missing fields', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await users.insertMany([
      { _id: 'd1', name: 'A', city: 'Tokyo' },
      { _id: 'd2', name: 'B' },
      { _id: 'd3', name: 'C', city: 'Osaka' },
    ]);

    const result = await users.find().distinct('city');
    assert.deepEqual(result, ['Tokyo', 'Osaka']);
  } finally {
    await database.close();
  }
});

void test('distinct includes null', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await users.insertMany([
      { _id: 'd1', name: 'A', city: 'Tokyo' },
      { _id: 'd2', name: 'B', city: null },
      { _id: 'd3', name: 'C', city: 'Tokyo' },
    ]);

    const result = await users.find().distinct('city');
    assert.deepEqual(result, ['Tokyo', null]);
  } finally {
    await database.close();
  }
});

void test('distinct returns empty array for no matches', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);

    const result = await users.find({ status: 'suspended' }).distinct('city');
    assert.deepEqual(result, []);
  } finally {
    await database.close();
  }
});

void test('distinct throws ValidationError for empty field', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);

    await assert.rejects(() => users.find().distinct(''), ValidationError);
  } finally {
    await database.close();
  }
});

void test('distinct respects filter', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);

    const result = await users.find({ dept: 'eng' }).distinct('profile.city');
    assert.deepEqual(result, ['Tokyo', 'Osaka']);
  } finally {
    await database.close();
  }
});

void test('distinct dedupes objects by deep equality regardless of key order', async () => {
  const database = new Database({});
  const col = database.collection<{ _id?: string; v: Record<string, number> }>(
    'objs',
  );

  try {
    await col.insertMany([
      { _id: '1', v: { a: 1, b: 2 } },
      { _id: '2', v: { b: 2, a: 1 } },
      { _id: '3', v: { a: 1, b: 3 } },
    ]);

    const vals = await col.find().distinct('v');
    assert.equal(vals.length, 2);
    assert.deepEqual(vals[0], { a: 1, b: 2 });
    assert.deepEqual(vals[1], { a: 1, b: 3 });
  } finally {
    await database.close();
  }
});

void test('distinct dedupes nested objects regardless of key order', async () => {
  const database = new Database({});
  const col = database.collection<{ _id?: string; v: Record<string, unknown> }>(
    'nested',
  );

  try {
    await col.insertMany([
      { _id: '1', v: { a: { x: 1, y: 2 }, b: 3 } },
      { _id: '2', v: { b: 3, a: { y: 2, x: 1 } } },
      { _id: '3', v: { a: { x: 1, y: 9 }, b: 3 } },
    ]);

    const vals = await col.find().distinct('v');
    assert.equal(vals.length, 2);
    assert.deepEqual(vals[0], { a: { x: 1, y: 2 }, b: 3 });
    assert.deepEqual(vals[1], { a: { x: 1, y: 9 }, b: 3 });
  } finally {
    await database.close();
  }
});

void test('distinct treats array element order as significant', async () => {
  const database = new Database({});
  const col = database.collection<{ _id?: string; v: number[] }>('arrs');

  try {
    await col.insertMany([
      { _id: '1', v: [1, 2] },
      { _id: '2', v: [2, 1] },
      { _id: '3', v: [1, 2] },
    ]);

    const vals = await col.find().distinct('v');
    assert.equal(vals.length, 2);
    assert.deepEqual(vals[0], [1, 2]);
    assert.deepEqual(vals[1], [2, 1]);
  } finally {
    await database.close();
  }
});

void test('distinct distinguishes arrays from objects with numeric keys', async () => {
  const database = new Database({});
  const col = database.collection<{ _id?: string; v: unknown }>('mixed');

  try {
    await col.insertMany([
      { _id: '1', v: [1, 2] },
      { _id: '2', v: { 0: 1, 1: 2 } },
    ]);

    const vals = await col.find().distinct('v');
    assert.equal(vals.length, 2);
    assert.deepEqual(vals[0], [1, 2]);
    assert.deepEqual(vals[1], { 0: 1, 1: 2 });
  } finally {
    await database.close();
  }
});

void test('distinct dedupes a large set of objects in linear time', async () => {
  const database = new Database({});
  const col = database.collection<{ _id?: string; v: Record<string, number> }>(
    'bulk',
  );

  try {
    const docs = Array.from({ length: 20000 }, (_, i) => ({
      _id: String(i),
      // Two distinct shapes, alternating, so dedup must compare many objects.
      v: i % 2 === 0 ? { a: 1, b: 2 } : { a: 1, b: 3 },
    }));
    await col.insertMany(docs);

    const start = Date.now();
    const vals = await col.find().distinct('v');
    const elapsed = Date.now() - start;

    assert.equal(vals.length, 2);
    // An O(N^2) scan over 20k objects would take seconds; O(N) stays well under.
    assert.ok(
      elapsed < 1000,
      `distinct over 20k objects took ${String(elapsed)}ms (expected < 1000ms)`,
    );
  } finally {
    await database.close();
  }
});

void test('percentile computes p-th percentile with linear interpolation', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await users.insertMany([
      { _id: 'p1', name: 'A', salary: 10 },
      { _id: 'p2', name: 'B', salary: 20 },
      { _id: 'p3', name: 'C', salary: 30 },
      { _id: 'p4', name: 'D', salary: 40 },
    ]);

    const chain = users.find({});
    assert.equal(await chain.percentile('salary', 0), 10);
    assert.equal(await chain.percentile('salary', 1), 40);
    assert.equal(await chain.percentile('salary', 0.5), 25);
    assert.equal(await chain.percentile('salary', 0.25), 17.5);
  } finally {
    await database.close();
  }
});

void test('percentile array form fetches once and returns positional results', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await users.insertMany([
      { _id: 'p1', name: 'A', salary: 10 },
      { _id: 'p2', name: 'B', salary: 20 },
      { _id: 'p3', name: 'C', salary: 30 },
      { _id: 'p4', name: 'D', salary: 40 },
    ]);

    const result = await users.find({}).percentile('salary', [0, 0.5, 1]);
    assert.deepEqual(result, [10, 25, 40]);
  } finally {
    await database.close();
  }
});

void test('percentile array form allows duplicate p values', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await users.insertMany([
      { _id: 'p1', name: 'A', salary: 10 },
      { _id: 'p2', name: 'B', salary: 20 },
    ]);

    const result = await users.find({}).percentile('salary', [0.5, 0.5, 0]);
    assert.deepEqual(result, [15, 15, 10]);
  } finally {
    await database.close();
  }
});

void test('median is equivalent to percentile(field, 0.5)', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);
    const chain = users.find({ status: 'active' });
    assert.equal(
      await chain.median('salary'),
      await chain.percentile('salary', 0.5),
    );
  } finally {
    await database.close();
  }
});

void test('percentile and median skip non-numeric values and respect filter', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);
    // active salaries: u1=100, u3='90' (string, skipped), u4 missing, u5=200 -> [100, 200]
    const chain = users.find({ status: 'active' });
    assert.equal(await chain.median('salary'), 150);
    assert.equal(await chain.percentile('salary', 0), 100);
    assert.equal(await chain.percentile('salary', 1), 200);
  } finally {
    await database.close();
  }
});

void test('percentile and median return null for no matching documents', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);
    const noMatch = users.find({ status: 'suspended' });
    assert.equal(await noMatch.median('salary'), null);
    assert.equal(await noMatch.percentile('salary', 0.5), null);
    assert.deepEqual(await noMatch.percentile('salary', [0.5, 0.95]), [
      null,
      null,
    ]);
  } finally {
    await database.close();
  }
});

void test('percentile and median throw ValidationError for invalid p', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);
    await assert.rejects(
      () => users.find().percentile('salary', -0.1),
      ValidationError,
    );
    await assert.rejects(
      () => users.find().percentile('salary', 1.1),
      ValidationError,
    );
    await assert.rejects(
      () => users.find().percentile('salary', Number.NaN),
      ValidationError,
    );
    await assert.rejects(
      () => users.find().percentile('salary', []),
      ValidationError,
    );
    await assert.rejects(
      () => users.find().percentile('salary', [0.5, 1.1]),
      ValidationError,
    );
  } finally {
    await database.close();
  }
});

void test('percentile and median throw ValidationError for empty field', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);
    await assert.rejects(
      () => users.find().percentile('', 0.5),
      ValidationError,
    );
    await assert.rejects(() => users.find().median(''), ValidationError);
  } finally {
    await database.close();
  }
});

void test('aggregation terminals ignore skip/limit when no sort is present', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await users.insertMany([
      { _id: 'a1', name: 'A', status: 'active', salary: 100 },
      { _id: 'a2', name: 'B', status: 'active', salary: 80 },
      { _id: 'a3', name: 'C', status: 'active', salary: 200 },
    ]);

    const chain = users.find({ status: 'active' }).limit(1);
    assert.equal(await chain.sum('salary'), 380);
    assert.equal(await chain.min('salary'), 80);
    assert.equal(await chain.max('salary'), 200);
    assert.equal(await chain.avg('salary'), 380 / 3);
    assert.deepEqual((await chain.distinct('salary')).sort(), [100, 200, 80]);
    // percentile/median also operate on the full filtered set (sorted: [80, 100, 200])
    assert.equal(await chain.median('salary'), 100);
    assert.equal(await chain.percentile('salary', 0), 80);
    assert.equal(await chain.percentile('salary', 1), 200);

    // .count(), by contrast, still honours limit for pagination parity.
    assert.equal(await chain.count(), 1);

    const skipChain = users.find({ status: 'active' }).skip(2);
    assert.equal(await skipChain.sum('salary'), 380);
  } finally {
    await database.close();
  }
});
