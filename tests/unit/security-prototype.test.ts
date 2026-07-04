// Defensive regression tests for frostpillar-db's input-validation layer.
// The hostile-looking inputs below are fixtures that MUST be rejected (or
// safely handled) by the library; they verify the prototype-pollution guards
// in src/internal/ continue to block these shapes.
// No code here produces a usable payload.

import assert from 'node:assert/strict';
import test from 'node:test';

import { ValidationError } from '../../src/errors.js';
import { createDatabaseCaches } from '../../src/internal/databaseCaches.js';
import { setValueByPath } from '../../src/internal/documentPath.js';
import { applyUpdateOperations } from '../../src/internal/updateApplier.js';
import type { FrostpillarStoredDocument } from '../../src/types.js';

const caches = createDatabaseCaches();
const pathCache = caches.pathCache;

// --- #8 Error message sanitization ---

void test('setValueByPath error does not leak field values', () => {
  const target = { secret: 42 };

  assert.throws(
    () =>
      setValueByPath(
        target as Record<string, unknown>,
        'secret.child',
        'x',
        pathCache,
      ),
    (error: unknown) => {
      assert.ok(error instanceof ValidationError);
      assert.ok(!error.message.includes('42'));
      assert.ok(!error.message.includes('secret'));
      return true;
    },
  );
});

// --- #9 Update path prototype-pollution guard ---

void test('$set rejects __proto__ nested in value object', () => {
  const source = { _id: 'u1', x: 1 };
  assert.throws(
    () =>
      applyUpdateOperations(
        source,
        { $set: { meta: { __proto__: { polluted: true } } } },
        pathCache,
      ),
    ValidationError,
  );
});

void test('$set rejects constructor nested in value object', () => {
  const source = { _id: 'u1', x: 1 };
  assert.throws(
    () =>
      applyUpdateOperations(
        source,
        { $set: { meta: { constructor: 'bad' } } },
        pathCache,
      ),
    ValidationError,
  );
});

void test('$set rejects prototype nested in value object', () => {
  const source = { _id: 'u1', x: 1 };
  assert.throws(
    () =>
      applyUpdateOperations(
        source,
        { $set: { meta: { prototype: 'bad' } } },
        pathCache,
      ),
    ValidationError,
  );
});

void test('$push rejects __proto__ key in pushed object value', () => {
  const source = { _id: 'u1', items: [] };
  assert.throws(
    () =>
      applyUpdateOperations(
        source,
        { $push: { items: { __proto__: { polluted: true } } } },
        pathCache,
      ),
    ValidationError,
  );
});

void test('$push rejects constructor key in pushed object value', () => {
  const source = { _id: 'u1', items: [] };
  assert.throws(
    () =>
      applyUpdateOperations(
        source,
        { $push: { items: { constructor: 'bad' } } },
        pathCache,
      ),
    ValidationError,
  );
});

void test('$addToSet rejects __proto__ key in pushed object value', () => {
  const source = { _id: 'u1', items: [] };
  assert.throws(
    () =>
      applyUpdateOperations(
        source,
        { $addToSet: { items: { __proto__: { polluted: true } } } },
        pathCache,
      ),
    ValidationError,
  );
});

void test('$addToSet rejects prototype key in pushed object value', () => {
  const source = { _id: 'u1', items: [] };
  assert.throws(
    () =>
      applyUpdateOperations(
        source,
        { $addToSet: { items: { prototype: 'bad' } } },
        pathCache,
      ),
    ValidationError,
  );
});

void test('$set rejects dot-notation path containing __proto__ segment', () => {
  const source = { _id: 'u1', x: 1 };
  assert.throws(
    () =>
      applyUpdateOperations(source, { $set: { '__proto__.x': 1 } }, pathCache),
    ValidationError,
  );
});

void test('$set rejects dot-notation path containing constructor segment', () => {
  const source = { _id: 'u1', x: 1 };
  assert.throws(
    () =>
      applyUpdateOperations(
        source,
        { $set: { 'foo.constructor.bar': 1 } },
        pathCache,
      ),
    ValidationError,
  );
});

void test('$set rejects dot-notation path containing prototype segment', () => {
  const source = { _id: 'u1', x: 1 };
  assert.throws(
    () =>
      applyUpdateOperations(
        source,
        { $set: { 'foo.prototype': 1 } },
        pathCache,
      ),
    ValidationError,
  );
});

void test('$rename rejects source path containing __proto__ segment', () => {
  const source = { _id: 'u1', x: 1 };
  assert.throws(
    () =>
      applyUpdateOperations(
        source,
        { $rename: { '__proto__.x': 'safe' } },
        pathCache,
      ),
    ValidationError,
  );
});

void test('$rename rejects destination path containing __proto__ segment', () => {
  const source = { _id: 'u1', x: 1 };
  assert.throws(
    () =>
      applyUpdateOperations(
        source,
        { $rename: { x: '__proto__.y' } },
        pathCache,
      ),
    ValidationError,
  );
});

void test('$rename rejects destination path containing constructor segment', () => {
  const source = { _id: 'u1', x: 1 };
  assert.throws(
    () =>
      applyUpdateOperations(
        source,
        { $rename: { x: 'foo.constructor' } },
        pathCache,
      ),
    ValidationError,
  );
});

void test('$rename rejects destination path containing prototype segment', () => {
  const source = { _id: 'u1', x: 1 };
  assert.throws(
    () =>
      applyUpdateOperations(
        source,
        { $rename: { x: 'fn.prototype' } },
        pathCache,
      ),
    ValidationError,
  );
});

void test('$rename rejects reserved destination path when source does not exist', () => {
  const document = { _id: 'u1' } as FrostpillarStoredDocument;
  assert.throws(
    () =>
      applyUpdateOperations(
        document,
        { $rename: { nonExistent: '__proto__.y' } },
        pathCache,
      ),
    ValidationError,
  );
});

void test('$set rejects deeply nested constructor key', () => {
  const document = { _id: 'u1' } as FrostpillarStoredDocument;
  assert.throws(
    () =>
      applyUpdateOperations(
        document,
        { $set: { a: { b: { c: { constructor: 'x' } } } } },
        pathCache,
      ),
    ValidationError,
  );
});

void test('$set rejects reserved key inside array element object', () => {
  const document = { _id: 'u1' } as FrostpillarStoredDocument;
  assert.throws(
    () =>
      applyUpdateOperations(
        document,
        { $set: { items: [{ constructor: 'x' }] } },
        pathCache,
      ),
    ValidationError,
  );
});
