import assert from 'node:assert/strict';
import test from 'node:test';

import { ValidationError } from '../../src/errors.js';
import {
  clampVariance,
  computeCountDistinct,
  computeDistinct,
  computePercentile,
  computeStdDev,
  computeVariance,
  computeWelford,
  extractNumericValues,
  validateAggregationField,
  validatePercentile,
} from '../../src/internal/aggregationUtils.js';
import {
  MAX_DISTINCT_COUNT,
  MAX_FIELD_PATH_DEPTH,
} from '../../src/internal/limits.js';
import type {
  FrostpillarDocument,
  FrostpillarStoredDocument,
} from '../../src/types.js';

const pathCache = new Map<string, string[]>();

interface Doc extends FrostpillarDocument {
  value?: unknown;
  category?: string;
  score?: number;
}

const doc = (
  id: string,
  fields: Record<string, unknown>,
): FrostpillarStoredDocument<Doc> =>
  ({ _id: id, ...fields }) as FrostpillarStoredDocument<Doc>;

// ---------------------------------------------------------------------------
// validateAggregationField
// ---------------------------------------------------------------------------

void test('validateAggregationField rejects non-string input', () => {
  assert.throws(
    () => validateAggregationField(42 as unknown as string),
    ValidationError,
  );
});

void test('validateAggregationField rejects empty string', () => {
  assert.throws(() => validateAggregationField(''), ValidationError);
});

void test('validateAggregationField rejects path with empty segment', () => {
  assert.throws(() => validateAggregationField('a..b'), ValidationError);
  assert.throws(() => validateAggregationField('.a'), ValidationError);
  assert.throws(() => validateAggregationField('a.'), ValidationError);
});

void test('validateAggregationField rejects reserved segments', () => {
  assert.throws(() => validateAggregationField('__proto__'), ValidationError);
  assert.throws(
    () => validateAggregationField('a.__proto__.b'),
    ValidationError,
  );
  assert.throws(() => validateAggregationField('constructor'), ValidationError);
  assert.throws(() => validateAggregationField('a.prototype'), ValidationError);
});

void test('validateAggregationField rejects paths exceeding max depth', () => {
  const deepPath = Array.from(
    { length: MAX_FIELD_PATH_DEPTH + 1 },
    (_, i) => `s${String(i)}`,
  ).join('.');
  assert.throws(() => validateAggregationField(deepPath), ValidationError);
});

void test('validateAggregationField returns the field for valid paths', () => {
  assert.equal(validateAggregationField('a'), 'a');
  assert.equal(validateAggregationField('a.b.c'), 'a.b.c');
});

// ---------------------------------------------------------------------------
// computeDistinct
// ---------------------------------------------------------------------------

void test('computeDistinct rejects reserved field path even with zero documents', () => {
  assert.throws(
    () => computeDistinct([], '__proto__.x', pathCache),
    ValidationError,
  );
});

void test('extractNumericValues rejects reserved field path even with zero documents', () => {
  assert.throws(
    () => extractNumericValues([], 'constructor', pathCache),
    ValidationError,
  );
});

void test('computeDistinct dedupes primitive values', () => {
  const docs = [
    doc('1', { value: 'a' }),
    doc('2', { value: 'b' }),
    doc('3', { value: 'a' }),
  ];
  assert.deepEqual(computeDistinct(docs, 'value', pathCache), ['a', 'b']);
});

void test('computeDistinct skips documents where the field is missing or undefined', () => {
  const docs = [
    doc('1', { value: 1 }),
    doc('2', {}),
    doc('3', { value: undefined }),
    doc('4', { value: 2 }),
  ];
  assert.deepEqual(computeDistinct(docs, 'value', pathCache), [1, 2]);
});

