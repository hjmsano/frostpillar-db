import type { RecordPayload } from '@frostpillar/frostpillar-storage-engine';

import { ClosedDatabaseError } from './errors.js';
import { ChangeEmitter } from './internal/changeEmitter.js';
import {
  extractIdEquality,
  validateFilterArgument,
  validateIdString,
} from './internal/filterUtils.js';
import {
  validateInsertPayload,
  validatePayloadSecurity,
} from './internal/payloadValidator.js';
import { applyUpdateOperations } from './internal/updateApplier.js';
import {
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
  buildUpsertDocument,
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
  private readonly updateMaxDepth: number;
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
    this.updateMaxDepth = context.payloadLimits?.maxDepth ?? DEFAULT_MAX_DEPTH;
    if (context.onListenerError !== undefined) {
      this.changeEmitter.setErrorHandler(context.onListenerError);
    }
    this.queryContext = {
      datastore: context.datastore,
      caches: context.caches,
      maxMatchedDocuments: context.maxMatchedDocuments,
      ttl,
      duplicateKeys,
    };
    this.chainContext = createChainContext<TDocument>(
      () => this.assertOpen(),
      this.queryContext,
    );
  }

  public watch(listener: ChangeListener<TDocument>): () => void {
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

  private validatePayload(document: unknown): void {
    if (this.context.skipInsertValidation) {
      validatePayloadSecurity(document, this.context.payloadLimits?.maxDepth);
    } else {
      validateInsertPayload(document, this.context.payloadLimits);
    }
  }

  public async insert(document: InsertDocument<TDocument>): Promise<string> {
    this.assertOpen();
    this.validatePayload(document);
    const { id, payload, record } = prepareInsertRecord<TDocument>(
      document,
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
    for (const doc of documents) {
      this.validatePayload(doc);
    }
    const now = Date.now();
    const count = documents.length;
    const records = new Array<{ key: string; payload: RecordPayload }>(count);
    const ids = new Array<string>(count);
    const payloads = new Array<FrostpillarStoredDocument<TDocument>>(count);
    for (let i = 0; i < count; i++) {
      const { id, payload, record } = prepareInsertRecord<TDocument>(
        documents[i],
        now,
        this.ttl,
      );
      records[i] = record;
      ids[i] = id;
      payloads[i] = payload;
    }
    try {
      await this.context.datastore.putMany(records);
    } catch (e) {
      rethrowStorageError(e, this.name);
    }
    for (let i = 0; i < count; i++) {
      this.emitChange('insert', ids[i], payloads[i]);
    }
    return ids;
  }

  public find(filter?: Filter): ResultChain<TDocument> {
    this.assertOpen();
    validateFilterArgument(filter, 'Collection.find', true);
    return new ResultChain<TDocument>(this.chainContext, { filter });
  }

  public async findOne(
    filter?: Filter,
  ): Promise<FrostpillarStoredDocument<TDocument> | null> {
    this.assertOpen();
    validateFilterArgument(filter, 'Collection.findOne', true);
    const idKey = filter !== undefined ? extractIdEquality(filter) : null;
    if (
      idKey !== null &&
      !(this.duplicateKeys === 'allow' && this.ttl !== undefined)
    ) {
      return findOneByIdOptimized<TDocument>(
        this.context.datastore,
        idKey,
        this.ttl,
      );
    }
    return (await this.find(filter).limit(1).toArray())[0] ?? null;
  }

  public async update(
    filter: Filter,
    operations: UpdateOperations,
    options?: UpdateOptions,
  ): Promise<UpdateResult> {
    this.assertOpen();
    validateFilterArgument(filter, 'Collection.update', false);
    if (Object.keys(operations).length === 0)
      return { modifiedCount: 0, upsertedId: null };

    const records = await getRecordsByFilter(this.queryContext, filter);
    const matches = collectFilteredDocuments<TDocument>(
      this.queryContext,
      records,
      filter,
    );

    let updated = 0;
    for (const { record, document } of matches) {
      const result = applyUpdateOperations(
        document,
        operations,
        this.context.caches.pathCache,
        this.protectCreatedAt,
        this.updateMaxDepth,
      );
      if (!result.changed) continue;
      this.validatePayload(result.document);
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

    if (matches.length > 0 || !options?.upsert) {
      return { modifiedCount: updated, upsertedId: null };
    }
    return await this.performUpsert(filter, operations);
  }

  private async performUpsert(
    filter: Filter,
    operations: UpdateOperations,
  ): Promise<UpdateResult> {
    const insertDoc = buildUpsertDocument<TDocument>(
      filter,
      operations,
      this.context.caches.pathCache,
      this.protectCreatedAt,
      this.updateMaxDepth,
    );
    const insertedId = await this.insert(insertDoc);
    return { modifiedCount: 0, upsertedId: insertedId };
  }

  public async remove(filter: Filter): Promise<number> {
    this.assertOpen();
    validateFilterArgument(filter, 'Collection.remove', false);
    const fastPath = await removeNoTtlFastPath(
      this.context.datastore,
      filter,
      this.ttl,
      this.duplicateKeys,
      (id) => this.emitChange('remove', id, null),
    );
    if (fastPath !== null) return fastPath;

    const records = await getRecordsByFilter(this.queryContext, filter);
    const matches = collectFilteredDocuments<TDocument>(
      this.queryContext,
      records,
      filter,
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
    );
  }

  public async ids(): Promise<string[]> {
    this.assertOpen();
    return idsWithTtl(this.context.datastore, this.ttl, () =>
      this.context.datastore.getAll(),
    );
  }

  public async purgeExpired(): Promise<number> {
    this.assertOpen();
    return purgeExpiredRecords(this.context.datastore, this.ttl, () =>
      this.context.datastore.getAll(),
    );
  }
}
