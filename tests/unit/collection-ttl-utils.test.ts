import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  Datastore,
  EntryId,
  KeyedRecord,
} from '@frostpillar/frostpillar-storage-engine';

import { purgeExpiredRecords } from '../../src/internal/collectionTtlUtils.js';

/**
 * Unit tests for purgeExpiredRecords.
 *
 * These tests use a minimal Datastore stub to verify that the function
 * returns the count of expired documents *identified* (expiredIds.length),
 * not the count returned by the storage engine's deleteByIds.
 */

const makeExpiredRecord = (
  entryId: number,
  docId: string,
): KeyedRecord<unknown> => ({
  _id: entryId as unknown as EntryId,
  key: docId,
  payload: { _id: docId, _createdAt: Date.now() - 60_000 },
});

const makeValidRecord = (
  entryId: number,
  docId: string,
): KeyedRecord<unknown> => ({
  _id: entryId as unknown as EntryId,
  key: docId,
  payload: { _id: docId, _createdAt: Date.now() },
});

void test('purgeExpiredRecords returns identified count, not storage-delete count', async () => {
  // Simulate: 3 expired docs identified, but storage only deletes 1
  // (the other 2 were already removed by a concurrent caller).
  const expired1 = makeExpiredRecord(1, 'doc1');
  const expired2 = makeExpiredRecord(2, 'doc2');
  const expired3 = makeExpiredRecord(3, 'doc3');
  const valid1 = makeValidRecord(4, 'doc4');

  const allRecords = [expired1, expired2, expired3, valid1];

  const stubDatastore = {
    deleteByIds: (_ids: number[]): Promise<number> => Promise.resolve(1),
  } as unknown as Datastore;

  const result = await purgeExpiredRecords(stubDatastore, 10, () =>
    Promise.resolve(allRecords),
  );

  assert.equal(
    result,
    3,
    'should return the number of expired docs identified, not storage-delete count',
  );
});

void test('purgeExpiredRecords returns 0 when ttl is undefined', async () => {
  const stubDatastore = {} as unknown as Datastore;

  const result = await purgeExpiredRecords(stubDatastore, undefined, () =>
    Promise.resolve([]),
  );

  assert.equal(result, 0);
});

void test('purgeExpiredRecords returns 0 when no documents are expired', async () => {
  const valid1 = makeValidRecord(1, 'doc1');
  const valid2 = makeValidRecord(2, 'doc2');

  let deleteByIdsCalled = false;
  const stubDatastore = {
    deleteByIds: (_ids: number[]): Promise<number> => {
      deleteByIdsCalled = true;
      return Promise.resolve(0);
    },
  } as unknown as Datastore;

  const result = await purgeExpiredRecords(stubDatastore, 10, () =>
    Promise.resolve([valid1, valid2]),
  );

  assert.equal(result, 0);
  assert.equal(
    deleteByIdsCalled,
    true,
    'deleteByIds should still be called with empty array',
  );
});
