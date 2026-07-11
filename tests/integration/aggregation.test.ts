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

// --- countDistinct (ADR-022) ------------------------------------------------

void test('countDistinct returns the count of unique values for a field', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await users.insertMany([
      { _id: 'd1', name: 'A', city: 'Tokyo' },
      { _id: 'd2', name: 'B', city: 'Osaka' },
      { _id: 'd3', name: 'C', city: 'Tokyo' },
    ]);

    const result = await users.find().countDistinct('city');
    assert.equal(result, 2);
  } finally {
    await database.close();
  }
});

void test('countDistinct with dot notation (nested field)', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);

    const result = await users.find().countDistinct('profile.city');
    assert.equal(result, 3);
  } finally {
    await database.close();
  }
});

void test('countDistinct respects filter', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);

    const result = await users
      .find({ dept: 'eng' })
      .countDistinct('profile.city');
    assert.equal(result, 2);
  } finally {
    await database.close();
  }
});

void test('countDistinct skips missing fields and counts null as a value', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await users.insertMany([
      { _id: 'd1', name: 'A', city: 'Tokyo' },
      { _id: 'd2', name: 'B' },
      { _id: 'd3', name: 'C', city: null },
      { _id: 'd4', name: 'D', city: 'Tokyo' },
    ]);

    // 'Tokyo' and null are distinct values; missing (d2) is skipped.
    const result = await users.find().countDistinct('city');
    assert.equal(result, 2);
  } finally {
    await database.close();
  }
});

void test('countDistinct returns 0 for no matching documents', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);

    const result = await users
      .find({ status: 'suspended' })
      .countDistinct('city');
    assert.equal(result, 0);
  } finally {
    await database.close();
  }
});

void test('countDistinct returns 0 when matches exist but the field is always missing', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await users.insertMany([
      { _id: 'd1', name: 'A' },
      { _id: 'd2', name: 'B' },
    ]);

    const result = await users.find().countDistinct('city');
    assert.equal(result, 0);
  } finally {
    await database.close();
  }
});

void test('countDistinct throws ValidationError for empty field', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);

    await assert.rejects(
      () => users.find().countDistinct(''),
      ValidationError,
    );
  } finally {
    await database.close();
  }
});

void test('countDistinct validates field eagerly before checking closed database', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');
  await users.insert({ _id: 'u1', name: 'Alice', city: 'Tokyo' });

  const chain = users.find();
  await database.close();

  // Invalid field must surface as ValidationError, not ClosedDatabaseError,
  // proving field validation runs before the closed-database check -- the
  // same eager-validation ordering as the other aggregation terminals.
  await assert.rejects(
    () => chain.countDistinct('__proto__'),
    ValidationError,
  );
});

void test('countDistinct is order-insensitive: identical with and without a preceding .sort()', async () => {
  const database = new Database({});
  const ranked = database.collection<RankedDocument>('ranked');

  try {
    await ranked.insertMany([
      { _id: '1', category: 'b', rank: 3 },
      { _id: '2', category: 'a', rank: 1 },
      { _id: '3', category: 'c', rank: 2 },
      { _id: '4', category: 'a', rank: 4 },
    ]);

    const noSort = await ranked.find({}).countDistinct('category');
    const sortAsc = await ranked
      .find({})
      .sort({ rank: 1 })
      .countDistinct('category');
    const sortDesc = await ranked
      .find({})
      .sort({ rank: -1 })
      .countDistinct('category');

    assert.equal(noSort, 3);
    assert.equal(sortAsc, noSort);
    assert.equal(sortDesc, noSort);
  } finally {
    await database.close();
  }
});

void test('countDistinct equals distinct(field).length for a filtered set', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);

    const distinctValues = await users.find({ dept: 'eng' }).distinct('profile.city');
    const count = await users.find({ dept: 'eng' }).countDistinct('profile.city');
    assert.equal(count, distinctValues.length);
  } finally {
    await database.close();
  }
});