void test('computeDistinct dedupes object values by deep equality', () => {
  const docs = [
    doc('1', { value: { x: 1, y: 2 } }),
    doc('2', { value: { x: 1, y: 2 } }),
    doc('3', { value: { x: 1, y: 3 } }),
  ];
  const result = computeDistinct(docs, 'value', pathCache);
  assert.equal(result.length, 2);
  assert.deepEqual(result, [
    { x: 1, y: 2 },
    { x: 1, y: 3 },
  ]);
});

void test('computeDistinct throws when primitive values exceed MAX_DISTINCT_COUNT', () => {
  // MAX_DISTINCT_COUNT + 1 distinct primitive values must raise exactly one error.
  const docs = Array.from({ length: MAX_DISTINCT_COUNT + 1 }, (_, i) =>
    doc(String(i), { value: i }),
  );
  assert.throws(
    () => computeDistinct(docs, 'value', pathCache),
    ValidationError,
  );
});

void test('computeDistinct throws when object values exceed MAX_DISTINCT_COUNT', () => {
  // Fill result to the limit with cheap primitives, then push one extra object.
  // This avoids the O(n²) deepEqual scan that would result from
  // MAX_DISTINCT_COUNT distinct objects, keeping the test fast.
  const primitiveDocs = Array.from({ length: MAX_DISTINCT_COUNT }, (_, i) =>
    doc(String(i), { value: i }),
  );
  const objectDocs = [doc('obj-0', { value: { n: 0 } })];
  assert.throws(
    () =>
      computeDistinct([...primitiveDocs, ...objectDocs], 'value', pathCache),
    ValidationError,
  );
});

void test('computeDistinct mixes primitives and objects in order of first occurrence', () => {
  const docs = [
    doc('1', { value: 'a' }),
    doc('2', { value: { k: 1 } }),
    doc('3', { value: 'a' }),
    doc('4', { value: { k: 1 } }),
    doc('5', { value: null }),
  ];
  const result = computeDistinct(docs, 'value', pathCache);
  assert.deepEqual(result, ['a', { k: 1 }, null]);
});

void test('computeDistinct dedupes array values', () => {
  const docs = [
    doc('1', { value: [1, 2, 3] }),
    doc('2', { value: [1, 2, 3] }),
    doc('3', { value: [4, 5] }),
  ];
  const result = computeDistinct(docs, 'value', pathCache);
  assert.equal(result.length, 2);
  assert.deepEqual(result, [
    [1, 2, 3],
    [4, 5],
  ]);
});

void test('computeDistinct dedupes nested object values', () => {
  const docs = [
    doc('1', { value: { a: { b: 1 }, c: [2] } }),
    doc('2', { value: { a: { b: 1 }, c: [2] } }),
    doc('3', { value: { a: { b: 2 }, c: [2] } }),
  ];
  const result = computeDistinct(docs, 'value', pathCache);
  assert.equal(result.length, 2);
  assert.deepEqual(result, [
    { a: { b: 1 }, c: [2] },
    { a: { b: 2 }, c: [2] },
  ]);
});

void test('computeDistinct handles many unique object values', () => {
  const count = 5000;
  const docs = Array.from({ length: count }, (_, i) =>
    doc(String(i), { value: { n: i } }),
  );
  const result = computeDistinct(docs, 'value', pathCache);
  assert.equal(result.length, count);
});

void test('computeDistinct distinguishes object with NaN from object with null', () => {
  const docs = [
    doc('1', { value: { a: Number.NaN } }),
    doc('2', { value: { a: null } }),
  ];
  const result = computeDistinct(docs, 'value', pathCache);
  assert.equal(result.length, 2);
});

void test('computeDistinct distinguishes object with undefined value from empty object', () => {
  const docs = [doc('1', { value: { a: undefined } }), doc('2', { value: {} })];
  const result = computeDistinct(docs, 'value', pathCache);
  assert.equal(result.length, 2);
});

// ---------------------------------------------------------------------------
// computeCountDistinct (ADR-022) — dedup parity with computeDistinct
// ---------------------------------------------------------------------------

