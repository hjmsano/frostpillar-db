import assert from 'node:assert/strict';
import test from 'node:test';

import { ValidationError } from '../../src/errors.js';
import {
  computeGroupBy,
  validateGroupByField,
} from '../../src/internal/aggregationUtils.js';
import {
  MAX_FIELD_PATH_DEPTH,
  MAX_GROUP_ACCUMULATORS,
  MAX_GROUP_DOCUMENTS,
} from '../../src/internal/limits.js';
import type {
  FrostpillarDocument,
  FrostpillarStoredDocument,
  GroupAccumulators,
} from '../../src/types.js';

const pathCache = new Map<string, string[]>();

interface Doc extends FrostpillarDocument {
  category?: string;
  score?: number;
}

const doc = (
  id: string,
  fields: Record<string, unknown>,
): FrostpillarStoredDocument<Doc> =>
  ({ _id: id, ...fields }) as FrostpillarStoredDocument<Doc>;

// ---------------------------------------------------------------------------
// computeGroupBy — validation and empty-group behavior
// ---------------------------------------------------------------------------

void test('computeGroupBy rejects reserved group field path with zero documents', () => {
  assert.throws(
    () =>
      computeGroupBy([], '__proto__', { count: { $count: true } }, pathCache),
    ValidationError,
  );
});

void test('computeGroupBy rejects reserved accumulator field path with zero documents', () => {
  assert.throws(
    () =>
      computeGroupBy(
        [],
        'category',
        {
          total: { $sum: 'constructor.name' },
        },
        pathCache,
      ),
    ValidationError,
  );
});

void test('computeGroupBy rejects over-depth accumulator field path', () => {
  const deepPath = Array.from(
    { length: MAX_FIELD_PATH_DEPTH + 1 },
    (_, i) => `s${String(i)}`,
  ).join('.');
  assert.throws(
    () =>
      computeGroupBy(
        [],
        'category',
        {
          total: { $sum: deepPath },
        },
        pathCache,
      ),
    ValidationError,
  );
});

void test('computeGroupBy throws when accumulators is empty', () => {
  assert.throws(
    () =>
      computeGroupBy([doc('1', { category: 'a' })], 'category', {}, pathCache),
    ValidationError,
  );
});

void test('computeGroupBy throws when an accumulator has multiple keys', () => {
  const accumulators = {
    bad: { $sum: 'score', $avg: 'score' },
  } as unknown as GroupAccumulators;
  assert.throws(
    () =>
      computeGroupBy(
        [doc('1', { category: 'a' })],
        'category',
        accumulators,
        pathCache,
      ),
    ValidationError,
  );
});

void test('computeGroupBy throws on unknown accumulator key', () => {
  const accumulators = {
    bad: { $bogus: 'score' },
  } as unknown as GroupAccumulators;
  assert.throws(
    () =>
      computeGroupBy(
        [doc('1', { category: 'a' })],
        'category',
        accumulators,
        pathCache,
      ),
    ValidationError,
  );
});

void test('computeGroupBy throws ValidationError when accumulator operand is not a string', () => {
  const ops = [
    '$sum',
    '$avg',
    '$min',
    '$max',
    '$median',
    '$stdDevPop',
    '$stdDevSamp',
    '$variancePop',
    '$varianceSamp',
  ] as const;
  const badOperands: [string, unknown][] = [
    ['numeric', 123],
    ['null', null],
    ['boolean', true],
  ];

  for (const op of ops) {
    for (const [label, operand] of badOperands) {
      assert.throws(
        () =>
          computeGroupBy(
            [],
            'category',
            { result: { [op]: operand } } as unknown as GroupAccumulators,
            pathCache,
          ),
        ValidationError,
        `Expected ValidationError for ${op} with ${label} operand`,
      );
    }
  }
});

void test('computeGroupBy returns null for $avg/$min/$max when no numeric values in a group', () => {
  const docs = [
    doc('1', { category: 'a', score: 'x' }),
    doc('2', { category: 'a', score: null }),
  ];
  const result = computeGroupBy(
    docs,
    'category',
    {
      average: { $avg: 'score' },
      minimum: { $min: 'score' },
      maximum: { $max: 'score' },
      total: { $sum: 'score' },
      count: { $count: true },
    },
    pathCache,
  );
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], {
    _key: 'a',
    average: null,
    minimum: null,
    maximum: null,
    total: 0,
    count: 2,
  });
});

void test('computeGroupBy groups missing field values under null key', () => {
  const docs = [
    doc('1', { category: 'a', score: 1 }),
    doc('2', { score: 2 }),
    doc('3', { score: 3 }),
  ];
  const result = computeGroupBy(
    docs,
    'category',
    {
      total: { $sum: 'score' },
    },
    pathCache,
  );

  assert.equal(result.length, 2);
  const byKey = new Map(result.map((entry) => [entry._key, entry]));
  assert.deepEqual(byKey.get('a'), { _key: 'a', total: 1 });
  assert.deepEqual(byKey.get(null), { _key: null, total: 5 });
});

// ---------------------------------------------------------------------------
// computeGroupBy — array (multi-dimension) form: validation
// ---------------------------------------------------------------------------

void test('computeGroupBy rejects empty field array with zero documents', () => {
  assert.throws(
    () => computeGroupBy([], [], { count: { $count: true } }, pathCache),
    ValidationError,
  );
});

void test('computeGroupBy rejects non-string field array element', () => {
  assert.throws(
    () =>
      computeGroupBy(
        [],
        ['category', 123] as unknown as string[],
        { count: { $count: true } },
        pathCache,
      ),
    ValidationError,
  );
  assert.throws(
    () =>
      computeGroupBy(
        [],
        ['category', null] as unknown as string[],
        { count: { $count: true } },
        pathCache,
      ),
    ValidationError,
  );
});

void test('computeGroupBy rejects reserved segment in field array element with zero documents', () => {
  assert.throws(
    () =>
      computeGroupBy(
        [],
        ['category', '__proto__'],
        { count: { $count: true } },
        pathCache,
      ),
    ValidationError,
  );
});

void test('computeGroupBy rejects duplicate field paths in array', () => {
  assert.throws(
    () =>
      computeGroupBy(
        [],
        ['category', 'category'],
        { count: { $count: true } },
        pathCache,
      ),
    ValidationError,
  );
});

void test('computeGroupBy rejects over-depth field array element', () => {
  const deepPath = Array.from(
    { length: MAX_FIELD_PATH_DEPTH + 1 },
    (_, i) => `s${String(i)}`,
  ).join('.');
  assert.throws(
    () =>
      computeGroupBy(
        [],
        ['category', deepPath],
        { count: { $count: true } },
        pathCache,
      ),
    ValidationError,
  );
});

// ---------------------------------------------------------------------------
// computeGroupBy — array (multi-dimension) form: behavior
// ---------------------------------------------------------------------------

