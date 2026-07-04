import assert from 'node:assert/strict';
import test from 'node:test';

import { ValidationError } from '../../src/errors.js';
import { applyUpdateOperations } from '../../src/internal/updateApplier.js';

const pathCache = new Map<string, string[]>();

// --- cross-operator same-field deterministic order ---
// Application order: $set → $unset → $inc → $rename → $push → $pull → $addToSet

// $set + $inc

void test('$set + $inc on the same field applies set first then inc', () => {
  const source = { _id: 'u1', x: 0 };
  const result = applyUpdateOperations(
    source,
    {
      $set: { x: 5 },
      $inc: { x: 1 },
    },
    pathCache,
  );

  assert.equal(result.changed, true);
  assert.deepEqual(result.document, { _id: 'u1', x: 6 });
});

// $set + $rename

void test('$set + $rename on the same field applies set first then rename', () => {
  const source = { _id: 'u1', old: 10 };
  const result = applyUpdateOperations(
    source,
    {
      $set: { old: 99 },
      $rename: { old: 'new' },
    },
    pathCache,
  );

  assert.equal(result.changed, true);
  assert.deepEqual(result.document, { _id: 'u1', new: 99 });
});

// $set + $push

void test('$set + $push on the same field: set to array then push', () => {
  const source = { _id: 'u1', arr: ['old'] };
  const result = applyUpdateOperations(
    source,
    {
      $set: { arr: [1, 2] },
      $push: { arr: 3 },
    },
    pathCache,
  );

  assert.equal(result.changed, true);
  assert.deepEqual(result.document, { _id: 'u1', arr: [1, 2, 3] });
});

void test('$set + $push on the same field: set to non-array then push throws', () => {
  const source = { _id: 'u1', x: 'hello' };

  assert.throws(
    () =>
      applyUpdateOperations(
        source,
        {
          $set: { x: 'not-array' },
          $push: { x: 1 },
        },
        pathCache,
      ),
    ValidationError,
  );
});

// $set + $pull

void test('$set + $pull on the same field: set to array then pull', () => {
  const source = { _id: 'u1', arr: ['x'] };
  const result = applyUpdateOperations(
    source,
    {
      $set: { arr: [1, 2, 1, 3] },
      $pull: { arr: 1 },
    },
    pathCache,
  );

  assert.equal(result.changed, true);
  assert.deepEqual(result.document, { _id: 'u1', arr: [2, 3] });
});

// $set + $addToSet

void test('$set + $addToSet on the same field: set to array then addToSet new value', () => {
  const source = { _id: 'u1', arr: ['x'] };
  const result = applyUpdateOperations(
    source,
    {
      $set: { arr: [1, 2] },
      $addToSet: { arr: 3 },
    },
    pathCache,
  );

  assert.equal(result.changed, true);
  assert.deepEqual(result.document, { _id: 'u1', arr: [1, 2, 3] });
});

void test('$set + $addToSet on the same field: addToSet is no-op when value already present', () => {
  const source = { _id: 'u1', arr: ['x'] };
  const result = applyUpdateOperations(
    source,
    {
      $set: { arr: [1, 2] },
      $addToSet: { arr: 2 },
    },
    pathCache,
  );

  assert.equal(result.changed, true);
  assert.deepEqual(result.document, { _id: 'u1', arr: [1, 2] });
});

// $unset + $inc

void test('$unset + $inc on the same field: unset removes, inc re-creates with increment value', () => {
  const source = { _id: 'u1', x: 100 };
  const result = applyUpdateOperations(
    source,
    {
      $unset: { x: true },
      $inc: { x: 5 },
    },
    pathCache,
  );

  assert.equal(result.changed, true);
  assert.deepEqual(result.document, { _id: 'u1', x: 5 });
});

// $unset + $rename

void test('$unset + $rename on the same field: unset removes source, rename is no-op', () => {
  const source = { _id: 'u1', a: 'value' };
  const result = applyUpdateOperations(
    source,
    {
      $unset: { a: true },
      $rename: { a: 'b' },
    },
    pathCache,
  );

  assert.equal(result.changed, true);
  assert.deepEqual(result.document, { _id: 'u1' });
});

// $unset + $push

void test('$unset + $push on the same field: unset removes, push re-creates as array', () => {
  const source = { _id: 'u1', arr: [1, 2] };
  const result = applyUpdateOperations(
    source,
    {
      $unset: { arr: true },
      $push: { arr: 'x' },
    },
    pathCache,
  );

  assert.equal(result.changed, true);
  assert.deepEqual(result.document, { _id: 'u1', arr: ['x'] });
});

// $unset + $pull

void test('$unset + $pull on the same field: unset removes, pull is no-op on missing field', () => {
  const source = { _id: 'u1', arr: [1, 2, 3] };
  const result = applyUpdateOperations(
    source,
    {
      $unset: { arr: true },
      $pull: { arr: 1 },
    },
    pathCache,
  );

  assert.equal(result.changed, true);
  assert.deepEqual(result.document, { _id: 'u1' });
});

