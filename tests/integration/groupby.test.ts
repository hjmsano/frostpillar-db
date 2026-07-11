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

void test('groupBy groups documents and applies accumulators', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);

    const result = await users.find({}).groupBy('dept', {
      count: { $count: true },
      avgSalary: { $avg: 'salary' },
      maxAge: { $max: 'age' },
    });

    assert.equal(result.length, 2);

    const eng = result.find((group) => group._key === 'eng');
    assert.ok(eng);
    assert.equal(eng.count, 4);
    assert.equal(eng.avgSalary, (100 + 80 + 200) / 3);
    assert.equal(eng.maxAge, 35);

    const design = result.find((group) => group._key === 'design');
    assert.ok(design);
    assert.equal(design.count, 1);
    assert.equal(design.avgSalary, null);
    assert.equal(design.maxAge, 28);
  } finally {
    await database.close();
  }
});

void test('groupBy with dot notation field', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);

    const result = await users.find({}).groupBy('profile.city', {
      count: { $count: true },
    });

    assert.equal(result.length, 3);
    assert.equal(result[0]._key, 'Tokyo');
    assert.equal(result[0].count, 3);
    assert.equal(result[1]._key, 'Osaka');
    assert.equal(result[1].count, 1);
    assert.equal(result[2]._key, 'Nagoya');
    assert.equal(result[2].count, 1);
  } finally {
    await database.close();
  }
});

void test('groupBy groups missing field values under null key', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await users.insertMany([
      { _id: 'g1', name: 'A', dept: 'eng' },
      { _id: 'g2', name: 'B' },
      { _id: 'g3', name: 'C', dept: 'eng' },
      { _id: 'g4', name: 'D' },
    ]);

    const result = await users.find({}).groupBy('dept', {
      count: { $count: true },
    });

    assert.equal(result.length, 2);

    const eng = result.find((group) => group._key === 'eng');
    assert.ok(eng);
    assert.equal(eng.count, 2);

    const nullGroup = result.find((group) => group._key === null);
    assert.ok(nullGroup);
    assert.equal(nullGroup.count, 2);
  } finally {
    await database.close();
  }
});

void test('groupBy $sum accumulator', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);

    const result = await users.find({}).groupBy('dept', {
      totalSalary: { $sum: 'salary' },
    });

    const eng = result.find((group) => group._key === 'eng');
    assert.ok(eng);
    assert.equal(eng.totalSalary, 100 + 80 + 200);

    const design = result.find((group) => group._key === 'design');
    assert.ok(design);
    assert.equal(design.totalSalary, 0);
  } finally {
    await database.close();
  }
});

void test('groupBy $min accumulator', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);

    const result = await users.find({}).groupBy('dept', {
      minAge: { $min: 'age' },
    });

    const eng = result.find((group) => group._key === 'eng');
    assert.ok(eng);
    assert.equal(eng.minAge, 24);

    const design = result.find((group) => group._key === 'design');
    assert.ok(design);
    assert.equal(design.minAge, 28);
  } finally {
    await database.close();
  }
});

void test('groupBy returns empty array for no matches', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);

    const result = await users
      .find({ status: 'suspended' })
      .groupBy('dept', { count: { $count: true } });

    assert.deepEqual(result, []);
  } finally {
    await database.close();
  }
});

void test('groupBy throws ValidationError for empty field', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);

    await assert.rejects(
      () => users.find().groupBy('', { count: { $count: true } }),
      ValidationError,
    );
  } finally {
    await database.close();
  }
});

void test('groupBy throws ValidationError for empty accumulators', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);

    await assert.rejects(
      () => users.find().groupBy('dept', {}),
      ValidationError,
    );
  } finally {
    await database.close();
  }
});

