import {
  DatabaseLockedError,
  DuplicateKeyError,
  QuotaExceededError,
} from '@frostpillar/frostpillar-storage-engine';
import type { RecordPayload } from '@frostpillar/frostpillar-storage-engine';

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

export const toInsertPayload = <TDocument extends FrostpillarDocument>(
  document: InsertDocument<TDocument>,
  id: string,
): FrostpillarStoredDocument<TDocument> => {
  if (!isObjectRecord(document)) {
    throw new ValidationError('Document must be an object.');
  }

  return { ...document, _id: id } as FrostpillarStoredDocument<TDocument>;
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
