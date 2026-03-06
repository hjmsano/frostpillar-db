import { existsSync } from 'node:fs';
import type {
  FileDatastoreConfig,
  PersistedTimeseriesRecord,
} from '../types.js';
import { parseFileAutoCommitConfig } from './config.js';
import { createFileBackend, releaseFileLock } from './fileBackend.js';
import {
  commitFileBackendSnapshot,
  loadFileSnapshot,
  writeInitialFileSnapshot,
} from './fileBackendSnapshot.js';
import type { FileAutoCommitState, FileBackendState, IntervalTimerHandle } from './types.js';

export interface FileBackendControllerSnapshot {
  records: PersistedTimeseriesRecord[];
  nextInsertionOrder: bigint;
}

export interface FileBackendControllerCreateOptions {
  config: FileDatastoreConfig;
  getSnapshot: () => FileBackendControllerSnapshot;
  onAutoCommitError: (error: unknown) => void;
}

export interface FileBackendControllerCreateResult {
  controller: FileBackendController;
  initialRecords: PersistedTimeseriesRecord[];
  initialCurrentSizeBytes: number;
  initialNextInsertionOrder: bigint;
}

export class FileBackendController {
  private readonly backend: FileBackendState;
  private readonly autoCommit: FileAutoCommitState;
  private readonly getSnapshot: () => FileBackendControllerSnapshot;
  private readonly onAutoCommitError: (error: unknown) => void;
  private pendingAutoCommitBytes: number;
  private autoCommitTimer: IntervalTimerHandle | null;
  private closed: boolean;

  private constructor(
    backend: FileBackendState,
    autoCommit: FileAutoCommitState,
    getSnapshot: () => FileBackendControllerSnapshot,
    onAutoCommitError: (error: unknown) => void,
  ) {
    this.backend = backend;
    this.autoCommit = autoCommit;
    this.getSnapshot = getSnapshot;
    this.onAutoCommitError = onAutoCommitError;
    this.pendingAutoCommitBytes = 0;
    this.autoCommitTimer = null;
    this.closed = false;
    this.startAutoCommitSchedule();
  }

  public static create(
    options: FileBackendControllerCreateOptions,
  ): FileBackendControllerCreateResult {
    const autoCommit = parseFileAutoCommitConfig(options.config.autoCommit);
    const backend = createFileBackend(options.config);

    let initialRecords: PersistedTimeseriesRecord[] = [];
    let initialCurrentSizeBytes = 0;
    let initialNextInsertionOrder = 0n;

    if (!existsSync(backend.sidecarPath)) {
      writeInitialFileSnapshot(backend, initialNextInsertionOrder);
    } else {
      const loaded = loadFileSnapshot(backend);
      initialRecords = loaded.records;
      initialCurrentSizeBytes = loaded.currentSizeBytes;
      initialNextInsertionOrder = loaded.nextInsertionOrder;
    }

    const controller = new FileBackendController(
      backend,
      autoCommit,
      options.getSnapshot,
      options.onAutoCommitError,
    );
    return {
      controller,
      initialRecords,
      initialCurrentSizeBytes,
      initialNextInsertionOrder,
    };
  }

  public handleRecordAppended(encodedBytes: number): void {
    if (this.autoCommit.frequency === 'immediate') {
      this.commitNow();
      return;
    }

    this.pendingAutoCommitBytes += encodedBytes;
    if (
      this.autoCommit.maxPendingBytes !== null &&
      this.pendingAutoCommitBytes >= this.autoCommit.maxPendingBytes
    ) {
      this.commitNow();
    }
  }

  public commitNow(): void {
    const snapshot = this.getSnapshot();
    commitFileBackendSnapshot(
      this.backend,
      snapshot.records,
      snapshot.nextInsertionOrder,
    );
    this.pendingAutoCommitBytes = 0;
  }

  public close(): void {
    if (this.closed) {
      return;
    }

    this.stopAutoCommitSchedule();
    if (this.backend.lockAcquired) {
      releaseFileLock(this.backend);
    }
    this.closed = true;
  }

  private startAutoCommitSchedule(): void {
    if (this.autoCommit.frequency !== 'scheduled' || this.autoCommit.intervalMs === null) {
      return;
    }

    this.autoCommitTimer = setInterval((): void => {
      this.handleAutoCommitTick();
    }, this.autoCommit.intervalMs);
  }

  private stopAutoCommitSchedule(): void {
    if (this.autoCommitTimer === null) {
      return;
    }

    clearInterval(this.autoCommitTimer);
    this.autoCommitTimer = null;
  }

  private handleAutoCommitTick(): void {
    if (this.closed || this.pendingAutoCommitBytes <= 0) {
      return;
    }

    try {
      this.commitNow();
    } catch (error) {
      this.onAutoCommitError(error);
    }
  }
}
