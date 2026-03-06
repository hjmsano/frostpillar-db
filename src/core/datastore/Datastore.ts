import {
  ClosedDatastoreError,
  ConfigurationError,
  InvalidQueryRangeError,
  QueryEngineNotRegisteredError,
  UnsupportedBackendError,
  ValidationError,
} from '../errors/index.js';
import { compareByLogicalOrder, toPublicRecord } from '../records/ordering.js';
import type {
  DatastoreConfig,
  DatastoreErrorListener,
  InputTimeseriesRecord,
  NativeQueryRequest,
  NativeQueryResultRow,
  PersistedTimeseriesRecord,
  QueryEngineModule,
  QueryExecutionOptions,
  QueryLanguage,
  TimeRangeQuery,
  TimeseriesRecord,
} from '../types.js';
import { emitAutoCommitErrorToListeners } from './autoCommit.js';
import { validateAndNormalizePayload } from '../validation/payload.js';
import { normalizeTimestampInput } from '../validation/timestamp.js';
import { enforceCapacityPolicy } from './capacity.js';
import { parseCapacityConfig } from './config.js';
import { computeRecordEncodedBytes } from './encoding.js';
import {
  FileBackendController,
  type FileBackendControllerSnapshot,
} from './fileBackendController.js';
import { executeNativeQuery } from './query.js';
import type { CapacityState } from './types.js';

export class Datastore {
  private readonly errorListeners: Set<DatastoreErrorListener>;
  private readonly queryEngines: Map<QueryLanguage, QueryEngineModule>;
  private readonly records: PersistedTimeseriesRecord[];
  private readonly capacityState: CapacityState | null;
  private nextInsertionOrder: bigint;
  private currentSizeBytes: number;
  private closed: boolean;
  private fileBackendController: FileBackendController | null;

  constructor(config: DatastoreConfig) {
    this.errorListeners = new Set<DatastoreErrorListener>();
    this.queryEngines = new Map<QueryLanguage, QueryEngineModule>();
    this.records = [];
    this.capacityState = parseCapacityConfig(config.capacity);
    this.nextInsertionOrder = 0n;
    this.currentSizeBytes = 0;
    this.closed = false;
    this.fileBackendController = null;

    if (config.location === 'memory') {
      if (config.autoCommit !== undefined) {
        throw new ConfigurationError(
          'autoCommit is not supported for location: "memory".',
        );
      }
      return;
    }

    if (config.location === 'file') {
      const fileBackendCreateResult = FileBackendController.create({
        config,
        getSnapshot: (): FileBackendControllerSnapshot => ({
          records: this.records,
          nextInsertionOrder: this.nextInsertionOrder,
        }),
        onAutoCommitError: (error: unknown): void => {
          emitAutoCommitErrorToListeners(this.errorListeners, error);
        },
      });
      this.records.push(...fileBackendCreateResult.initialRecords);
      this.currentSizeBytes = fileBackendCreateResult.initialCurrentSizeBytes;
      this.nextInsertionOrder = fileBackendCreateResult.initialNextInsertionOrder;
      this.fileBackendController = fileBackendCreateResult.controller;
      return;
    }

    throw new UnsupportedBackendError(
      `Backend "${config.location}" is not implemented in current runtime slice.`,
    );
  }

  public insert(record: InputTimeseriesRecord): Promise<void> {
    return Promise.resolve().then((): void => {
      this.ensureOpen();

      const rawRecord = record as Record<string, unknown>;
      if ('insertionOrder' in rawRecord) {
        throw new ValidationError(
          'insertionOrder is internal metadata and must not be provided.',
        );
      }

      const normalizedTimestamp = normalizeTimestampInput(
        record.timestamp,
        'timestamp',
      );
      const normalizedPayload = validateAndNormalizePayload(record.payload);
      const encodedBytes = computeRecordEncodedBytes(
        normalizedTimestamp,
        normalizedPayload,
      );

      this.currentSizeBytes = enforceCapacityPolicy(
        this.records,
        this.capacityState,
        this.currentSizeBytes,
        encodedBytes,
      );

      this.records.push({
        timestamp: normalizedTimestamp,
        payload: normalizedPayload,
        insertionOrder: this.nextInsertionOrder,
        encodedBytes,
      });
      this.currentSizeBytes += encodedBytes;
      this.nextInsertionOrder += 1n;
      this.fileBackendController?.handleRecordAppended(encodedBytes);
    });
  }

  public select(query: TimeRangeQuery): Promise<TimeseriesRecord[]> {
    return Promise.resolve().then((): TimeseriesRecord[] => {
      this.ensureOpen();
      const start = normalizeTimestampInput(query.start, 'start');
      const end = normalizeTimestampInput(query.end, 'end');

      if (start > end) {
        throw new InvalidQueryRangeError('start must be <= end.');
      }

      return this.records
        .filter((record) => record.timestamp >= start && record.timestamp <= end)
        .sort(compareByLogicalOrder)
        .map(toPublicRecord);
    });
  }

  public query(
    language: QueryLanguage,
    queryText: string,
    options?: QueryExecutionOptions,
  ): Promise<NativeQueryResultRow[]> {
    return Promise.resolve().then(async (): Promise<NativeQueryResultRow[]> => {
      this.ensureOpen();
      const engine = this.queryEngines.get(language);
      if (engine === undefined) {
        throw new QueryEngineNotRegisteredError(
          `No query engine is registered for language "${language}".`,
        );
      }

      const request = engine.toNativeQuery(queryText, options);
      return await this.queryNative(request);
    });
  }

  public queryNative(request: NativeQueryRequest): Promise<NativeQueryResultRow[]> {
    return Promise.resolve().then((): NativeQueryResultRow[] => {
      this.ensureOpen();
      return executeNativeQuery(this.records, request);
    });
  }

  public registerQueryEngine(engine: QueryEngineModule): void {
    this.ensureOpen();
    this.queryEngines.set(engine.language, engine);
  }

  public unregisterQueryEngine(language: QueryLanguage): void {
    this.ensureOpen();
    this.queryEngines.delete(language);
  }

  public commit(): Promise<void> {
    return Promise.resolve().then((): void => {
      this.ensureOpen();
      this.fileBackendController?.commitNow();
    });
  }

  public on(event: 'error', listener: DatastoreErrorListener): () => void;
  public on(event: string, listener: DatastoreErrorListener): () => void {
    if (event !== 'error') {
      throw new ValidationError('Only "error" event is supported.');
    }
    this.errorListeners.add(listener);
    return (): void => {
      this.off(event, listener);
    };
  }

  public off(event: 'error', listener: DatastoreErrorListener): void;
  public off(event: string, listener: DatastoreErrorListener): void {
    if (event !== 'error') {
      throw new ValidationError('Only "error" event is supported.');
    }
    this.errorListeners.delete(listener);
  }

  public close(): Promise<void> {
    return Promise.resolve().then((): void => {
      if (this.closed) {
        return;
      }

      this.fileBackendController?.close();
      this.fileBackendController = null;

      this.closed = true;
      this.queryEngines.clear();
      this.errorListeners.clear();
    });
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new ClosedDatastoreError('Datastore has been closed.');
    }
  }
}
