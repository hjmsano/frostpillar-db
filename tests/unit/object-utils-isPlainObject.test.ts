import assert from 'node:assert/strict';
import test from 'node:test';

import { isPlainObject } from '../../src/internal/objectUtils.js';

void test('isPlainObject accepts object literals and null-prototype objects', () => {
  assert.equal(isPlainObject({}), true);
  assert.equal(isPlainObject({ a: 1 }), true);
  assert.equal(isPlainObject(Object.create(null)), true);
});

void test('isPlainObject rejects primitives, null, and arrays', () => {
  assert.equal(isPlainObject(null), false);
  assert.equal(isPlainObject(undefined), false);
  assert.equal(isPlainObject('x'), false);
  assert.equal(isPlainObject(1), false);
  assert.equal(isPlainObject([]), false);
});

void test('isPlainObject rejects class instances', () => {
  class Point {
    x = 1;
  }
  assert.equal(isPlainObject(new Date()), false);
  assert.equal(isPlainObject(new Map()), false);
  assert.equal(isPlainObject(new Set()), false);
  assert.equal(isPlainObject(new Point()), false);
});

void test('isPlainObject rejects objects whose keys live on the prototype', () => {
  const inherited: unknown = Object.create({ _id: 'missing' });
  assert.equal(isPlainObject(inherited), false);
});
