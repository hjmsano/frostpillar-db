import { Datastore } from '@frostpillar/frostpillar-storage-engine';
import type { DatastoreDriver } from '@frostpillar/frostpillar-storage-engine';

import { Collection } from './collection.js';
import { ClosedDatabaseError, ConfigurationError } from './errors.js';
import { validateCollectionName } from './internal/collectionName.js';
import {
  createDatabaseCaches,
  type DatabaseCaches,
} from './internal/databaseCaches.js';
import {
  DEFAULT_MAX_ERROR_LISTENERS,
  isSameCollectionOptions,
  resolveCollectionOptions,
  validatePayloadLimits,
} from './internal/databaseOptions.js';
import { DEFAULT_MAX_MATCHED_DOCUMENTS } from './internal/limits.js';
import type {
  AutoCommitConfig,
  CapacityConfig,
  CollectionDuplicateKeyPolicy,
  CollectionOptions,
  DatabaseConfig,
  DatabaseErrorListener,
  DatastoreKeyDefinition,
  FrostpillarDocument,
  IndexConfig,
  ResolvedCollectionOptions,
} from './types.js';

export class Database {
  private readonly baseConfig: DatabaseConfig;
  private readonly datastores: Map<string, Datastore>;
  private readonly collections: Map<string, Collection<FrostpillarDocument>>;
  private readonly collectionOptions: Map<string, ResolvedCollectionOptions>;
  private readonly errorListeners: DatabaseErrorListener[];
  // Per-datastore listener→unsub table. Keyed by collection name, then by the
  // original listener reference. Lets on()'s unsubscribe walk the CURRENT set
  // of datastores (including ones created after on() was called).
  private readonly errorUnsubscribers: Map<
    string,
    Map<DatabaseErrorListener, () => void>
  >;
  private closed: boolean;
  private readonly caches: DatabaseCaches;
  private readonly maxErrorListeners: number; // Infinity means unlimited
  private errorListenerWarnEmitted: boolean;
  private readonly maxMatchedDocuments: number;

  public constructor(config?: DatabaseConfig) {
    if (config?.payloadLimits !== undefined) {
      validatePayloadLimits(config.payloadLimits);
    }
    const rawMax = config?.maxErrorListeners;
    if (rawMax !== undefined) {
      if (rawMax !== 'unlimited') {
        if (!Number.isSafeInteger(rawMax) || rawMax <= 0) {
          throw new ConfigurationError(
            'maxErrorListeners must be a positive safe integer or "unlimited".',
          );
        }
      }
    }
    this.maxErrorListeners =
      rawMax === 'unlimited'
        ? Infinity
        : (rawMax ?? DEFAULT_MAX_ERROR_LISTENERS);
    this.errorListenerWarnEmitted = false;
    const rawMaxMatched = config?.maxMatchedDocuments;
    if (rawMaxMatched !== undefined) {
      if (!Number.isSafeInteger(rawMaxMatched) || rawMaxMatched <= 0) {
        throw new ConfigurationError(
          'maxMatchedDocuments must be a positive safe integer.',
        );
      }
    }
    this.maxMatchedDocuments = rawMaxMatched ?? DEFAULT_MAX_MATCHED_DOCUMENTS;
    this.baseConfig = config ?? {};
    this.caches = createDatabaseCaches();
    this.datastores = new Map<string, Datastore>();
    this.collections = new Map<string, Collection<FrostpillarDocument>>();
    this.collectionOptions = new Map<string, ResolvedCollectionOptions>();
    this.errorListeners = [];
    this.errorUnsubscribers = new Map<
      string,
      Map<DatabaseErrorListener, () => void>
    >();
    this.closed = false;
  }

