import type {
  Datastore,
  KeyedRecord,
} from '@frostpillar/frostpillar-storage-engine';

import { ValidationError } from '../errors.js';
import { cloneDocument, isEmptyFilter } from './objectUtils.js';
import { matchesFilter } from './filterEvaluator.js';
import { validateFilter } from './filterValidator.js';
import {
  extractEqualityFields,
  extractIdEquality,
  extractIdInclusion,
  extractIdRange,
} from './filterUtils.js';
import {
  computeExpiryThreshold,
  isDocumentExpiredAt,
  toStoredDocument,
} from './collectionUtils.js';
import { DEFAULT_MAX_DEPTH } from './limits.js';
import { applyUpdateOperations } from './updateApplier.js';
import type { DatabaseCaches } from './databaseCaches.js';
import type { ResultChainContext } from '../resultChain.js';
import type {
  CollectionDuplicateKeyPolicy,
  Filter,
  FrostpillarDocument,
  FrostpillarStoredDocument,
  InsertDocument,
  UpdateOperations,
} from '../types.js';

export interface QueryContext {
  readonly datastore: Datastore;
  readonly caches: DatabaseCaches;
  readonly maxMatchedDocuments: number;
  readonly ttl: number | undefined;
  readonly duplicateKeys: CollectionDuplicateKeyPolicy;
  readonly hasCustomKey: boolean;
}

export interface ScanResult<TDocument extends FrostpillarDocument> {
  scannedCount: number;
  matched: FrostpillarStoredDocument<TDocument>[];
}

export interface MatchedRecord<TDocument extends FrostpillarDocument> {
  record: KeyedRecord<unknown>;
  document: FrostpillarStoredDocument<TDocument>;
}

export const getRecordsByFilter = async (
  ctx: QueryContext,
  filter?: Filter,
): Promise<KeyedRecord<unknown>[]> => {
  if (filter === undefined) return ctx.datastore.getAll();
  const idKey = extractIdEquality(filter);
  if (idKey !== null) {
    if (ctx.duplicateKeys !== 'allow') {
      const record = await ctx.datastore.getFirst(idKey);
      return record !== null ? [record] : [];
    }
    return ctx.datastore.get(idKey);
  }
  const idKeys = extractIdInclusion(filter);
  if (idKeys !== null) return ctx.datastore.getMany(idKeys);
  // Equality and `$in` lookups stay safe under a custom key: each queried `_id`
  // normalizes to the key its own record was stored under, so the index returns
  // a superset that the caller then filters by `_id`. A range lookup does not:
  // it walks the index in the key definition's order, which need not agree with
  // the string order the filter is evaluated in (`"10"` sits inside the string
  // range `"1".."3"` but outside the numeric one), so it can drop matches.
  // Fall back to a full scan (ADR-027).
  const range = ctx.hasCustomKey ? null : extractIdRange(filter);
  if (range !== null) {
    if (range.start > range.end) return [];
    return ctx.datastore.getRange(range.start, range.end);
  }
  return ctx.datastore.getAll();
};

export const scanRecords = async <TDocument extends FrostpillarDocument>(
  ctx: QueryContext,
  filter?: Filter,
  options?: { limit?: number; skipMatchLimit?: boolean },
): Promise<ScanResult<TDocument>> => {
  const records = await getRecordsByFilter(ctx, filter);
  const matched: FrostpillarStoredDocument<TDocument>[] = [];
  const emptyFilter = isEmptyFilter(filter);
  // Validate the filter structure up front so invalid filters throw
  // consistently, including on empty / no-candidate result sets (FP-03).
  if (!emptyFilter) validateFilter(filter, ctx.caches);
  const expiryThreshold = computeExpiryThreshold(ctx.ttl);
  // When an explicit scan limit is provided (no-sort path only), raise the
  // effective cap to at least that limit: the caller already bounds memory
  // to `options.limit` documents, so throwing before that would be wrong.
  const effectiveMatchLimit =
    options?.limit !== undefined
      ? Math.max(options.limit, ctx.maxMatchedDocuments)
      : ctx.maxMatchedDocuments;

  for (const record of records) {
    const document = toStoredDocument<TDocument>(record.payload);
    if (
      isDocumentExpiredAt(document as Record<string, unknown>, expiryThreshold)
    )
      continue;
    if (!emptyFilter && !matchesFilter(document, filter, ctx.caches)) continue;
    matched.push(document);
    if (!options?.skipMatchLimit && matched.length > effectiveMatchLimit) {
      throw new ValidationError(
        `Query matched more than ${ctx.maxMatchedDocuments.toString()} documents. Use limit() to bound the result set.`,
      );
    }
    // Short-circuit once we have enough matches for the requested limit.
    // ResultChain will apply skip/limit on the returned slice.
    if (options?.limit !== undefined && matched.length >= options.limit) {
      break;
    }
  }

  return { scannedCount: records.length, matched };
};

