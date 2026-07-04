// Defensive regression tests for frostpillar-db's input-validation layer.
// The hostile-looking inputs below are fixtures that MUST be rejected (or
// safely handled) by the library; they verify the array-length, operand-size,
// and aggregate-count guards in src/internal/ continue to block these shapes.
// No code here produces a usable payload.

import assert from 'node:assert/strict';
import test from 'node:test';

import { ValidationError } from '../../src/errors.js';
import { createDatabaseCaches } from '../../src/internal/databaseCaches.js';
import { matchesFilter } from '../../src/internal/filterEvaluator.js';
import { applyUpdateOperations } from '../../src/internal/updateApplier.js';
import {
  computeDistinct,
  computeGroupBy,
} from '../../src/internal/aggregationUtils.js';
import type { FrostpillarStoredDocument } from '../../src/types.js';
import {
  MAX_ARRAY_LENGTH,
  MAX_DISTINCT_COUNT,
  MAX_GROUP_COUNT,
  MAX_OPERAND_ARRAY_SIZE,
} from '../../src/internal/limits.js';

const caches = createDatabaseCaches();
const pathCache = caches.pathCache;

// --- #4 $push / $addToSet array length limits ---

void test('$push rejects when array reaches maximum length', () => {
  const largeArray = Array.from({ length: MAX_ARRAY_LENGTH }, (_, i) => i);
  const document = {
    _id: 'u1',
    tags: largeArray,
  } as FrostpillarStoredDocument<{ _id: string; tags: number[] }>;

  assert.throws(
    () =>
      applyUpdateOperations(
        document,
        { $push: { tags: 'overflow' } },
        pathCache,
      ),
    ValidationError,
  );
});

void test('$push allows when array is below maximum length', () => {
  const document = {
    _id: 'u1',
    tags: ['a', 'b'],
  } as FrostpillarStoredDocument<{ _id: string; tags: string[] }>;

  const result = applyUpdateOperations(
    document,
    { $push: { tags: 'c' } },
    pathCache,
  );
  assert.equal(result.changed, true);
  assert.deepEqual((result.document as Record<string, unknown>).tags, [
    'a',
    'b',
    'c',
  ]);
});

void test('$addToSet rejects when array reaches maximum length', () => {
  const largeArray = Array.from({ length: MAX_ARRAY_LENGTH }, (_, i) => i);
  const document = {
    _id: 'u1',
    tags: largeArray,
  } as FrostpillarStoredDocument<{ _id: string; tags: number[] }>;

  assert.throws(
    () =>
      applyUpdateOperations(
        document,
        { $addToSet: { tags: 'overflow' } },
        pathCache,
      ),
    ValidationError,
  );
});

void test('$addToSet allows duplicate (no growth) even at max length', () => {
  const largeArray = Array.from({ length: MAX_ARRAY_LENGTH }, (_, i) => i);
  const document = {
    _id: 'u1',
    tags: largeArray,
  } as FrostpillarStoredDocument<{ _id: string; tags: number[] }>;

  const result = applyUpdateOperations(
    document,
    { $addToSet: { tags: 0 } },
    pathCache,
  );
  assert.equal(result.changed, false);
});

// --- #5 $in / $nin / $all operand size limits ---

void test('$in rejects operand exceeding maximum size', () => {
  const document = { _id: 'u1', status: 'active' };
  const largeOperand = Array.from(
    { length: MAX_OPERAND_ARRAY_SIZE + 1 },
    (_, i) => i,
  );

  assert.throws(
    () => matchesFilter(document, { status: { $in: largeOperand } }, caches),
    ValidationError,
  );
});

void test('$nin rejects operand exceeding maximum size', () => {
  const document = { _id: 'u1', status: 'active' };
  const largeOperand = Array.from(
    { length: MAX_OPERAND_ARRAY_SIZE + 1 },
    (_, i) => i,
  );

  assert.throws(
    () => matchesFilter(document, { status: { $nin: largeOperand } }, caches),
    ValidationError,
  );
});

void test('$all rejects operand exceeding maximum size', () => {
  const document = { _id: 'u1', tags: ['a', 'b'] };
  const largeOperand = Array.from(
    { length: MAX_OPERAND_ARRAY_SIZE + 1 },
    (_, i) => String(i),
  );

  assert.throws(
    () => matchesFilter(document, { tags: { $all: largeOperand } }, caches),
    ValidationError,
  );
});

void test('$in allows operand within size limit', () => {
  const document = { _id: 'u1', status: 'active' };

  assert.equal(
    matchesFilter(document, { status: { $in: ['active', 'pending'] } }, caches),
    true,
  );
});

// --- #6 groupBy group count limit ---

void test('groupBy rejects when group count exceeds maximum', () => {
  const documents = Array.from({ length: MAX_GROUP_COUNT + 1 }, (_, i) => ({
    _id: `d${String(i)}`,
    key: `unique-${String(i)}`,
  }));

  assert.throws(
    () =>
      computeGroupBy(documents, 'key', { total: { $count: true } }, pathCache),
    ValidationError,
  );
});

void test('groupBy allows groups within limit', () => {
  const documents = [
    { _id: 'd1', dept: 'eng' },
    { _id: 'd2', dept: 'eng' },
    { _id: 'd3', dept: 'design' },
  ];

  const result = computeGroupBy(
    documents,
    'dept',
    { total: { $count: true } },
    pathCache,
  );
  assert.equal(result.length, 2);
});

// --- #7 distinct count limit ---

void test('distinct rejects when unique count exceeds maximum', () => {
  const documents = Array.from({ length: MAX_DISTINCT_COUNT + 1 }, (_, i) => ({
    _id: `d${String(i)}`,
    value: i,
  }));

  assert.throws(
    () => computeDistinct(documents, 'value', pathCache),
    ValidationError,
  );
});

void test('distinct allows values within limit', () => {
  const documents = [
    { _id: 'd1', color: 'red' },
    { _id: 'd2', color: 'blue' },
    { _id: 'd3', color: 'red' },
  ];

  const result = computeDistinct(documents, 'color', pathCache);
  assert.deepEqual(result, ['red', 'blue']);
});