  // Resolves the driver for a new collection's datastore. A factory yields an
  // isolated physical namespace per collection; a plain DatastoreDriver is
  // bound to a single namespace, so sharing it across collections would
  // target the same lock/file (DatabaseLockedError) or silently overwrite
  // snapshots (last-writer-wins data loss). See ADR-024.
  private resolveDriver(name: string): DatastoreDriver | undefined {
    const driver = this.baseConfig.driver;
    if (driver === undefined) {
      return undefined;
    }
    if (typeof driver === 'function') {
      return driver(name);
    }
    if (this.datastores.size > 0) {
      throw new ConfigurationError(
        `Cannot create collection "${name}": a plain DatastoreDriver instance targets a single physical namespace and cannot back more than one collection. ` +
          'Pass a driver factory ((collectionName) => DatastoreDriver) that derives a per-collection namespace instead.',
      );
    }
    return driver;
  }

  private createDatastore(
    driver: DatastoreDriver | undefined,
    duplicateKeys: CollectionDuplicateKeyPolicy,
    capacity?: CapacityConfig,
    autoCommit?: AutoCommitConfig,
    index?: IndexConfig,
    key?: DatastoreKeyDefinition<unknown, unknown>,
  ): Datastore {
    const {
      driver: _driver,
      maxErrorListeners: _maxErrorListeners,
      maxMatchedDocuments: _maxMatchedDocuments,
      ...datastoreBaseConfig
    } = this.baseConfig;
    return new Datastore({
      ...datastoreBaseConfig,
      ...(driver !== undefined ? { driver } : {}),
      skipPayloadValidation: true,
      duplicateKeys,
      ...(capacity !== undefined ? { capacity } : {}),
      ...(autoCommit !== undefined ? { autoCommit } : {}),
      ...(index !== undefined ? { index } : {}),
      ...(key !== undefined ? { key } : {}),
    });
  }

  private registerErrorListeners(name: string, datastore: Datastore): void {
    const entry = new Map<DatabaseErrorListener, () => void>();
    for (const listener of this.errorListeners) {
      entry.set(listener, datastore.on('error', listener));
    }
    this.errorUnsubscribers.set(name, entry);
  }

  private createCollectionInstance(
    name: string,
    resolvedOptions: ResolvedCollectionOptions,
    datastore: Datastore,
  ): Collection<FrostpillarDocument> {
    return new Collection<FrostpillarDocument>(
      {
        assertOpen: () => this.assertOpen(),
        datastore,
        skipInsertValidation: this.baseConfig.skipPayloadValidation === true,
        payloadLimits: this.baseConfig.payloadLimits,
        caches: this.caches,
        maxMatchedDocuments: this.maxMatchedDocuments,
        onListenerError: (error: unknown) => {
          const message =
            error instanceof Error ? error.message : String(error);
          console.warn(
            `[frostpillar-db] watch() listener error in collection "${name}": ${message}`,
          );
        },
      },
      name,
      resolvedOptions.duplicateKeys,
      resolvedOptions.ttl,
      resolvedOptions.immutableCreatedAt,
    );
  }

  public collection<
    TDocument extends FrostpillarDocument = FrostpillarDocument,
  >(name: string, options?: CollectionOptions): Collection<TDocument> {
    this.assertOpen();
    validateCollectionName(name);

    const resolvedOptions = resolveCollectionOptions(options);
    const existing = this.collections.get(name);
    if (existing !== undefined) {
      // Invariant: whenever a collection exists in `this.collections`, its resolved
      // options are also stored in `this.collectionOptions` (both set together in
      // the create path below). Non-null assertion is safe; drop the dead guard.
      const existingOptions = this.collectionOptions.get(name);
      if (
        existingOptions === undefined ||
        !isSameCollectionOptions(existingOptions, resolvedOptions)
      ) {
        throw new ConfigurationError(
          `Collection "${name}" was already created with different options.`,
        );
      }
      return existing as Collection<TDocument>;
    }

    const driver = this.resolveDriver(name);
    this.collectionOptions.set(name, resolvedOptions);
    const datastore = this.createDatastore(
      driver,
      resolvedOptions.duplicateKeys,
      resolvedOptions.capacity,
      resolvedOptions.autoCommit,
      resolvedOptions.index,
      resolvedOptions.key,
    );
    this.datastores.set(name, datastore);
    this.registerErrorListeners(name, datastore);

    const collection = this.createCollectionInstance(
      name,
      resolvedOptions,
      datastore,
    );
    this.collections.set(name, collection);

    return collection as Collection<TDocument>;
  }