void test('computeGroupBy groups by two fields with composite _key and accumulators', () => {
  const docs = [
    doc('1', { dept: 'eng', address: { city: 'Tokyo' }, score: 10 }),
    doc('2', { dept: 'eng', address: { city: 'Tokyo' }, score: 20 }),
    doc('3', { dept: 'eng', address: { city: 'Osaka' }, score: 5 }),
    doc('4', { dept: 'sales', address: { city: 'Tokyo' }, score: 7 }),
  ];

  const result = computeGroupBy(
    docs,
    ['dept', 'address.city'],
    {
      count: { $count: true },
      total: { $sum: 'score' },
      average: { $avg: 'score' },
    },
    pathCache,
  );

  assert.equal(result.length, 3);

  assert.deepEqual(result[0]._key, { dept: 'eng', 'address.city': 'Tokyo' });
  assert.equal(result[0].count, 2);
  assert.equal(result[0].total, 30);
  assert.equal(result[0].average, 15);

  assert.deepEqual(result[1]._key, { dept: 'eng', 'address.city': 'Osaka' });
  assert.equal(result[1].count, 1);
  assert.equal(result[1].total, 5);
  assert.equal(result[1].average, 5);

  assert.deepEqual(result[2]._key, { dept: 'sales', 'address.city': 'Tokyo' });
  assert.equal(result[2].count, 1);
  assert.equal(result[2].total, 7);
  assert.equal(result[2].average, 7);
});

void test('computeGroupBy composite grouping treats a missing dimension as null for that dimension only', () => {
  const docs = [
    doc('1', { dept: 'eng', address: { city: 'Tokyo' } }),
    doc('2', { dept: 'eng' }),
    doc('3', { address: { city: 'Tokyo' } }),
  ];

  const result = computeGroupBy(
    docs,
    ['dept', 'address.city'],
    { count: { $count: true } },
    pathCache,
  );

  assert.equal(result.length, 3);
  assert.deepEqual(result[0]._key, { dept: 'eng', 'address.city': 'Tokyo' });
  assert.deepEqual(result[1]._key, { dept: 'eng', 'address.city': null });
  assert.deepEqual(result[2]._key, { dept: null, 'address.city': 'Tokyo' });
});

void test('computeGroupBy composite grouping is type-aware per dimension', () => {
  const docs = [doc('1', { a: '1', b: 'x' }), doc('2', { a: 1, b: 'x' })];

  const result = computeGroupBy(
    docs,
    ['a', 'b'],
    { count: { $count: true } },
    pathCache,
  );

  assert.equal(result.length, 2);
  assert.deepEqual(result[0]._key, { a: '1', b: 'x' });
  assert.equal(result[0].count, 1);
  assert.deepEqual(result[1]._key, { a: 1, b: 'x' });
  assert.equal(result[1].count, 1);
});

void test('computeGroupBy composite grouping has no cross-dimension collision', () => {
  const docs = [
    doc('1', { a: 'a:b', b: 'c' }),
    doc('2', { a: 'a', b: 'b:c' }),
    doc('3', { a: 'x,y', b: '[z]' }),
    doc('4', { a: 'x', b: 'y,[z]' }),
  ];

  const result = computeGroupBy(
    docs,
    ['a', 'b'],
    { count: { $count: true } },
    pathCache,
  );

  assert.equal(result.length, 4);
  for (const entry of result) {
    assert.equal(entry.count, 1);
  }
  const uniqueKeys = new Set(result.map((entry) => JSON.stringify(entry._key)));
  assert.equal(uniqueKeys.size, 4);
});

void test('computeGroupBy single-element field array yields object _key, not scalar', () => {
  const docs = [doc('1', { category: 'a' }), doc('2', { category: 'b' })];

  const result = computeGroupBy(
    docs,
    ['category'],
    { count: { $count: true } },
    pathCache,
  );

  assert.equal(result.length, 2);
  assert.deepEqual(result[0]._key, { category: 'a' });
  assert.deepEqual(result[1]._key, { category: 'b' });
});

void test('computeGroupBy string form still yields a scalar _key alongside the array form', () => {
  const docs = [
    doc('1', { category: 'a', score: 1 }),
    doc('2', { category: 'a', score: 2 }),
    doc('3', { category: 'b', score: 3 }),
  ];

  const scalarResult = computeGroupBy(
    docs,
    'category',
    { count: { $count: true } },
    pathCache,
  );
  assert.equal(scalarResult[0]._key, 'a');
  assert.equal(typeof scalarResult[0]._key, 'string');

  const arrayResult = computeGroupBy(
    docs,
    ['category'],
    { count: { $count: true } },
    pathCache,
  );
  assert.deepEqual(arrayResult[0]._key, { category: 'a' });
});

void test('computeGroupBy composite grouping distinguishes null value from string "null" within a dimension', () => {
  const docs = [doc('1', { a: null, b: 'x' }), doc('2', { a: 'null', b: 'x' })];

  const result = computeGroupBy(
    docs,
    ['a', 'b'],
    { count: { $count: true } },
    pathCache,
  );

  assert.equal(result.length, 2);
  assert.deepEqual(result[0]._key, { a: null, b: 'x' });
  assert.equal(result[0].count, 1);
  assert.deepEqual(result[1]._key, { a: 'null', b: 'x' });
  assert.equal(result[1].count, 1);
});

void test('computeGroupBy composite grouping supports object-valued dimensions', () => {
  const docs = [
    doc('1', { meta: { tier: 'gold' }, region: 'jp' }),
    doc('2', { meta: { tier: 'gold' }, region: 'jp' }),
    doc('3', { meta: { tier: 'silver' }, region: 'jp' }),
  ];

  const result = computeGroupBy(
    docs,
    ['meta', 'region'],
    { count: { $count: true } },
    pathCache,
  );

  assert.equal(result.length, 2);
  assert.deepEqual(result[0]._key, { meta: { tier: 'gold' }, region: 'jp' });
  assert.equal(result[0].count, 2);
  assert.deepEqual(result[1]._key, { meta: { tier: 'silver' }, region: 'jp' });
  assert.equal(result[1].count, 1);
});

void test('computeGroupBy composite grouping does not collide on adversarial type-prefixed values', () => {
  const docs = [
    doc('1', { a: 'string:x', b: 'y' }),
    doc('2', { a: 'x', b: 'y' }),
  ];

  const result = computeGroupBy(
    docs,
    ['a', 'b'],
    { count: { $count: true } },
    pathCache,
  );

  assert.equal(result.length, 2);
  assert.deepEqual(result[0]._key, { a: 'string:x', b: 'y' });
  assert.equal(result[0].count, 1);
  assert.deepEqual(result[1]._key, { a: 'x', b: 'y' });
  assert.equal(result[1].count, 1);
});

void test('computeGroupBy composite _key holds correct values under integer-like path keys', () => {
  const docs = [
    doc('1', { dept: 'eng', '2024': 100 }),
    doc('2', { dept: 'eng', '2024': 200 }),
  ];

  const result = computeGroupBy(
    docs,
    ['dept', '2024'],
    { count: { $count: true } },
    pathCache,
  );

  assert.equal(result.length, 2);
  // Access by key name only: JavaScript reorders integer-like object keys,
  // so Object.keys order is not asserted here.
  const first = result[0]._key as Record<string, unknown>;
  assert.equal(first.dept, 'eng');
  assert.equal(first['2024'], 100);
  const second = result[1]._key as Record<string, unknown>;
  assert.equal(second.dept, 'eng');
  assert.equal(second['2024'], 200);
});

// ---------------------------------------------------------------------------
// computeGroupBy — $median / $percentile accumulators
// ---------------------------------------------------------------------------

void test('computeGroupBy computes $median per group (string groupBy form)', () => {
  const docs = [
    doc('1', { category: 'a', score: 1 }),
    doc('2', { category: 'a', score: 2 }),
    doc('3', { category: 'a', score: 3 }),
    doc('4', { category: 'a', score: 4 }),
    doc('5', { category: 'b', score: 10 }),
  ];
  const result = computeGroupBy(
    docs,
    'category',
    { medianScore: { $median: 'score' } },
    pathCache,
  );
  const byKey = new Map(result.map((entry) => [entry._key, entry]));
  assert.equal(byKey.get('a')?.medianScore, 2.5);
  assert.equal(byKey.get('b')?.medianScore, 10);
});

