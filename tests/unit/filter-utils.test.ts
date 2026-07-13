import assert from 'node:assert/strict';
import test from 'node:test';

import { ValidationError } from '../../src/errors.js';
import {
  extractEqualityFields,
  extractIdEquality,
  extractIdInclusion,
  extractIdRange,
} from '../../src/internal/filterUtils.js';
import { MAX_OPERAND_ARRAY_SIZE } from '../../src/internal/limits.js';

const pathCache = new Map<string, string[]>();

const makeIds = (count: number): string[] =>
  Array.from({ length: count }, (_, i) => `id-${String(i)}`);

void test('extractEqualityFields returns direct value for implicit $eq', () => {
  const result = extractEqualityFields({ name: 'Alice' }, pathCache);
  assert.deepEqual(result, { name: 'Alice' });
});

void test('extractEqualityFields returns value for explicit $eq', () => {
  const result = extractEqualityFields({ age: { $eq: 30 } }, pathCache);
  assert.deepEqual(result, { age: 30 });
});

void test('extractEqualityFields skips non-equality operator', () => {
  const result = extractEqualityFields({ age: { $gt: 20 } }, pathCache);
  assert.deepEqual(result, {});
});

void test('extractEqualityFields skips $-prefixed keys', () => {
  const result = extractEqualityFields(
    { $or: [{ a: 1 }, { b: 2 }] },
    pathCache,
  );
  assert.deepEqual(result, {});
});

void test('extractEqualityFields skips field with multiple operators', () => {
  const result = extractEqualityFields(
    { age: { $gt: 20, $lt: 50 } },
    pathCache,
  );
  assert.deepEqual(result, {});
});

void test('extractEqualityFields returns empty object for empty filter', () => {
  const result = extractEqualityFields({}, pathCache);
  assert.deepEqual(result, {});
});

void test('extractEqualityFields extracts only equality conditions from mixed filter', () => {
  const result = extractEqualityFields(
    {
      name: 'Bob',
      age: { $gt: 25 },
      status: { $eq: 'active' },
    },
    pathCache,
  );
  assert.deepEqual(result, { name: 'Bob', status: 'active' });
});

void test('extractEqualityFields expands dot-notation key into nested object', () => {
  const result = extractEqualityFields({ 'address.city': 'Tokyo' }, pathCache);
  assert.deepEqual(result, { address: { city: 'Tokyo' } });
});

void test('extractEqualityFields expands deeply nested dot-notation key', () => {
  const result = extractEqualityFields({ 'a.b.c': 42 }, pathCache);
  assert.deepEqual(result, { a: { b: { c: 42 } } });
});

void test('extractEqualityFields expands dot-notation with explicit $eq', () => {
  const result = extractEqualityFields(
    { 'address.city': { $eq: 'Osaka' } },
    pathCache,
  );
  assert.deepEqual(result, { address: { city: 'Osaka' } });
});

void test('extractEqualityFields merges multiple dot-notation keys sharing a prefix', () => {
  const result = extractEqualityFields(
    {
      'address.city': 'Tokyo',
      'address.zip': '100-0001',
    },
    pathCache,
  );
  assert.deepEqual(result, { address: { city: 'Tokyo', zip: '100-0001' } });
});

void test('extractEqualityFields mixes flat and dot-notation keys', () => {
  const result = extractEqualityFields(
    {
      name: 'Alice',
      'address.city': 'Tokyo',
    },
    pathCache,
  );
  assert.deepEqual(result, { name: 'Alice', address: { city: 'Tokyo' } });
});

// --- extractIdEquality ---

void test('extractIdEquality returns id for implicit $eq', () => {
  assert.equal(extractIdEquality({ _id: 'abc' }), 'abc');
});

void test('extractIdEquality returns id for explicit $eq', () => {
  assert.equal(extractIdEquality({ _id: { $eq: 'abc' } }), 'abc');
});

void test('extractIdEquality returns id from a conjunctive filter', () => {
  assert.equal(extractIdEquality({ _id: 'abc', name: 'Alice' }), 'abc');
});

