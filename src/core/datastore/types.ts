import type { CapacityPolicy, RecordPayload } from '../types.js';

export interface CapacityState {
  maxSizeBytes: number;
  policy: CapacityPolicy;
}

export interface FileAutoCommitState {
  frequency: 'immediate' | 'scheduled';
  intervalMs: number | null;
  maxPendingBytes: number | null;
}

export type IntervalTimerHandle = ReturnType<typeof setInterval>;

export interface SerializablePersistedRecord {
  timestamp: number;
  payload: RecordPayload;
  insertionOrder: string;
}

export interface FileGenerationSnapshot {
  magic: string;
  version: number;
  rootPageId: number;
  nextPageId: number;
  freePageHeadId: number | null;
  records: SerializablePersistedRecord[];
}

export interface FileSidecarSnapshot {
  magic: string;
  version: number;
  activeDataFile: string;
  rootPageId: number;
  nextPageId: number;
  freePageHeadId: number | null;
  nextInsertionOrder: string;
  commitId: number;
}

export interface FileBackendState {
  dataFilePath: string;
  directoryPath: string;
  baseFileName: string;
  sidecarPath: string;
  lockPath: string;
  activeDataFile: string;
  commitId: number;
  rootPageId: number;
  nextPageId: number;
  freePageHeadId: number | null;
  lockAcquired: boolean;
}
