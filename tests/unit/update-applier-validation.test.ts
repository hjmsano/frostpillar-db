import assert from 'node:assert/strict';
import test from 'node:test';

import { ValidationError } from '../../src/errors.js';
import { applyUpdateOperations } from '../../src/internal/updateApplier.js';

const pathCache = new Map<string, string[]>();

// --- bug-06: $set value validation ---

void test('$set rejects Infinity value', () => {
  const source = { _id: 'u1', x: 1 };
  assert.throws(
    () => applyUpdateOperations(source, { $set: { x: Infinity } }, pathCache),
    ValidationError,
  );
});

void test('$set rejects self-referential array value', () => {
  const source = { _id: 'u1', x: 1 };
  const arr: unknown[] = [1];
  arr.push(arr);
  assert.throws(
    () => applyUpdateOperations(source, { $set: { x: arr } }, pathCache),
    ValidationError,
  );
});

void test('$set rejects -Infinity value', () => {
  const source = { _id: 'u1', x: 1 };
  assert.throws(
    () => applyUpdateOperations(source, { $set: { x: -Infinity } }, pathCache),
    ValidationError,
  );
});

void test('$set rejects NaN value', () => {
  const source = { _id: 'u1', x: 1 };
  assert.throws(
    () => applyUpdateOperations(source, { $set: { x: NaN } }, pathCache),
    ValidationError,
  );
});

void test('$set rejects BigInt value', () => {
  const source = { _id: 'u1', x: 1 };
  assert.throws(
    () => applyUpdateOperations(source, { $set: { x: BigInt(42) } }, pathCache),
    ValidationError,
  );
});

void test('$set rejects Date instance', () => {
  const source = { _id: 'u1', x: 1 };
  assert.throws(
    () => applyUpdateOperations(source, { $set: { x: new Date() } }, pathCache),
    ValidationError,
  );
});

void test('$set rejects Map instance', () => {
  const source = { _id: 'u1', x: 1 };
  assert.throws(
    () => applyUpdateOperations(source, { $set: { x: new Map() } }, pathCache),
    ValidationError,
  );
});

void test('$set rejects reserved key in nested object', () => {
  const source = { _id: 'u1', x: 1 };
  assert.throws(
    () =>
      applyUpdateOperations(
        source,
        {
          $set: { meta: { constructor: 'bad' } },
        },
        pathCache,
      ),
    ValidationError,
  );
});

void test('$set rejects non-finite number in nested object', () => {
  const source = { _id: 'u1', x: 1 };
  assert.throws(
    () =>
      applyUpdateOperations(
        source,
        {
          $set: { meta: { nested: Infinity } },
        },
        pathCache,
      ),
    ValidationError,
  );
});

void test('$set rejects non-finite number in array', () => {
  const source = { _id: 'u1', x: 1 };
  assert.throws(
    () =>
      applyUpdateOperations(
        source,
        { $set: { arr: [1, Infinity, 3] } },
        pathCache,
      ),
    ValidationError,
  );
});

void test('$set accepts valid values (string, number, boolean, null, array, object)', () => {
  const source = { _id: 'u1' };
  const result = applyUpdateOperations(
    source,
    {
      $set: {
        s: 'hello',
        n: 42,
        b: true,
        nil: null,
        arr: [1, 'two', { three: 3 }],
        obj: { nested: { deep: true } },
      },
    },
    pathCache,
  );

  assert.equal(result.changed, true);
  assert.deepEqual(result.document, {
    _id: 'u1',
    s: 'hello',
    n: 42,
    b: true,
    nil: null,
    arr: [1, 'two', { three: 3 }],
    obj: { nested: { deep: true } },
  });
});

// --- bug-06: $push value validation ---

void test('$push rejects Infinity value', () => {
  const source = { _id: 'u1', arr: [1] };
  assert.throws(
    () =>
      applyUpdateOperations(source, { $push: { arr: Infinity } }, pathCache),
    ValidationError,
  );
});

void test('$push rejects non-plain object value', () => {
  const source = { _id: 'u1', arr: [1] };
  assert.throws(
    () =>
      applyUpdateOperations(source, { $push: { arr: new Date() } }, pathCache),
    ValidationError,
  );
});

void test('$push rejects BigInt value', () => {
  const source = { _id: 'u1', arr: [1] };
  assert.throws(
    () =>
      applyUpdateOperations(source, { $push: { arr: BigInt(1) } }, pathCache),
    ValidationError,
  );
});

// --- bug-06: $addToSet value validation ---

void test('$addToSet rejects Infinity value', () => {
  const source = { _id: 'u1', arr: [1] };
  assert.throws(
    () =>
      applyUpdateOperations(
        source,
        { $addToSet: { arr: Infinity } },
        pathCache,
      ),
    ValidationError,
  );
});

void test('$addToSet rejects non-plain object value', () => {
  const source = { _id: 'u1', arr: [1] };
  assert.throws(
    () =>
      applyUpdateOperations(
        source,
        { $addToSet: { arr: new Map() } },
        pathCache,
      ),
    ValidationError,
  );
});
