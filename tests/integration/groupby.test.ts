import assert from 'node:assert/strict';
import test from 'node:test';

import { Database, ValidationError } from '../../src/index.js';
import type { Collection, GroupAccumulators } from '../../src/index.js';

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

void test('groupBy array form is unaffected by caller mutating the field array mid-execution', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);

    const fields = ['dept', 'profile.city'];
    // Do not await yet: validateGroupByField copies `fields` synchronously
    // before the internal fetch await, so mutations below cannot leak in.
    const pending = users
      .find({})
      .groupBy(fields, { count: { $count: true } });
    fields[0] = 'status';
    fields.length = 1;

    const result = await pending;

    // Results must reflect the ORIGINAL paths: dept x profile.city.
    assert.equal(result.length, 3);
    for (const group of result) {
      const key = group._key as Record<string, unknown>;
      assert.deepEqual(Object.keys(key).sort(), ['dept', 'profile.city']);
    }

    const engTokyo = result.find((group) => {
      const key = group._key as Record<string, unknown>;
      return key.dept === 'eng' && key['profile.city'] === 'Tokyo';
    });
    assert.ok(engTokyo);
    assert.equal(engTokyo.count, 3);
  } finally {
    await database.close();
  }
});

void test('groupBy $median and $percentile accumulators (string groupBy form)', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);

    const result = await users.find({}).groupBy('dept', {
      medianSalary: { $median: 'salary' },
      p95Salary: { $percentile: { field: 'salary', p: 0.95 } },
    });

    // eng salaries: u1=100, u2=80, u3='90' (string, skipped), u5=200 -> [80, 100, 200]
    const eng = result.find((group) => group._key === 'eng');
    assert.ok(eng);
    assert.equal(eng.medianSalary, 100);
    // rank = 0.95 * 2 = 1.9, lo=1, frac=0.9 -> 100 + 0.9*(200-100) = 190
    assert.equal(eng.p95Salary, 190);

    const design = result.find((group) => group._key === 'design');
    assert.ok(design);
    assert.equal(design.medianSalary, null);
    assert.equal(design.p95Salary, null);
  } finally {
    await database.close();
  }
});

void test('groupBy $median accumulator (multi-dimension array groupBy form)', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);

    const result = await users.find({}).groupBy(['dept', 'profile.city'], {
      medianSalary: { $median: 'salary' },
    });

    const engTokyo = result.find((group) => {
      const key = group._key as Record<string, unknown>;
      return key.dept === 'eng' && key['profile.city'] === 'Tokyo';
    });
    assert.ok(engTokyo);
    // u1=100 (Tokyo), u3='90' (Tokyo, skipped), u5=200 (Tokyo) -> [100, 200]
    assert.equal(engTokyo.medianSalary, 150);
  } finally {
    await database.close();
  }
});

void test('groupBy supports multiple percentile output fields (p50/p95/p99) per group', async () => {
  const database = new Database({});
  const requests = database.collection<{
    _id?: string;
    route: string;
    latencyMs: number;
  }>('requests');

  try {
    await requests.insertMany(
      Array.from({ length: 100 }, (_, i) => ({
        _id: String(i),
        route: '/api',
        latencyMs: i + 1,
      })),
    );

    const result = await requests.find({}).groupBy('route', {
      p50: { $percentile: { field: 'latencyMs', p: 0.5 } },
      p95: { $percentile: { field: 'latencyMs', p: 0.95 } },
      p99: { $percentile: { field: 'latencyMs', p: 0.99 } },
      medianLatency: { $median: 'latencyMs' },
    });

    assert.equal(result.length, 1);
    assert.equal(result[0].p50, 50.5);
    assert.equal(result[0].p95, 95.05);
    assert.equal(result[0].p99, 99.01);
    assert.equal(result[0].medianLatency, result[0].p50);
  } finally {
    await database.close();
  }
});

const badPercentileOperands: unknown[] = [
  'salary',
  { field: 'salary' },
  { p: 0.5 },
  { field: 'salary', p: 1.5 },
  { field: 'salary', p: 0.5, extra: true },
  { field: 'salary', p: [0.5, 0.95] },
];

void test('groupBy $percentile operand validation errors', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);

    for (const operand of badPercentileOperands) {
      await assert.rejects(
        () =>
          users.find().groupBy('dept', {
            result: { $percentile: operand },
          } as unknown as GroupAccumulators),
        ValidationError,
        `Expected ValidationError for operand ${JSON.stringify(operand)}`,
      );
    }
  } finally {
    await database.close();
  }
});