void test('computeGroupBy computes $median per group (array groupBy form)', () => {
  const docs = [
    doc('1', { category: 'a', score: 1 }),
    doc('2', { category: 'a', score: 3 }),
    doc('3', { category: 'a', score: 5 }),
  ];
  const result = computeGroupBy(
    docs,
    ['category'],
    { medianScore: { $median: 'score' } },
    pathCache,
  );
  assert.equal(result[0].medianScore, 3);
});

void test('computeGroupBy $median returns null when a group has no numeric values', () => {
  const docs = [
    doc('1', { category: 'a', score: 'x' }),
    doc('2', { category: 'a', score: null }),
  ];
  const result = computeGroupBy(
    docs,
    'category',
    { medianScore: { $median: 'score' } },
    pathCache,
  );
  assert.equal(result[0].medianScore, null);
});

void test('computeGroupBy computes $percentile per group (string groupBy form)', () => {
  const docs = [
    doc('1', { category: 'a', score: 10 }),
    doc('2', { category: 'a', score: 20 }),
    doc('3', { category: 'a', score: 30 }),
    doc('4', { category: 'a', score: 40 }),
  ];
  const result = computeGroupBy(
    docs,
    'category',
    {
      p25: { $percentile: { field: 'score', p: 0.25 } },
      p75: { $percentile: { field: 'score', p: 0.75 } },
    },
    pathCache,
  );
  assert.equal(result[0].p25, 17.5);
  assert.equal(result[0].p75, 32.5);
});

void test('computeGroupBy computes $percentile per group (array groupBy form)', () => {
  const docs = [
    doc('1', { category: 'a', score: 10 }),
    doc('2', { category: 'a', score: 20 }),
  ];
  const result = computeGroupBy(
    docs,
    ['category'],
    { p50: { $percentile: { field: 'score', p: 0.5 } } },
    pathCache,
  );
  assert.equal(result[0].p50, 15);
});

void test('computeGroupBy $percentile returns null when a group has no numeric values', () => {
  const docs = [doc('1', { category: 'a', score: 'x' })];
  const result = computeGroupBy(
    docs,
    'category',
    { p50: { $percentile: { field: 'score', p: 0.5 } } },
    pathCache,
  );
  assert.equal(result[0].p50, null);
});

void test('computeGroupBy supports multiple percentile output fields (p50/p95/p99) in one call', () => {
  const docs = Array.from({ length: 100 }, (_, i) =>
    doc(String(i), { category: 'a', latencyMs: i + 1 }),
  );
  const result = computeGroupBy(
    docs,
    'category',
    {
      p50: { $percentile: { field: 'latencyMs', p: 0.5 } },
      p95: { $percentile: { field: 'latencyMs', p: 0.95 } },
      p99: { $percentile: { field: 'latencyMs', p: 0.99 } },
      medianLatency: { $median: 'latencyMs' },
    },
    pathCache,
  );
  assert.equal(result[0].p50, result[0].medianLatency);
  assert.equal(result[0].p50, 50.5);
  assert.equal(result[0].p95, 95.05);
  assert.equal(result[0].p99, 99.01);
});

// ---------------------------------------------------------------------------
// computeGroupBy — $percentile operand validation
// ---------------------------------------------------------------------------

void test('computeGroupBy throws when $percentile operand is not an object', () => {
  for (const badOperand of ['score', 123, null, true, ['score', 0.5]]) {
    assert.throws(
      () =>
        computeGroupBy(
          [],
          'category',
          {
            result: { $percentile: badOperand },
          } as unknown as GroupAccumulators,
          pathCache,
        ),
      ValidationError,
      `Expected ValidationError for operand ${JSON.stringify(badOperand)}`,
    );
  }
});

void test('computeGroupBy throws when $percentile operand is missing "p"', () => {
  assert.throws(
    () =>
      computeGroupBy(
        [],
        'category',
        {
          result: { $percentile: { field: 'score' } },
        } as unknown as GroupAccumulators,
        pathCache,
      ),
    ValidationError,
  );
});

void test('computeGroupBy throws when $percentile operand is missing "field"', () => {
  assert.throws(
    () =>
      computeGroupBy(
        [],
        'category',
        {
          result: { $percentile: { p: 0.5 } },
        } as unknown as GroupAccumulators,
        pathCache,
      ),
    ValidationError,
  );
});

void test('computeGroupBy throws when $percentile operand has an extra key', () => {
  assert.throws(
    () =>
      computeGroupBy(
        [],
        'category',
        {
          result: {
            $percentile: { field: 'score', p: 0.5, extra: true },
          },
        } as unknown as GroupAccumulators,
        pathCache,
      ),
    ValidationError,
  );
});

void test('computeGroupBy throws when $percentile "field" is invalid', () => {
  assert.throws(
    () =>
      computeGroupBy(
        [],
        'category',
        {
          result: { $percentile: { field: '__proto__', p: 0.5 } },
        } as unknown as GroupAccumulators,
        pathCache,
      ),
    ValidationError,
  );
  assert.throws(
    () =>
      computeGroupBy(
        [],
        'category',
        {
          result: { $percentile: { field: 123, p: 0.5 } },
        } as unknown as GroupAccumulators,
        pathCache,
      ),
    ValidationError,
  );
});

void test('computeGroupBy throws when $percentile "p" is invalid', () => {
  for (const badP of [-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY, '0.5']) {
    assert.throws(
      () =>
        computeGroupBy(
          [],
          'category',
          {
            result: { $percentile: { field: 'score', p: badP } },
          } as unknown as GroupAccumulators,
          pathCache,
        ),
      ValidationError,
      `Expected ValidationError for p=${JSON.stringify(badP)}`,
    );
  }
});

void test('computeGroupBy throws when $percentile "p" is an array (scalar-only inside groupBy)', () => {
  assert.throws(
    () =>
      computeGroupBy(
        [],
        'category',
        {
          result: { $percentile: { field: 'score', p: [0.5, 0.95] } },
        } as unknown as GroupAccumulators,
        pathCache,
      ),
    ValidationError,
  );
});

void test('computeGroupBy $percentile entry still enforces exactly-one-accumulator-key rule', () => {
  assert.throws(
    () =>
      computeGroupBy(
        [],
        'category',
        {
          result: {
            $percentile: { field: 'score', p: 0.5 },
            $median: 'score',
          },
        } as unknown as GroupAccumulators,
        pathCache,
      ),
    ValidationError,
  );
});

// ---------------------------------------------------------------------------
// computeGroupBy — $stdDevPop / $stdDevSamp / $variancePop / $varianceSamp
// accumulators
// ---------------------------------------------------------------------------

