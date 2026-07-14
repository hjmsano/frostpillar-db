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

/**
 * A record counts as a hit only when it is live and — under a custom key
 * definition — actually carries the requested `_id`. With `normalize`, one
 * storage key can be reached by several distinct `_id` strings (`"01"` and
 * `"1"` collide under `normalize: Number`), so a key hit alone does not prove
 * `_id` identity. See ADR-027.
 */
const isLiveIdMatch = (
  record: KeyedRecord<unknown>,
  id: string,
  expiryThreshold: number | undefined,
  requireIdMatch: boolean,
): boolean => {
  const document = toStoredDocument(record.payload);
  if (requireIdMatch && document._id !== id) return false;
  return !isDocumentExpiredAt(
    document as Record<string, unknown>,
    expiryThreshold,
  );
};

export const existsWithTtl = async (
  datastore: Datastore,
  id: string,
  ttl: number | undefined,
  duplicateKeys: CollectionDuplicateKeyPolicy = 'reject',
  hasCustomKey = false,
): Promise<boolean> => {
  if (ttl === undefined && !hasCustomKey) {
    return await datastore.has(id);
  }
  const expiryThreshold = computeExpiryThreshold(ttl);
  if (duplicateKeys === 'allow' || hasCustomKey) {
    // `get` returns every record sharing the storage key, which is the full
    // candidate set for both duplicate `_id`s and normalize collisions.
    const records = await datastore.get(id);
    return records.some((r) =>
      isLiveIdMatch(r, id, expiryThreshold, hasCustomKey),
    );
  }
  const record = await datastore.getFirst(id);
  if (record === null) return false;
  return isLiveIdMatch(record, id, expiryThreshold, hasCustomKey);
};

export const idsWithTtl = async (
  datastore: Datastore,
  ttl: number | undefined,
  getAllRecords: () => Promise<KeyedRecord<unknown>[]>,
  hasCustomKey = false,
  duplicateKeys: CollectionDuplicateKeyPolicy = 'reject',
): Promise<string[]> => {
  // `datastore.keys()` yields normalized storage keys, which are only `_id`
  // strings under the default key definition; otherwise read `_id` back off
  // each payload to honour the `Promise<string[]>` contract (ADR-027).
  //
  // It also yields each key once, however many records share it, so the fast
  // path is disabled under `duplicateKeys: 'allow'` as well: `ids()` reports
  // one entry per document (`ids().length === count()`), and the TTL path
  // below — which reads `_id` per record — already did.
  if (ttl === undefined && !hasCustomKey && duplicateKeys !== 'allow') {
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
  hasCustomKey = false,
): Promise<number | null> => {
  if (ttl !== undefined) return null;
  if (duplicateKeys === 'allow') return null;
  // Deleting by storage key would also delete `_id`s that merely normalize to
  // the same key, and would emit the filter's `_id` rather than the stored one.
  // The generic path re-checks each candidate's `_id` before deleting it.
  if (hasCustomKey) return null;
  // Key deletion does not evaluate other predicates, so it is correct only
  // when the `_id` condition is the entire filter.
  if (Object.keys(filter).length !== 1) return null;
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
