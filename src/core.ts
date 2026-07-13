export { Collection } from './collection.js';
export { Database } from './database.js';
export { ResultChain } from './resultChain.js';
export { collectionNamespace } from './internal/collectionNamespace.js';
export {
  ClosedDatabaseError,
  ConfigurationError,
  DuplicateIdError,
  ValidationError,
} from './errors.js';

export {
  DatabaseLockedError,
  FrostpillarError,
  QuotaExceededError,
} from '@frostpillar/frostpillar-storage-engine';

export type {
  AutoCommitConfig,
  CapacityConfig,
  CapacityPolicy,
  ChangeEvent,
  ChangeEventType,
  ChangeListener,
  CollectionDuplicateKeyPolicy,
  CollectionOptions,
  DatabaseConfig,
  DatabaseDriverFactory,
  DatastoreDriver,
  DatastoreKeyDefinition,
  DatabaseErrorEvent,
  DatabaseErrorListener,
  DeleteRebalancePolicy,
  Filter,
  FrostpillarDocument,
  FrostpillarStoredDocument,
  GroupAccumulator,
  IndexConfig,
  GroupAccumulators,
  GroupResultEntry,
  InsertDocument,
  PayloadLimitsConfig,
  ProjectionSpec,
  ProjectionValue,
  ResolvedCollectionOptions,
  SortDirection,
  SortInput,
  SortSpec,
  SortSpecEntries,
  UpdateOperations,
  UpdateOptions,
  UpdateResult,
} from './types.js';