void test('computeGroupBy computes $stdDevPop/$stdDevSamp/$variancePop/$varianceSamp per group (string groupBy form)', () => {
  const docs = [
    doc('1', { category: 'a', score: 2 }),
    doc('2', { category: 'a', score: 4 }),
    doc('3', { category: 'a', score: 4 }),
    doc('4', { category: 'a', score: 4 }),
    doc('5', { category: 'a', score: 5 }),
    doc('6', { category: 'a', score: 5 }),
    doc('7', { category: 'a', score: 7 }),
    doc('8', { category: 'a', score: 9 }),
  ];
  const result = computeGroupBy(
    docs,
    'category',
    {
      sdPop: { $stdDevPop: 'score' },
      sdSamp: { $stdDevSamp: 'score' },
      varPop: { $variancePop: 'score' },
      varSamp: { $varianceSamp: 'score' },
    },
    pathCache,
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].varPop, 4);
  assert.equal(result[0].sdPop, 2);
  const varSamp = result[0].varSamp as number;
  assert.ok(Math.abs(varSamp - 32 / 7) < 1e-9);
  const sdSamp = result[0].sdSamp as number;
  assert.ok(Math.abs(sdSamp - Math.sqrt(32 / 7)) < 1e-9);
});

void test('computeGroupBy computes $variancePop per group (array groupBy form)', () => {
  const docs = [
    doc('1', { category: 'a', score: 1 }),
    doc('2', { category: 'a', score: 2 }),
    doc('3', { category: 'a', score: 3 }),
    doc('4', { category: 'a', score: 4 }),
  ];
  const result = computeGroupBy(
    docs,
    ['category'],
    { varPop: { $variancePop: 'score' } },
    pathCache,
  );
  assert.equal(result[0].varPop, 1.25);
});

void test('computeGroupBy $stdDevPop/$stdDevSamp/$variancePop/$varianceSamp return null when a group has no numeric values (n=0)', () => {
  const docs = [
    doc('1', { category: 'a', score: 'x' }),
    doc('2', { category: 'a', score: null }),
  ];
  const result = computeGroupBy(
    docs,
    'category',
    {
      sdPop: { $stdDevPop: 'score' },
      sdSamp: { $stdDevSamp: 'score' },
      varPop: { $variancePop: 'score' },
      varSamp: { $varianceSamp: 'score' },
    },
    pathCache,
  );
  assert.deepEqual(result[0], {
    _key: 'a',
    sdPop: null,
    sdSamp: null,
    varPop: null,
    varSamp: null,
  });
});

void test('computeGroupBy $stdDevPop/$variancePop is 0 and $stdDevSamp/$varianceSamp is null for a single-value group (n=1)', () => {
  const docs = [doc('1', { category: 'a', score: 42 })];
  const result = computeGroupBy(
    docs,
    'category',
    {
      sdPop: { $stdDevPop: 'score' },
      sdSamp: { $stdDevSamp: 'score' },
      varPop: { $variancePop: 'score' },
      varSamp: { $varianceSamp: 'score' },
    },
    pathCache,
  );
  assert.deepEqual(result[0], {
    _key: 'a',
    sdPop: 0,
    sdSamp: null,
    varPop: 0,
    varSamp: null,
  });
});

void test('computeGroupBy rejects reserved field path for $stdDevPop/$stdDevSamp/$variancePop/$varianceSamp accumulators', () => {
  for (const op of [
    '$stdDevPop',
    '$stdDevSamp',
    '$variancePop',
    '$varianceSamp',
  ] as const) {
    assert.throws(
      () =>
        computeGroupBy(
          [],
          'category',
          { result: { [op]: '__proto__.x' } } as unknown as GroupAccumulators,
          pathCache,
        ),
      ValidationError,
      `Expected ValidationError for ${op} with reserved field path`,
    );
  }
});

void test('computeGroupBy $stdDevPop entry still enforces exactly-one-accumulator-key rule', () => {
  assert.throws(
    () =>
      computeGroupBy(
        [],
        'category',
        {
          result: { $stdDevPop: 'score', $variancePop: 'score' },
        } as unknown as GroupAccumulators,
        pathCache,
      ),
    ValidationError,
  );
});

// ---------------------------------------------------------------------------
// validateGroupByField — defensive copy semantics
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// computeGroupBy — $first / $last accumulators (ADR-021)
// ---------------------------------------------------------------------------

interface FirstLastDoc extends FrostpillarDocument {
  category?: string;
  value?: unknown;
}

const flDoc = (
  id: string,
  fields: Record<string, unknown>,
): FrostpillarStoredDocument<FirstLastDoc> =>
  ({ _id: id, ...fields }) as FrostpillarStoredDocument<FirstLastDoc>;

void test('computeGroupBy $first/$last select value.of the first/last document in input (array) order', () => {
  const docs = [
    flDoc('1', { category: 'a', value: 'one' }),
    flDoc('2', { category: 'a', value: 'two' }),
    flDoc('3', { category: 'a', value: 'three' }),
  ];
  const result = computeGroupBy(
    docs,
    'category',
    { firstValue: { $first: 'value' }, lastValue: { $last: 'value' } },
    pathCache,
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].firstValue, 'one');
  assert.equal(result[0].lastValue, 'three');
});

void test('computeGroupBy $first/$last is positional-then-read: missing field on the selected document returns null even if another document in the group has it', () => {
  // First doc lacks `value`, later docs have it -- $first must be null, NOT "one".
  const docsMissingFirst = [
    flDoc('1', { category: 'a' }),
    flDoc('2', { category: 'a', value: 'two' }),
  ];
  const firstResult = computeGroupBy(
    docsMissingFirst,
    'category',
    { firstValue: { $first: 'value' } },
    pathCache,
  );
  assert.equal(firstResult[0].firstValue, null);

  // Last doc lacks `value`, earlier docs have it -- $last must be null, NOT "one".
  const docsMissingLast = [
    flDoc('1', { category: 'a', value: 'one' }),
    flDoc('2', { category: 'a' }),
  ];
  const lastResult = computeGroupBy(
    docsMissingLast,
    'category',
    { lastValue: { $last: 'value' } },
    pathCache,
  );
  assert.equal(lastResult[0].lastValue, null);
});

void test("computeGroupBy $first/$last on a single-document group returns that document's value for both", () => {
  const docs = [flDoc('1', { category: 'a', value: 'only' })];
  const result = computeGroupBy(
    docs,
    'category',
    { firstValue: { $first: 'value' }, lastValue: { $last: 'value' } },
    pathCache,
  );
  assert.equal(result[0].firstValue, 'only');
  assert.equal(result[0].lastValue, 'only');
});

void test('computeGroupBy $first/$last support non-numeric value types: string, number, boolean, null, object, array', () => {
  const cases: [string, unknown][] = [
    ['string', 'hello'],
    ['number', 42],
    ['boolean', true],
    ['null', null],
    ['object', { nested: 1 }],
    ['array', [1, 2, 3]],
  ];

  for (const [label, value] of cases) {
    const docs = [flDoc('1', { category: 'a', value })];
    const result = computeGroupBy(
      docs,
      'category',
      { firstValue: { $first: 'value' } },
      pathCache,
    );
    assert.deepEqual(
      result[0].firstValue,
      value,
      `Expected ${label} to round-trip`,
    );
  }
});

void test('computeGroupBy $first/$last defensively clone object/array values: mutating the result does not affect the stored document', () => {
  const storedObject = { tag: 'original' };
  const storedArray = [1, 2, 3];
  const docs = [
    flDoc('1', { category: 'a', value: storedObject }),
    flDoc('2', { category: 'a', value: storedArray }),
  ];

  const result = computeGroupBy(
    docs,
    'category',
    { firstValue: { $first: 'value' }, lastValue: { $last: 'value' } },
    pathCache,
  );

  assert.notEqual(result[0].firstValue, storedObject);
  (result[0].firstValue as Record<string, unknown>).tag = 'mutated';
  assert.equal(storedObject.tag, 'original');

  assert.notEqual(result[0].lastValue, storedArray);
  (result[0].lastValue as unknown[]).push(999);
  assert.deepEqual(storedArray, [1, 2, 3]);
});