void test('groupBy $stdDevPop/$stdDevSamp/$variancePop/$varianceSamp accumulators (string groupBy form)', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);

    const result = await users.find({}).groupBy('dept', {
      sdPop: { $stdDevPop: 'salary' },
      sdSamp: { $stdDevSamp: 'salary' },
      varPop: { $variancePop: 'salary' },
      varSamp: { $varianceSamp: 'salary' },
    });

    // eng salaries: u1=100, u2=80, u3='90' (string, skipped), u5=200 -> [80, 100, 200]
    // mean = 380/3, pop variance and sample variance computed via Welford.
    const eng = result.find((group) => group._key === 'eng');
    assert.ok(eng);
    const mean = (80 + 100 + 200) / 3;
    const sumSqDev =
      (80 - mean) ** 2 + (100 - mean) ** 2 + (200 - mean) ** 2;
    const expectedVarPop = sumSqDev / 3;
    const expectedVarSamp = sumSqDev / 2;
    assert.ok(Math.abs((eng.varPop as number) - expectedVarPop) < 1e-9);
    assert.ok(Math.abs((eng.varSamp as number) - expectedVarSamp) < 1e-9);
    assert.ok(
      Math.abs((eng.sdPop as number) - Math.sqrt(expectedVarPop)) < 1e-9,
    );
    assert.ok(
      Math.abs((eng.sdSamp as number) - Math.sqrt(expectedVarSamp)) < 1e-9,
    );

    // design has a single active member (u4) with no salary field -> n=0 -> null for all four.
    const design = result.find((group) => group._key === 'design');
    assert.ok(design);
    assert.equal(design.sdPop, null);
    assert.equal(design.sdSamp, null);
    assert.equal(design.varPop, null);
    assert.equal(design.varSamp, null);
  } finally {
    await database.close();
  }
});

void test('groupBy $variancePop/$varianceSamp n=1 edge: pop is 0, samp is null', async () => {
  const database = new Database({});
  const single = database.collection<{
    _id?: string;
    category: string;
    score: number;
  }>('single');

  try {
    // A group with exactly one numeric value (n=1): population variance/stddev
    // is 0 (zero dispersion from itself), sample variance/stddev is null
    // (n-1=0 divisor is undefined).
    await single.insert({ _id: 's1', category: 'solo', score: 42 });

    const result = await single.find({}).groupBy('category', {
      sdPop: { $stdDevPop: 'score' },
      sdSamp: { $stdDevSamp: 'score' },
      varPop: { $variancePop: 'score' },
      varSamp: { $varianceSamp: 'score' },
    });
    assert.equal(result[0].sdPop, 0);
    assert.equal(result[0].varPop, 0);
    assert.equal(result[0].sdSamp, null);
    assert.equal(result[0].varSamp, null);
  } finally {
    await database.close();
  }
});

void test('groupBy $variancePop accumulator (multi-dimension array groupBy form)', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);

    const result = await users.find({}).groupBy(['dept', 'profile.city'], {
      varPop: { $variancePop: 'salary' },
    });

    const engTokyo = result.find((group) => {
      const key = group._key as Record<string, unknown>;
      return key.dept === 'eng' && key['profile.city'] === 'Tokyo';
    });
    assert.ok(engTokyo);
    // u1=100 (Tokyo), u3='90' (Tokyo, skipped), u5=200 (Tokyo) -> [100, 200]
    // mean=150, pop variance = ((100-150)^2 + (200-150)^2) / 2 = 2500
    assert.equal(engTokyo.varPop, 2500);
  } finally {
    await database.close();
  }
});

void test('groupBy accumulator field path validation errors for $stdDevPop/$stdDevSamp/$variancePop/$varianceSamp', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);

    for (const op of [
      '$stdDevPop',
      '$stdDevSamp',
      '$variancePop',
      '$varianceSamp',
    ] as const) {
      await assert.rejects(
        () =>
          users.find().groupBy('dept', {
            result: { [op]: '__proto__.x' },
          } as unknown as GroupAccumulators),
        ValidationError,
        `Expected ValidationError for ${op} with reserved field path`,
      );
    }
  } finally {
    await database.close();
  }
});

void test('groupBy accumulator entry with $stdDevPop and another key still enforces exactly-one-key rule', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);

    await assert.rejects(
      () =>
        users.find().groupBy('dept', {
          result: {
            $stdDevPop: 'salary',
            $variancePop: 'salary',
          },
        } as unknown as GroupAccumulators),
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
