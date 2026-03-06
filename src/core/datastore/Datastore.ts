import {
  ClosedDatastoreError,
  ConfigurationError,
  InvalidQueryRangeError,
  UnsupportedBackendError,
  ValidationError,
} from '../errors/index.js';
import { compareByLogicalOrder, toPublicRecord } from '../records/ordering.js';
import type {
  DatastoreConfig,
  DatastoreErrorListener,
  InputTimeseriesRecord,
  PersistedTimeseriesRecord,
  TimeRangeQuery,
  TimeseriesRecord,
} from '../types.js';
import { validateAndNormalizePayload } from '../validation/payload.js';
import { normalizeTimestampInput } from '../validation/timestamp.js';

export class Datastore {
  private readonly errorListeners: Set<DatastoreErrorListener>;

  private readonly records: PersistedTimeseriesRecord[];

  private nextInsertionOrder: bigint;

  private closed: boolean;

  constructor(config: DatastoreConfig) {
    this.errorListeners = new Set<DatastoreErrorListener>();
    this.records = [];
    this.nextInsertionOrder = 0n;
    this.closed = false;

    if (config.location === 'memory') {
      if (config.autoCommit !== undefined) {
        throw new ConfigurationError(
          'autoCommit is not supported for location: "memory".',
        );
      }

      return;
    }

    throw new UnsupportedBackendError(
      `Backend "${config.location}" is not implemented in M1.`,
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

      const persistedRecord: PersistedTimeseriesRecord = {
        timestamp: normalizedTimestamp,
        payload: normalizedPayload,
        insertionOrder: this.nextInsertionOrder,
      };

      this.records.push(persistedRecord);
      this.nextInsertionOrder += 1n;
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

  public commit(): Promise<void> {
    return Promise.resolve().then((): void => {
      this.ensureOpen();
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

      this.closed = true;
      this.errorListeners.clear();
    });
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new ClosedDatastoreError('Datastore has been closed.');
    }
  }
}