void test('computeGroupBy $first/$last (array groupBy form)', () => {
  const docs = [
    flDoc('1', { category: 'a', value: 'x' }),
    flDoc('2', { category: 'a', value: 'y' }),
  ];
  const result = computeGroupBy(
    docs,
    ['category'],
    { firstValue: { $first: 'value' }, lastValue: { $last: 'value' } },
    pathCache,
  );
  assert.equal(result[0].firstValue, 'x');
  assert.equal(result[0].lastValue, 'y');
});

void test('computeGroupBy $first/$last with dot-notation field path', () => {
  const docs = [
    flDoc('1', { category: 'a', value: { nested: { deep: 'v1' } } }),
    flDoc('2', { category: 'a', value: { nested: { deep: 'v2' } } }),
  ];
  const result = computeGroupBy(
    docs,
    'category',
    {
      firstDeep: { $first: 'value.nested.deep' },
      lastDeep: { $last: 'value.nested.deep' },
    },
    pathCache,
  );
  assert.equal(result[0].firstDeep, 'v1');
  assert.equal(result[0].lastDeep, 'v2');
});

void test('computeGroupBy throws ValidationError when $first/$last operand is not a string', () => {
  const badOperands: [string, unknown][] = [
    ['numeric', 123],
    ['null', null],
    ['boolean', true],
    ['object', { field: 'value' }],
  ];
  for (const op of ['$first', '$last'] as const) {
    for (const [label, operand] of badOperands) {
      assert.throws(
        () =>
          computeGroupBy(
            [],
            'category',
            { result: { [op]: operand } } as unknown as GroupAccumulators,
            pathCache,
          ),
        ValidationError,
        `Expected ValidationError for ${op} with ${label} operand`,
      );
    }
  }
});

void test('computeGroupBy rejects reserved field path for $first/$last accumulators', () => {
  for (const op of ['$first', '$last'] as const) {
    assert.throws(
      () =>
        computeGroupBy(
          [],
          'category',
          { result: { [op]: '__proto__.x' } } as unknown as GroupAccumulators,
          pathCache,
        ),
      ValidationError,
      `Expected ValidationError for ${op} with reserved field path`,
    );
  }
});

void test('computeGroupBy $first entry still enforces exactly-one-accumulator-key rule', () => {
  assert.throws(
    () =>
      computeGroupBy(
        [],
        'category',
        {
          result: { $first: 'value', $last: 'value' },
        } as unknown as GroupAccumulators,
        pathCache,
      ),
    ValidationError,
  );
});

// ---------------------------------------------------------------------------
// computeGroupBy — $countDistinct accumulator (ADR-022)
// ---------------------------------------------------------------------------

void test('computeGroupBy $countDistinct counts unique values per group', () => {
  const docs = [
    flDoc('1', { category: 'a', value: 'x' }),
    flDoc('2', { category: 'a', value: 'y' }),
    flDoc('3', { category: 'a', value: 'x' }),
    flDoc('4', { category: 'b', value: 'x' }),
  ];
  const result = computeGroupBy(
    docs,
    'category',
    { uniqueValues: { $countDistinct: 'value' } },
    pathCache,
  );
  const a = result.find((entry) => entry._key === 'a')!;
  const b = result.find((entry) => entry._key === 'b')!;
  assert.equal(a.uniqueValues, 2);
  assert.equal(b.uniqueValues, 1);
});

void test('computeGroupBy $countDistinct skips missing/undefined and counts null as a value, per group', () => {
  const docs = [
    flDoc('1', { category: 'a', value: null }),
    flDoc('2', { category: 'a' }), // missing
    flDoc('3', { category: 'a', value: undefined }),
    flDoc('4', { category: 'a', value: null }),
  ];
  const result = computeGroupBy(
    docs,
    'category',
    { uniqueValues: { $countDistinct: 'value' } },
    pathCache,
  );
  // Only `null` is a present value here; it counts as exactly one distinct value.
  assert.equal(result[0].uniqueValues, 1);
});

void test('computeGroupBy $countDistinct returns 0 for a group with no present values', () => {
  const docs = [
    flDoc('1', { category: 'a' }),
    flDoc('2', { category: 'a', value: undefined }),
  ];
  const result = computeGroupBy(
    docs,
    'category',
    { uniqueValues: { $countDistinct: 'value' } },
    pathCache,
  );
  assert.equal(result[0].uniqueValues, 0);
});

void test('computeGroupBy $countDistinct dedupes object values by deep equality within a group', () => {
  const docs = [
    flDoc('1', { category: 'a', value: { x: 1, y: 2 } }),
    flDoc('2', { category: 'a', value: { y: 2, x: 1 } }),
    flDoc('3', { category: 'a', value: { x: 1, y: 3 } }),
  ];
  const result = computeGroupBy(
    docs,
    'category',
    { uniqueValues: { $countDistinct: 'value' } },
    pathCache,
  );
  assert.equal(result[0].uniqueValues, 2);
});

void test('computeGroupBy $countDistinct counts unique values independently per group across three groups', () => {
  const docs = [
    flDoc('1', { category: 'a', value: 'x' }),
    flDoc('2', { category: 'a', value: 'y' }),
    flDoc('3', { category: 'a', value: 'x' }),
    flDoc('4', { category: 'b', value: 1 }),
    flDoc('5', { category: 'b', value: 2 }),
    flDoc('6', { category: 'b', value: 1 }),
    flDoc('7', { category: 'b', value: 3 }),
    flDoc('8', { category: 'c', value: 'only' }),
  ];
  const result = computeGroupBy(
    docs,
    'category',
    { uniqueCount: { $countDistinct: 'value' } },
    pathCache,
  );
  const a = result.find((entry) => entry._key === 'a')!;
  const b = result.find((entry) => entry._key === 'b')!;
  const c = result.find((entry) => entry._key === 'c')!;
  assert.equal(a.uniqueCount, 2);
  assert.equal(b.uniqueCount, 3);
  assert.equal(c.uniqueCount, 1);
});

void test('computeGroupBy $countDistinct with dot-notation field path', () => {
  const docs = [
    flDoc('1', { category: 'a', value: { nested: { deep: 'v1' } } }),
    flDoc('2', { category: 'a', value: { nested: { deep: 'v2' } } }),
    flDoc('3', { category: 'a', value: { nested: { deep: 'v1' } } }),
  ];
  const result = computeGroupBy(
    docs,
    'category',
    { uniqueDeep: { $countDistinct: 'value.nested.deep' } },
    pathCache,
  );
  assert.equal(result[0].uniqueDeep, 2);
});

void test('computeGroupBy $countDistinct (array groupBy form)', () => {
  const docs = [
    flDoc('1', { category: 'a', value: 'x' }),
    flDoc('2', { category: 'a', value: 'y' }),
    flDoc('3', { category: 'b', value: 'x' }),
  ];
  const result = computeGroupBy(
    docs,
    ['category'],
    { uniqueValues: { $countDistinct: 'value' } },
    pathCache,
  );
  const a = result.find(
    (entry) => (entry._key as Record<string, unknown>).category === 'a',
  )!;
  assert.equal(a.uniqueValues, 2);
});