// $unset + $addToSet

void test('$unset + $addToSet on the same field: unset removes, addToSet re-creates as array', () => {
  const source = { _id: 'u1', arr: [1, 2] };
  const result = applyUpdateOperations(
    source,
    {
      $unset: { arr: true },
      $addToSet: { arr: 'x' },
    },
    pathCache,
  );

  assert.equal(result.changed, true);
  assert.deepEqual(result.document, { _id: 'u1', arr: ['x'] });
});

// $inc + $rename

void test('$inc + $rename on the same field applies inc first then rename', () => {
  const source = { _id: 'u1', counter: 10 };
  const result = applyUpdateOperations(
    source,
    {
      $inc: { counter: 5 },
      $rename: { counter: 'total' },
    },
    pathCache,
  );

  assert.equal(result.changed, true);
  assert.deepEqual(result.document, { _id: 'u1', total: 15 });
});

// $inc + array operators (type mismatch)

void test('$inc + $push on the same field: inc creates numeric, push throws on non-array', () => {
  const source = { _id: 'u1', x: 10 };

  assert.throws(
    () =>
      applyUpdateOperations(
        source,
        {
          $inc: { x: 1 },
          $push: { x: 'val' },
        },
        pathCache,
      ),
    ValidationError,
  );
});

void test('$inc + $pull on the same field: inc creates numeric, pull throws on non-array', () => {
  const source = { _id: 'u1', x: 10 };

  assert.throws(
    () =>
      applyUpdateOperations(
        source,
        {
          $inc: { x: 1 },
          $pull: { x: 'val' },
        },
        pathCache,
      ),
    ValidationError,
  );
});

void test('$inc + $addToSet on the same field: inc creates numeric, addToSet throws on non-array', () => {
  const source = { _id: 'u1', x: 10 };

  assert.throws(
    () =>
      applyUpdateOperations(
        source,
        {
          $inc: { x: 1 },
          $addToSet: { x: 'val' },
        },
        pathCache,
      ),
    ValidationError,
  );
});

// $push + $pull

void test('$push + $pull on the same field: push appends, then pull removes all matches', () => {
  const source = { _id: 'u1', arr: ['a', 'b'] };
  const result = applyUpdateOperations(
    source,
    {
      $push: { arr: 'a' },
      $pull: { arr: 'a' },
    },
    pathCache,
  );

  assert.equal(result.changed, true);
  assert.deepEqual(result.document, { _id: 'u1', arr: ['b'] });
});

void test('$push + $pull on the same field: push and pull different values', () => {
  const source = { _id: 'u1', arr: ['a', 'b'] };
  const result = applyUpdateOperations(
    source,
    {
      $push: { arr: 'c' },
      $pull: { arr: 'a' },
    },
    pathCache,
  );

  assert.equal(result.changed, true);
  assert.deepEqual(result.document, { _id: 'u1', arr: ['b', 'c'] });
});

// $push + $addToSet

void test('$push + $addToSet on the same field: push first, addToSet is no-op for same value', () => {
  const source = { _id: 'u1', arr: ['a'] };
  const result = applyUpdateOperations(
    source,
    {
      $push: { arr: 'b' },
      $addToSet: { arr: 'b' },
    },
    pathCache,
  );

  assert.equal(result.changed, true);
  assert.deepEqual(result.document, { _id: 'u1', arr: ['a', 'b'] });
});

void test('$push + $addToSet on the same field: different values both added', () => {
  const source = { _id: 'u1', arr: ['a'] };
  const result = applyUpdateOperations(
    source,
    {
      $push: { arr: 'b' },
      $addToSet: { arr: 'c' },
    },
    pathCache,
  );

  assert.equal(result.changed, true);
  assert.deepEqual(result.document, { _id: 'u1', arr: ['a', 'b', 'c'] });
});

// $pull + $addToSet

void test('$pull + $addToSet on the same field: pull removes, addToSet re-adds one', () => {
  const source = { _id: 'u1', arr: ['a', 'b', 'a'] };
  const result = applyUpdateOperations(
    source,
    {
      $pull: { arr: 'a' },
      $addToSet: { arr: 'a' },
    },
    pathCache,
  );

  assert.equal(result.changed, true);
  assert.deepEqual(result.document, { _id: 'u1', arr: ['b', 'a'] });
});

void test('$pull + $addToSet on the same field: pull and addToSet different values', () => {
  const source = { _id: 'u1', arr: ['a', 'b'] };
  const result = applyUpdateOperations(
    source,
    {
      $pull: { arr: 'a' },
      $addToSet: { arr: 'c' },
    },
    pathCache,
  );

  assert.equal(result.changed, true);
  assert.deepEqual(result.document, { _id: 'u1', arr: ['b', 'c'] });
});