void test('groupBy distinguishes keys of different types', async () => {
  const database = new Database({});
  const items = database.collection<{
    _id?: string;
    name: string;
    category: string | number | boolean | null;
  }>('items');

  try {
    await items.insertMany([
      { _id: 'i1', name: 'A', category: 'null' },
      { _id: 'i2', name: 'B', category: 'null' },
      { _id: 'i4', name: 'D', category: 'true' },
      { _id: 'i5', name: 'E', category: true },
      { _id: 'i6', name: 'F', category: '123' },
      { _id: 'i7', name: 'G', category: 123 },
    ]);

    const result = await items.find({}).groupBy('category', {
      count: { $count: true },
    });

    assert.equal(result.length, 5);

    const stringNull = result.find((g) => g._key === 'null');
    assert.ok(stringNull);
    assert.equal(stringNull.count, 2);

    const stringTrue = result.find((g) => g._key === 'true');
    assert.ok(stringTrue);
    assert.equal(stringTrue.count, 1);

    const boolTrue = result.find((g) => g._key === true);
    assert.ok(boolTrue);
    assert.equal(boolTrue.count, 1);

    const string123 = result.find((g) => g._key === '123');
    assert.ok(string123);
    assert.equal(string123.count, 1);

    const num123 = result.find((g) => g._key === 123);
    assert.ok(num123);
    assert.equal(num123.count, 1);
  } finally {
    await database.close();
  }
});

void test('groupBy distinguishes null value from missing field', async () => {
  const database = new Database({});
  const items = database.collection<{
    _id?: string;
    name: string;
    tag?: string | null;
  }>('items');

  try {
    await items.insertMany([
      { _id: 'i1', name: 'A', tag: 'null' },
      { _id: 'i2', name: 'B', tag: null },
      { _id: 'i3', name: 'C' },
    ]);

    const result = await items.find({}).groupBy('tag', {
      count: { $count: true },
    });

    // "null" (string) is one group, null (missing field) and null (value) are another
    const stringNull = result.find((g) => g._key === 'null');
    assert.ok(stringNull);
    assert.equal(stringNull.count, 1);

    const actualNull = result.find((g) => g._key === null);
    assert.ok(actualNull);
    assert.equal(actualNull.count, 2);
  } finally {
    await database.close();
  }
});

void test('groupBy multi-dimension grouping via array field', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);

    const result = await users.find({}).groupBy(['dept', 'profile.city'], {
      count: { $count: true },
      totalSalary: { $sum: 'salary' },
    });

    assert.equal(result.length, 3);

    const findGroup = (
      dept: string,
      city: string,
    ): (typeof result)[number] | undefined =>
      result.find((group) => {
        const key = group._key as Record<string, unknown>;
        return key.dept === dept && key['profile.city'] === city;
      });

    const engTokyo = findGroup('eng', 'Tokyo');
    assert.ok(engTokyo);
    assert.deepEqual(engTokyo._key, { dept: 'eng', 'profile.city': 'Tokyo' });
    // u1 (100), u3 (salary '90' is a string, skipped), u5 (200)
    assert.equal(engTokyo.count, 3);
    assert.equal(engTokyo.totalSalary, 100 + 200);

    const engOsaka = findGroup('eng', 'Osaka');
    assert.ok(engOsaka);
    assert.equal(engOsaka.count, 1);
    assert.equal(engOsaka.totalSalary, 80);

    const designNagoya = findGroup('design', 'Nagoya');
    assert.ok(designNagoya);
    assert.equal(designNagoya.count, 1);
    assert.equal(designNagoya.totalSalary, 0);
  } finally {
    await database.close();
  }
});

void test('groupBy throws ValidationError for empty field array', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);

    await assert.rejects(
      () => users.find().groupBy([], { count: { $count: true } }),
      ValidationError,
    );
  } finally {
    await database.close();
  }
});

void test('groupBy throws ValidationError for duplicate field paths in array', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);

    await assert.rejects(
      () =>
        users.find().groupBy(['dept', 'dept'], { count: { $count: true } }),
      ValidationError,
    );
  } finally {
    await database.close();
  }
});

void test('groupBy respects filter', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);

    const result = await users.find({ status: 'active' }).groupBy('dept', {
      count: { $count: true },
      totalSalary: { $sum: 'salary' },
    });

    assert.equal(result.length, 2);

    const eng = result.find((group) => group._key === 'eng');
    assert.ok(eng);
    assert.equal(eng.count, 3);
    assert.equal(eng.totalSalary, 100 + 200);

    const design = result.find((group) => group._key === 'design');
    assert.ok(design);
    assert.equal(design.count, 1);
    assert.equal(design.totalSalary, 0);
  } finally {
    await database.close();
  }
});