void test('computeCountDistinct rejects reserved field path even with zero documents', () => {
  assert.throws(
    () => computeCountDistinct([], '__proto__.x', pathCache),
    ValidationError,
  );
});

void test('computeCountDistinct returns 0 for an empty document set', () => {
  assert.equal(computeCountDistinct([], 'value', pathCache), 0);
});

void test('computeCountDistinct counts deduped primitive values', () => {
  const docs = [
    doc('1', { value: 'a' }),
    doc('2', { value: 'b' }),
    doc('3', { value: 'a' }),
  ];
  assert.equal(computeCountDistinct(docs, 'value', pathCache), 2);
});

void test('computeCountDistinct skips documents where the field is missing or undefined', () => {
  const docs = [
    doc('1', { value: 1 }),
    doc('2', {}),
    doc('3', { value: undefined }),
    doc('4', { value: 2 }),
  ];
  assert.equal(computeCountDistinct(docs, 'value', pathCache), 2);
});

void test('computeCountDistinct counts null as one distinct value', () => {
  const docs = [
    doc('1', { value: null }),
    doc('2', { value: null }),
    doc('3', { value: 1 }),
  ];
  assert.equal(computeCountDistinct(docs, 'value', pathCache), 2);
});

void test('computeCountDistinct counts object values deduped by deep equality, including reordered keys', () => {
  const docs = [
    doc('1', { value: { x: 1, y: 2 } }),
    doc('2', { value: { y: 2, x: 1 } }),
    doc('3', { value: { x: 1, y: 3 } }),
  ];
  assert.equal(computeCountDistinct(docs, 'value', pathCache), 2);
});

void test('computeCountDistinct distinguishes null from "null" (string) from missing', () => {
  const docs = [
    doc('1', { value: null }),
    doc('2', { value: 'null' }),
    doc('3', {}),
    doc('4', { value: null }),
    doc('5', { value: 'null' }),
  ];
  assert.equal(computeCountDistinct(docs, 'value', pathCache), 2);
});

void test('computeCountDistinct counts array values, treating element order as significant', () => {
  const docs = [
    doc('1', { value: [1, 2] }),
    doc('2', { value: [2, 1] }),
    doc('3', { value: [1, 2] }),
  ];
  assert.equal(computeCountDistinct(docs, 'value', pathCache), 2);
});

void test('computeCountDistinct mixes primitives and objects', () => {
  const docs = [
    doc('1', { value: 'a' }),
    doc('2', { value: { k: 1 } }),
    doc('3', { value: 'a' }),
    doc('4', { value: { k: 1 } }),
    doc('5', { value: null }),
  ];
  assert.equal(computeCountDistinct(docs, 'value', pathCache), 3);
});

void test('computeCountDistinct throws when primitive values exceed MAX_DISTINCT_COUNT', () => {
  const docs = Array.from({ length: MAX_DISTINCT_COUNT + 1 }, (_, i) =>
    doc(String(i), { value: i }),
  );
  assert.throws(
    () => computeCountDistinct(docs, 'value', pathCache),
    ValidationError,
  );
});

void test('computeCountDistinct throws at the identical boundary as computeDistinct (exactly MAX_DISTINCT_COUNT is fine, +1 throws)', () => {
  const atLimit = Array.from({ length: MAX_DISTINCT_COUNT }, (_, i) =>
    doc(String(i), { value: i }),
  );
  assert.equal(computeCountDistinct(atLimit, 'value', pathCache), MAX_DISTINCT_COUNT);

  const overLimit = [...atLimit, doc('extra', { value: 'one-too-many' })];
  assert.throws(
    () => computeCountDistinct(overLimit, 'value', pathCache),
    ValidationError,
  );
});

