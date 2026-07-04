import assert from 'node:assert/strict';
import test from 'node:test';

import { hasAnyKey, isEmptyFilter } from '../../src/internal/objectUtils.js';

void test('hasAnyKey returns false for empty object', () => {
  assert.equal(hasAnyKey({}), false);
});

void test('hasAnyKey returns true for object with keys', () => {
  assert.equal(hasAnyKey({ a: 1 }), true);
});

void test('hasAnyKey ignores inherited properties', () => {
  const obj: Record<string, unknown> = Object.create({
    inherited: true,
  }) as Record<string, unknown>;
  assert.equal(hasAnyKey(obj), false);
});

void test('hasAnyKey returns true when own property exists alongside inherited', () => {
  const obj: Record<string, unknown> = Object.create({
    inherited: true,
  }) as Record<string, unknown>;
  obj.own = 1;
  assert.equal(hasAnyKey(obj), true);
});

void test('isEmptyFilter returns true for undefined', () => {
  assert.equal(isEmptyFilter(undefined), true);
});

void test('isEmptyFilter returns true for empty object', () => {
  assert.equal(isEmptyFilter({}), true);
});

void test('isEmptyFilter returns false for non-empty filter', () => {
  assert.equal(isEmptyFilter({ name: 'test' }), false);
});
