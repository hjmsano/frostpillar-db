import assert from 'node:assert/strict';
import test from 'node:test';

import { ValidationError } from '../../src/errors.js';
import { operandAllPrimitiveCache } from '../../src/internal/filterCache.js';
import { createDatabaseCaches } from '../../src/internal/databaseCaches.js';
import { matchesFilter } from '../../src/internal/filterEvaluator.js';
import {
  getInclusionSet,
  getOperandAllPrimitive,
  isOperatorExpression,
} from '../../src/internal/filterOperatorEvaluators.js';

void test('isOperatorExpression returns false for non-object values', () => {
  assert.equal(isOperatorExpression(null), false);
  assert.equal(isOperatorExpression(undefined), false);
  assert.equal(isOperatorExpression(42), false);
  assert.equal(isOperatorExpression('string'), false);
  assert.equal(isOperatorExpression(true), false);
  assert.equal(isOperatorExpression([]), false);
});

void test('isOperatorExpression returns false for empty object', () => {
  assert.equal(isOperatorExpression({}), false);
});

void test('isOperatorExpression returns false for object with no operator keys', () => {
  assert.equal(isOperatorExpression({ name: 'Alice', age: 30 }), false);
});

void test('isOperatorExpression returns true for object with all operator keys', () => {
  assert.equal(isOperatorExpression({ $gt: 10 }), true);
  assert.equal(isOperatorExpression({ $gt: 10, $lt: 20 }), true);
});

void test('isOperatorExpression throws ValidationError when mixing operator and non-operator keys', () => {
  assert.throws(
    () => isOperatorExpression({ $gt: 10, name: 'Alice' }),
    ValidationError,
  );
});

void test('isOperatorExpression returns true for single operator', () => {
  assert.equal(isOperatorExpression({ $eq: 'test' }), true);
});

void test('isOperatorExpression correctly detects $ prefix on various operators', () => {
  assert.equal(isOperatorExpression({ $in: [1, 2], $nin: [3] }), true);
});

void test('isOperatorExpression returns true for bare $ key', () => {
  assert.equal(isOperatorExpression({ $: 1 }), true);
});

void test('isOperatorExpression returns false for empty-string key', () => {
  assert.equal(isOperatorExpression({ '': 'value' }), false);
});

void test('isOperatorExpression does not iterate over inherited prototype properties', () => {
  const proto = { $inherited: 'value' };
  const obj = Object.create(proto) as Record<string, unknown>;
  obj.name = 'Alice';

  assert.equal(isOperatorExpression(obj), false);
});

// --- getOperandAllPrimitive ---

void test('getOperandAllPrimitive returns true for an all-primitive array', () => {
  const operand: unknown[] = [1, 'hello', true, null, undefined];
  assert.equal(getOperandAllPrimitive(operand), true);
});

void test('getOperandAllPrimitive returns false for an array with a non-primitive element', () => {
  const operand: unknown[] = [1, { name: 'A' }, 'x'];
  assert.equal(getOperandAllPrimitive(operand), false);
});

void test('getOperandAllPrimitive returns false when array contains a nested array', () => {
  const operand: unknown[] = [1, [2, 3]];
  assert.equal(getOperandAllPrimitive(operand), false);
});

void test('getOperandAllPrimitive returns true for an empty array', () => {
  const operand: unknown[] = [];
  assert.equal(getOperandAllPrimitive(operand), true);
});

void test('getOperandAllPrimitive populates the cache on first call', () => {
  const operand: unknown[] = [10, 20, 30];
  assert.equal(operandAllPrimitiveCache.has(operand), false);
  getOperandAllPrimitive(operand);
  assert.equal(operandAllPrimitiveCache.has(operand), true);
  assert.equal(operandAllPrimitiveCache.get(operand)?.value, true);
});

void test('getOperandAllPrimitive returns the cached result on subsequent calls', () => {
  const operand: unknown[] = ['a', 'b', 'c'];
  const first = getOperandAllPrimitive(operand);
  const second = getOperandAllPrimitive(operand);
  assert.equal(first, true);
  assert.equal(second, true);
  assert.equal(operandAllPrimitiveCache.get(operand)?.value, true);
});

void test('getOperandAllPrimitive caches false for mixed-type arrays', () => {
  const operand: unknown[] = ['x', { key: 'val' }];
  getOperandAllPrimitive(operand);
  assert.equal(operandAllPrimitiveCache.get(operand)?.value, false);
});

// --- length-based cache invalidation (B3 bug fix) ---

void test('getInclusionSet rebuilds the Set after the operand length changes', () => {
  const ops: unknown[] = ['x'];
  const s1 = getInclusionSet(ops);
  assert.equal(s1.has('x'), true);
  assert.equal(s1.has('y'), false);
  ops.push('y');
  const s2 = getInclusionSet(ops);
  assert.equal(s2.has('y'), true);
});

void test('getOperandAllPrimitive recomputes after the operand length changes', () => {
  const ops: unknown[] = ['x'];
  assert.equal(getOperandAllPrimitive(ops), true);
  ops.push({});
  assert.equal(getOperandAllPrimitive(ops), false);
});

void test('matchesFilter $in reflects operand after push (end-to-end B3 repro)', () => {
  const caches = createDatabaseCaches();
  const ops: unknown[] = ['x'];
  assert.equal(
    matchesFilter({ _id: '1', v: 'y' }, { v: { $in: ops } }, caches),
    false,
  );
  ops.push('y');
  assert.equal(
    matchesFilter({ _id: '1', v: 'y' }, { v: { $in: ops } }, caches),
    true,
  );
});
