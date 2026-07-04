import assert from 'node:assert/strict';
import test from 'node:test';

import { ValidationError } from '../../src/errors.js';
import { createDatabaseCaches } from '../../src/internal/databaseCaches.js';
import { matchesFilter } from '../../src/internal/filterEvaluator.js';

const caches = createDatabaseCaches();

// --- $elemMatch ---

void test('$elemMatch matches primitive array element', () => {
  const document = { _id: 'u1', scores: [70, 85, 95] };

  assert.equal(
    matchesFilter(
      document,
      { scores: { $elemMatch: { $gt: 80, $lt: 90 } } },
      caches,
    ),
    true,
  );
});

void test('$elemMatch matches object array element', () => {
  const document = {
    _id: 'u1',
    items: [
      { name: 'A', qty: 10 },
      { name: 'B', qty: 3 },
    ],
  };

  assert.equal(
    matchesFilter(
      document,
      {
        items: { $elemMatch: { name: 'A', qty: { $gt: 5 } } },
      },
      caches,
    ),
    true,
  );
});

void test('$elemMatch returns false on non-array field', () => {
  const document = { _id: 'u1', scores: 'not-an-array' };

  assert.equal(
    matchesFilter(document, { scores: { $elemMatch: { $gt: 80 } } }, caches),
    false,
  );
});

void test('$elemMatch returns false when no element matches all conditions', () => {
  const document = { _id: 'u1', scores: [70, 95] };

  assert.equal(
    matchesFilter(
      document,
      { scores: { $elemMatch: { $gt: 80, $lt: 90 } } },
      caches,
    ),
    false,
  );
});

// --- $all ---

void test('$all matches when array contains all values', () => {
  const document = { _id: 'u1', tags: ['a', 'b', 'c'] };

  assert.equal(
    matchesFilter(document, { tags: { $all: ['a', 'b'] } }, caches),
    true,
  );
});

void test('$all returns false when missing a value', () => {
  const document = { _id: 'u1', tags: ['a', 'c'] };

  assert.equal(
    matchesFilter(document, { tags: { $all: ['a', 'b'] } }, caches),
    false,
  );
});

void test('$all returns false on non-array field', () => {
  const document = { _id: 'u1', tags: 'not-an-array' };

  assert.equal(
    matchesFilter(document, { tags: { $all: ['a'] } }, caches),
    false,
  );
});

void test('$all throws ValidationError for non-array operand', () => {
  const document = { _id: 'u1', tags: ['a'] };

  assert.throws(
    () => matchesFilter(document, { tags: { $all: 'not-array' } }, caches),
    ValidationError,
  );
});

void test('$all with empty array returns false (no vacuous truth)', () => {
  const document = { _id: 'u1', tags: ['a', 'b'] };

  assert.equal(matchesFilter(document, { tags: { $all: [] } }, caches), false);
});

// --- $all primitive fast-path ---

void test('$all primitive fast-path: numbers — all present', () => {
  const document = { _id: 'u1', values: [1, 2, 3, 4, 5] };

  assert.equal(
    matchesFilter(document, { values: { $all: [2, 4] } }, caches),
    true,
  );
});

void test('$all primitive fast-path: numbers — missing element', () => {
  const document = { _id: 'u1', values: [1, 2, 3] };

  assert.equal(
    matchesFilter(document, { values: { $all: [2, 99] } }, caches),
    false,
  );
});

void test('$all primitive fast-path: mixed primitive types', () => {
  const document = { _id: 'u1', values: [1, 'a', true, null] };

  assert.equal(
    matchesFilter(document, { values: { $all: [1, 'a'] } }, caches),
    true,
  );
});

void test('$all primitive fast-path: type coercion safety — 1 !== "1"', () => {
  const document = { _id: 'u1', values: [1, 2] };

  assert.equal(
    matchesFilter(document, { values: { $all: ['1'] } }, caches),
    false,
  );
});

void test('$all mixed array with objects falls back to deepEqual', () => {
  const document = { _id: 'u1', values: [{ x: 1 }, { x: 2 }] };

  assert.equal(
    matchesFilter(document, { values: { $all: [{ x: 1 }] } }, caches),
    true,
  );
});

void test('$all primitive fast-path: large array correctness', () => {
  const fieldArray = Array.from({ length: 1000 }, (_, i) => i);
  const document = { _id: 'u1', values: fieldArray };

  assert.equal(
    matchesFilter(document, { values: { $all: [0, 499, 999] } }, caches),
    true,
  );
  assert.equal(
    matchesFilter(document, { values: { $all: [0, 499, 1000] } }, caches),
    false,
  );
});

void test('$all primitive fast-path: NaN matches NaN (SameValueZero consistent with deepEqual)', () => {
  const document = { _id: 'u1', values: [NaN, 1, 2] };

  assert.equal(
    matchesFilter(document, { values: { $all: [NaN] } }, caches),
    true,
  );
});

void test('$all primitive fast-path: NaN not found when absent', () => {
  const document = { _id: 'u1', values: [1, 2, 3] };

  assert.equal(
    matchesFilter(document, { values: { $all: [NaN] } }, caches),
    false,
  );
});

// --- $size ---

void test('$size matches array length', () => {
  const document = { _id: 'u1', tags: ['a', 'b', 'c'] };

  assert.equal(matchesFilter(document, { tags: { $size: 3 } }, caches), true);
});

void test('$size returns false on wrong length', () => {
  const document = { _id: 'u1', tags: ['a', 'b'] };

  assert.equal(matchesFilter(document, { tags: { $size: 3 } }, caches), false);
});

void test('$size returns false on non-array field', () => {
  const document = { _id: 'u1', tags: 'not-an-array' };

  assert.equal(matchesFilter(document, { tags: { $size: 1 } }, caches), false);
});

void test('$size throws ValidationError for non-integer operand', () => {
  const document = { _id: 'u1', tags: ['a'] };

  assert.throws(
    () => matchesFilter(document, { tags: { $size: 2.5 } }, caches),
    ValidationError,
  );
});

void test('matchesFilter rejects reserved prototype-pollution keys', () => {
  const document = { _id: 'u1', name: 'Alice' };

  for (const key of ['__proto__', 'constructor', 'prototype']) {
    assert.throws(
      () => matchesFilter(document, { [key]: 'value' }, caches),
      ValidationError,
    );
  }
});

void test('matchesFilter rejects reserved keys nested in $and/$or', () => {
  const document = { _id: 'u1', name: 'Alice' };
  const protoFilter = Object.create(null) as Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/dot-notation
  protoFilter['__proto__'] = 'x';

  assert.throws(
    () => matchesFilter(document, { $and: [protoFilter] }, caches),
    ValidationError,
  );
  assert.throws(
    () => matchesFilter(document, { $or: [{ constructor: 'x' }] }, caches),
    ValidationError,
  );
});