void test('extractIdEquality returns null for non-string _id', () => {
  assert.equal(extractIdEquality({ _id: 123 }), null);
});

void test('extractIdEquality returns null for empty string _id', () => {
  assert.equal(extractIdEquality({ _id: '' }), null);
});

void test('extractIdEquality returns null for non-equality operator', () => {
  assert.equal(extractIdEquality({ _id: { $gt: 'abc' } }), null);
});

void test('extractIdEquality returns null for filter without _id', () => {
  assert.equal(extractIdEquality({ name: 'Alice' }), null);
});

// --- extractIdRange ---

void test('extractIdRange returns range for $gte and $lte', () => {
  const result = extractIdRange({ _id: { $gte: 100, $lte: 200 } });
  assert.deepEqual(result, { start: 100, end: 200 });
});

void test('extractIdRange returns range for $gt and $lt', () => {
  const result = extractIdRange({ _id: { $gt: 'a', $lt: 'z' } });
  // $gt and $gte both set the same start value; exclusivity is re-applied by matchesFilter
  assert.deepEqual(result, { start: 'a', end: 'z' });
});

void test('extractIdRange returns range for $gte and $lt', () => {
  const result = extractIdRange({ _id: { $gte: 10, $lt: 50 } });
  assert.deepEqual(result, { start: 10, end: 50 });
});

void test('extractIdRange returns range for $gt and $lte', () => {
  const result = extractIdRange({ _id: { $gt: 'abc', $lte: 'xyz' } });
  assert.deepEqual(result, { start: 'abc', end: 'xyz' });
});

void test('extractIdRange returns null when only lower bound present', () => {
  assert.equal(extractIdRange({ _id: { $gte: 100 } }), null);
});

void test('extractIdRange returns null when only upper bound present', () => {
  assert.equal(extractIdRange({ _id: { $lte: 200 } }), null);
});

void test('extractIdRange returns null for non-range operators', () => {
  assert.equal(extractIdRange({ _id: { $eq: 'abc' } }), null);
});

void test('extractIdRange returns null when _id is a plain string', () => {
  assert.equal(extractIdRange({ _id: 'abc' }), null);
});

void test('extractIdRange returns null for empty filter', () => {
  assert.equal(extractIdRange({}), null);
});

void test('extractIdRange extracts range even with additional filter keys', () => {
  const result = extractIdRange({
    _id: { $gte: 1, $lte: 10 },
    status: 'active',
  });
  assert.deepEqual(result, { start: 1, end: 10 });
});

void test('extractIdRange prefers $gte over $gt when both present', () => {
  const result = extractIdRange({ _id: { $gte: 5, $gt: 3, $lte: 10 } });
  assert.deepEqual(result, { start: 5, end: 10 });
});

void test('extractIdRange prefers $lte over $lt when both present', () => {
  const result = extractIdRange({ _id: { $gte: 5, $lte: 10, $lt: 12 } });
  assert.deepEqual(result, { start: 5, end: 10 });
});

// --- extractIdRange: same-type enforcement ---

void test('extractIdRange accepts string+string bounds', () => {
  const result = extractIdRange({ _id: { $gte: 'a', $lte: 'z' } });
  assert.deepEqual(result, { start: 'a', end: 'z' });
});

void test('extractIdRange accepts number+number bounds', () => {
  const result = extractIdRange({ _id: { $gte: 1, $lte: 100 } });
  assert.deepEqual(result, { start: 1, end: 100 });
});

void test('extractIdRange throws ValidationError for mixed-type bounds (string $gte, number $lte)', () => {
  try {
    extractIdRange({ _id: { $gte: '10', $lte: 20 } });
    assert.fail('Expected ValidationError');
  } catch (error: unknown) {
    assert.ok(error instanceof ValidationError);
    assert.match(error.message, /"_id"/);
    assert.match(error.message, /string/);
    assert.match(error.message, /number/);
  }
});

