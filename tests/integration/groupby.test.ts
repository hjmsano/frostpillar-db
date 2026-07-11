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

// --- Chain-sort-aware aggregation (ADR-020) --------------------------------

interface GroupRankedDocument {
  _id?: string;
  group: string;
  rank: number;
}

void test('groupBy group order follows .sort() ascending', async () => {
  const database = new Database({});
  const items = database.collection<GroupRankedDocument>('items');

  try {
    await items.insertMany([
      { _id: '1', group: 'b', rank: 3 },
      { _id: '2', group: 'a', rank: 1 },
      { _id: '3', group: 'c', rank: 2 },
      { _id: '4', group: 'a', rank: 4 },
    ]);

    // Storage order (no sort): first occurrence is b, a, c.
    const noSort = await items.find({}).groupBy('group', {
      count: { $count: true },
    });
    assert.deepEqual(
      noSort.map((entry) => entry._key),
      ['b', 'a', 'c'],
    );

    // Ascending by rank: 2(a,1), 3(c,2), 1(b,3), 4(a,4 dup) -> a, c, b.
    const sorted = await items
      .find({})
      .sort({ rank: 1 })
      .groupBy('group', { count: { $count: true } });
    assert.deepEqual(
      sorted.map((entry) => entry._key),
      ['a', 'c', 'b'],
    );

    // Group contents (not just order) are unchanged by the sort.
    const groupA = sorted.find((entry) => entry._key === 'a');
    assert.ok(groupA);
    assert.equal(groupA.count, 2);
  } finally {
    await database.close();
  }
});

void test('groupBy group order follows .sort() descending', async () => {
  const database = new Database({});
  const items = database.collection<GroupRankedDocument>('items');

  try {
    await items.insertMany([
      { _id: '1', group: 'b', rank: 3 },
      { _id: '2', group: 'a', rank: 1 },
      { _id: '3', group: 'c', rank: 2 },
      { _id: '4', group: 'a', rank: 4 },
    ]);

    // Descending by rank: 4(a,4), 1(b,3), 3(c,2), 2(a,1 dup) -> a, b, c.
    const sorted = await items
      .find({})
      .sort({ rank: -1 })
      .groupBy('group', { count: { $count: true } });
    assert.deepEqual(
      sorted.map((entry) => entry._key),
      ['a', 'b', 'c'],
    );
  } finally {
    await database.close();
  }
});

// --- $first / $last accumulators (ADR-021) ---------------------------------

interface EventDocument {
  _id?: string;
  userId: string;
  status: string;
  updatedAt: number;
  meta?: { tags?: string[] } | null;
}

void test('groupBy $first/$last: latest status per user via .sort() descending (canonical ADR-021 example)', async () => {
  const database = new Database({});
  const events = database.collection<EventDocument>('events');

  try {
    await events.insertMany([
      { _id: 'e1', userId: 'u1', status: 'created', updatedAt: 1 },
      { _id: 'e2', userId: 'u1', status: 'shipped', updatedAt: 3 },
      { _id: 'e3', userId: 'u1', status: 'paid', updatedAt: 2 },
      { _id: 'e4', userId: 'u2', status: 'created', updatedAt: 1 },
    ]);

    const result = await events
      .find({})
      .sort({ updatedAt: -1 })
      .groupBy('userId', {
        latestStatus: { $first: 'status' },
      });

    const u1 = result.find((group) => group._key === 'u1');
    assert.ok(u1);
    // Descending by updatedAt: e2(3,shipped), e3(2,paid), e1(1,created) -> first is e2.
    assert.equal(u1.latestStatus, 'shipped');

    const u2 = result.find((group) => group._key === 'u2');
    assert.ok(u2);
    assert.equal(u2.latestStatus, 'created');
  } finally {
    await database.close();
  }
});

void test('groupBy $first/$last: first event per session via .sort() ascending', async () => {
  const database = new Database({});
  const events = database.collection<EventDocument>('events');

  try {
    await events.insertMany([
      { _id: 'e1', userId: 's1', status: 'created', updatedAt: 5 },
      { _id: 'e2', userId: 's1', status: 'shipped', updatedAt: 1 },
      { _id: 'e3', userId: 's1', status: 'paid', updatedAt: 3 },
    ]);

    const result = await events
      .find({})
      .sort({ updatedAt: 1 })
      .groupBy('userId', {
        earliestStatus: { $first: 'status' },
        latestStatus: { $last: 'status' },
      });

    assert.equal(result[0].earliestStatus, 'shipped'); // updatedAt=1
    assert.equal(result[0].latestStatus, 'created'); // updatedAt=5
  } finally {
    await database.close();
  }
});