void test('result chain supports countDistinct reuse across multiple calls', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);
    const activeUsers = users.find({ status: 'active' });

    const count1 = await activeUsers.countDistinct('profile.city');
    const distinctValues = await activeUsers.distinct('profile.city');
    const count2 = await activeUsers.countDistinct('profile.city');

    assert.equal(count1, count2);
    assert.equal(count1, distinctValues.length);
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
    const arrayP = [0.5, 0.95] as unknown as number;
    await assert.rejects(
      () => users.find().percentile('salary', arrayP),
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

void test('stdDevPop/stdDevSamp/variancePop/varianceSamp compute correct values with filter', async () => {
  const database = new Database({});
  const scores = database.collection<{ _id?: string; score: number }>(
    'scores',
  );

  try {
    // [2, 4, 4, 4, 5, 5, 7, 9]: mean=5, sum sq dev=32
    // population variance = 32/8 = 4, stdDevPop = 2
    // sample variance = 32/7, stdDevSamp = sqrt(32/7)
    await scores.insertMany(
      [2, 4, 4, 4, 5, 5, 7, 9].map((score, i) => ({
        _id: `s${String(i)}`,
        score,
      })),
    );

    const chain = scores.find({});
    assert.equal(await chain.variancePop('score'), 4);
    assert.equal(await chain.stdDevPop('score'), 2);
    const varSamp = await chain.varianceSamp('score');
    assert.ok(varSamp !== null);
    assert.ok(Math.abs(varSamp - 32 / 7) < 1e-9);
    const sdSamp = await chain.stdDevSamp('score');
    assert.ok(sdSamp !== null);
    assert.ok(Math.abs(sdSamp - Math.sqrt(32 / 7)) < 1e-9);
  } finally {
    await database.close();
  }
});

void test('stdDevPop/stdDevSamp/variancePop/varianceSamp skip non-numeric values and respect filter', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);
    // active salaries: u1=100, u3='90' (string, skipped), u4 missing, u5=200 -> [100, 200]
    // mean=150, sum sq dev = 2500+2500=5000; pop var=2500, samp var=5000
    const chain = users.find({ status: 'active' });
    assert.equal(await chain.variancePop('salary'), 2500);
    assert.equal(await chain.stdDevPop('salary'), 50);
    assert.equal(await chain.varianceSamp('salary'), 5000);
    assert.equal(await chain.stdDevSamp('salary'), Math.sqrt(5000));
  } finally {
    await database.close();
  }
});

void test('stdDevPop/stdDevSamp/variancePop/varianceSamp return null for no matching documents (n=0)', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);
    const noMatch = users.find({ status: 'suspended' });
    assert.equal(await noMatch.stdDevPop('salary'), null);
    assert.equal(await noMatch.stdDevSamp('salary'), null);
    assert.equal(await noMatch.variancePop('salary'), null);
    assert.equal(await noMatch.varianceSamp('salary'), null);
  } finally {
    await database.close();
  }
});

void test('stdDevPop/variancePop are 0 and stdDevSamp/varianceSamp are null for a single numeric value (n=1)', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await users.insert({ _id: 'u1', name: 'Alice', salary: 100 });
    const chain = users.find({});
    assert.equal(await chain.stdDevPop('salary'), 0);
    assert.equal(await chain.variancePop('salary'), 0);
    assert.equal(await chain.stdDevSamp('salary'), null);
    assert.equal(await chain.varianceSamp('salary'), null);
  } finally {
    await database.close();
  }
});

void test('stdDevPop/stdDevSamp/variancePop/varianceSamp throw ValidationError for empty field', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);
    await assert.rejects(() => users.find().stdDevPop(''), ValidationError);
    await assert.rejects(() => users.find().stdDevSamp(''), ValidationError);
    await assert.rejects(() => users.find().variancePop(''), ValidationError);
    await assert.rejects(
      () => users.find().varianceSamp(''),
      ValidationError,
    );
  } finally {
    await database.close();
  }
});

void test('stdDevPop/stdDevSamp/variancePop/varianceSamp validate field eagerly before checking closed database', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');
  await users.insert({ _id: 'u1', name: 'Alice', salary: 100 });

  const chain = users.find();
  await database.close();

  // Invalid field must surface as ValidationError, not ClosedDatabaseError,
  // proving field validation runs before the closed-database check -- the
  // same eager-validation ordering as the other numeric terminals.
  await assert.rejects(() => chain.stdDevPop('__proto__'), ValidationError);
  await assert.rejects(() => chain.stdDevSamp('__proto__'), ValidationError);
  await assert.rejects(() => chain.variancePop('__proto__'), ValidationError);
  await assert.rejects(
    () => chain.varianceSamp('__proto__'),
    ValidationError,
  );
});

void test('result chain supports stdDevPop/stdDevSamp/variancePop/varianceSamp reuse across multiple calls', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);
    const activeUsers = users.find({ status: 'active' });

    const varPop1 = await activeUsers.variancePop('salary');
    const stdDevSamp = await activeUsers.stdDevSamp('salary');
    const varPop2 = await activeUsers.variancePop('salary');

    assert.equal(varPop1, varPop2);
    assert.equal(varPop1, 2500);
    assert.ok(stdDevSamp !== null);
  } finally {
    await database.close();
  }
});

