import assert from 'node:assert/strict';
import test from 'node:test';

import { ValidationError } from '../../src/errors.js';
import { computeGroupBy } from '../../src/internal/aggregationUtils.js';
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
    bad: { $median: 'score' },
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
  for (const op of ['$sum', '$avg', '$min', '$max'] as const) {
    assert.throws(
      () =>
        computeGroupBy(
          [],
          'category',
          {
            result: { [op]: 123 },
          } as unknown as GroupAccumulators,
          pathCache,
        ),
      ValidationError,
      `Expected ValidationError for ${op} with numeric operand`,
    );
    assert.throws(
      () =>
        computeGroupBy(
          [],
          'category',
          {
            result: { [op]: null },
          } as unknown as GroupAccumulators,
          pathCache,
        ),
      ValidationError,
      `Expected ValidationError for ${op} with null operand`,
    );
    assert.throws(
      () =>
        computeGroupBy(
          [],
          'category',
          {
            result: { [op]: true },
          } as unknown as GroupAccumulators,
          pathCache,
        ),
      ValidationError,
      `Expected ValidationError for ${op} with boolean operand`,
    );
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