void test('groupBy $first/$last: multi-key .sort() determines group document order', async () => {
  const database = new Database({});
  const events = database.collection<EventDocument>('events');

  try {
    await events.insertMany([
      { _id: 'e1', userId: 'u1', status: 'a', updatedAt: 1 },
      { _id: 'e2', userId: 'u1', status: 'b', updatedAt: 1 },
      { _id: 'e3', userId: 'u1', status: 'c', updatedAt: 2 },
    ]);

    // Sort by updatedAt asc, then _id desc: within updatedAt=1, e2 before e1.
    const result = await events
      .find({})
      .sort([
        ['updatedAt', 1],
        ['_id', -1],
      ])
      .groupBy('userId', {
        firstStatus: { $first: 'status' },
        lastStatus: { $last: 'status' },
      });

    assert.equal(result[0].firstStatus, 'b');
    assert.equal(result[0].lastStatus, 'c');
  } finally {
    await database.close();
  }
});

void test('groupBy $first/$last without .sort() uses storage order', async () => {
  const database = new Database({});
  const events = database.collection<EventDocument>('events');

  try {
    await events.insertMany([
      { _id: 'e1', userId: 'u1', status: 'a', updatedAt: 1 },
      { _id: 'e2', userId: 'u1', status: 'b', updatedAt: 2 },
      { _id: 'e3', userId: 'u1', status: 'c', updatedAt: 3 },
    ]);

    const result = await events.find({}).groupBy('userId', {
      firstStatus: { $first: 'status' },
      lastStatus: { $last: 'status' },
    });

    // Storage order (insertion order for the memory backend): a, b, c.
    assert.equal(result[0].firstStatus, 'a');
    assert.equal(result[0].lastStatus, 'c');
  } finally {
    await database.close();
  }
});

void test('groupBy $first/$last tie-stability: equal sort keys keep storage order', async () => {
  const database = new Database({});
  const items = database.collection<GroupRankedDocument>('items');

  try {
    await items.insertMany([
      { _id: 'A', group: 'p', rank: 1 },
      { _id: 'B', group: 'p', rank: 1 }, // tie with A
      { _id: 'C', group: 'p', rank: 2 },
    ]);

    const result = await items
      .find({})
      .sort({ rank: 1 })
      .groupBy('group', {
        firstId: { $first: '_id' },
        lastId: { $last: '_id' },
      });

    // Ties (A, B at rank 1) keep storage order -> A first; C is rank 2 -> last.
    assert.equal(result[0].firstId, 'A');
    assert.equal(result[0].lastId, 'C');
  } finally {
    await database.close();
  }
});

void test('groupBy $first/$last: positional-then-read -- missing field on the selected document returns null even when another document in the group has it', async () => {
  const database = new Database({});
  const events = database.collection<EventDocument>('events');

  try {
    // Sorted ascending by updatedAt: e1 (no status) is first, e2 (status='b') is second.
    await events.insertMany([
      { _id: 'e1', userId: 'u1', updatedAt: 1 } as EventDocument,
      { _id: 'e2', userId: 'u1', status: 'b', updatedAt: 2 },
    ]);

    const result = await events
      .find({})
      .sort({ updatedAt: 1 })
      .groupBy('userId', {
        firstStatus: { $first: 'status' },
      });

    // e1 is positionally first but lacks `status` -> null, NOT "b".
    assert.equal(result[0].firstStatus, null);
  } finally {
    await database.close();
  }
});

void test('groupBy $first/$last: non-numeric value types (boolean, null, object, array)', async () => {
  const database = new Database({});
  const items = database.collection<{
    _id?: string;
    category: string;
    flag: boolean;
    tag: string | null;
    meta: { level: number };
    list: number[];
  }>('items');

  try {
    await items.insertMany([
      {
        _id: 'i1',
        category: 'a',
        flag: true,
        tag: null,
        meta: { level: 1 },
        list: [1, 2],
      },
    ]);

    const result = await items.find({}).groupBy('category', {
      firstFlag: { $first: 'flag' },
      firstTag: { $first: 'tag' },
      firstMeta: { $first: 'meta' },
      firstList: { $first: 'list' },
    });

    assert.equal(result[0].firstFlag, true);
    assert.equal(result[0].firstTag, null);
    assert.deepEqual(result[0].firstMeta, { level: 1 });
    assert.deepEqual(result[0].firstList, [1, 2]);
  } finally {
    await database.close();
  }
});

