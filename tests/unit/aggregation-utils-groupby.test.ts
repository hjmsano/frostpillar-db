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
