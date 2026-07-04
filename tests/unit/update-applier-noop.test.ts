import assert from 'node:assert/strict';
import test from 'node:test';

import { ValidationError } from '../../src/errors.js';
import { applyUpdateOperations } from '../../src/internal/updateApplier.js';

const pathCache = new Map<string, string[]>();

// --- No-op detection (bug-02) ---

void test('$set with same value is a no-op', () => {
  const source = { _id: 'u1', name: 'Alice' };
  const result = applyUpdateOperations(
    source,
    {
      $set: { name: 'Alice' },
    },
    pathCache,
  );

  assert.equal(result.changed, false);
  assert.deepEqual(result.document, { _id: 'u1', name: 'Alice' });
});

void test('$set with same nested value is a no-op', () => {
  const source = { _id: 'u1', profile: { city: 'Tokyo', age: 30 } };
  const result = applyUpdateOperations(
    source,
    {
      $set: { 'profile.city': 'Tokyo' },
    },
    pathCache,
  );

  assert.equal(result.changed, false);
});

void test('$set with same object value is a no-op', () => {
  const source = { _id: 'u1', meta: { x: 1, y: [2, 3] } };
  const result = applyUpdateOperations(
    source,
    {
      $set: { meta: { x: 1, y: [2, 3] } },
    },
    pathCache,
  );

  assert.equal(result.changed, false);
});

void test('$set mixed: one field same, one field different', () => {
  const source = { _id: 'u1', name: 'Alice', age: 30 };
  const result = applyUpdateOperations(
    source,
    {
      $set: { name: 'Alice', age: 31 },
    },
    pathCache,
  );

  assert.equal(result.changed, true);
  assert.deepEqual(result.document, { _id: 'u1', name: 'Alice', age: 31 });
});

void test('$inc by 0 on existing field is a no-op', () => {
  const source = { _id: 'u1', x: 5 };
  const result = applyUpdateOperations(
    source,
    {
      $inc: { x: 0 },
    },
    pathCache,
  );

  assert.equal(result.changed, false);
  assert.deepEqual(result.document, { _id: 'u1', x: 5 });
});

void test('$inc by 0 on missing field still creates it', () => {
  const source = { _id: 'u1', name: 'Alice' };
  const result = applyUpdateOperations(
    source,
    {
      $inc: { x: 0 },
    },
    pathCache,
  );

  assert.equal(result.changed, true);
  assert.deepEqual(result.document, { _id: 'u1', name: 'Alice', x: 0 });
});

void test('$addToSet of already-present value is a no-op (unchanged flag)', () => {
  const source = { _id: 'u1', tags: ['a', 'b'] };
  const result = applyUpdateOperations(
    source,
    {
      $addToSet: { tags: 'b' },
    },
    pathCache,
  );

  assert.equal(result.changed, false);
  assert.deepEqual(result.document, { _id: 'u1', tags: ['a', 'b'] });
});

// --- bug-06: $inc rejects non-finite values ---

void test('$inc rejects Infinity', () => {
  const source = { _id: 'u1', x: 1 };
  assert.throws(
    () => applyUpdateOperations(source, { $inc: { x: Infinity } }, pathCache),
    ValidationError,
  );
});

void test('$inc rejects -Infinity', () => {
  const source = { _id: 'u1', x: 1 };
  assert.throws(
    () => applyUpdateOperations(source, { $inc: { x: -Infinity } }, pathCache),
    ValidationError,
  );
});

void test('$inc rejects NaN', () => {
  const source = { _id: 'u1', x: 1 };
  assert.throws(
    () => applyUpdateOperations(source, { $inc: { x: NaN } }, pathCache),
    ValidationError,
  );
});

void test('$inc rejects result that would produce Infinity', () => {
  const source = { _id: 'u1', x: Number.MAX_VALUE };
  assert.throws(
    () =>
      applyUpdateOperations(
        source,
        { $inc: { x: Number.MAX_VALUE } },
        pathCache,
      ),
    ValidationError,
  );
});