void test('groupBy $first/$last: mutating a returned object/array value does not affect the stored document', async () => {
  const database = new Database({});
  const items = database.collection<{
    _id?: string;
    category: string;
    meta: { tags: string[] };
  }>('items');

  try {
    await items.insert({
      _id: 'i1',
      category: 'a',
      meta: { tags: ['x', 'y'] },
    });

    const result = await items.find({}).groupBy('category', {
      firstMeta: { $first: 'meta' },
    });

    const firstMeta = result[0].firstMeta as { tags: string[] };
    firstMeta.tags.push('MUTATED');
    firstMeta.tags[0] = 'MUTATED';

    const stored = await items.find({ _id: 'i1' }).toArray();
    assert.deepEqual(stored[0]?.meta, { tags: ['x', 'y'] });
  } finally {
    await database.close();
  }
});

void test('groupBy $first/$last: string and array groupBy forms', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);

    const stringForm = await users.find({}).groupBy('dept', {
      firstName: { $first: 'name' },
    });
    const eng = stringForm.find((group) => group._key === 'eng');
    assert.ok(eng);
    assert.equal(eng.firstName, 'Alice');

    const arrayForm = await users.find({}).groupBy(['dept'], {
      firstName: { $first: 'name' },
      lastName: { $last: 'name' },
    });
    const engArray = arrayForm.find(
      (group) => (group._key as Record<string, unknown>).dept === 'eng',
    );
    assert.ok(engArray);
    assert.equal(engArray.firstName, 'Alice');
    assert.equal(engArray.lastName, 'Erin');
  } finally {
    await database.close();
  }
});

void test('groupBy $first/$last operand validation: non-string operand rejected', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);

    for (const op of ['$first', '$last'] as const) {
      for (const badOperand of [123, null, true, { field: 'name' }]) {
        await assert.rejects(
          () =>
            users.find().groupBy('dept', {
              result: { [op]: badOperand },
            } as unknown as GroupAccumulators),
          ValidationError,
          `Expected ValidationError for ${op} with operand ${JSON.stringify(badOperand)}`,
        );
      }
    }
  } finally {
    await database.close();
  }
});

void test('groupBy $first/$last operand validation: bad field path rejected', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);

    for (const op of ['$first', '$last'] as const) {
      await assert.rejects(
        () =>
          users.find().groupBy('dept', {
            result: { [op]: '__proto__.x' },
          } as unknown as GroupAccumulators),
        ValidationError,
        `Expected ValidationError for ${op} with reserved field path`,
      );
      await assert.rejects(
        () =>
          users.find().groupBy('dept', {
            result: { [op]: '' },
          } as unknown as GroupAccumulators),
        ValidationError,
        `Expected ValidationError for ${op} with empty field path`,
      );
    }
  } finally {
    await database.close();
  }
});

void test('groupBy $first/$last: exactly-one-accumulator-key rule still enforced', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);

    await assert.rejects(
      () =>
        users.find().groupBy('dept', {
          result: { $first: 'name', $last: 'name' },
        } as unknown as GroupAccumulators),
      ValidationError,
    );
  } finally {
    await database.close();
  }
});

void test('groupBy preserves storage order for equal sort keys (tie stability)', async () => {
  const database = new Database({});
  const items = database.collection<GroupRankedDocument>('items');

  try {
    await items.insertMany([
      { _id: 'A', group: 'p', rank: 1 },
      { _id: 'B', group: 'q', rank: 2 },
      { _id: 'C', group: 'r', rank: 1 }, // tie with A
      { _id: 'D', group: 's', rank: 2 }, // tie with B
    ]);

    // Storage order (no sort): p, q, r, s.
    const noSort = await items.find({}).groupBy('group', {
      count: { $count: true },
    });
    assert.deepEqual(
      noSort.map((entry) => entry._key),
      ['p', 'q', 'r', 's'],
    );

    // Ascending by rank, stable: ties keep storage order within each rank
    // bucket (A before C, B before D) -> p, r, q, s.
    const sorted = await items
      .find({})
      .sort({ rank: 1 })
      .groupBy('group', { count: { $count: true } });
    assert.deepEqual(
      sorted.map((entry) => entry._key),
      ['p', 'r', 'q', 's'],
    );
  } finally {
    await database.close();
  }
});
