import assert from 'node:assert/strict';
import test from 'node:test';

import { ValidationError } from '../../src/errors.js';
import { applyUpdateOperations } from '../../src/internal/updateApplier.js';

const pathCache = new Map<string, string[]>();

// --- $push ---

void test('$push appends value to existing array', () => {
  const source = { _id: 'u1', tags: ['a'] };
  const result = applyUpdateOperations(
    source,
    {
      $push: { tags: 'b' },
    },
    pathCache,
  );

  assert.equal(result.changed, true);
  assert.deepEqual(result.document, { _id: 'u1', tags: ['a', 'b'] });
});

void test('$push creates array if field missing', () => {
  const source = { _id: 'u1', name: 'Alice' };
  const result = applyUpdateOperations(
    source,
    {
      $push: { tags: 'a' },
    },
    pathCache,
  );

  assert.equal(result.changed, true);
  assert.deepEqual(result.document, { _id: 'u1', name: 'Alice', tags: ['a'] });
});

void test('$push throws on non-array field', () => {
  const source = { _id: 'u1', tags: 'string' };

  assert.throws(
    () =>
      applyUpdateOperations(
        source,
        {
          $push: { tags: 'a' },
        },
        pathCache,
      ),
    ValidationError,
  );
});

void test('$push with dot notation', () => {
  const source = { _id: 'u1', meta: { tags: ['x'] } };
  const result = applyUpdateOperations(
    source,
    {
      $push: { 'meta.tags': 'y' },
    },
    pathCache,
  );

  assert.equal(result.changed, true);
  assert.deepEqual(result.document, { _id: 'u1', meta: { tags: ['x', 'y'] } });
});

// --- $pull ---

void test('$pull removes all matching values', () => {
  const source = { _id: 'u1', tags: ['a', 'b', 'a'] };
  const result = applyUpdateOperations(
    source,
    {
      $pull: { tags: 'a' },
    },
    pathCache,
  );

  assert.equal(result.changed, true);
  assert.deepEqual(result.document, { _id: 'u1', tags: ['b'] });
});

void test('$pull is no-op on missing field', () => {
  const source = { _id: 'u1', name: 'Alice' };
  const result = applyUpdateOperations(
    source,
    {
      $pull: { tags: 'a' },
    },
    pathCache,
  );

  assert.equal(result.changed, false);
  assert.deepEqual(result.document, { _id: 'u1', name: 'Alice' });
});

void test('$pull is no-op when element does not exist in array', () => {
  const source = { _id: 'u1', tags: ['a', 'b', 'c'] };
  const result = applyUpdateOperations(
    source,
    {
      $pull: { tags: 'z' },
    },
    pathCache,
  );

  assert.equal(result.changed, false);
  assert.deepEqual(result.document, { _id: 'u1', tags: ['a', 'b', 'c'] });
});

void test('$pull throws on non-array field', () => {
  const source = { _id: 'u1', tags: 42 };

  assert.throws(
    () =>
      applyUpdateOperations(
        source,
        {
          $pull: { tags: 'a' },
        },
        pathCache,
      ),
    ValidationError,
  );
});

void test('$pull with deep equality', () => {
  const source = { _id: 'u1', items: [{ x: 1 }, { x: 2 }, { x: 1 }] };
  const result = applyUpdateOperations(
    source,
    {
      $pull: { items: { x: 1 } },
    },
    pathCache,
  );

  assert.equal(result.changed, true);
  assert.deepEqual(result.document, { _id: 'u1', items: [{ x: 2 }] });
});

// --- $addToSet ---

void test('$addToSet adds value if not present', () => {
  const source = { _id: 'u1', tags: ['a'] };
  const result = applyUpdateOperations(
    source,
    {
      $addToSet: { tags: 'b' },
    },
    pathCache,
  );

  assert.equal(result.changed, true);
  assert.deepEqual(result.document, { _id: 'u1', tags: ['a', 'b'] });
});

void test('$addToSet no-op if value already exists', () => {
  const source = { _id: 'u1', tags: ['a', 'b'] };
  const result = applyUpdateOperations(
    source,
    {
      $addToSet: { tags: 'a' },
    },
    pathCache,
  );

  assert.equal(result.changed, false);
  assert.deepEqual(result.document, { _id: 'u1', tags: ['a', 'b'] });
});

void test('$addToSet creates array if field missing', () => {
  const source = { _id: 'u1', name: 'Alice' };
  const result = applyUpdateOperations(
    source,
    {
      $addToSet: { tags: 'x' },
    },
    pathCache,
  );

  assert.equal(result.changed, true);
  assert.deepEqual(result.document, { _id: 'u1', name: 'Alice', tags: ['x'] });
});

void test('$addToSet throws on non-array field', () => {
  const source = { _id: 'u1', tags: 'string' };

  assert.throws(
    () =>
      applyUpdateOperations(
        source,
        {
          $addToSet: { tags: 'a' },
        },
        pathCache,
      ),
    ValidationError,
  );
});