void test('computeGroupBy throws ValidationError when $countDistinct operand is not a string', () => {
  const badOperands: [string, unknown][] = [
    ['numeric', 123],
    ['null', null],
    ['boolean', true],
    ['object', { field: 'value' }],
  ];
  for (const [label, operand] of badOperands) {
    assert.throws(
      () =>
        computeGroupBy(
          [],
          'category',
          {
            result: { $countDistinct: operand },
          } as unknown as GroupAccumulators,
          pathCache,
        ),
      ValidationError,
      `Expected ValidationError for $countDistinct with ${label} operand`,
    );
  }
});

void test('computeGroupBy rejects reserved/bad field path for $countDistinct accumulator', () => {
  assert.throws(
    () =>
      computeGroupBy(
        [],
        'category',
        {
          result: { $countDistinct: '__proto__.x' },
        } as unknown as GroupAccumulators,
        pathCache,
      ),
    ValidationError,
    'Expected ValidationError for $countDistinct with reserved field path',
  );
  assert.throws(
    () =>
      computeGroupBy(
        [],
        'category',
        { result: { $countDistinct: '' } } as unknown as GroupAccumulators,
        pathCache,
      ),
    ValidationError,
    'Expected ValidationError for $countDistinct with empty field path',
  );
});

void test('computeGroupBy $countDistinct entry still enforces exactly-one-accumulator-key rule', () => {
  assert.throws(
    () =>
      computeGroupBy(
        [],
        'category',
        {
          result: { $countDistinct: 'value', $first: 'value' },
        } as unknown as GroupAccumulators,
        pathCache,
      ),
    ValidationError,
  );
});

void test('computeGroupBy reaches MAX_GROUP_DOCUMENTS before the equal $countDistinct cap', () => {
  const docs = Array.from({ length: MAX_GROUP_DOCUMENTS + 1 }, (_, i) =>
    flDoc(String(i), { category: 'a', value: i }),
  );
  assert.throws(
    () =>
      computeGroupBy(
        docs,
        'category',
        { uniqueValues: { $countDistinct: 'value' } },
        pathCache,
      ),
    {
      constructor: ValidationError,
      message: `groupBy group exceeds maximum of ${String(MAX_GROUP_DOCUMENTS)} documents per group.`,
    },
  );
});

void test('computeGroupBy $countDistinct does not throw when different groups each stay within MAX_DISTINCT_COUNT, even though the combined total exceeds it', () => {
  // Two groups, each with MAX_DISTINCT_COUNT unique values -- the cap is
  // per-group, so this must succeed even though total unique values across
  // both groups (2 * MAX_DISTINCT_COUNT) exceeds MAX_DISTINCT_COUNT.
  const half = 2000; // keep the unit test fast; boundary-exactness is covered above
  const docsA = Array.from({ length: half }, (_, i) =>
    flDoc(`a${String(i)}`, { category: 'a', value: i }),
  );
  const docsB = Array.from({ length: half }, (_, i) =>
    flDoc(`b${String(i)}`, { category: 'b', value: i }),
  );
  const result = computeGroupBy(
    [...docsA, ...docsB],
    'category',
    { uniqueValues: { $countDistinct: 'value' } },
    pathCache,
  );
  const a = result.find((entry) => entry._key === 'a')!;
  const b = result.find((entry) => entry._key === 'b')!;
  assert.equal(a.uniqueValues, half);
  assert.equal(b.uniqueValues, half);
});

// ---------------------------------------------------------------------------
// computeGroupBy — $push / $addToSet accumulators (ADR-023)
// ---------------------------------------------------------------------------

void test('computeGroupBy $push collects every present value in aggregation input order, preserving duplicates', () => {
  const docs = [
    flDoc('1', { category: 'a', value: 'x' }),
    flDoc('2', { category: 'a', value: 'y' }),
    flDoc('3', { category: 'a', value: 'x' }),
  ];
  const result = computeGroupBy(
    docs,
    'category',
    { values: { $push: 'value' } },
    pathCache,
  );
  assert.deepEqual(result[0].values, ['x', 'y', 'x']);
});

void test('computeGroupBy $push skips missing/undefined but includes null, preserving position', () => {
  const docs = [
    flDoc('1', { category: 'a', value: 'x' }),
    flDoc('2', { category: 'a' }), // missing
    flDoc('3', { category: 'a', value: undefined }),
    flDoc('4', { category: 'a', value: null }),
    flDoc('5', { category: 'a', value: 'y' }),
  ];
  const result = computeGroupBy(
    docs,
    'category',
    { values: { $push: 'value' } },
    pathCache,
  );
  assert.deepEqual(result[0].values, ['x', null, 'y']);
});

void test('computeGroupBy $push returns [] for a group with no present values', () => {
  const docs = [
    flDoc('1', { category: 'a' }),
    flDoc('2', { category: 'a', value: undefined }),
  ];
  const result = computeGroupBy(
    docs,
    'category',
    { values: { $push: 'value' } },
    pathCache,
  );
  assert.deepEqual(result[0].values, []);
});

void test('computeGroupBy $push (array groupBy form)', () => {
  const docs = [
    flDoc('1', { category: 'a', value: 'x' }),
    flDoc('2', { category: 'a', value: 'y' }),
    flDoc('3', { category: 'b', value: 'z' }),
  ];
  const result = computeGroupBy(
    docs,
    ['category'],
    { values: { $push: 'value' } },
    pathCache,
  );
  const a = result.find(
    (entry) => (entry._key as Record<string, unknown>).category === 'a',
  )!;
  assert.deepEqual(a.values, ['x', 'y']);
});

void test('computeGroupBy $push with dot-notation field path', () => {
  const docs = [
    flDoc('1', { category: 'a', value: { nested: { deep: 'v1' } } }),
    flDoc('2', { category: 'a', value: { nested: { deep: 'v2' } } }),
  ];
  const result = computeGroupBy(
    docs,
    'category',
    { deepValues: { $push: 'value.nested.deep' } },
    pathCache,
  );
  assert.deepEqual(result[0].deepValues, ['v1', 'v2']);
});

void test('computeGroupBy $push defensively clones object/array values: mutating the result does not affect the stored document', () => {
  const storedObject = { tag: 'original' };
  const storedArray = [1, 2, 3];
  const docs = [
    flDoc('1', { category: 'a', value: storedObject }),
    flDoc('2', { category: 'a', value: storedArray }),
  ];

  const result = computeGroupBy(
    docs,
    'category',
    { values: { $push: 'value' } },
    pathCache,
  );

  const values = result[0].values as unknown[];
  assert.notEqual(values[0], storedObject);
  (values[0] as Record<string, unknown>).tag = 'mutated';
  assert.equal(storedObject.tag, 'original');

  assert.notEqual(values[1], storedArray);
  (values[1] as unknown[]).push(999);
  assert.deepEqual(storedArray, [1, 2, 3]);
});

void test('computeGroupBy throws ValidationError when $push operand is not a string', () => {
  const badOperands: [string, unknown][] = [
    ['numeric', 123],
    ['null', null],
    ['boolean', true],
    ['object', { field: 'value' }],
  ];
  for (const [label, operand] of badOperands) {
    assert.throws(
      () =>
        computeGroupBy(
          [],
          'category',
          { result: { $push: operand } } as unknown as GroupAccumulators,
          pathCache,
        ),
      ValidationError,
      `Expected ValidationError for $push with ${label} operand`,
    );
  }
});

