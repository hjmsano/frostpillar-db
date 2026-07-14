import {
  DatabaseLockedError,
  DuplicateKeyError,
  QuotaExceededError,
} from '@frostpillar/frostpillar-storage-engine';
import type {
  Datastore,
  KeyedRecord,
  RecordPayload,
} from '@frostpillar/frostpillar-storage-engine';

import { DuplicateIdError, ValidationError } from '../errors.js';
import type {
  FrostpillarDocument,
  FrostpillarStoredDocument,
  InsertDocument,
} from '../types.js';
import { hasOwn, isObjectRecord } from './objectUtils.js';
import { validateIdString } from './filterUtils.js';

export const assertDocumentId = (value: unknown): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ValidationError('Document _id must be a non-empty string.');
  }
  validateIdString(value);
  return value;
};

export const toStoredDocument = <TDocument extends FrostpillarDocument>(
  payload: unknown,
): FrostpillarStoredDocument<TDocument> => {
  if (!isObjectRecord(payload)) {
    throw new ValidationError('Document payload must be an object.');
  }

  assertDocumentId(payload._id);
  return payload as FrostpillarStoredDocument<TDocument>;
};

/**
 * Turns the write path's document snapshot into the payload that will be stored
 * (ADR-025, ADR-030). The caller's object was already deep-copied by
 * `materializePayload`, in the same pass that validated it, so `document` here
 * is a graph this collection owns outright: it is stamped with the `_id` and
 * handed to the datastore as-is. No second copy is taken — and none may be
 * skipped either, because the datastore runs with `skipPayloadValidation: true`
 * and does not copy the payload, so whatever is passed here *becomes* the
 * stored record.
 */
export const toInsertPayload = <TDocument extends FrostpillarDocument>(
  document: InsertDocument<TDocument>,
  id: string,
): FrostpillarStoredDocument<TDocument> => {
  if (!isObjectRecord(document)) {
    throw new ValidationError('Document must be an object.');
  }

  const payload = document as Record<string, unknown>;
  payload._id = id;
  return payload as FrostpillarStoredDocument<TDocument>;
};

/**
 * The storage-engine exposes a typed `DuplicateKeyError` class, so we can
 * identify duplicate-key errors by instance check directly. A contract test at
 * `tests/unit/duplicate-key-error-contract.test.ts` pins this behaviour.
 */
export const isDuplicateKeyError = (error: unknown): boolean => {
  return error instanceof DuplicateKeyError;
};

const hasProvidedId = (document: unknown): boolean => {
  return isObjectRecord(document) && hasOwn(document, '_id');
};

export interface PreparedRecord<TDocument extends FrostpillarDocument> {
  id: string;
  payload: FrostpillarStoredDocument<TDocument>;
  record: { key: string; payload: RecordPayload };
}

/**
 * Returns the entry IDs that are expired at one shared point in time. Write
 * paths use these IDs for targeted reclamation before duplicate enforcement;
 * records without a valid TTL timestamp remain live, matching read behavior.
 */
export const getExpiredRecordIds = (
  records: readonly KeyedRecord<unknown>[],
  ttl: number | undefined,
): KeyedRecord<unknown>['_id'][] => {
  const expiryThreshold = computeExpiryThreshold(ttl);
  if (expiryThreshold === undefined) return [];

  const expiredIds: KeyedRecord<unknown>['_id'][] = [];
  for (const record of records) {
    const document = toStoredDocument(record.payload);
    if (
      isDocumentExpiredAt(
        document as Record<string, unknown>,
        expiryThreshold,
      )
    ) {
      expiredIds.push(record._id);
    }
  }
  return expiredIds;
};

/**
 * Removes expired records occupying one incoming storage key. This is a narrow
 * write-conflict cleanup rather than a collection scan. A live candidate is
 * left for the storage engine to reject normally.
 */
export const reclaimExpiredInsertConflict = async (
  datastore: Datastore,
  key: string,
  ttl: number | undefined,
): Promise<void> => {
  if (ttl === undefined) return;
  const existing = await datastore.get(key);
  const expiredIds = getExpiredRecordIds(existing, ttl);
  if (expiredIds.length === 0 || expiredIds.length !== existing.length) return;
  await datastore.deleteByIds(expiredIds);
};

/**
 * Prepares the record for a single insert. `document` must be the collection's
 * own snapshot of the caller's payload (`materializePayload`), not the caller's
 * object: it is stored by reference and stamped with `_id`/`_createdAt`.
 *
 * `_createdAt` exists purely as TTL bookkeeping (see ADR-016) — nothing else
 * reads it. Whenever the collection has a `ttl`, the server-generated
 * `createdAt` is unconditionally written, overwriting any caller-supplied
 * value. This is independent of `immutableCreatedAt`, which only matters for
 * collections that do NOT use `ttl`.
 */
