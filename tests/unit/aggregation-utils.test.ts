import assert from 'node:assert/strict';
import test from 'node:test';

import { ValidationError } from '../../src/errors.js';
import {
  computeDistinct,
  extractNumericValues,
  validateAggregationField,
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