void test('computeGroupBy rejects reserved/bad field path for $push accumulator', () => {
  assert.throws(
    () =>
      computeGroupBy(
        [],
        'category',
        { result: { $push: '__proto__.x' } } as unknown as GroupAccumulators,
        pathCache,
      ),
    ValidationError,
    'Expected ValidationError for $push with reserved field path',
  );
});

void test('computeGroupBy $push entry still enforces exactly-one-accumulator-key rule', () => {
  assert.throws(
    () =>
      computeGroupBy(
        [],
        'category',
        {
          result: { $push: 'value', $last: 'value' },
        } as unknown as GroupAccumulators,
        pathCache,
      ),
    ValidationError,
  );
});

void test('computeGroupBy $addToSet collects distinct values in first-occurrence order, per group', () => {
  const docs = [
    flDoc('1', { category: 'a', value: 'x' }),
    flDoc('2', { category: 'a', value: 'y' }),
    flDoc('3', { category: 'a', value: 'x' }),
    flDoc('4', { category: 'b', value: 'z' }),
  ];
  const result = computeGroupBy(
    docs,
    'category',
    { values: { $addToSet: 'value' } },
    pathCache,
  );
  const a = result.find((entry) => entry._key === 'a')!;
  const b = result.find((entry) => entry._key === 'b')!;
  assert.deepEqual(a.values, ['x', 'y']);
  assert.deepEqual(b.values, ['z']);
});

void test('computeGroupBy $addToSet skips missing/undefined, includes null as one distinct member, distinguishes null from the string "null"', () => {
  const docs = [
    flDoc('1', { category: 'a', value: null }),
    flDoc('2', { category: 'a' }), // missing
    flDoc('3', { category: 'a', value: undefined }),
    flDoc('4', { category: 'a', value: null }), // duplicate null
    flDoc('5', { category: 'a', value: 'null' }), // the string "null" is distinct from null
  ];
  const result = computeGroupBy(
    docs,
    'category',
    { values: { $addToSet: 'value' } },
    pathCache,
  );
  assert.deepEqual(result[0].values, [null, 'null']);
});

void test('computeGroupBy $addToSet dedupes object values by deep equality regardless of key order', () => {
  const docs = [
    flDoc('1', { category: 'a', value: { x: 1, y: 2 } }),
    flDoc('2', { category: 'a', value: { y: 2, x: 1 } }), // same object, reordered keys -> one
    flDoc('3', { category: 'a', value: { x: 1, y: 3 } }),
  ];
  const result = computeGroupBy(
    docs,
    'category',
    { values: { $addToSet: 'value' } },
    pathCache,
  );
  assert.deepEqual(result[0].values, [
    { x: 1, y: 2 },
    { x: 1, y: 3 },
  ]);
});

void test('computeGroupBy $addToSet returns [] for a group with no present values', () => {
  const docs = [
    flDoc('1', { category: 'a' }),
    flDoc('2', { category: 'a', value: undefined }),
  ];
  const result = computeGroupBy(
    docs,
    'category',
    { values: { $addToSet: 'value' } },
    pathCache,
  );
  assert.deepEqual(result[0].values, []);
});

void test('computeGroupBy $addToSet (array groupBy form)', () => {
  const docs = [
    flDoc('1', { category: 'a', value: 'x' }),
    flDoc('2', { category: 'a', value: 'x' }),
    flDoc('3', { category: 'b', value: 'z' }),
  ];
  const result = computeGroupBy(
    docs,
    ['category'],
    { values: { $addToSet: 'value' } },
    pathCache,
  );
  const a = result.find(
    (entry) => (entry._key as Record<string, unknown>).category === 'a',
  )!;
  assert.deepEqual(a.values, ['x']);
});

void test('computeGroupBy $addToSet with dot-notation field path', () => {
  const docs = [
    flDoc('1', { category: 'a', value: { nested: { deep: 'v1' } } }),
    flDoc('2', { category: 'a', value: { nested: { deep: 'v1' } } }),
    flDoc('3', { category: 'a', value: { nested: { deep: 'v2' } } }),
  ];
  const result = computeGroupBy(
    docs,
    'category',
    { deepValues: { $addToSet: 'value.nested.deep' } },
    pathCache,
  );
  assert.deepEqual(result[0].deepValues, ['v1', 'v2']);
});

void test('computeGroupBy $addToSet defensively clones distinct object/array values: mutating the result does not affect the stored document', () => {
  const storedObject = { tag: 'original' };
  const docs = [
    flDoc('1', { category: 'a', value: storedObject }),
    flDoc('2', { category: 'a', value: storedObject }), // same reference; still one distinct value
  ];

  const result = computeGroupBy(
    docs,
    'category',
    { values: { $addToSet: 'value' } },
    pathCache,
  );

  const values = result[0].values as unknown[];
  assert.equal(values.length, 1);
  assert.notEqual(values[0], storedObject);
  (values[0] as Record<string, unknown>).tag = 'mutated';
  assert.equal(storedObject.tag, 'original');
});

void test('computeGroupBy throws ValidationError when $addToSet operand is not a string', () => {
  const badOperands: [string, unknown][] = [
    ['numeric', 123],
    ['null', null],
    ['boolean', true],
    ['object', { field: 'value' }],
  ];
  for (const [label, operand] of badOperands) {
    assert.throws(
      () =>
        computeGroupBy(
          [],
          'category',
          { result: { $addToSet: operand } } as unknown as GroupAccumulators,
          pathCache,
        ),
      ValidationError,
      `Expected ValidationError for $addToSet with ${label} operand`,
    );
  }
});

void test('computeGroupBy rejects reserved/bad field path for $addToSet accumulator', () => {
  assert.throws(
    () =>
      computeGroupBy(
        [],
        'category',
        {
          result: { $addToSet: '__proto__.x' },
        } as unknown as GroupAccumulators,
        pathCache,
      ),
    ValidationError,
    'Expected ValidationError for $addToSet with reserved field path',
  );
});

void test('computeGroupBy $addToSet entry still enforces exactly-one-accumulator-key rule', () => {
  assert.throws(
    () =>
      computeGroupBy(
        [],
        'category',
        {
          result: { $addToSet: 'value', $first: 'value' },
        } as unknown as GroupAccumulators,
        pathCache,
      ),
    ValidationError,
  );
});

void test('computeGroupBy $addToSet throws ValidationError when a single group exceeds MAX_DISTINCT_COUNT unique values (per-group cap)', () => {
  // MAX_GROUP_DOCUMENTS === MAX_DISTINCT_COUNT at the current limits, so
  // MAX_DISTINCT_COUNT + 1 unique values in one group also breaches
  // MAX_GROUP_DOCUMENTS first -- mirroring the equivalent $countDistinct
  // test above (spec 03 §1.3's documented precedence). Either way a
  // ValidationError is thrown for the cap breach.
  const docs = Array.from({ length: MAX_GROUP_DOCUMENTS + 1 }, (_, i) =>
    flDoc(String(i), { category: 'a', value: i }),
  );
  assert.throws(
    () =>
      computeGroupBy(
        docs,
        'category',
        { values: { $addToSet: 'value' } },
        pathCache,
      ),
    {
      constructor: ValidationError,
      message: `groupBy group exceeds maximum of ${String(MAX_GROUP_DOCUMENTS)} documents per group.`,
    },
  );
});

