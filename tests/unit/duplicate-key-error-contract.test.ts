import assert from 'node:assert/strict';
import test from 'node:test';

import {
  Datastore,
  DuplicateKeyError,
  ValidationError as StorageValidationError,
} from '@frostpillar/frostpillar-storage-engine';

import { isDuplicateKeyError } from '../../src/internal/collectionUtils.js';

/**
 * Cross-package contract test.
 *
 * frostpillar-db translates duplicate-key errors from
 * @frostpillar/frostpillar-storage-engine into a domain-level DuplicateIdError
 * via an `instanceof DuplicateKeyError` check (see isDuplicateKeyError in
 * src/internal/collectionUtils.ts). The storage-engine exposes a typed
 * DuplicateKeyError class, so the contract is enforced by type — not by
 * string matching.
 *
 * This test triggers a REAL duplicate-key throw from the storage-engine and
 * asserts that the error is an instance of DuplicateKeyError. If the
 * storage-engine upgrades and changes the error class, this test fails loudly
 * at CI time rather than at runtime for users.
 */
void test('storage-engine duplicate-key error is recognised by isDuplicateKeyError', async () => {
  const datastore = new Datastore({
    skipPayloadValidation: true,
    duplicateKeys: 'reject',
  });

  let raw: unknown;
  try {
    await datastore.put({ key: 'k1', payload: { _id: 'k1' } });
    try {
      await datastore.put({ key: 'k1', payload: { _id: 'k1' } });
    } catch (error) {
      raw = error;
    }
  } finally {
    await datastore.close();
  }

  assert.ok(
    raw !== undefined,
    'expected storage-engine to throw on duplicate key insert',
  );
  assert.ok(
    raw instanceof DuplicateKeyError,
    `storage-engine duplicate-key error shape changed — expected DuplicateKeyError, got ${
      raw instanceof Error ? raw.constructor.name : typeof raw
    }. Update isDuplicateKeyError in src/internal/collectionUtils.ts.`,
  );
  assert.equal(
    isDuplicateKeyError(raw),
    true,
    'isDuplicateKeyError failed to recognise a real storage-engine duplicate-key error — update isDuplicateKeyError in src/internal/collectionUtils.ts.',
  );
});

void test('isDuplicateKeyError rejects unrelated errors', () => {
  assert.equal(
    isDuplicateKeyError(
      new StorageValidationError(
        'Duplicate key rejected: a record with this key already exists.',
      ),
    ),
    false,
  );
  assert.equal(isDuplicateKeyError(new Error('Duplicate key rejected')), false);
  assert.equal(isDuplicateKeyError(undefined), false);
  assert.equal(isDuplicateKeyError(null), false);
  assert.equal(isDuplicateKeyError('Duplicate key rejected: oops'), false);
});
