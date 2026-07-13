import type { RecordPayload } from '@frostpillar/frostpillar-storage-engine';

import { ClosedDatabaseError } from './errors.js';
import { ChangeEmitter } from './internal/changeEmitter.js';
import { extractIdEquality, validateIdString } from './internal/filterUtils.js';
import {
  snapshotOptionalFilterArgument,
  snapshotRequiredFilterArgument,
} from './internal/filterSnapshot.js';
import {
  materializePayload,
  validateInsertPayload,
  validatePayloadSecurity,
} from './internal/payloadValidator.js';
import { applyNormalizedUpdateOperations } from './internal/updateApplier.js';
import {
  normalizeUpdateOperations,
  type NormalizedOperations,
} from './internal/updateValidator.js';
import {
  assertNoDuplicateBatchIds,
  findPersistedBatchKeys,
  prepareInsertRecord,
  rethrowStorageError,
} from './internal/collectionUtils.js';
import { DEFAULT_MAX_DEPTH } from './internal/limits.js';
import {
  existsWithTtl,
  idsWithTtl,
  purgeExpiredRecords,
  removeNoTtlFastPath,
} from './internal/collectionTtlUtils.js';
import {
  buildUpsertDocumentFromNormalized,
  collectFilteredDocuments,
  createChainContext,
  findOneByIdOptimized,
  getRecordsByFilter,
  type QueryContext,
} from './internal/collectionQueryHelpers.js';
import { ResultChain, type ResultChainContext } from './resultChain.js';
import type {
  ChangeListener,
  CollectionContext,
  CollectionDuplicateKeyPolicy,
  Filter,
  FrostpillarDocument,
  FrostpillarStoredDocument,
  InsertDocument,
  UpdateOperations,
  UpdateOptions,
  UpdateResult,
} from './types.js';

export class Collection<
  TDocument extends FrostpillarDocument = FrostpillarDocument,