void test('computeGroupBy $push and $addToSet coexist as separate output fields in the same accumulators object', () => {
  const docs = [
    flDoc('1', { category: 'a', value: 'x' }),
    flDoc('2', { category: 'a', value: 'x' }),
    flDoc('3', { category: 'a', value: 'y' }),
  ];
  const result = computeGroupBy(
    docs,
    'category',
    { all: { $push: 'value' }, distinctValues: { $addToSet: 'value' } },
    pathCache,
  );
  assert.deepEqual(result[0].all, ['x', 'x', 'y']);
  assert.deepEqual(result[0].distinctValues, ['x', 'y']);
});

void test('validateGroupByField returns a defensive copy for the array form', () => {
  const input = ['category', 'score'];
  const validated = validateGroupByField(input);

  assert.ok(Array.isArray(validated));
  assert.notEqual(validated, input);
  assert.deepEqual(validated, ['category', 'score']);

  // Mutating the input afterwards must not affect the returned copy.
  input[0] = 'mutated';
  input.length = 1;
  assert.deepEqual(validated, ['category', 'score']);
});

// ---------------------------------------------------------------------------
// computeGroupBy — _key isolation (ADR-026)
// ---------------------------------------------------------------------------

void test('computeGroupBy clones an object _key so mutating it cannot alter the source document (string form)', () => {
  const source = doc('1', { category: { name: 'eng', tags: ['a'] } });
  const accumulators: GroupAccumulators = { count: { $count: true } };

  const result = computeGroupBy([source], 'category', accumulators, pathCache);

  const key = result[0]._key as { name: string; tags: string[] };
  assert.notEqual(key, (source as { category?: unknown }).category);

  key.name = 'mutated';
  key.tags.push('injected');

  assert.deepEqual((source as { category?: unknown }).category, {
    name: 'eng',
    tags: ['a'],
  });
});

void test('computeGroupBy clones each composite _key dimension so mutating it cannot alter the source document (array form)', () => {
  const source = doc('1', {
    category: { name: 'eng' },
    score: [1, [2]],
  });
  const accumulators: GroupAccumulators = { count: { $count: true } };

  const result = computeGroupBy(
    [source],
    ['category', 'score'],
    accumulators,
    pathCache,
  );

  const key = result[0]._key as Record<string, unknown>;
  const categoryKey = key.category as { name: string };
  const scoreKey = key.score as [number, number[]];

  assert.notEqual(categoryKey, (source as { category?: unknown }).category);
  assert.notEqual(scoreKey, (source as { score?: unknown }).score);

  categoryKey.name = 'mutated';
  scoreKey.push(99);
  scoreKey[1].push(99);

  assert.deepEqual((source as { category?: unknown }).category, {
    name: 'eng',
  });
  assert.deepEqual((source as { score?: unknown }).score, [1, [2]]);
});

void test('computeGroupBy still groups documents with deep-equal object keys of identical shape together', () => {
  const accumulators: GroupAccumulators = { count: { $count: true } };
  const docs = [
    doc('1', { category: { name: 'eng' } }),
    doc('2', { category: { name: 'eng' } }),
    doc('3', { category: { name: 'sales' } }),
  ];

  const result = computeGroupBy(docs, 'category', accumulators, pathCache);

  assert.equal(result.length, 2);
  assert.deepEqual(result[0]._key, { name: 'eng' });
  assert.equal(result[0].count, 2);
  assert.deepEqual(result[1]._key, { name: 'sales' });
  assert.equal(result[1].count, 1);
});

// --- $count operand validation ---

void test('computeGroupBy rejects a $count operand that is not true', () => {
  const docs = [doc('1', { category: 'eng' })];
  for (const operand of [false, 0, 1, 'true', null, {}]) {
    assert.throws(
      () =>
        computeGroupBy(
          docs,
          'category',
          { total: { $count: operand } } as unknown as GroupAccumulators,
          pathCache,
        ),
      ValidationError,
    );
  }
});

void test('computeGroupBy accepts $count: true', () => {
  const docs = [doc('1', { category: 'eng' })];
  const result = computeGroupBy(
    docs,
    'category',
    { total: { $count: true } },
    pathCache,
  );
  assert.equal(result[0].total, 1);
});

// --- accumulator output-field name validation ---

void test('computeGroupBy rejects "_key" as an accumulator output name', () => {
  const docs = [doc('1', { category: 'eng' })];
  assert.throws(
    () =>
      computeGroupBy(docs, 'category', { _key: { $count: true } }, pathCache),
    ValidationError,
  );
});

void test('computeGroupBy rejects a reserved accumulator output name', () => {
  const docs = [doc('1', { category: 'eng' })];
  const accumulators = JSON.parse(
    '{"__proto__": {"$count": true}}',
  ) as GroupAccumulators;
  assert.throws(
    () => computeGroupBy(docs, 'category', accumulators, pathCache),
    ValidationError,
  );
  // `constructor` is contextually typed against Object.prototype's member, so
  // the literal needs the cast that a runtime-built accumulator map implies.
  const constructorAccumulators = {
    constructor: { $count: true },
  } as unknown as GroupAccumulators;
  assert.throws(
    () => computeGroupBy(docs, 'category', constructorAccumulators, pathCache),
    ValidationError,
  );
});

void test('computeGroupBy rejects a blank accumulator output name', () => {
  const docs = [doc('1', { category: 'eng' })];
  assert.throws(
    () =>
      computeGroupBy(docs, 'category', { '  ': { $count: true } }, pathCache),
    ValidationError,
  );
});

// --- accumulator budget and per-group memoization ---

void test('computeGroupBy rejects more than MAX_GROUP_ACCUMULATORS accumulators', () => {
  const accumulators: GroupAccumulators = {};
  for (let i = 0; i <= MAX_GROUP_ACCUMULATORS; i += 1) {
    accumulators[`a${String(i)}`] = { $sum: 'score' };
  }
  assert.throws(
    () =>
      computeGroupBy(
        [doc('1', { category: 'a', score: 1 })],
        'category',
        accumulators,
        pathCache,
      ),
    ValidationError,
  );
});

void test('computeGroupBy accepts exactly MAX_GROUP_ACCUMULATORS accumulators', () => {
  const accumulators: GroupAccumulators = {};
  for (let i = 0; i < MAX_GROUP_ACCUMULATORS; i += 1) {
    accumulators[`a${String(i)}`] = { $sum: 'score' };
  }
  const result = computeGroupBy(
    [doc('1', { category: 'a', score: 2 })],
    'category',
    accumulators,
    pathCache,
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].a0, 2);
  assert.equal(result[0][`a${String(MAX_GROUP_ACCUMULATORS - 1)}`], 2);
});

void test('computeGroupBy shares one field scan across accumulators reading the same path', () => {
  const docs = [
    doc('1', { category: 'a', score: 10 }),
    doc('2', { category: 'a', score: 20 }),
    doc('3', { category: 'a', score: 30 }),
    doc('4', { category: 'b', score: 5 }),
  ];

  const result = computeGroupBy(
    docs,
    'category',
    {
      total: { $sum: 'score' },
      average: { $avg: 'score' },
      p50: { $percentile: { field: 'score', p: 0.5 } },
      p100: { $percentile: { field: 'score', p: 1 } },
      middle: { $median: 'score' },
      smallest: { $min: 'score' },
    },
    pathCache,
  );

  assert.deepEqual(result[0], {
    _key: 'a',
    total: 60,
    average: 20,
    p50: 20,
    p100: 30,
    middle: 20,
    smallest: 10,
  });
  assert.deepEqual(result[1], {
    _key: 'b',
    total: 5,
    average: 5,
    p50: 5,
    p100: 5,
    middle: 5,
    smallest: 5,
  });
});