export const prepareInsertRecord = <TDocument extends FrostpillarDocument>(
  document: InsertDocument<TDocument>,
  createdAt: number,
  ttl: number | undefined,
): PreparedRecord<TDocument> => {
  const hasId = hasProvidedId(document);
  const id = hasId ? assertDocumentId(document._id) : crypto.randomUUID();
  const payload = toInsertPayload(document, id);
  if (ttl !== undefined) {
    (payload as Record<string, unknown>)._createdAt = createdAt;
  }
  return {
    id,
    payload,
    record: { key: id, payload: payload as RecordPayload },
  };
};

/**
 * Rejects a batch that would hit a duplicate key, **before** any record is
 * written. `putMany` writes in order and throws on the offending record, so a
 * duplicate in the middle of a batch persisted everything before it while the
 * caller's `insertMany` threw — and the insert events, emitted only after
 * `putMany` resolves, were never sent for those stored documents.
 *
 * Only meaningful under `duplicateKeys: 'reject'`; the other policies accept a
 * duplicate key by definition. Duplicates are detected on the `_id` strings, so
 * a custom key definition whose `normalize` collapses two distinct `_id`s of the
 * same batch onto one storage key still surfaces from the storage engine
 * (ADR-027). On TTL collections, stored candidates are reclaimed only when all
 * of them have expired, preserving the no-write result for a batch blocked by a
 * live duplicate.
 */
export const assertNoDuplicateBatchIds = async (
  datastore: Datastore,
  records: readonly { key: string; payload: RecordPayload }[],
  collectionName: string,
  ttl: number | undefined,
): Promise<void> => {
  const keys = new Set<string>();
  for (const record of records) {
    if (keys.has(record.key)) {
      throw new DuplicateIdError(
        `Duplicate _id "${sanitizeForLog(record.key)}" within the insertMany batch for collection "${sanitizeForLog(collectionName)}".`,
      );
    }
    keys.add(record.key);
  }
  if (keys.size === 0) return;

  const existing = await datastore.getMany([...keys]);
  const expiredIds = getExpiredRecordIds(existing, ttl);
  if (expiredIds.length !== existing.length) {
    throw new DuplicateIdError(
      `Duplicate _id in collection "${sanitizeForLog(collectionName)}".`,
    );
  }
  if (expiredIds.length > 0) {
    await datastore.deleteByIds(expiredIds);
  }
};

/**
 * Reports which records of a failed `'reject'` batch actually reached storage,
 * in batch order, so their insert events can still be emitted. Sound only for
 * `'reject'`: `assertNoDuplicateBatchIds` established that none of these keys
 * existed, so any that exists now was written by this call. Under
 * `'replace'`/`'allow'` a key present afterwards may be a pre-existing record,
 * which is why the caller does not reconcile there.
 */
export const findPersistedBatchKeys = async (
  datastore: Datastore,
  records: readonly { key: string; payload: RecordPayload }[],
): Promise<Set<string>> => {
  const keys = [...new Set(records.map((record) => record.key))];
  if (keys.length === 0) return new Set<string>();
  const stored = await datastore.getMany(keys);
  const persisted = new Set<string>();
  for (const record of stored) {
    persisted.add(toStoredDocument(record.payload)._id);
  }
  return persisted;
};

export const sanitizeForLog = (value: string): string => {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\x00-\x1f\x7f]/g, (char) => {
    return `\\x${char.charCodeAt(0).toString(16).padStart(2, '0')}`;
  });
};

export const wrapStorageError = (
  error: unknown,
  collectionName: string,
): void => {
  const safeName = sanitizeForLog(collectionName);
  if (error instanceof QuotaExceededError) {
    throw new QuotaExceededError(
      `Storage quota exceeded in collection "${safeName}": ${error.message}`,
    );
  }
  if (error instanceof DatabaseLockedError) {
    throw new DatabaseLockedError(
      `Database is locked for collection "${safeName}": ${error.message}`,
    );
  }
};

export const rethrowStorageError = (
  error: unknown,
  collectionName: string,
): never => {
  if (isDuplicateKeyError(error)) {
    throw new DuplicateIdError(
      `Duplicate _id in collection "${sanitizeForLog(collectionName)}".`,
    );
  }
  wrapStorageError(error, collectionName);
  throw error;
};

export const isDocumentExpired = (
  document: Record<string, unknown>,
  ttl: number | undefined,
): boolean => {
  if (ttl === undefined) {
    return false;
  }
  const createdAt = document._createdAt;
  if (typeof createdAt !== 'number') {
    return false;
  }
  return Date.now() - createdAt > ttl * 1000;
};

export const computeExpiryThreshold = (
  ttl: number | undefined,
): number | undefined => {
  if (ttl === undefined) return undefined;
  return Date.now() - ttl * 1000;
};

export const isDocumentExpiredAt = (
  document: Record<string, unknown>,
  expiryThreshold: number | undefined,
): boolean => {
  if (expiryThreshold === undefined) return false;
  const createdAt = document._createdAt;
  if (typeof createdAt !== 'number') return false;
  return createdAt < expiryThreshold;
};