void test('computeCountDistinct throws when object values exceed MAX_DISTINCT_COUNT', () => {
  // Same technique as the computeDistinct cap test: fill to the limit with
  // cheap primitives, then push one extra object, avoiding an O(n^2) scan.
  const primitiveDocs = Array.from({ length: MAX_DISTINCT_COUNT }, (_, i) =>
    doc(String(i), { value: i }),
  );
  const objectDocs = [doc('obj-0', { value: { n: 0 } })];
  assert.throws(
    () =>
      computeCountDistinct(
        [...primitiveDocs, ...objectDocs],
        'value',
        pathCache,
      ),
    ValidationError,
  );
});

// ---------------------------------------------------------------------------
// computeCountDistinct === computeDistinct(...).length — the ADR-022 core
// equivalence guarantee, proven by shared-core refactor non-regression.
// ---------------------------------------------------------------------------

void test('computeCountDistinct equals computeDistinct(docs, field, cache).length across varied datasets (ADR-022 equivalence guarantee)', () => {
  const datasets: {
    docs: FrostpillarStoredDocument<Doc>[];
    field: string;
  }[] = [
    { docs: [], field: 'value' },
    {
      docs: [doc('1', { value: 'a' }), doc('2', { value: 'b' }), doc('3', { value: 'a' })],
      field: 'value',
    },
    {
      docs: [doc('1', { value: 1 }), doc('2', {}), doc('3', { value: undefined }), doc('4', { value: 2 })],
      field: 'value',
    },
    {
      docs: [
        doc('1', { value: { x: 1, y: 2 } }),
        doc('2', { value: { y: 2, x: 1 } }),
        doc('3', { value: { x: 1, y: 3 } }),
      ],
      field: 'value',
    },
    {
      docs: [
        doc('1', { value: [1, 2, 3] }),
        doc('2', { value: [1, 2, 3] }),
        doc('3', { value: [4, 5] }),
      ],
      field: 'value',
    },
    {
      docs: [
        doc('1', { value: 'a' }),
        doc('2', { value: { k: 1 } }),
        doc('3', { value: 'a' }),
        doc('4', { value: { k: 1 } }),
        doc('5', { value: null }),
      ],
      field: 'value',
    },
    {
      docs: Array.from({ length: 500 }, (_, i) =>
        doc(String(i), { value: i % 50 }),
      ),
      field: 'value',
    },
    {
      docs: Array.from({ length: 200 }, (_, i) =>
        doc(String(i), { value: { n: i % 20 } }),
      ),
      field: 'value',
    },
  ];

  for (const { docs, field } of datasets) {
    const distinctLength = computeDistinct(docs, field, pathCache).length;
    const count = computeCountDistinct(docs, field, pathCache);
    assert.equal(
      count,
      distinctLength,
      `computeCountDistinct must equal computeDistinct(...).length for dataset of size ${String(docs.length)}`,
    );
  }
});

// ---------------------------------------------------------------------------
// extractNumericValues
// ---------------------------------------------------------------------------

void test('extractNumericValues returns only finite numeric values', () => {
  const docs = [
    doc('1', { score: 10 }),
    doc('2', { score: 'not a number' }),
    doc('3', { score: Number.POSITIVE_INFINITY }),
    doc('4', { score: Number.NaN }),
    doc('5', { score: -3.5 }),
    doc('6', {}),
  ];
  assert.deepEqual(extractNumericValues(docs, 'score', pathCache), [10, -3.5]);
});

// ---------------------------------------------------------------------------
// computePercentile
// ---------------------------------------------------------------------------

void test('computePercentile returns null for an empty array', () => {
  assert.equal(computePercentile([], 0.5), null);
});

void test('computePercentile returns the single value unchanged for every p', () => {
  assert.equal(computePercentile([42], 0), 42);
  assert.equal(computePercentile([42], 0.5), 42);
  assert.equal(computePercentile([42], 1), 42);
});