void test('extractIdRange throws ValidationError for mixed-type bounds (number $gt, string $lt)', () => {
  assert.throws(
    () => extractIdRange({ _id: { $gt: 10, $lt: 'z' } }),
    ValidationError,
  );
});

void test('extractIdRange returns null for single-sided range with only $gte (no type check triggered)', () => {
  assert.equal(extractIdRange({ _id: { $gte: '10' } }), null);
});

void test('extractIdRange returns null for single-sided range with only $lte (no type check triggered)', () => {
  assert.equal(extractIdRange({ _id: { $lte: 100 } }), null);
});

void test('extractIdRange returns null for single-sided range with only $gt (no type check triggered)', () => {
  assert.equal(extractIdRange({ _id: { $gt: 'abc' } }), null);
});

void test('extractIdRange returns null for single-sided range with only $lt (no type check triggered)', () => {
  assert.equal(extractIdRange({ _id: { $lt: 50 } }), null);
});

void test('extractIdInclusion returns the ids for a simple _id $in filter', () => {
  assert.deepEqual(extractIdInclusion({ _id: { $in: ['a', 'b'] } }), [
    'a',
    'b',
  ]);
});

void test('extractIdInclusion accepts an operand at the maximum size', () => {
  const ids = makeIds(MAX_OPERAND_ARRAY_SIZE);
  assert.equal(extractIdInclusion({ _id: { $in: ids } })?.length, ids.length);
});

void test('extractIdInclusion throws ValidationError when the operand exceeds the maximum size', () => {
  const ids = makeIds(MAX_OPERAND_ARRAY_SIZE + 1);
  assert.throws(
    () => extractIdInclusion({ _id: { $in: ids } }),
    (error: unknown) =>
      error instanceof ValidationError &&
      error.message.includes('$in operand exceeds maximum of'),
  );
});

void test('extractIdInclusion throws ValidationError when the operand is not an array', () => {
  assert.throws(
    () => extractIdInclusion({ _id: { $in: 'a' } }),
    ValidationError,
  );
});

void test('extractIdInclusion returns null for an empty operand', () => {
  assert.equal(extractIdInclusion({ _id: { $in: [] } }), null);
});

void test('extractIdInclusion returns null for a non-string element', () => {
  assert.equal(extractIdInclusion({ _id: { $in: ['a', 1] } }), null);
});

void test('extractIdInclusion returns ids from a conjunctive filter', () => {
  assert.deepEqual(extractIdInclusion({ _id: { $in: ['a'] }, v: 1 }), ['a']);
});

void test('extractEqualityFields keeps an object-valued implicit equality', () => {
  const filter = { profile: { tier: 'pro' } };
  const result = extractEqualityFields(filter, pathCache);
  assert.deepEqual(result, { profile: { tier: 'pro' } });
  // Deep-cloned: the filter's object must not be aliased by the new document.
  assert.notEqual(result.profile, filter.profile);
});

void test('extractEqualityFields keeps an array-valued implicit equality', () => {
  const filter = { tags: ['a', 'b'] };
  const result = extractEqualityFields(filter, pathCache);
  assert.deepEqual(result, { tags: ['a', 'b'] });
  assert.notEqual(result.tags, filter.tags);
});

void test('extractEqualityFields keeps an object-valued explicit $eq', () => {
  const result = extractEqualityFields(
    { profile: { $eq: { tier: 'pro' } } },
    pathCache,
  );
  assert.deepEqual(result, { profile: { tier: 'pro' } });
});

void test('extractEqualityFields expands a dot path to an object value', () => {
  const result = extractEqualityFields(
    { 'meta.profile': { tier: 'pro' } },
    pathCache,
  );
  assert.deepEqual(result, { meta: { profile: { tier: 'pro' } } });
});

void test('extractEqualityFields still skips operator expressions with object operands', () => {
  const result = extractEqualityFields(
    { profile: { $ne: { tier: 'pro' } } },
    pathCache,
  );
  assert.deepEqual(result, {});
});
