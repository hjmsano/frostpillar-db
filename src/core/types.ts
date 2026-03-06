export type TimestampInput = number | string | Date;
export type RecordId = string;
export type NativeScalar = string | number | boolean | null;
export type NativeQueryResultRow = Record<string, NativeScalar>;
export type ByteSizeInput =
  | number
  | `${number}B`
  | `${number}KB`
  | `${number}MB`
  | `${number}GB`;
export type AutoCommitFrequencyInput =
  | 'immediate'
  | number
  | `${number}ms`
  | `${number}s`
  | `${number}m`
  | `${number}h`;

export type SupportedValue = string | number | boolean | null;
export type SupportedNestedValue =
  | SupportedValue
  | { [key in string]: SupportedNestedValue };
export type RecordPayload = { [key in string]: SupportedNestedValue };

export interface TimeseriesRecord {
  timestamp: number;
  payload: RecordPayload;
}

export interface PersistedTimeseriesRecord extends TimeseriesRecord {
  insertionOrder: bigint;
}

export type InputTimeseriesRecord = Omit<TimeseriesRecord, 'timestamp'> & {
  timestamp: TimestampInput;
};

export interface TimeRangeQuery {
  start: TimestampInput;
  end: TimestampInput;
}

export type CapacityPolicy = 'strict' | 'turnover';

export interface CapacityConfig {
  maxSize: ByteSizeInput;
  policy?: CapacityPolicy;
}

export interface AutoCommitConfig {
  frequency?: AutoCommitFrequencyInput;
  maxPendingBytes?: number;
}

export interface MemoryDatastoreConfig {
  location: 'memory';
  autoCommit?: never;
  capacity?: CapacityConfig;
}

export interface FileTargetByPathConfig {
  kind: 'path';
  filePath: string;
  directory?: never;
  fileName?: never;
  filePrefix?: never;
}

export interface FileTargetByDirectoryConfig {
  kind: 'directory';
  directory: string;
  fileName?: string;
  filePrefix?: string;
  filePath?: never;
}

export type FileTargetConfig =
  | FileTargetByPathConfig
  | FileTargetByDirectoryConfig;

export interface FileDatastoreConfig {
  location: 'file';
  target?: FileTargetConfig;
  filePath?: string;
  autoCommit?: AutoCommitConfig;
  capacity?: CapacityConfig;
}

export interface OpfsConfig {
  directoryName?: string;
}

export interface IndexedDBConfig {
  databaseName?: string;
  objectStoreName?: string;
  version?: number;
}

export interface LocalStorageConfig {
  keyPrefix?: string;
  databaseKey?: string;
  maxChunkChars?: number;
  maxChunks?: number;
}

export type BrowserStorageType = 'auto' | 'opfs' | 'indexedDB' | 'localStorage';

export interface BrowserDatastoreConfig {
  location: 'browser';
  browserStorage?: BrowserStorageType;
  opfs?: OpfsConfig;
  indexedDB?: IndexedDBConfig;
  localStorage?: LocalStorageConfig;
  autoCommit?: AutoCommitConfig;
  capacity?: CapacityConfig;
}

export type DatastoreConfig =
  | MemoryDatastoreConfig
  | FileDatastoreConfig
  | BrowserDatastoreConfig;

export interface DatastoreErrorEvent {
  source: 'autoCommit';
  error: Error;
  occurredAt: number;
}

export type DatastoreErrorListener = (
  event: DatastoreErrorEvent,
) => void | Promise<void>;
