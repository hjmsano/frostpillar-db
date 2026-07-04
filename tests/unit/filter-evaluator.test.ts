import assert from 'node:assert/strict';
import test from 'node:test';

import { ValidationError } from '../../src/errors.js';
import { createDatabaseCaches } from '../../src/internal/databaseCaches.js';
import { matchesFilter } from '../../src/internal/filterEvaluator.js';

const caches = createDatabaseCaches();

void test('matchesFilter treats undefined and empty filter as match-all', () => {
  const document = { _id: 'u1', name: 'Alice', age: 30 };

  assert.equal(matchesFilter(document, undefined, caches), true);
  assert.equal(matchesFilter(document, {}, caches), true);
});

void test('matchesFilter supports implicit equality and comparison operators', () => {
  const document = { _id: 'u1', name: 'Alice', age: 30, active: true };

  assert.equal(matchesFilter(document, { name: 'Alice' }, caches), true);
  assert.equal(matchesFilter(document, { age: { $eq: 30 } }, caches), true);
  assert.equal(
    matchesFilter(document, { age: { $gt: 29, $lte: 30 } }, caches),
    true,
  );
  assert.equal(matchesFilter(document, { age: { $lt: 30 } }, caches), false);
  assert.equal(
    matchesFilter(document, { active: { $gte: true } }, caches),
    true,
  );
});

void test('matchesFilter does not coerce mismatched types for comparisons', () => {
  const document = { _id: 'u1', age: '30' };

  assert.equal(matchesFilter(document, { age: { $gt: 20 } }, caches), false);
});

// Cross-type comparison returns false by design (mirrors MongoDB semantics).
// These tests are intentional guards: a future "fix" that adds coercion would
// break them, surfacing the intentional behavior change.
void test('cross-type comparisons return false for all ordering operators', () => {
  // numeric field, string operand
  const numericDoc = { _id: 'u1', age: 30 };
  assert.equal(
    matchesFilter(numericDoc, { age: { $gt: '20' } }, caches),
    false,
  );
  assert.equal(
    matchesFilter(numericDoc, { age: { $gte: '30' } }, caches),
    false,
  );
  assert.equal(
    matchesFilter(numericDoc, { age: { $lt: '50' } }, caches),
    false,
  );
  assert.equal(
    matchesFilter(numericDoc, { age: { $lte: '30' } }, caches),
    false,
  );

  // string field, numeric operand
  const stringDoc = { _id: 'u2', age: '30' };
  assert.equal(matchesFilter(stringDoc, { age: { $gt: 20 } }, caches), false);
  assert.equal(matchesFilter(stringDoc, { age: { $gte: 30 } }, caches), false);
  assert.equal(matchesFilter(stringDoc, { age: { $lt: 50 } }, caches), false);
  assert.equal(matchesFilter(stringDoc, { age: { $lte: 30 } }, caches), false);

  // same-type control: numeric field with numeric operand must still work
  assert.equal(matchesFilter(numericDoc, { age: { $gt: 20 } }, caches), true);
  assert.equal(matchesFilter(numericDoc, { age: { $gte: 30 } }, caches), true);
  assert.equal(matchesFilter(numericDoc, { age: { $lt: 50 } }, caches), true);
  assert.equal(matchesFilter(numericDoc, { age: { $lte: 30 } }, caches), true);
});

void test('matchesFilter supports inclusion and logical operators', () => {
  const document = { _id: 'u1', role: 'admin', age: 32, status: 'active' };

  assert.equal(
    matchesFilter(document, { role: { $in: ['admin', 'editor'] } }, caches),
    true,
  );
  assert.equal(
    matchesFilter(document, { role: { $nin: ['guest'] } }, caches),
    true,
  );
  assert.equal(
    matchesFilter(
      document,
      {
        $and: [{ age: { $gt: 20 } }, { status: 'active' }],
      },
      caches,
    ),
    true,
  );
  assert.equal(
    matchesFilter(
      document,
      {
        $or: [{ status: 'inactive' }, { role: 'admin' }],
      },
      caches,
    ),
    true,
  );
  assert.equal(
    matchesFilter(document, { age: { $not: { $gt: 40 } } }, caches),
    true,
  );
});

