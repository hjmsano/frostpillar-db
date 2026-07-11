import assert from 'node:assert/strict';
import test from 'node:test';

import { ValidationError } from '../../src/errors.js';
import {
  computeGroupBy,
  validateGroupByField,
} from '../../src/internal/aggregationUtils.js';
import { MAX_FIELD_PATH_DEPTH } from '../../src/internal/limits.js';
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

void test('computeGroupBy $first/$last on a single-document group returns that document\'s value for both', () => {
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
    assert.deepEqual(result[0].firstValue, value, `Expected ${label} to round-trip`);
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
