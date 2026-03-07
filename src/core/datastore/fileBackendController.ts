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

export interface FileBackendControllerTestHooks {
  beforeCommit?: () => void | Promise<void>;
  afterCommit?: () => void | Promise<void>;
}

interface FileDatastoreConfigWithTestHooks extends FileDatastoreConfig {
  __testHooks?: FileBackendControllerTestHooks;
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
  private readonly testHooks: FileBackendControllerTestHooks | null;
  private pendingAutoCommitBytes: number;
  private autoCommitTimer: IntervalTimerHandle | null;
  private commitInFlight: Promise<void> | null;
  private pendingForegroundCommitRequest: boolean;
  private pendingBackgroundCommitRequest: boolean;
  private closed: boolean;

  private constructor(
    backend: FileBackendState,
    autoCommit: FileAutoCommitState,
    getSnapshot: () => FileBackendControllerSnapshot,
    onAutoCommitError: (error: unknown) => void,
    testHooks: FileBackendControllerTestHooks | null,
  ) {
    this.backend = backend;
    this.autoCommit = autoCommit;
    this.getSnapshot = getSnapshot;
    this.onAutoCommitError = onAutoCommitError;
    this.testHooks = testHooks;
    this.pendingAutoCommitBytes = 0;
    this.autoCommitTimer = null;
    this.commitInFlight = null;
    this.pendingForegroundCommitRequest = false;
    this.pendingBackgroundCommitRequest = false;
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

    const configWithTestHooks = options.config as FileDatastoreConfigWithTestHooks;

    const controller = new FileBackendController(
      backend,
      autoCommit,
      options.getSnapshot,
      options.onAutoCommitError,
      configWithTestHooks.__testHooks ?? null,
    );
    return {
      controller,
      initialRecords,
      initialCurrentSizeBytes,
      initialNextInsertionOrder,
    };
  }

  public handleRecordAppended(encodedBytes: number): Promise<void> {
    if (this.autoCommit.frequency === 'immediate') {
      return this.commitNow();
    }

    this.pendingAutoCommitBytes += encodedBytes;
    if (
      this.autoCommit.maxPendingBytes !== null &&
      this.pendingAutoCommitBytes >= this.autoCommit.maxPendingBytes
    ) {
      return this.queueCommitRequest('foreground');
    }

    return Promise.resolve();
  }

  public commitNow(): Promise<void> {
    return this.queueCommitRequest('foreground');
  }

  public close(): Promise<void> {
    return Promise.resolve().then(async (): Promise<void> => {
      if (this.closed) {
        return;
      }

      this.closed = true;
      this.stopAutoCommitSchedule();
      await this.waitForCommitSettlement();
      if (this.backend.lockAcquired) {
        releaseFileLock(this.backend);
      }
    });
  }

  private waitForCommitSettlement(): Promise<void> {
    if (this.commitInFlight === null) {
      return Promise.resolve();
    }

    return this.commitInFlight
      .then((): void => undefined)
      .catch((): void => undefined);
  }

  private queueCommitRequest(
    requestType: 'foreground' | 'background',
  ): Promise<void> {
    if (requestType === 'foreground') {
      this.pendingForegroundCommitRequest = true;
    } else {
      this.pendingBackgroundCommitRequest = true;
    }

    if (this.commitInFlight === null) {
      this.commitInFlight = this.runCommitLoop().finally((): void => {
        this.commitInFlight = null;
      });
    }

    if (requestType === 'background') {
      return Promise.resolve();
    }

    return this.commitInFlight;
  }

  private runCommitLoop(): Promise<void> {
    return Promise.resolve().then(async (): Promise<void> => {
      let shouldContinue = true;
      while (shouldContinue) {
        const runForeground = this.pendingForegroundCommitRequest;
        const runBackground = this.pendingBackgroundCommitRequest;
        this.pendingForegroundCommitRequest = false;
        this.pendingBackgroundCommitRequest = false;

        const shouldRunCommit =
          runForeground || (runBackground && this.pendingAutoCommitBytes > 0);
        if (!shouldRunCommit) {
          shouldContinue = false;
          continue;
        }

        try {
          const committedPendingBytes = await this.executeSingleCommit();
          this.pendingAutoCommitBytes = Math.max(
            0,
            this.pendingAutoCommitBytes - committedPendingBytes,
          );
        } catch (error) {
          if (runForeground) {
            throw error;
          }
          this.onAutoCommitError(error);
        }

        if (
          !this.pendingForegroundCommitRequest &&
          !this.pendingBackgroundCommitRequest
        ) {
          shouldContinue = false;
        }
      }
    });
  }

  private executeSingleCommit(): Promise<number> {
    return Promise.resolve().then(async (): Promise<number> => {
      await this.testHooks?.beforeCommit?.();

      const committedPendingBytes = this.pendingAutoCommitBytes;
      const snapshot = this.getSnapshot();
      commitFileBackendSnapshot(
        this.backend,
        snapshot.records,
        snapshot.nextInsertionOrder,
      );

      await this.testHooks?.afterCommit?.();
      return committedPendingBytes;
    });
  }

  private startAutoCommitSchedule(): void {
    if (
      this.autoCommit.frequency !== 'scheduled' ||
      this.autoCommit.intervalMs === null
    ) {
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
    if (this.closed) {
      return;
    }
    if (this.pendingAutoCommitBytes <= 0) {
      return;
    }
    void this.queueCommitRequest('background');
  }
}