// --- Chain-sort-aware aggregation (ADR-020) --------------------------------

interface RankedDocument {
  _id?: string;
  category: string;
  nested?: { rank?: number };
  rank?: number;
  tie?: number;
}

void test('distinct follows .sort() order (ascending) when a sort precedes it', async () => {
  const database = new Database({});
  const ranked = database.collection<RankedDocument>('ranked');

  try {
    await ranked.insertMany([
      { _id: '1', category: 'b', rank: 3 },
      { _id: '2', category: 'a', rank: 1 },
      { _id: '3', category: 'c', rank: 2 },
      { _id: '4', category: 'a', rank: 4 },
    ]);

    // Storage order (no sort): first occurrence is b, a, c.
    assert.deepEqual(await ranked.find({}).distinct('category'), [
      'b',
      'a',
      'c',
    ]);

    // Ascending by rank: 2(a,1), 3(c,2), 1(b,3), 4(a,4 dup) -> a, c, b.
    const asc = await ranked
      .find({})
      .sort({ rank: 1 })
      .distinct('category');
    assert.deepEqual(asc, ['a', 'c', 'b']);
  } finally {
    await database.close();
  }
});

void test('distinct follows .sort() order (descending) when a sort precedes it', async () => {
  const database = new Database({});
  const ranked = database.collection<RankedDocument>('ranked');

  try {
    await ranked.insertMany([
      { _id: '1', category: 'b', rank: 3 },
      { _id: '2', category: 'a', rank: 1 },
      { _id: '3', category: 'c', rank: 2 },
      { _id: '4', category: 'a', rank: 4 },
    ]);

    // Descending by rank: 4(a,4), 1(b,3), 3(c,2), 2(a,1 dup) -> a, b, c.
    const desc = await ranked
      .find({})
      .sort({ rank: -1 })
      .distinct('category');
    assert.deepEqual(desc, ['a', 'b', 'c']);
  } finally {
    await database.close();
  }
});

void test('distinct honors multi-key .sort() precedence', async () => {
  const database = new Database({});
  const ranked = database.collection<RankedDocument>('ranked');

  try {
    await ranked.insertMany([
      { _id: '1', category: 'x', rank: 1, tie: 2 },
      { _id: '2', category: 'y', rank: 1, tie: 1 },
      { _id: '3', category: 'z', rank: 2, tie: 0 },
    ]);

    // Primary key rank, secondary key tie: rank=1 group ordered by tie
    // (2 then 1), so y (tie:1) sorts before x (tie:2); z (rank:2) is last.
    const result = await ranked
      .find({})
      .sort({ rank: 1, tie: 1 })
      .distinct('category');
    assert.deepEqual(result, ['y', 'x', 'z']);
  } finally {
    await database.close();
  }
});

void test('distinct honors .sort() on a dotted-path field', async () => {
  const database = new Database({});
  const ranked = database.collection<RankedDocument>('ranked');

  try {
    await ranked.insertMany([
      { _id: '1', category: 'p', nested: { rank: 3 } },
      { _id: '2', category: 'q', nested: { rank: 1 } },
      { _id: '3', category: 'r', nested: { rank: 2 } },
    ]);

    const result = await ranked
      .find({})
      .sort({ 'nested.rank': 1 })
      .distinct('category');
    assert.deepEqual(result, ['q', 'r', 'p']);
  } finally {
    await database.close();
  }
});

void test('distinct places missing-sort-field documents per spec 03 §1.2 order', async () => {
  const database = new Database({});
  const ranked = database.collection<RankedDocument>('ranked');

  try {
    await ranked.insertMany([
      { _id: '1', category: 'x', rank: 5 },
      { _id: '2', category: 'y' }, // rank missing
      { _id: '3', category: 'z', rank: 1 },
    ]);

    // Ascending: missing sorts first, then by value ascending -> y, z, x.
    const asc = await ranked.find({}).sort({ rank: 1 }).distinct('category');
    assert.deepEqual(asc, ['y', 'z', 'x']);

    // Descending: existing values first (descending), missing last -> x, z, y.
    const desc = await ranked
      .find({})
      .sort({ rank: -1 })
      .distinct('category');
    assert.deepEqual(desc, ['x', 'z', 'y']);
  } finally {
    await database.close();
  }
});

void test('regression: distinct and groupBy without .sort() are byte-identical to storage-order behavior', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);

    // distinct: storage-order first occurrence, unaffected by ADR-020.
    assert.deepEqual(await users.find({}).distinct('dept'), [
      'eng',
      'design',
    ]);

    const grouped = await users.find({}).groupBy('dept', {
      count: { $count: true },
    });
    assert.deepEqual(
      grouped.map((entry) => entry._key),
      ['eng', 'design'],
    );
  } finally {
    await database.close();
  }
});

