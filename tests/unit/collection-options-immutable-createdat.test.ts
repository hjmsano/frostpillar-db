import assert from 'node:assert/strict';
import test from 'node:test';

import { ValidationError } from '../../src/errors.js';
import { resolveCollectionOptions } from '../../src/internal/databaseOptions.js';
import { applyUpdateOperations } from '../../src/internal/updateApplier.js';

const pathCache = new Map<string, string[]>();

// resolveCollectionOptions — immutableCreatedAt

void test('resolveCollectionOptions: default immutableCreatedAt is false', () => {
  const resolved = resolveCollectionOptions();
  assert.equal(resolved.immutableCreatedAt, false);
});

void test('resolveCollectionOptions: immutableCreatedAt true is preserved', () => {
  const resolved = resolveCollectionOptions({ immutableCreatedAt: true });
  assert.equal(resolved.immutableCreatedAt, true);
});

void test('resolveCollectionOptions: immutableCreatedAt false is preserved', () => {
  const resolved = resolveCollectionOptions({ immutableCreatedAt: false });
  assert.equal(resolved.immutableCreatedAt, false);
});

void test('resolveCollectionOptions: non-boolean immutableCreatedAt throws ValidationError', () => {
  assert.throws(
    () =>
      resolveCollectionOptions({
        immutableCreatedAt: 1 as unknown as boolean,
      }),
    ValidationError,
  );
});

void test('resolveCollectionOptions: string immutableCreatedAt throws ValidationError', () => {
  assert.throws(
    () =>
      resolveCollectionOptions({
        immutableCreatedAt: 'yes' as unknown as boolean,
      }),
    ValidationError,
  );
});

// applyUpdateOperations — protectCreatedAt

void test('applyUpdateOperations: $set _createdAt throws with protectCreatedAt=true', () => {
  const doc = { _id: 'u1', _createdAt: 1000 };
  assert.throws(
    () =>
      applyUpdateOperations(
        doc,
        { $set: { _createdAt: 9999 } },
        pathCache,
        true,
      ),
    ValidationError,
  );
});

void test('applyUpdateOperations: $set _createdAt succeeds without protectCreatedAt (default false)', () => {
  const doc = { _id: 'u1', _createdAt: 1000 };
  const result = applyUpdateOperations(
    doc,
    { $set: { _createdAt: 9999 } },
    pathCache,
  );
  assert.equal(result.changed, true);
  assert.equal((result.document as Record<string, unknown>)._createdAt, 9999);
});

void test('applyUpdateOperations: $unset _createdAt throws with protectCreatedAt=true', () => {
  const doc = { _id: 'u1', _createdAt: 1000 };
  assert.throws(
    () =>
      applyUpdateOperations(
        doc,
        { $unset: { _createdAt: '' } },
        pathCache,
        true,
      ),
    ValidationError,
  );
});

void test('applyUpdateOperations: $inc _createdAt throws with protectCreatedAt=true', () => {
  const doc = { _id: 'u1', _createdAt: 1000 };
  assert.throws(
    () =>
      applyUpdateOperations(doc, { $inc: { _createdAt: 1 } }, pathCache, true),
    ValidationError,
  );
});

void test('applyUpdateOperations: $set other field still succeeds with protectCreatedAt=true', () => {
  const doc = { _id: 'u1', _createdAt: 1000, name: 'Alice' };
  const result = applyUpdateOperations(
    doc,
    { $set: { name: 'Bob' } },
    pathCache,
    true,
  );
  assert.equal(result.changed, true);
  assert.equal((result.document as Record<string, unknown>).name, 'Bob');
});
