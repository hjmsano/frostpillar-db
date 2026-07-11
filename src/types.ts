import type {
  AutoCommitConfig,
  CapacityConfig,
  CapacityPolicy,
  Datastore,
  DatastoreConfig,
  DatastoreErrorEvent,
  DatastoreErrorListener,
  DatastoreKeyDefinition,
  DeleteRebalancePolicy,
  IndexConfig,
  PayloadLimitsConfig,
} from '@frostpillar/frostpillar-storage-engine';

import type { DatabaseCaches } from './internal/databaseCaches.js';

export type CollectionDuplicateKeyPolicy = 'allow' | 'replace' | 'reject';

export interface CollectionContext {
  readonly assertOpen: () => void;
  readonly datastore: Datastore;
  readonly skipInsertValidation: boolean;
  readonly payloadLimits?: PayloadLimitsConfig;
  readonly caches: DatabaseCaches;
  readonly maxMatchedDocuments: number;
  readonly onListenerError?: (error: unknown) => void;
}

export interface CollectionOptions {
  duplicateKeys?: CollectionDuplicateKeyPolicy;
  ttl?: number;
  capacity?: CapacityConfig;
  autoCommit?: AutoCommitConfig;
  index?: IndexConfig;
  key?: DatastoreKeyDefinition<unknown, unknown>;
  immutableCreatedAt?: boolean;
}

export interface ResolvedCollectionOptions {
  duplicateKeys: CollectionDuplicateKeyPolicy;
  ttl?: number;
  capacity?: CapacityConfig;
  autoCommit?: AutoCommitConfig;
  index?: IndexConfig;
  key?: DatastoreKeyDefinition<unknown, unknown>;
  immutableCreatedAt: boolean;
}

export type {
  AutoCommitConfig,
  CapacityConfig,
  CapacityPolicy,
  DeleteRebalancePolicy,
  DatastoreKeyDefinition,
  IndexConfig,
  PayloadLimitsConfig,
};

export type DatabaseConfig = Omit<DatastoreConfig, 'duplicateKeys'> & {
  maxErrorListeners?: number | 'unlimited';
  maxMatchedDocuments?: number;
};

export interface FrostpillarDocument {
  _id?: string;
}

export type FrostpillarStoredDocument<
  TDocument extends FrostpillarDocument = FrostpillarDocument,
> = Omit<TDocument, '_id'> & {
  _id: string;
};

export type InsertDocument<
  TDocument extends FrostpillarDocument = FrostpillarDocument,
> = Omit<TDocument, '_id'> & Partial<Pick<TDocument, '_id'>>;

export type Filter = Record<string, unknown>;

export type SortDirection = 1 | -1;
export type SortSpec = Record<string, SortDirection>;
export type SortSpecEntries = readonly (readonly [string, SortDirection])[];
export type SortInput = SortSpec | SortSpecEntries;

export type ProjectionValue = 0 | 1;
export type ProjectionSpec = Record<string, ProjectionValue>;

export interface UpdateOperations {
  $set?: Record<string, unknown>;
  $unset?: Record<string, unknown>;
  $inc?: Record<string, unknown>;
  $rename?: Record<string, unknown>;
  $push?: Record<string, unknown>;
  $pull?: Record<string, unknown>;
  $addToSet?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface UpdateOptions {
  upsert?: boolean;
}

export interface UpdateResult {
  modifiedCount: number;
  upsertedId: string | null;
}

export interface GroupAccumulator {
  $count?: true;
  $sum?: string;
  $avg?: string;
  $min?: string;
  $max?: string;
  $median?: string;
  $percentile?: { field: string; p: number };
  $stdDevPop?: string;
  $stdDevSamp?: string;
  $variancePop?: string;
  $varianceSamp?: string;
}

export type GroupAccumulators = Record<string, GroupAccumulator>;

export interface GroupResultEntry {
  _key: unknown;
  [outputField: string]: unknown;
}

export type DatabaseErrorEvent = DatastoreErrorEvent;
export type DatabaseErrorListener = DatastoreErrorListener;

export type ChangeEventType = 'insert' | 'update' | 'remove';

export interface ChangeEvent<
  TDocument extends FrostpillarDocument = FrostpillarDocument,
> {
  /** Type of change */
  readonly type: ChangeEventType;
  /** Collection name */
  readonly collection: string;
  /** The document's _id */
  readonly documentId: string;
  /** The document after the change (null for 'remove') */
  readonly document: FrostpillarStoredDocument<TDocument> | null;
}

export type ChangeListener<
  TDocument extends FrostpillarDocument = FrostpillarDocument,
> = (event: ChangeEvent<TDocument>) => void;