interface MetricDocument {
  _id?: string;
  group: string;
  value: number | string;
}

void test('regression: numeric aggregation terminals are identical with and without a preceding .sort()', async () => {
  const database = new Database({});
  const metrics = database.collection<MetricDocument>('metrics');

  try {
    await metrics.insertMany([
      { _id: '1', group: 'g1', value: 7 },
      { _id: '2', group: 'g2', value: 'nonnumeric' },
      { _id: '3', group: 'g1', value: 2 },
      { _id: '4', group: 'g3', value: 9 },
      { _id: '5', group: 'g2', value: 4 },
      { _id: '6', group: 'g1', value: 4 },
      { _id: '7', group: 'g3', value: 1 },
      { _id: '8', group: 'g2', value: 6 },
      { _id: '9', group: 'g1', value: 8 },
      { _id: '10', group: 'g3', value: 3 },
    ]);

    const noSort = metrics.find({});
    const sortAsc = metrics.find({}).sort({ value: 1 });
    const sortDesc = metrics.find({}).sort({ value: -1 });
    const sortByGroup = metrics.find({}).sort({ group: 1, value: -1 });

    const baselineSum = await noSort.sum('value');
    assert.equal(baselineSum, 44);
    assert.equal(await sortAsc.sum('value'), baselineSum);
    assert.equal(await sortDesc.sum('value'), baselineSum);
    assert.equal(await sortByGroup.sum('value'), baselineSum);

    const baselineAvg = await noSort.avg('value');
    assert.equal(await sortAsc.avg('value'), baselineAvg);
    assert.equal(await sortDesc.avg('value'), baselineAvg);
    assert.equal(await sortByGroup.avg('value'), baselineAvg);

    const baselineMin = await noSort.min('value');
    assert.equal(await sortAsc.min('value'), baselineMin);
    assert.equal(await sortDesc.min('value'), baselineMin);
    assert.equal(await sortByGroup.min('value'), baselineMin);

    const baselineMax = await noSort.max('value');
    assert.equal(await sortAsc.max('value'), baselineMax);
    assert.equal(await sortDesc.max('value'), baselineMax);
    assert.equal(await sortByGroup.max('value'), baselineMax);

    const baselineMedian = await noSort.median('value');
    assert.equal(await sortAsc.median('value'), baselineMedian);
    assert.equal(await sortDesc.median('value'), baselineMedian);
    assert.equal(await sortByGroup.median('value'), baselineMedian);

    const baselineP25 = await noSort.percentile('value', 0.25);
    assert.equal(await sortAsc.percentile('value', 0.25), baselineP25);
    assert.equal(await sortDesc.percentile('value', 0.25), baselineP25);
    assert.equal(await sortByGroup.percentile('value', 0.25), baselineP25);

    const baselineP75 = await noSort.percentile('value', 0.75);
    assert.equal(await sortAsc.percentile('value', 0.75), baselineP75);
    assert.equal(await sortDesc.percentile('value', 0.75), baselineP75);
    assert.equal(await sortByGroup.percentile('value', 0.75), baselineP75);

    const baselineStdDevPop = await noSort.stdDevPop('value');
    assert.equal(await sortAsc.stdDevPop('value'), baselineStdDevPop);
    assert.equal(await sortDesc.stdDevPop('value'), baselineStdDevPop);
    assert.equal(await sortByGroup.stdDevPop('value'), baselineStdDevPop);

    const baselineStdDevSamp = await noSort.stdDevSamp('value');
    assert.equal(await sortAsc.stdDevSamp('value'), baselineStdDevSamp);
    assert.equal(await sortDesc.stdDevSamp('value'), baselineStdDevSamp);
    assert.equal(await sortByGroup.stdDevSamp('value'), baselineStdDevSamp);

    const baselineVariancePop = await noSort.variancePop('value');
    assert.equal(await sortAsc.variancePop('value'), baselineVariancePop);
    assert.equal(await sortDesc.variancePop('value'), baselineVariancePop);
    assert.equal(
      await sortByGroup.variancePop('value'),
      baselineVariancePop,
    );

    const baselineVarianceSamp = await noSort.varianceSamp('value');
    assert.equal(await sortAsc.varianceSamp('value'), baselineVarianceSamp);
    assert.equal(await sortDesc.varianceSamp('value'), baselineVarianceSamp);
    assert.equal(
      await sortByGroup.varianceSamp('value'),
      baselineVarianceSamp,
    );
  } finally {
    await database.close();
  }
});