void test('matchesFilter supports regex and existence operators', () => {
  const document = {
    _id: 'u1',
    name: 'Alice',
    email: null,
    profile: { city: 'Tokyo' },
  };

  assert.equal(
    matchesFilter(document, { name: { $regex: /^ali/i } }, caches),
    true,
  );
  assert.equal(
    matchesFilter(document, { name: { $regex: '^Ali' } }, caches),
    true,
  );
  assert.equal(
    matchesFilter(document, { email: { $exists: true } }, caches),
    true,
  );
  assert.equal(
    matchesFilter(document, { 'profile.city': { $exists: true } }, caches),
    true,
  );
  assert.equal(
    matchesFilter(document, { 'profile.country': { $exists: false } }, caches),
    true,
  );
});

void test('matchesFilter throws ValidationError for invalid regex patterns', () => {
  const document = { _id: 'u1', name: 'Alice' };

  assert.throws(
    () => matchesFilter(document, { name: { $regex: '[' } }, caches),
    ValidationError,
  );
});

void test('matchesFilter rejects catastrophic backtracking in RegExp objects', () => {
  const document = { _id: 'u1', name: 'Alice' };

  assert.throws(
    () =>
      matchesFilter(
        document,
        { name: { $regex: new RegExp('(a+)+$') } },
        caches,
      ),
    ValidationError,
  );
});

void test('matchesFilter supports dot notation and handles non-object intermediates as no-match', () => {
  const document = {
    _id: 'u1',
    profile: { city: 'Tokyo' },
    age: 30,
  };

  assert.equal(
    matchesFilter(document, { 'profile.city': 'Tokyo' }, caches),
    true,
  );
  assert.equal(matchesFilter(document, { 'age.value': 30 }, caches), false);
});

void test('matchesFilter $nin returns true when field does not exist', () => {
  const document = { _id: 'u1', name: 'Alice' };

  assert.equal(
    matchesFilter(document, { role: { $nin: ['admin'] } }, caches),
    true,
  );
  assert.equal(
    matchesFilter(document, { role: { $in: ['admin'] } }, caches),
    false,
  );
});

// --- $in / $nin with array fields ---

void test('$in matches when document array field contains any operand value', () => {
  const document = { _id: 'u1', tags: ['a', 'b', 'c'] };

  assert.equal(
    matchesFilter(document, { tags: { $in: ['a', 'x'] } }, caches),
    true,
  );
  assert.equal(
    matchesFilter(document, { tags: { $in: ['x', 'y'] } }, caches),
    false,
  );
  assert.equal(matchesFilter(document, { tags: { $in: ['b'] } }, caches), true);
});

void test('$nin matches when document array field contains no operand value', () => {
  const document = { _id: 'u1', tags: ['a', 'b', 'c'] };

  assert.equal(
    matchesFilter(document, { tags: { $nin: ['x', 'y'] } }, caches),
    true,
  );
  assert.equal(
    matchesFilter(document, { tags: { $nin: ['a', 'x'] } }, caches),
    false,
  );
  assert.equal(
    matchesFilter(document, { tags: { $nin: ['a'] } }, caches),
    false,
  );
});

void test('$in matches array field with object elements', () => {
  const document = {
    _id: 'u1',
    items: [{ name: 'A' }, { name: 'B' }],
  };

  assert.equal(
    matchesFilter(document, { items: { $in: [{ name: 'A' }] } }, caches),
    true,
  );
  assert.equal(
    matchesFilter(document, { items: { $in: [{ name: 'C' }] } }, caches),
    false,
  );
});

void test('$in still works with scalar field values', () => {
  const document = { _id: 'u1', role: 'admin' };

  assert.equal(
    matchesFilter(document, { role: { $in: ['admin', 'editor'] } }, caches),
    true,
  );
  assert.equal(
    matchesFilter(document, { role: { $in: ['guest'] } }, caches),
    false,
  );
});

void test('matchesFilter throws ValidationError for unknown operators', () => {
  const document = { _id: 'u1', age: 30 };

  assert.throws(
    () => matchesFilter(document, { age: { $foo: 1 } }, caches),
    ValidationError,
  );
  assert.throws(
    () => matchesFilter(document, { $foo: [] }, caches),
    ValidationError,
  );
});