  public async dropCollection(name: string): Promise<void> {
    this.assertOpen();
    validateCollectionName(name);

    const datastore = this.datastores.get(name);
    try {
      if (datastore !== undefined) {
        await datastore.clear();
      }
    } finally {
      const collection = this.collections.get(name);
      if (collection !== undefined) {
        collection.markDropped();
      }
      this.collections.delete(name);
      this.collectionOptions.delete(name);
      this.datastores.delete(name);

      if (datastore !== undefined) {
        const entry = this.errorUnsubscribers.get(name);
        if (entry !== undefined) {
          for (const unsub of entry.values()) {
            unsub();
          }
          this.errorUnsubscribers.delete(name);
        }
        await datastore.close();
      }
    }
  }

  public listCollections(): Promise<string[]> {
    // assertOpen() is called inside the promise so a closed-database error
    // surfaces as a rejection (not a synchronous throw), matching the async
    // contract expected by callers using assert.rejects / .catch.
    return Promise.resolve().then(() => {
      this.assertOpen();
      return Array.from(this.collections.keys()).sort();
    });
  }

  public async commit(): Promise<void> {
    this.assertOpen();
    for (const datastore of this.datastores.values()) {
      await datastore.commit();
    }
  }

  public async close(): Promise<void> {
    this.assertOpen();
    this.closed = true;

    for (const entry of this.errorUnsubscribers.values()) {
      for (const unsub of entry.values()) {
        unsub();
      }
    }

    for (const datastore of this.datastores.values()) {
      await datastore.close();
    }

    this.errorListeners.length = 0;
    this.errorUnsubscribers.clear();
    this.collections.clear();
    this.datastores.clear();
    this.collectionOptions.clear();
    this.caches.pathCache.clear();
    this.caches.regexStringCache.clear();
  }

  public on(event: 'error', listener: DatabaseErrorListener): () => void {
    this.assertOpen();

    // Idempotent: if this exact listener reference is already registered,
    // return a no-op to avoid leaking duplicate underlying subscriptions.
    if (this.errorListeners.includes(listener)) {
      return () => undefined;
    }

    this.errorListeners.push(listener);

    if (
      !this.errorListenerWarnEmitted &&
      this.errorListeners.length > this.maxErrorListeners
    ) {
      this.errorListenerWarnEmitted = true;
      console.warn(
        `[frostpillar-db] Database.on('error') has ${this.errorListeners.length.toString()} listeners registered, ` +
          `which exceeds the maxErrorListeners threshold (${this.maxErrorListeners.toString()}). ` +
          `This may indicate a listener leak. To suppress this warning, increase or disable the threshold ` +
          `via the maxErrorListeners DatabaseConfig option (e.g. maxErrorListeners: 64 or maxErrorListeners: 'unlimited').`,
      );
    }

    for (const [name, datastore] of this.datastores) {
      const unsub = datastore.on(event, listener);
      let entry = this.errorUnsubscribers.get(name);
      if (entry === undefined) {
        entry = new Map<DatabaseErrorListener, () => void>();
        this.errorUnsubscribers.set(name, entry);
      }
      entry.set(listener, unsub);
    }

    return () => {
      const index = this.errorListeners.indexOf(listener);
      if (index !== -1) this.errorListeners.splice(index, 1);
      // Reset the warn flag when the count drops back to or below the threshold
      // so a future re-crossing will warn again.
      if (this.errorListeners.length <= this.maxErrorListeners) {
        this.errorListenerWarnEmitted = false;
      }
      // Walk the CURRENT datastore set (not a snapshot) so listeners
      // attached to datastores created after on() are also detached.
      for (const entry of this.errorUnsubscribers.values()) {
        const unsub = entry.get(listener);
        if (unsub !== undefined) {
          unsub();
          entry.delete(listener);
        }
      }
    };
  }

  public assertOpen(): void {
    if (this.closed) {
      throw new ClosedDatabaseError('Database has already been closed.');
    }
  }
}
