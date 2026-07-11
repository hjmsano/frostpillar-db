import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cloneAccumulatorValue,
  cloneDocument,
} from '../../src/internal/objectUtils.js';

void test('cloneDocument: primitives are returned as-is', () => {
  assert.equal(cloneDocument(42), 42);
  assert.equal(cloneDocument('hello'), 'hello');
  assert.equal(cloneDocument(true), true);
  assert.equal(cloneDocument(false), false);
  assert.equal(cloneDocument(null), null);
});

void test('cloneDocument: undefined is returned as-is', () => {
  assert.equal(cloneDocument(undefined), undefined);
});

void test('cloneDocument: plain object is deep-cloned', () => {
  const original = { a: 1, b: 'two', c: true };
  const cloned = cloneDocument(original);
  assert.deepEqual(cloned, original);
  assert.notEqual(cloned, original);
});

void test('cloneDocument: nested objects are deep-cloned', () => {
  const original = { a: { b: { c: 3 } } };
  const cloned = cloneDocument(original);
  assert.deepEqual(cloned, original);
  assert.notEqual(cloned, original);
  assert.notEqual(cloned.a, original.a);
  assert.notEqual(cloned.a.b, original.a.b);
});

void test('cloneDocument: arrays are deep-cloned', () => {
  const original = [1, 'two', true, null];
  const cloned = cloneDocument(original);
  assert.deepEqual(cloned, original);
  assert.notEqual(cloned, original);
});

void test('cloneDocument: nested arrays within objects are deep-cloned', () => {
  const original = { tags: ['a', 'b'], nested: { items: [1, 2, 3] } };
  const cloned = cloneDocument(original);
  assert.deepEqual(cloned, original);
  assert.notEqual(cloned, original);
  assert.notEqual(cloned.tags, original.tags);
  assert.notEqual(cloned.nested.items, original.nested.items);
});

void test('cloneDocument: objects within arrays are deep-cloned', () => {
  const original = [{ a: 1 }, { b: 2 }];
  const cloned = cloneDocument(original);
  assert.deepEqual(cloned, original);
  assert.notEqual(cloned[0], original[0]);
  assert.notEqual(cloned[1], original[1]);
});

void test('cloneDocument: empty object and array', () => {
  assert.deepEqual(cloneDocument({}), {});
  assert.deepEqual(cloneDocument([]), []);
  assert.notEqual(cloneDocument({}), {});
  assert.notEqual(cloneDocument([]), []);
});

void test('cloneDocument: null values in objects are preserved', () => {
  const original = { a: null, b: { c: null } };
  const cloned = cloneDocument(original);
  assert.deepEqual(cloned, original);
  assert.equal(cloned.a, null);
  assert.equal(cloned.b.c, null);
});

void test('cloneDocument: deeply nested structure', () => {
  const original = {
    level1: {
      level2: {
        level3: {
          level4: {
            value: 'deep',
            arr: [{ nested: true }],
          },
        },
      },
    },
  };
  const cloned = cloneDocument(original);
  assert.deepEqual(cloned, original);
  assert.notEqual(
    cloned.level1.level2.level3.level4,
    original.level1.level2.level3.level4,
  );
  assert.notEqual(
    cloned.level1.level2.level3.level4.arr[0],
    original.level1.level2.level3.level4.arr[0],
  );
});

void test('cloneDocument: mutation of clone does not affect original', () => {
  const original = { a: 1, b: { c: 2 }, d: [3, 4] };
  const cloned = cloneDocument(original);
  (cloned as Record<string, unknown>).a = 999;
  (cloned.b as Record<string, unknown>).c = 888;
  cloned.d.push(777);
  assert.equal(original.a, 1);
  assert.equal(original.b.c, 2);
  assert.deepEqual(original.d, [3, 4]);
});

void test('cloneDocument: typical stored document with _id', () => {
  const original = {
    _id: 'abc123',
    name: 'test',
    metadata: { created: 'today' },
    tags: ['x'],
  };
  const cloned = cloneDocument(original);
  assert.deepEqual(cloned, original);
  assert.notEqual(cloned, original);
  assert.notEqual(cloned.metadata, original.metadata);
  assert.notEqual(cloned.tags, original.tags);
});

void test('cloneDocument: __proto__ key is safely skipped', () => {
  const input = JSON.parse(
    '{"__proto__": {"polluted": true}, "safe": 1}',
  ) as Record<string, unknown>;
  const cloned = cloneDocument(input);
  assert.equal(cloned.safe, 1);
  assert.equal(Object.getPrototypeOf(cloned), Object.prototype);
  const probe = {} as Record<string, unknown>;
  assert.equal(probe.polluted, undefined);
});

// ---------------------------------------------------------------------------
// cloneAccumulatorValue (ADR-021) -- primitives pass through, objects/arrays
// are deep-cloned. It is a thin named-export alias of cloneDocument, reused
// by $first/$last (ADR-021) and $push/$addToSet (ADR-023, PR 6).
// ---------------------------------------------------------------------------

void test('cloneAccumulatorValue: primitives and null pass through unchanged', () => {
  assert.equal(cloneAccumulatorValue(42), 42);
  assert.equal(cloneAccumulatorValue('hello'), 'hello');
  assert.equal(cloneAccumulatorValue(true), true);
  assert.equal(cloneAccumulatorValue(false), false);
  assert.equal(cloneAccumulatorValue(null), null);
  assert.equal(cloneAccumulatorValue(undefined), undefined);
});

void test('cloneAccumulatorValue: objects are deep-cloned, not passed by reference', () => {
  const original = { a: 1, nested: { b: 2 } };
  const cloned = cloneAccumulatorValue(original) as typeof original;
  assert.deepEqual(cloned, original);
  assert.notEqual(cloned, original);
  assert.notEqual(cloned.nested, original.nested);

  cloned.nested.b = 999;
  assert.equal(original.nested.b, 2);
});

void test('cloneAccumulatorValue: arrays are deep-cloned, not passed by reference', () => {
  const original = [1, { x: 'y' }, [2, 3]];
  const cloned = cloneAccumulatorValue(original) as typeof original;
  assert.deepEqual(cloned, original);
  assert.notEqual(cloned, original);
  assert.notEqual(cloned[1], original[1]);

  cloned.push(4);
  assert.equal(original.length, 3);
});