export const collectFilteredDocuments = <TDocument extends FrostpillarDocument>(
  ctx: QueryContext,
  records: KeyedRecord<unknown>[],
  filter: Filter | undefined,
): MatchedRecord<TDocument>[] => {
  const emptyFilter = isEmptyFilter(filter);
  // Validate the filter structure up front so invalid filters throw
  // consistently, including on empty / no-candidate result sets (FP-03).
  if (!emptyFilter) validateFilter(filter, ctx.caches);
  const expiryThreshold = computeExpiryThreshold(ctx.ttl);
  const matched: MatchedRecord<TDocument>[] = [];

  for (const record of records) {
    const document = toStoredDocument<TDocument>(record.payload);
    if (
      isDocumentExpiredAt(document as Record<string, unknown>, expiryThreshold)
    )
      continue;
    if (!emptyFilter && !matchesFilter(document, filter, ctx.caches)) continue;
    matched.push({ record, document });
    if (matched.length > ctx.maxMatchedDocuments) {
      throw new ValidationError(
        `Query matched more than ${ctx.maxMatchedDocuments.toString()} documents. Use limit() to bound the result set.`,
      );
    }
  }

  return matched;
};

export const findOneByIdOptimized = async <
  TDocument extends FrostpillarDocument,
>(
  datastore: Datastore,
  idKey: string,
  ttl: number | undefined,
): Promise<FrostpillarStoredDocument<TDocument> | null> => {
  const record = await datastore.getFirst(idKey);
  if (record === null) return null;
  const doc = toStoredDocument<TDocument>(record.payload);
  const expiryThreshold = computeExpiryThreshold(ttl);
  if (isDocumentExpiredAt(doc as Record<string, unknown>, expiryThreshold))
    return null;
  return cloneDocument(doc);
};

export const countMatchedRecords = async <
  TDocument extends FrostpillarDocument,
>(
  ctx: QueryContext,
  filter?: Filter,
): Promise<number> => {
  const records = await getRecordsByFilter(ctx, filter);
  const emptyFilter = isEmptyFilter(filter);
  // Validate the filter structure up front so invalid filters throw
  // consistently, including on empty / no-candidate result sets (FP-03).
  if (!emptyFilter) validateFilter(filter, ctx.caches);
  const expiryThreshold = computeExpiryThreshold(ctx.ttl);
  let count = 0;
  for (const record of records) {
    const document = toStoredDocument<TDocument>(record.payload);
    if (
      isDocumentExpiredAt(document as Record<string, unknown>, expiryThreshold)
    ) {
      continue;
    }
    if (!emptyFilter && !matchesFilter(document, filter, ctx.caches)) continue;
    count += 1;
  }
  return count;
};

export const createChainContext = <TDocument extends FrostpillarDocument>(
  assertOpen: () => void,
  queryContext: QueryContext,
): ResultChainContext<TDocument> => {
  return {
    assertOpen,
    executeFilter: async (f?: Filter, limit?: number) => {
      const result = await scanRecords<TDocument>(queryContext, f, { limit });
      return result.matched;
    },
    executeCount: async (f?: Filter) => {
      if (
        isEmptyFilter(f) &&
        queryContext.ttl === undefined &&
        queryContext.duplicateKeys !== 'allow'
      ) {
        return await queryContext.datastore.count();
      }
      return await countMatchedRecords<TDocument>(queryContext, f);
    },
    pathCache: queryContext.caches.pathCache,
  };
};

export const buildUpsertDocument = <TDocument extends FrostpillarDocument>(
  filter: Filter,
  operations: UpdateOperations,
  pathCache: Map<string, string[]>,
  protectCreatedAt = false,
  maxDepth: number = DEFAULT_MAX_DEPTH,
): InsertDocument<TDocument> => {
  const baseDoc = extractEqualityFields(filter, pathCache);
  if (typeof baseDoc._id !== 'string' || baseDoc._id.length === 0) {
    baseDoc._id = crypto.randomUUID();
  }
  const storedBase = baseDoc as FrostpillarStoredDocument<TDocument>;
  const result = applyUpdateOperations(
    storedBase,
    operations,
    pathCache,
    protectCreatedAt,
    maxDepth,
  );
  return result.document as InsertDocument<TDocument>;
};