void test('computePercentile p=0 returns the min and p=1 returns the max', () => {
  const values = [5, 1, 9, 3, 7];
  assert.equal(computePercentile(values, 0), 1);
  assert.equal(computePercentile(values, 1), 9);
});

void test('computePercentile computes the median for odd-count sets', () => {
  assert.equal(computePercentile([3, 1, 2], 0.5), 2);
});

void test('computePercentile computes the median as the average of the two middle values for even-count sets', () => {
  assert.equal(computePercentile([1, 2, 3, 4], 0.5), 2.5);
});

void test('computePercentile does not mutate the input array (sorts a copy)', () => {
  const values = [3, 1, 2];
  const copy = [...values];
  computePercentile(values, 0.5);
  assert.deepEqual(values, copy);
});

void test('computePercentile interpolates linearly between closest ranks', () => {
  // v = [10, 20, 30, 40], n=4, p=0.25 -> rank = 0.25*3 = 0.75, lo=0, frac=0.75
  // result = 10 + 0.75*(20-10) = 17.5
  assert.equal(computePercentile([40, 10, 30, 20], 0.25), 17.5);
});

void test('computePercentile handles duplicate values', () => {
  assert.equal(computePercentile([5, 5, 5, 5], 0.5), 5);
  assert.equal(computePercentile([1, 1, 2, 2], 0.5), 1.5);
});

void test('computePercentile handles extreme p on a small set', () => {
  // n=3, p=0.999 -> rank = 0.999*2 = 1.998, lo=1, frac=0.998
  // result = v[1] + 0.998*(v[2]-v[1])
  const result = computePercentile([1, 2, 3], 0.999);
  assert.ok(result !== null);
  assert.ok(Math.abs(result - (2 + 0.998 * (3 - 2))) < 1e-9);
});

// ---------------------------------------------------------------------------
// validatePercentile
// ---------------------------------------------------------------------------

void test('validatePercentile accepts 0 and 1 (boundary values)', () => {
  assert.equal(validatePercentile(0), 0);
  assert.equal(validatePercentile(1), 1);
});

void test('validatePercentile accepts a mid-range fraction', () => {
  assert.equal(validatePercentile(0.95), 0.95);
});

void test('validatePercentile rejects non-number input', () => {
  assert.throws(
    () => validatePercentile('0.5' as unknown as number),
    ValidationError,
  );
  assert.throws(
    () => validatePercentile(null as unknown as number),
    ValidationError,
  );
  assert.throws(
    () => validatePercentile(undefined as unknown as number),
    ValidationError,
  );
});

void test('validatePercentile rejects NaN', () => {
  assert.throws(() => validatePercentile(Number.NaN), ValidationError);
});

void test('validatePercentile rejects Infinity and -Infinity', () => {
  assert.throws(
    () => validatePercentile(Number.POSITIVE_INFINITY),
    ValidationError,
  );
  assert.throws(
    () => validatePercentile(Number.NEGATIVE_INFINITY),
    ValidationError,
  );
});

void test('validatePercentile rejects out-of-range values', () => {
  assert.throws(() => validatePercentile(-0.1), ValidationError);
  assert.throws(() => validatePercentile(1.1), ValidationError);
});

void test('validatePercentile rejects arrays', () => {
  assert.throws(
    () => validatePercentile([0.5] as unknown as number),
    ValidationError,
  );
});

// ---------------------------------------------------------------------------
// computeWelford
// ---------------------------------------------------------------------------

void test('computeWelford returns count 0 / mean 0 / m2 0 for an empty array', () => {
  const result = computeWelford([]);
  assert.deepEqual(result, { count: 0, mean: 0, m2: 0 });
});

void test('computeWelford computes count, mean, and m2 for a known set', () => {
  // [2, 4, 4, 4, 5, 5, 7, 9]: mean = 5, sum of squared deviations = 32
  const values = [2, 4, 4, 4, 5, 5, 7, 9];
  const result = computeWelford(values);
  assert.equal(result.count, 8);
  assert.ok(Math.abs(result.mean - 5) < 1e-9);
  assert.ok(Math.abs(result.m2 - 32) < 1e-9);
});

