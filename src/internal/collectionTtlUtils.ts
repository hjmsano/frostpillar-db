import type {
  Datastore,
  KeyedRecord,
} from '@frostpillar/frostpillar-storage-engine';

import type { CollectionDuplicateKeyPolicy, Filter } from '../types.js';
import {
  computeExpiryThreshold,
  isDocumentExpiredAt,
  toStoredDocument,
} from './collectionUtils.js';
import { extractIdEquality, extractIdInclusion } from './filterUtils.js';

export const existsWithTtl = async (
  datastore: Datastore,
  id: string,
  ttl: number | undefined,
  duplicateKeys: CollectionDuplicateKeyPolicy = 'reject',
): Promise<boolean> => {
  if (ttl === undefined) {
    return await datastore.has(id);
  }
  const expiryThreshold = computeExpiryThreshold(ttl);
  if (duplicateKeys === 'allow') {
    const records = await datastore.get(id);
    return records.some(
      (r) =>
        !isDocumentExpiredAt(
          toStoredDocument(r.payload) as Record<string, unknown>,
          expiryThreshold,
        ),
    );
  }
  const record = await datastore.getFirst(id);
  if (record === null) return false;
  const document = toStoredDocument(record.payload);
  return !isDocumentExpiredAt(
    document as Record<string, unknown>,
    expiryThreshold,
  );
};

export const idsWithTtl = async (
  datastore: Datastore,
  ttl: number | undefined,
  getAllRecords: () => Promise<KeyedRecord<unknown>[]>,
): Promise<string[]> => {
  if (ttl === undefined) {
    return (await datastore.keys()) as string[];
  }
  const records = await getAllRecords();
  const expiryThreshold = computeExpiryThreshold(ttl);
  return records
    .filter(
      (r) =>
        !isDocumentExpiredAt(
          toStoredDocument(r.payload) as Record<string, unknown>,
          expiryThreshold,
        ),
    )
    .map((r) => toStoredDocument(r.payload)._id);
};

/**
 * Attempts a fast-path remove when TTL is undefined, using index lookups.
 * Returns the count of removed records, or null if the fast path does not apply.
 */
export const removeNoTtlFastPath = async (
  datastore: Datastore,
  filter: Filter,
  ttl: number | undefined,
  duplicateKeys: CollectionDuplicateKeyPolicy,
  emitRemove: (id: string) => void,
): Promise<number | null> => {
  if (ttl !== undefined) return null;
  if (duplicateKeys === 'allow') return null;
  const idKey = extractIdEquality(filter);
  if (idKey !== null) {
    const removed = await datastore.delete(idKey);
    if (removed > 0) emitRemove(idKey);
    return removed;
  }
  const idKeys = extractIdInclusion(filter);
  if (idKeys !== null) {
    const existingRecords = await datastore.getMany(idKeys);
    const existingKeys = existingRecords.map((r) => r.key as string);
    const removed = await datastore.deleteMany(idKeys);
    for (const key of existingKeys) emitRemove(key);
    return removed;
  }
  return null;
};

export const purgeExpiredRecords = async (
  datastore: Datastore,
  ttl: number | undefined,
  getAllRecords: () => Promise<KeyedRecord<unknown>[]>,
): Promise<number> => {
  if (ttl === undefined) return 0;
  const records = await getAllRecords();
  const expiryThreshold = computeExpiryThreshold(ttl);
  const expiredIds = records
    .filter((r) =>
      isDocumentExpiredAt(
        toStoredDocument(r.payload) as Record<string, unknown>,
        expiryThreshold,
      ),
    )
    .map((r) => r._id);
  await datastore.deleteByIds(expiredIds);
  return expiredIds.length;
};