> {
  public readonly name: string;
  public readonly duplicateKeys: CollectionDuplicateKeyPolicy;
  public readonly ttl: number | undefined;
  public readonly immutableCreatedAt: boolean;

  private readonly context: CollectionContext;
  private readonly changeEmitter = new ChangeEmitter<TDocument>();
  private readonly chainContext: ResultChainContext<TDocument>;
  private readonly queryContext: QueryContext;
  /** Whether `_createdAt` update protection is active (ADR-016): true if `immutableCreatedAt` is set, or unconditionally whenever `ttl` is set. */
  private readonly protectCreatedAt: boolean;
  /** Nesting cap for every recursive walk of caller input: payloads, update values, filters. */
  private readonly maxDepth: number;
  /** Top-level fields the insert path generates: `_id`, plus `_createdAt` under a TTL. */
  private readonly generatedInsertKeys: readonly string[];
  private dropped = false;

  public constructor(
    context: CollectionContext,
    name: string,
    duplicateKeys: CollectionDuplicateKeyPolicy,
    ttl?: number,
    immutableCreatedAt = false,
  ) {
    this.context = context;
    this.name = name;
    this.duplicateKeys = duplicateKeys;
    this.ttl = ttl;
    this.immutableCreatedAt = immutableCreatedAt;
    this.protectCreatedAt = immutableCreatedAt || ttl !== undefined;
    this.maxDepth = context.payloadLimits?.maxDepth ?? DEFAULT_MAX_DEPTH;
    this.generatedInsertKeys =
      ttl !== undefined ? ['_id', '_createdAt'] : ['_id'];
    if (context.onListenerError !== undefined) {
      this.changeEmitter.setErrorHandler(context.onListenerError);
    }
    this.queryContext = {
      datastore: context.datastore,
      caches: context.caches,
      maxMatchedDocuments: context.maxMatchedDocuments,
      ttl,
      duplicateKeys,
      hasCustomKey: context.hasCustomKey,
    };
    this.chainContext = createChainContext<TDocument>(
      () => this.assertOpen(),
      this.queryContext,
    );
  }

  public watch(listener: ChangeListener<TDocument>): () => void {
    // A dropped collection (or a closed database) can never emit again: the
    // instance is detached from the database registry, so a listener registered
    // here would silently never fire.
    this.assertOpen();
    return this.changeEmitter.watch(listener);
  }

  private emitChange(
    type: 'insert' | 'update' | 'remove',
    documentId: string,
    document: FrostpillarStoredDocument<TDocument> | null,
  ): void {
    this.changeEmitter.emit(type, this.name, documentId, document);
  }

  public markDropped(): void {
    this.dropped = true;
  }

  public assertOpen(): void {
    if (this.dropped) {
      throw new ClosedDatabaseError(
        `Collection "${this.name}" has been dropped. Re-acquire it via db.collection("${this.name}").`,
      );
    }
    this.context.assertOpen();
  }

  /**
   * Validates a document the collection already owns: the update path's result,
   * which is a copy of the stored document with the (already materialized)
   * update values applied. The insert path uses `materializeInsertDocument`
   * instead — it must copy the caller's object before validating it.
   */
  private validateOwnedDocument(document: unknown): void {
    if (this.context.skipInsertValidation) {
      validatePayloadSecurity(document, this.maxDepth);
    } else {
      validateInsertPayload(document, this.context.payloadLimits);
    }
  }

  /**
   * Takes the write path's single read of the caller's document and validates
   * that copy (ADR-030). Validating the caller's object and copying it
   * afterwards read every property twice, so an accessor could pass validation
   * with one value and store another.
   *
   * `generatedInsertKeys` names the top-level fields `prepareInsertRecord` adds
   * after validation, so the payload is measured against the limits as it will
   * be stored.
   */
  private materializeInsertDocument(
    document: InsertDocument<TDocument>,
  ): InsertDocument<TDocument> {
    const snapshot = materializePayload(document, this.maxDepth);
    if (!this.context.skipInsertValidation) {
      validateInsertPayload(
        snapshot,
        this.context.payloadLimits,
        this.generatedInsertKeys,
      );
    }
    return snapshot as InsertDocument<TDocument>;
  }

  public async insert(document: InsertDocument<TDocument>): Promise<string> {
    this.assertOpen();
    const { id, payload, record } = prepareInsertRecord<TDocument>(
      this.materializeInsertDocument(document),
      Date.now(),
      this.ttl,
    );
    try {
      await this.context.datastore.put(record);
    } catch (e) {
      rethrowStorageError(e, this.name);
    }
    this.emitChange('insert', id, payload);
    return id;
  }

  public async insertMany(
    documents: InsertDocument<TDocument>[],
  ): Promise<string[]> {
    this.assertOpen();
    const count = documents.length;
    // Every document is materialized (and so validated) before any of them is
    // prepared, keeping the batch's all-or-nothing validation contract.
    const snapshots = new Array<InsertDocument<TDocument>>(count);
    for (let i = 0; i < count; i++) {
      snapshots[i] = this.materializeInsertDocument(documents[i]);
    }
    const now = Date.now();
    const records = new Array<{ key: string; payload: RecordPayload }>(count);
    const ids = new Array<string>(count);
    const payloads = new Array<FrostpillarStoredDocument<TDocument>>(count);
    for (let i = 0; i < count; i++) {
      const { id, payload, record } = prepareInsertRecord<TDocument>(
        snapshots[i],
        now,
        this.ttl,
      );
      records[i] = record;
      ids[i] = id;
      payloads[i] = payload;
    }
    // A duplicate key is the one batch failure this layer can foresee, and
    // `putMany` would persist every record before the offending one. Detecting
    // it here keeps the batch all-or-nothing for that case.
    if (this.duplicateKeys === 'reject') {
      await assertNoDuplicateBatchIds(
        this.context.datastore,
        records,
        this.name,
      );
    }
    try {
      await this.context.datastore.putMany(records);
    } catch (e) {
      await this.emitPersistedInserts(records, ids, payloads);
      rethrowStorageError(e, this.name);
    }
    for (let i = 0; i < count; i++) {
      this.emitChange('insert', ids[i], payloads[i]);
    }
    return ids;
  }

  /**
   * Announces the records a failed batch did persist (quota, backend I/O — the
   * failures the duplicate pre-check cannot foresee), so a stored document is
   * never missing from the `watch()` stream. Reconciling reads back the batch's
   * keys, which is only sound under `'reject'`: the pre-check proved none of them
   * existed, so whatever exists now was written by this call.
   */
  private async emitPersistedInserts(
    records: readonly { key: string; payload: RecordPayload }[],
    ids: readonly string[],
    payloads: readonly FrostpillarStoredDocument<TDocument>[],
  ): Promise<void> {
    if (this.duplicateKeys !== 'reject') return;
    const persisted = await findPersistedBatchKeys(
      this.context.datastore,
      records,
    );
    if (persisted.size === 0) return;
    for (let i = 0; i < ids.length; i++) {
      if (persisted.has(ids[i])) {
        this.emitChange('insert', ids[i], payloads[i]);
      }
    }
  }

  /** Opens a chain over a filter this collection already owns (see `snapshotFilterArgument`). */
  private chain(filter?: Filter): ResultChain<TDocument> {
    return new ResultChain<TDocument>(this.chainContext, { filter });
  }

  public find(filter?: Filter): ResultChain<TDocument> {
    this.assertOpen();
    const owned = snapshotOptionalFilterArgument(
      filter,
      'Collection.find',
      this.maxDepth,
    );
    return this.chain(owned);
  }

  public async findOne(
    filter?: Filter,
  ): Promise<FrostpillarStoredDocument<TDocument> | null> {
    this.assertOpen();
    const owned = snapshotOptionalFilterArgument(
      filter,
      'Collection.findOne',
      this.maxDepth,
    );
    const idKey = owned !== undefined ? extractIdEquality(owned) : null;
    // A custom key definition can route several `_id` strings to one storage
    // key, so `getFirst` may answer with a different document than the filter
    // asked for. The generic path still uses the key index to fetch candidates,
    // then confirms `_id` per document (ADR-027).
    if (
      idKey !== null &&
      !this.context.hasCustomKey &&
      !(this.duplicateKeys === 'allow' && this.ttl !== undefined)
    ) {
      return findOneByIdOptimized<TDocument>(
        this.context.datastore,
        idKey,
        this.ttl,
      );
    }
    return (await this.chain(owned).limit(1).toArray())[0] ?? null;
  }

  public async update(
    filter: Filter,
    operations: UpdateOperations,
    options?: UpdateOptions,
  ): Promise<UpdateResult> {
    this.assertOpen();
    const owned = snapshotRequiredFilterArgument(
      filter,
      'Collection.update',
      this.maxDepth,
    );
    const normalized = normalizeUpdateOperations(
      operations,
      this.protectCreatedAt,
      this.maxDepth,
    );
    const upsert = options?.upsert === true;
    if (normalized.inputKeyCount === 0)
      return { modifiedCount: 0, upsertedId: null };

    const records = await getRecordsByFilter(this.queryContext, owned);
    const matches = collectFilteredDocuments<TDocument>(
      this.queryContext,
      records,
      owned,
    );

    let updated = 0;
    for (const { record, document } of matches) {
      const result = applyNormalizedUpdateOperations(
        document,
        normalized,
        this.context.caches.pathCache,
      );
      if (!result.changed) continue;
      this.validateOwnedDocument(result.document);
      if (
        !(await this.context.datastore.replaceById(
          record._id,
          result.document as RecordPayload,
        ))
      )
        continue;
      this.emitChange(
        'update',
        result.document._id,
        result.document as FrostpillarStoredDocument<TDocument>,
      );
      updated += 1;
    }

    if (matches.length > 0 || !upsert) {
      return { modifiedCount: updated, upsertedId: null };
    }
    return await this.performUpsert(owned, normalized);
  }

  private async performUpsert(
    filter: Filter,
    operations: NormalizedOperations,
  ): Promise<UpdateResult> {
    const insertDoc = buildUpsertDocumentFromNormalized<TDocument>(
      filter,
      operations,
      this.context.caches.pathCache,
    );
    const insertedId = await this.insert(insertDoc);
    return { modifiedCount: 0, upsertedId: insertedId };
  }

  public async remove(filter: Filter): Promise<number> {
    this.assertOpen();
    const owned = snapshotRequiredFilterArgument(
      filter,
      'Collection.remove',
      this.maxDepth,
    );
    const fastPath = await removeNoTtlFastPath(
      this.context.datastore,
      owned,
      this.ttl,
      this.duplicateKeys,
      (id) => this.emitChange('remove', id, null),
      this.context.hasCustomKey,
    );
    if (fastPath !== null) return fastPath;

    const records = await getRecordsByFilter(this.queryContext, owned);
    const matches = collectFilteredDocuments<TDocument>(
      this.queryContext,
      records,
      owned,
    );
    // Delete per-id so each emitted change-event corresponds to a record that
    // was actually deleted: deleteById returns whether that specific record was
    // removed, which stays correct under concurrent deletion (unlike a batch
    // count, which only tells us how many were removed, not which). This favors
    // change-event accuracy over batch throughput, consistent with the watch
    // event contract (see spec 02 — the $in fast path is likewise disabled for
    // the 'allow' policy to keep events accurate).
    let removed = 0;
    for (const match of matches) {
      const didDelete = await this.context.datastore.deleteById(
        match.record._id,
      );
      if (didDelete) {
        removed += 1;
        this.emitChange('remove', match.document._id, null);
      }
    }
    return removed;
  }

  public async count(filter?: Filter): Promise<number> {
    this.assertOpen();
    return this.find(filter).count();
  }

  public async exists(id: string): Promise<boolean> {
    this.assertOpen();
    validateIdString(id);
    return existsWithTtl(
      this.context.datastore,
      id,
      this.ttl,
      this.duplicateKeys,
      this.context.hasCustomKey,
    );
  }

  public async ids(): Promise<string[]> {
    this.assertOpen();
    return idsWithTtl(
      this.context.datastore,
      this.ttl,
      () => this.context.datastore.getAll(),
      this.context.hasCustomKey,
      this.duplicateKeys,
    );
  }

  public async purgeExpired(): Promise<number> {
    this.assertOpen();
    return purgeExpiredRecords(this.context.datastore, this.ttl, () =>
      this.context.datastore.getAll(),
    );
  }
}