void test('computeWelford does not mutate the input array', () => {
  const values = [3, 1, 2];
  const copy = [...values];
  computeWelford(values);
  assert.deepEqual(values, copy);
});

// ---------------------------------------------------------------------------
// computeVariance / computeStdDev — hand-computed correctness
// ---------------------------------------------------------------------------

void test('computeVariance computes population variance for a known set', () => {
  // [2, 4, 4, 4, 5, 5, 7, 9]: population variance = 32 / 8 = 4
  const values = [2, 4, 4, 4, 5, 5, 7, 9];
  assert.equal(computeVariance(values, false), 4);
});

void test('clampVariance normalizes negative floating-point roundoff to zero', () => {
  assert.equal(clampVariance(-Number.EPSILON), 0);
  assert.equal(clampVariance(0), 0);
  assert.equal(clampVariance(Number.EPSILON), Number.EPSILON);
});

void test('computeStdDev computes population standard deviation for a known set', () => {
  const values = [2, 4, 4, 4, 5, 5, 7, 9];
  assert.equal(computeStdDev(values, false), 2);
});

void test('computeVariance computes sample variance for a known set', () => {
  // [2, 4, 4, 4, 5, 5, 7, 9]: sample variance = 32 / 7
  const values = [2, 4, 4, 4, 5, 5, 7, 9];
  assert.ok(Math.abs(computeVariance(values, true)! - 32 / 7) < 1e-9);
});

void test('computeStdDev computes sample standard deviation for a known set', () => {
  const values = [2, 4, 4, 4, 5, 5, 7, 9];
  assert.ok(Math.abs(computeStdDev(values, true)! - Math.sqrt(32 / 7)) < 1e-9);
});

void test('computeVariance and computeStdDev return null for all four when n=0', () => {
  assert.equal(computeVariance([], false), null);
  assert.equal(computeVariance([], true), null);
  assert.equal(computeStdDev([], false), null);
  assert.equal(computeStdDev([], true), null);
});

void test('computeVariance and computeStdDev: n=1 gives pop 0 and samp null', () => {
  assert.equal(computeVariance([42], false), 0);
  assert.equal(computeStdDev([42], false), 0);
  assert.equal(computeVariance([42], true), null);
  assert.equal(computeStdDev([42], true), null);
});

void test('computeVariance: pop vs samp divisor difference for n>=2', () => {
  // [1, 2, 3, 4]: mean=2.5, sum sq dev = 5
  // pop = 5/4 = 1.25, samp = 5/3
  const values = [1, 2, 3, 4];
  assert.equal(computeVariance(values, false), 1.25);
  assert.ok(Math.abs(computeVariance(values, true)! - 5 / 3) < 1e-9);
  // samp must always be >= pop for n>=2 (dividing by a smaller number)
  assert.ok(computeVariance(values, true)! > computeVariance(values, false)!);
});

void test('computeVariance does not mutate the input array', () => {
  const values = [3, 1, 2];
  const copy = [...values];
  computeVariance(values, false);
  computeVariance(values, true);
  assert.deepEqual(values, copy);
});

void test('computeVariance is numerically stable for large-magnitude, low-variance data (Welford anti-cancellation regression)', () => {
  // Naive E[x^2] - E[x]^2 catastrophically cancels for values near 1e9;
  // Welford must not return 0 or a negative variance here.
  const values = [1e9, 1e9 + 1, 1e9 + 2];
  const pop = computeVariance(values, false);
  assert.ok(pop !== null);
  assert.ok(pop > 0, `expected positive variance, got ${String(pop)}`);
  assert.ok(
    Math.abs(pop - 2 / 3) < 1e-6,
    `expected variancePop ~= 2/3, got ${String(pop)}`,
  );
});
