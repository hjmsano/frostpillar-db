import assert from 'node:assert/strict';
import test from 'node:test';

import { deepEqual } from '../../src/internal/deepEqual.js';

void test('deepEqual: identical primitives are equal', () => {
  assert.equal(deepEqual(1, 1), true);
  assert.equal(deepEqual('foo', 'foo'), true);
  assert.equal(deepEqual(true, true), true);
  assert.equal(deepEqual(false, false), true);
  assert.equal(deepEqual(0, 0), true);
  assert.equal(deepEqual('', ''), true);
});

void test('deepEqual: different primitives are not equal', () => {
  assert.equal(deepEqual(1, 2), false);
  assert.equal(deepEqual('foo', 'bar'), false);
  assert.equal(deepEqual(true, false), false);
  assert.equal(deepEqual(0, 1), false);
});

void test('deepEqual: null equals null', () => {
  assert.equal(deepEqual(null, null), true);
});

void test('deepEqual: null does not equal non-null', () => {
  assert.equal(deepEqual(null, 0), false);
  assert.equal(deepEqual(null, ''), false);
  assert.equal(deepEqual(null, false), false);
  assert.equal(deepEqual(null, {}), false);
  assert.equal(deepEqual(0, null), false);
});

void test('deepEqual: undefined equals undefined', () => {
  assert.equal(deepEqual(undefined, undefined), true);
});

void test('deepEqual: undefined does not equal null or other values', () => {
  assert.equal(deepEqual(undefined, null), false);
  assert.equal(deepEqual(undefined, 0), false);
  assert.equal(deepEqual(null, undefined), false);
});

void test('deepEqual: type mismatch returns false', () => {
  assert.equal(deepEqual(1, '1'), false);
  assert.equal(deepEqual(0, false), false);
  assert.equal(deepEqual(1, true), false);
});

void test('deepEqual: plain objects with same keys and values are equal', () => {
  assert.equal(deepEqual({ a: 1, b: 2 }, { a: 1, b: 2 }), true);
  assert.equal(deepEqual({}, {}), true);
  assert.equal(deepEqual({ x: { y: 3 } }, { x: { y: 3 } }), true);
});

void test('deepEqual: plain objects with different values are not equal', () => {
  assert.equal(deepEqual({ a: 1 }, { a: 2 }), false);
  assert.equal(deepEqual({ a: 1, b: 2 }, { a: 1 }), false);
  assert.equal(deepEqual({ a: 1 }, { a: 1, b: 2 }), false);
  assert.equal(deepEqual({ a: 1 }, { b: 1 }), false);
});

void test('deepEqual: nested objects are compared recursively', () => {
  assert.equal(
    deepEqual({ a: { b: { c: 42 } } }, { a: { b: { c: 42 } } }),
    true,
  );
  assert.equal(
    deepEqual({ a: { b: { c: 42 } } }, { a: { b: { c: 43 } } }),
    false,
  );
});

void test('deepEqual: arrays with same elements are equal', () => {
  assert.equal(deepEqual([], []), true);
  assert.equal(deepEqual([1, 2, 3], [1, 2, 3]), true);
  assert.equal(deepEqual(['a', 'b'], ['a', 'b']), true);
});

void test('deepEqual: arrays with different elements are not equal', () => {
  assert.equal(deepEqual([1, 2], [1, 3]), false);
  assert.equal(deepEqual([1, 2], [1, 2, 3]), false);
  assert.equal(deepEqual([1, 2, 3], [1, 2]), false);
  assert.equal(deepEqual([1], []), false);
});

void test('deepEqual: arrays of objects compared recursively', () => {
  assert.equal(deepEqual([{ a: 1 }, { b: 2 }], [{ a: 1 }, { b: 2 }]), true);
  assert.equal(deepEqual([{ a: 1 }, { b: 2 }], [{ a: 1 }, { b: 3 }]), false);
});

void test('deepEqual: array is not equal to plain object', () => {
  assert.equal(deepEqual([], {}), false);
  assert.equal(deepEqual({}, []), false);
  assert.equal(deepEqual([1], { 0: 1 }), false);
});

void test('deepEqual: Date objects with same time are equal', () => {
  const d1 = new Date('2024-01-01T00:00:00.000Z');
  const d2 = new Date('2024-01-01T00:00:00.000Z');
  assert.equal(deepEqual(d1, d2), true);
});

void test('deepEqual: Date objects with different times are not equal', () => {
  const d1 = new Date('2024-01-01T00:00:00.000Z');
  const d2 = new Date('2024-06-15T12:00:00.000Z');
  assert.equal(deepEqual(d1, d2), false);
});

void test('deepEqual: Date is not equal to a plain number even if same milliseconds', () => {
  const d = new Date('2024-01-01T00:00:00.000Z');
  assert.equal(deepEqual(d, d.getTime()), false);
});

void test('deepEqual: mixed nested structure (array inside object)', () => {
  assert.equal(
    deepEqual({ tags: ['a', 'b'], count: 2 }, { tags: ['a', 'b'], count: 2 }),
    true,
  );
  assert.equal(
    deepEqual({ tags: ['a', 'b'], count: 2 }, { tags: ['a', 'c'], count: 2 }),
    false,
  );
});

void test('deepEqual: object inside array inside object', () => {
  const a = {
    items: [
      { id: '1', val: 10 },
      { id: '2', val: 20 },
    ],
  };
  const b = {
    items: [
      { id: '1', val: 10 },
      { id: '2', val: 20 },
    ],
  };
  const c = {
    items: [
      { id: '1', val: 10 },
      { id: '2', val: 99 },
    ],
  };
  assert.equal(deepEqual(a, b), true);
  assert.equal(deepEqual(a, c), false);
});

void test('deepEqual: NaN equals NaN (strict equality semantics)', () => {
  assert.equal(deepEqual(NaN, NaN), true);
});

void test('deepEqual: +0 equals -0 (primitive === semantics)', () => {
  assert.equal(deepEqual(+0, -0), true);
});
