import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import {
  ClosedDatastoreError,
  ConfigurationError,
  DatabaseLockedError,
  InvalidQueryRangeError,
  PageCorruptionError,
  QueryEngineNotRegisteredError,
  QueryValidationError,
  QuotaExceededError,
  StorageEngineError,
  UnsupportedBackendError,
  UnsupportedQueryFeatureError,
  ValidationError,
} from '../errors/index.js';
import { compareByLogicalOrder, toPublicRecord } from '../records/ordering.js';
import type {
  AutoCommitConfig,
  CapacityConfig,
  CapacityPolicy,
  DatastoreConfig,
  DatastoreErrorEvent,
  DatastoreErrorListener,
  FileDatastoreConfig,
  InputTimeseriesRecord,
  NativeFilterExpression,
  NativeQueryRequest,
  NativeQueryResultRow,
  NativeScalar,
  PersistedTimeseriesRecord,
  QueryEngineModule,
  QueryExecutionOptions,
  QueryLanguage,
  RecordPayload,
  TimeRangeQuery,
  TimeseriesRecord,
} from '../types.js';
import { validateAndNormalizePayload } from '../validation/payload.js';
import { normalizeTimestampInput } from '../validation/timestamp.js';

const UTF8_ENCODER = new TextEncoder();
const U64_MAX = 18446744073709551615n;
const SIDE_CAR_MAGIC = 'FPGE_META';
const GENERATION_MAGIC = 'FPGE_DATA';
const FORMAT_VERSION = 1;

type NodeErrorWithCode = Error & { code?: string };

interface CapacityState {
  maxSizeBytes: number;
  policy: CapacityPolicy;
}

interface FileAutoCommitState {
  frequency: 'immediate' | 'scheduled';
  intervalMs: number | null;
  maxPendingBytes: number | null;
}

type IntervalTimerHandle = ReturnType<typeof setInterval>;

interface SerializablePersistedRecord {
  timestamp: number;
  payload: RecordPayload;
  insertionOrder: string;
}

interface FileGenerationSnapshot {
  magic: string;
  version: number;
  rootPageId: number;
  nextPageId: number;
  freePageHeadId: number | null;
  records: SerializablePersistedRecord[];
}

interface FileSidecarSnapshot {
  magic: string;
  version: number;
  activeDataFile: string;
  rootPageId: number;
  nextPageId: number;
  freePageHeadId: number | null;
  nextInsertionOrder: string;
  commitId: number;
}

interface FileBackendState {
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

const toNodeErrorCode = (error: unknown): string | undefined => {
  if (error instanceof Error) {
    const nodeError = error as NodeErrorWithCode;
    return nodeError.code;
  }

  return undefined;
};

const throwStorageError = (message: string, error: unknown): never => {
  if (error instanceof StorageEngineError) {
    throw error;
  }

  if (error instanceof Error) {
    throw new StorageEngineError(`${message}: ${error.message}`);
  }

  throw new StorageEngineError(message);
};

const parseCapacityConfig = (capacity?: CapacityConfig): CapacityState | null => {
  if (capacity === undefined) {
    return null;
  }

  const maxSizeBytes = normalizeByteSizeInput(capacity.maxSize);
  const policy = capacity.policy ?? 'strict';
  if (policy !== 'strict' && policy !== 'turnover') {
    throw new ConfigurationError('capacity.policy must be "strict" or "turnover".');
  }

  return { maxSizeBytes, policy };
};

const parseFileAutoCommitConfig = (
  autoCommit?: AutoCommitConfig,
): FileAutoCommitState => {
  if (autoCommit?.maxPendingBytes !== undefined) {
    if (
      !Number.isSafeInteger(autoCommit.maxPendingBytes) ||
      autoCommit.maxPendingBytes <= 0
    ) {
      throw new ConfigurationError(
        'autoCommit.maxPendingBytes must be a positive safe integer.',
      );
    }
  }

  const frequency = autoCommit?.frequency;
  if (frequency === undefined || frequency === 'immediate') {
    return {
      frequency: 'immediate',
      intervalMs: null,
      maxPendingBytes: autoCommit?.maxPendingBytes ?? null,
    };
  }

  if (typeof frequency === 'number') {
    if (!Number.isSafeInteger(frequency) || frequency <= 0) {
      throw new ConfigurationError(
        'autoCommit.frequency number must be a positive safe integer.',
      );
    }

    return {
      frequency: 'scheduled',
      intervalMs: frequency,
      maxPendingBytes: autoCommit?.maxPendingBytes ?? null,
    };
  }

  const matched = /^(\d+)(ms|s|m|h)$/.exec(frequency);
  if (matched === null) {
    throw new ConfigurationError(
      'autoCommit.frequency string must be one of: <positive>ms, <positive>s, <positive>m, <positive>h.',
    );
  }
  const amount = Number(matched[1]);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new ConfigurationError(
      'autoCommit.frequency string amount must be a positive safe integer.',
    );
  }

  const unit = matched[2];
  const multiplierByUnit: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
  };
  const multiplier = multiplierByUnit[unit];
  const intervalMs = amount * multiplier;
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
    throw new ConfigurationError(
      'autoCommit.frequency exceeds safe integer range.',
    );
  }

  return {
    frequency: 'scheduled',
    intervalMs,
    maxPendingBytes: autoCommit?.maxPendingBytes ?? null,
  };
};

const validateActiveDataFileName = (
  value: unknown,
  baseFileName: string,
): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new PageCorruptionError(
      'sidecar.activeDataFile must be a non-empty string.',
    );
  }

  if (value.includes('/') || value.includes('\\')) {
    throw new PageCorruptionError(
      'sidecar.activeDataFile must be a file name without path separators.',
    );
  }

  const expectedPrefix = `${baseFileName}.g.`;
  if (!value.startsWith(expectedPrefix)) {
    throw new PageCorruptionError(
      'sidecar.activeDataFile must follow committed generation file naming.',
    );
  }

  const commitSuffix = value.slice(expectedPrefix.length);
  if (!/^\d+$/.test(commitSuffix)) {
    throw new PageCorruptionError(
      'sidecar.activeDataFile commit suffix must be an unsigned decimal integer.',
    );
  }

  return value;
};

const normalizeByteSizeInput = (value: CapacityConfig['maxSize']): number => {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new ConfigurationError(
        'capacity.maxSize must be a positive safe integer.',
      );
    }

    return value;
  }

  const matched = /^(\d+)(B|KB|MB|GB)$/.exec(value);
  if (matched === null) {
    throw new ConfigurationError(
      'capacity.maxSize string must be <positive><B|KB|MB|GB>.',
    );
  }

  const amount = Number(matched[1]);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new ConfigurationError('capacity.maxSize must be positive.');
  }

  const unit = matched[2];
  const multiplierByUnit: Record<string, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024,
  };
  const multiplier = multiplierByUnit[unit];
  const total = amount * multiplier;

  if (!Number.isSafeInteger(total) || total <= 0) {
    throw new ConfigurationError('capacity.maxSize exceeds safe integer range.');
  }

  return total;
};

const stableStringifyPayloadValue = (value: unknown): string => {
  if (value === null) {
    return 'null';
  }

  if (typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (typeof value === 'number') {
    return JSON.stringify(value);
  }

  if (typeof value === 'boolean') {
    return JSON.stringify(value);
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError('Payload contains unsupported value for encoding.');
  }

  const objectValue = value as Record<string, unknown>;
  const keys = Object.keys(objectValue).sort((left, right) =>
    left.localeCompare(right),
  );
  const chunks = keys.map((key) => {
    return `${JSON.stringify(key)}:${stableStringifyPayloadValue(objectValue[key])}`;
  });

  return `{${chunks.join(',')}}`;
};

const computeRecordEncodedBytes = (
  timestamp: number,
  payload: RecordPayload,
): number => {
  const stablePayload = stableStringifyPayloadValue(payload);
  return UTF8_ENCODER.encode(`${timestamp}|${stablePayload}`).byteLength;
};

const resolveFileDataPath = (config: FileDatastoreConfig): string => {
  if (config.filePath !== undefined && config.target !== undefined) {
    throw new ConfigurationError(
      'filePath and target cannot be specified together.',
    );
  }

  if (config.filePath !== undefined) {
    return resolve(config.filePath);
  }

  if (config.target === undefined) {
    return resolve('./frostpillar.fpdb');
  }

  if (config.target.kind === 'path') {
    return resolve(config.target.filePath);
  }

  const directoryPath = resolve(config.target.directory);
  const filePrefix = config.target.filePrefix ?? '';
  const fileName = config.target.fileName ?? 'frostpillar';
  return join(directoryPath, `${filePrefix}${fileName}.fpdb`);
};

const ensurePositiveSafeInteger = (value: unknown, field: string): number => {
  if (!Number.isSafeInteger(value) || typeof value !== 'number' || value < 0) {
    throw new PageCorruptionError(`${field} must be a non-negative safe integer.`);
  }

  return value;
};

const parseUnsignedBigInt = (value: unknown, field: string): bigint => {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new PageCorruptionError(`${field} must be an unsigned decimal string.`);
  }

  const parsed = BigInt(value);
  if (parsed > U64_MAX) {
    throw new PageCorruptionError(`${field} exceeds uint64 boundary.`);
  }

  return parsed;
};

const toSerializableRecord = (
  record: PersistedTimeseriesRecord,
): SerializablePersistedRecord => {
  return {
    timestamp: record.timestamp,
    payload: record.payload,
    insertionOrder: record.insertionOrder.toString(10),
  };
};

const decodeSerializableRecord = (
  serialized: SerializablePersistedRecord,
): PersistedTimeseriesRecord => {
  if (!Number.isSafeInteger(serialized.timestamp)) {
    throw new PageCorruptionError('Record timestamp must be a safe integer.');
  }

  const normalizedPayload = validateAndNormalizePayload(serialized.payload);
  const insertionOrder = parseUnsignedBigInt(
    serialized.insertionOrder,
    'record.insertionOrder',
  );
  const encodedBytes = computeRecordEncodedBytes(
    serialized.timestamp,
    normalizedPayload,
  );

  return {
    timestamp: serialized.timestamp,
    payload: normalizedPayload,
    insertionOrder,
    encodedBytes,
  };
};

const isNativeScalar = (value: unknown): value is NativeScalar => {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
};

const splitCanonicalPath = (fieldPath: string): string[] => {
  const segments: string[] = [];
  let current = '';
  let escape = false;

  for (const char of fieldPath) {
    if (escape) {
      current += char;
      escape = false;
      continue;
    }

    if (char === '\\') {
      escape = true;
      continue;
    }

    if (char === '.') {
      segments.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  if (escape) {
    current += '\\';
  }

  segments.push(current);
  return segments;
};

const readFieldValue = (
  record: PersistedTimeseriesRecord,
  field: string,
): NativeScalar | undefined => {
  if (field === 'timestamp') {
    return record.timestamp;
  }

  if (field === '_id') {
    return `${record.timestamp}:${record.insertionOrder.toString(10)}`;
  }

  const segments = splitCanonicalPath(field);
  let cursor: unknown = record.payload;

  for (const segment of segments) {
    if (
      typeof cursor !== 'object' ||
      cursor === null ||
      Array.isArray(cursor) ||
      !(segment in (cursor as Record<string, unknown>))
    ) {
      return undefined;
    }

    cursor = (cursor as Record<string, unknown>)[segment];
  }

  if (isNativeScalar(cursor)) {
    return cursor;
  }

  return undefined;
};

const compareNullableScalar = (
  left: NativeScalar | undefined,
  right: NativeScalar | undefined,
): number => {
  const leftValue = left ?? null;
  const rightValue = right ?? null;

  const rank = (value: NativeScalar): number => {
    if (value === null) {
      return 0;
    }
    if (typeof value === 'boolean') {
      return 1;
    }
    if (typeof value === 'number') {
      return 2;
    }
    return 3;
  };

  const leftRank = rank(leftValue);
  const rightRank = rank(rightValue);

  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }

  if (leftValue === rightValue) {
    return 0;
  }

  if (typeof leftValue === 'number' && typeof rightValue === 'number') {
    return leftValue < rightValue ? -1 : 1;
  }

  if (typeof leftValue === 'string' && typeof rightValue === 'string') {
    return leftValue < rightValue ? -1 : 1;
  }

  if (typeof leftValue === 'boolean' && typeof rightValue === 'boolean') {
    return leftValue === false ? -1 : 1;
  }

  return 0;
};

const evaluateFilterExpression = (
  record: PersistedTimeseriesRecord,
  expression: NativeFilterExpression,
): boolean => {
  if ('and' in expression) {
    return expression.and.every((item) => evaluateFilterExpression(record, item));
  }

  if ('or' in expression) {
    return expression.or.some((item) => evaluateFilterExpression(record, item));
  }

  if ('not' in expression) {
    return !evaluateFilterExpression(record, expression.not);
  }

  const fieldValue = readFieldValue(record, expression.field);
  const operator = expression.operator;

  if (operator === 'exists') {
    return fieldValue !== undefined;
  }

  if (operator === 'not_exists') {
    return fieldValue === undefined;
  }

  if (operator === 'is_null') {
    return fieldValue === null;
  }

  if (operator === 'is_not_null') {
    return fieldValue !== undefined && fieldValue !== null;
  }

  if (fieldValue === undefined) {
    return false;
  }

  if (operator === '=') {
    return fieldValue === expression.value;
  }

  if (operator === '!=') {
    return fieldValue !== expression.value;
  }

  if (operator === 'between') {
    if (expression.range === undefined) {
      throw new QueryValidationError('between operator requires range.');
    }

    const [start, end] = expression.range;
    if (
      typeof fieldValue === 'number' &&
      typeof start === 'number' &&
      typeof end === 'number'
    ) {
      return fieldValue >= start && fieldValue <= end;
    }

    if (
      typeof fieldValue === 'string' &&
      typeof start === 'string' &&
      typeof end === 'string'
    ) {
      return fieldValue >= start && fieldValue <= end;
    }

    return false;
  }

  if (operator === 'like') {
    if (typeof fieldValue !== 'string' || typeof expression.value !== 'string') {
      return false;
    }

    const escaped = expression.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = escaped.replace(/%/g, '.*').replace(/_/g, '.');
    const regex = new RegExp(`^${pattern}$`, 'u');
    return regex.test(fieldValue);
  }

  if (operator === 'regexp') {
    if (typeof fieldValue !== 'string' || typeof expression.value !== 'string') {
      return false;
    }

    try {
      const regex = new RegExp(expression.value, 'u');
      return regex.test(fieldValue);
    } catch {
      throw new QueryValidationError('Invalid regexp pattern.');
    }
  }

  if (
    operator === '>' ||
    operator === '>=' ||
    operator === '<' ||
    operator === '<='
  ) {
    const compared = expression.value;
    if (
      (typeof fieldValue === 'number' && typeof compared === 'number') ||
      (typeof fieldValue === 'string' && typeof compared === 'string')
    ) {
      if (operator === '>') {
        return fieldValue > compared;
      }
      if (operator === '>=') {
        return fieldValue >= compared;
      }
      if (operator === '<') {
        return fieldValue < compared;
      }
      return fieldValue <= compared;
    }

    return false;
  }

  return false;
};

const buildQueryRow = (
  record: PersistedTimeseriesRecord,
  select?: string[],
): NativeQueryResultRow => {
  if (select === undefined || select.length === 0) {
    const row: NativeQueryResultRow = { timestamp: record.timestamp };
    for (const [key, value] of Object.entries(record.payload)) {
      if (isNativeScalar(value)) {
        row[key] = value;
      }
    }
    return row;
  }

  const row: NativeQueryResultRow = {};
  for (const field of select) {
    const value = readFieldValue(record, field);
    row[field] = value ?? null;
  }
  return row;
};

export class Datastore {
  private readonly errorListeners: Set<DatastoreErrorListener>;

  private readonly queryEngines: Map<QueryLanguage, QueryEngineModule>;

  private readonly records: PersistedTimeseriesRecord[];

  private readonly capacityState: CapacityState | null;

  private nextInsertionOrder: bigint;

  private currentSizeBytes: number;

  private closed: boolean;

  private fileBackend: FileBackendState | null;

  private readonly fileAutoCommit: FileAutoCommitState | null;

  private pendingAutoCommitBytes: number;

  private fileAutoCommitTimer: IntervalTimerHandle | null;

  constructor(config: DatastoreConfig) {
    this.errorListeners = new Set<DatastoreErrorListener>();
    this.queryEngines = new Map<QueryLanguage, QueryEngineModule>();
    this.records = [];
    this.capacityState = parseCapacityConfig(config.capacity);
    this.nextInsertionOrder = 0n;
    this.currentSizeBytes = 0;
    this.closed = false;
    this.fileBackend = null;
    this.fileAutoCommit = null;
    this.pendingAutoCommitBytes = 0;
    this.fileAutoCommitTimer = null;

    if (config.location === 'memory') {
      if (config.autoCommit !== undefined) {
        throw new ConfigurationError(
          'autoCommit is not supported for location: "memory".',
        );
      }

      return;
    }

    if (config.location === 'file') {
      this.fileAutoCommit = parseFileAutoCommitConfig(config.autoCommit);
      this.initializeFileBackend(config);
      this.startFileAutoCommitSchedule();
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

      this.enforceCapacityPolicy(encodedBytes);

      const persistedRecord: PersistedTimeseriesRecord = {
        timestamp: normalizedTimestamp,
        payload: normalizedPayload,
        insertionOrder: this.nextInsertionOrder,
        encodedBytes,
      };

      this.records.push(persistedRecord);
      this.currentSizeBytes += encodedBytes;
      this.nextInsertionOrder += 1n;

      const fileAutoCommit = this.fileAutoCommit;
      if (this.fileBackend !== null && fileAutoCommit !== null) {
        if (fileAutoCommit.frequency === 'immediate') {
          this.commitFileBackend();
          this.pendingAutoCommitBytes = 0;
          return;
        }

        this.pendingAutoCommitBytes += encodedBytes;
        if (
          fileAutoCommit.maxPendingBytes !== null &&
          this.pendingAutoCommitBytes >= fileAutoCommit.maxPendingBytes
        ) {
          this.commitFileBackend();
          this.pendingAutoCommitBytes = 0;
        }
      }
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

      if (request.aggregates !== undefined || request.groupBy !== undefined) {
        throw new UnsupportedQueryFeatureError(
          'Aggregates and groupBy are not implemented in current query slice.',
        );
      }

      if (request.limit !== undefined) {
        if (!Number.isInteger(request.limit) || request.limit <= 0) {
          throw new QueryValidationError('limit must be a positive integer.');
        }
      }

      const filtered = this.records.filter((record) => {
        if (request.where === undefined) {
          return true;
        }
        return evaluateFilterExpression(record, request.where);
      });

      const sorted = filtered.sort((left, right) => {
        if (request.orderBy === undefined || request.orderBy.length === 0) {
          return compareByLogicalOrder(left, right);
        }

        for (const order of request.orderBy) {
          if (order.direction !== 'asc' && order.direction !== 'desc') {
            throw new QueryValidationError(
              'orderBy.direction must be "asc" or "desc".',
            );
          }
          const compared = compareNullableScalar(
            readFieldValue(left, order.field),
            readFieldValue(right, order.field),
          );
          if (compared !== 0) {
            return order.direction === 'asc' ? compared : -compared;
          }
        }

        return compareByLogicalOrder(left, right);
      });

      const rows = sorted.map((record) => buildQueryRow(record, request.select));
      const deduplicated = request.distinct
        ? this.distinctRows(rows)
        : rows;
      const limited =
        request.limit === undefined
          ? deduplicated
          : deduplicated.slice(0, request.limit);

      return limited;
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
      if (this.fileBackend !== null) {
        this.commitFileBackend();
        this.pendingAutoCommitBytes = 0;
      }
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

      this.stopFileAutoCommitSchedule();

      const fileBackend = this.fileBackend;
      if (fileBackend?.lockAcquired === true) {
        this.releaseFileLock(fileBackend);
      }

      this.closed = true;
      this.queryEngines.clear();
      this.errorListeners.clear();
    });
  }

  private distinctRows(rows: NativeQueryResultRow[]): NativeQueryResultRow[] {
    const output: NativeQueryResultRow[] = [];
    const seen = new Set<string>();

    for (const row of rows) {
      const serialized = JSON.stringify(row);
      if (seen.has(serialized)) {
        continue;
      }

      seen.add(serialized);
      output.push(row);
    }

    return output;
  }

  private enforceCapacityPolicy(encodedBytes: number): void {
    if (this.capacityState === null) {
      return;
    }

    if (encodedBytes > this.capacityState.maxSizeBytes) {
      throw new QuotaExceededError(
        'Record exceeds configured capacity.maxSize boundary.',
      );
    }

    if (this.capacityState.policy === 'strict') {
      if (this.currentSizeBytes + encodedBytes > this.capacityState.maxSizeBytes) {
        throw new QuotaExceededError(
          'Insert exceeds configured capacity.maxSize under strict policy.',
        );
      }
      return;
    }

    while (this.currentSizeBytes + encodedBytes > this.capacityState.maxSizeBytes) {
      if (this.records.length === 0) {
        throw new QuotaExceededError(
          'Record cannot fit in turnover policy with empty datastore.',
        );
      }

      this.evictOldestRecord();
    }
  }

  private evictOldestRecord(): void {
    let oldestIndex = 0;
    for (let index = 1; index < this.records.length; index += 1) {
      if (
        compareByLogicalOrder(this.records[index], this.records[oldestIndex]) < 0
      ) {
        oldestIndex = index;
      }
    }

    const removed = this.records[oldestIndex];
    this.records.splice(oldestIndex, 1);
    this.currentSizeBytes -= removed.encodedBytes;
  }

  private startFileAutoCommitSchedule(): void {
    if (this.fileAutoCommit === null || this.fileAutoCommit.frequency !== 'scheduled') {
      return;
    }

    const intervalMs = this.fileAutoCommit.intervalMs;
    if (intervalMs === null) {
      return;
    }

    this.fileAutoCommitTimer = setInterval((): void => {
      this.handleScheduledAutoCommitTick();
    }, intervalMs);
  }

  private stopFileAutoCommitSchedule(): void {
    const timer = this.fileAutoCommitTimer;
    if (timer === null) {
      return;
    }

    clearInterval(timer);
    this.fileAutoCommitTimer = null;
  }

  private handleScheduledAutoCommitTick(): void {
    if (this.closed || this.fileBackend === null) {
      return;
    }
    if (this.pendingAutoCommitBytes <= 0) {
      return;
    }

    try {
      this.commitFileBackend();
      this.pendingAutoCommitBytes = 0;
    } catch (error) {
      this.emitAutoCommitError(error);
    }
  }

  private emitAutoCommitError(error: unknown): void {
    const storageError =
      error instanceof StorageEngineError
        ? error
        : new StorageEngineError(
            error instanceof Error
              ? error.message
              : 'Unknown auto-commit storage failure.',
          );
    const event: DatastoreErrorEvent = {
      source: 'autoCommit',
      error: storageError,
      occurredAt: Date.now(),
    };

    for (const listener of this.errorListeners) {
      try {
        const delivered = listener(event);
        void Promise.resolve(delivered).catch((): void => undefined);
      } catch {
        // listener isolation by contract
      }
    }
  }

  private initializeFileBackend(config: FileDatastoreConfig): void {
    const dataFilePath = resolveFileDataPath(config);
    const directoryPath = dirname(dataFilePath);
    const baseFileName = basename(dataFilePath);
    const sidecarPath = `${dataFilePath}.meta.json`;
    const lockPath = `${dataFilePath}.lock`;

    mkdirSync(directoryPath, { recursive: true });
    this.acquireFileLock(lockPath);

    const backend: FileBackendState = {
      dataFilePath,
      directoryPath,
      baseFileName,
      sidecarPath,
      lockPath,
      activeDataFile: `${baseFileName}.g.0`,
      commitId: 0,
      rootPageId: 1,
      nextPageId: 2,
      freePageHeadId: null,
      lockAcquired: true,
    };

    this.cleanupFileTempArtifacts(backend);

    if (!existsSync(sidecarPath)) {
      this.writeInitialFileSnapshot(backend);
      this.fileBackend = backend;
      return;
    }

    this.loadFileSnapshot(backend);
    this.fileBackend = backend;
  }

  private acquireFileLock(lockPath: string): void {
    try {
      const descriptor = openSync(lockPath, 'wx');
      closeSync(descriptor);
    } catch (error) {
      const code = toNodeErrorCode(error);
      if (code === 'EEXIST') {
        throw new DatabaseLockedError(
          `Datastore is locked by another process: ${lockPath}`,
        );
      }

      throwStorageError(`Failed to acquire file lock at ${lockPath}`, error);
    }
  }

  private cleanupFileTempArtifacts(backend: FileBackendState): void {
    try {
      const sidecarTempPath = `${backend.sidecarPath}.tmp`;
      if (existsSync(sidecarTempPath)) {
        unlinkSync(sidecarTempPath);
      }

      const entries = readdirSync(backend.directoryPath);
      const generationPrefix = `${backend.baseFileName}.g.`;
      for (const entry of entries) {
        if (entry.startsWith(generationPrefix) && entry.endsWith('.tmp')) {
          unlinkSync(join(backend.directoryPath, entry));
        }
      }
    } catch (error) {
      throwStorageError('Failed to cleanup temporary durability artifacts', error);
    }
  }

  private writeInitialFileSnapshot(backend: FileBackendState): void {
    const generation: FileGenerationSnapshot = {
      magic: GENERATION_MAGIC,
      version: FORMAT_VERSION,
      rootPageId: backend.rootPageId,
      nextPageId: backend.nextPageId,
      freePageHeadId: backend.freePageHeadId,
      records: [],
    };
    const activeDataPath = join(backend.directoryPath, backend.activeDataFile);
    const sidecar: FileSidecarSnapshot = {
      magic: SIDE_CAR_MAGIC,
      version: FORMAT_VERSION,
      activeDataFile: backend.activeDataFile,
      rootPageId: backend.rootPageId,
      nextPageId: backend.nextPageId,
      freePageHeadId: backend.freePageHeadId,
      nextInsertionOrder: this.nextInsertionOrder.toString(10),
      commitId: backend.commitId,
    };

    try {
      writeFileSync(activeDataPath, JSON.stringify(generation), 'utf8');
      writeFileSync(backend.sidecarPath, JSON.stringify(sidecar, null, 2), 'utf8');
    } catch (error) {
      throwStorageError('Failed to initialize file backend snapshot', error);
    }
  }

  private loadFileSnapshot(backend: FileBackendState): void {
    try {
      const sidecarSource = readFileSync(backend.sidecarPath, 'utf8');
      const parsedSidecar = JSON.parse(sidecarSource) as FileSidecarSnapshot;

      if (
        parsedSidecar.magic !== SIDE_CAR_MAGIC ||
        parsedSidecar.version !== FORMAT_VERSION
      ) {
        throw new PageCorruptionError('Invalid sidecar magic/version.');
      }

      backend.activeDataFile = validateActiveDataFileName(
        parsedSidecar.activeDataFile,
        backend.baseFileName,
      );
      backend.commitId = ensurePositiveSafeInteger(
        parsedSidecar.commitId,
        'sidecar.commitId',
      );
      backend.rootPageId = ensurePositiveSafeInteger(
        parsedSidecar.rootPageId,
        'sidecar.rootPageId',
      );
      backend.nextPageId = ensurePositiveSafeInteger(
        parsedSidecar.nextPageId,
        'sidecar.nextPageId',
      );
      if (
        parsedSidecar.freePageHeadId !== null &&
        !Number.isSafeInteger(parsedSidecar.freePageHeadId)
      ) {
        throw new PageCorruptionError(
          'sidecar.freePageHeadId must be null or safe integer.',
        );
      }
      backend.freePageHeadId = parsedSidecar.freePageHeadId;

      const nextInsertionOrder = parseUnsignedBigInt(
        parsedSidecar.nextInsertionOrder,
        'sidecar.nextInsertionOrder',
      );

      const activeDataPath = join(backend.directoryPath, backend.activeDataFile);
      if (!existsSync(activeDataPath)) {
        throw new PageCorruptionError(
          'Active generation file referenced by sidecar is missing.',
        );
      }

      const generationSource = readFileSync(activeDataPath, 'utf8');
      const parsedGeneration = JSON.parse(generationSource) as FileGenerationSnapshot;
      if (
        parsedGeneration.magic !== GENERATION_MAGIC ||
        parsedGeneration.version !== FORMAT_VERSION
      ) {
        throw new PageCorruptionError('Invalid generation magic/version.');
      }

      if (
        parsedGeneration.rootPageId !== backend.rootPageId ||
        parsedGeneration.nextPageId !== backend.nextPageId ||
        parsedGeneration.freePageHeadId !== backend.freePageHeadId
      ) {
        throw new PageCorruptionError(
          'Sidecar mirrored page metadata does not match active generation.',
        );
      }

      this.records.length = 0;
      let nextSize = 0;
      for (const serializedRecord of parsedGeneration.records) {
        const record = decodeSerializableRecord(serializedRecord);
        this.records.push(record);
        nextSize += record.encodedBytes;
      }

      this.currentSizeBytes = nextSize;
      this.nextInsertionOrder = nextInsertionOrder;
    } catch (error) {
      throwStorageError('Failed to load file backend snapshot', error);
    }
  }

  private commitFileBackend(): void {
    if (this.fileBackend === null) {
      return;
    }

    const backend = this.fileBackend;
    const nextCommitId = backend.commitId + 1;
    const nextActiveDataFile = `${backend.baseFileName}.g.${nextCommitId}`;
    const generationTempPath = join(
      backend.directoryPath,
      `${nextActiveDataFile}.tmp`,
    );
    const generationPath = join(backend.directoryPath, nextActiveDataFile);
    const sidecarTempPath = `${backend.sidecarPath}.tmp`;

    const generationSnapshot: FileGenerationSnapshot = {
      magic: GENERATION_MAGIC,
      version: FORMAT_VERSION,
      rootPageId: backend.rootPageId,
      nextPageId: backend.nextPageId,
      freePageHeadId: backend.freePageHeadId,
      records: this.records.map(toSerializableRecord),
    };
    const sidecarSnapshot: FileSidecarSnapshot = {
      magic: SIDE_CAR_MAGIC,
      version: FORMAT_VERSION,
      activeDataFile: nextActiveDataFile,
      rootPageId: backend.rootPageId,
      nextPageId: backend.nextPageId,
      freePageHeadId: backend.freePageHeadId,
      nextInsertionOrder: this.nextInsertionOrder.toString(10),
      commitId: nextCommitId,
    };

    try {
      writeFileSync(generationTempPath, JSON.stringify(generationSnapshot), 'utf8');
      renameSync(generationTempPath, generationPath);

      writeFileSync(sidecarTempPath, JSON.stringify(sidecarSnapshot, null, 2), 'utf8');
      renameSync(sidecarTempPath, backend.sidecarPath);

      backend.activeDataFile = nextActiveDataFile;
      backend.commitId = nextCommitId;
    } catch (error) {
      throwStorageError('File commit failed', error);
    }
  }

  private releaseFileLock(backend: FileBackendState): void {
    try {
      if (existsSync(backend.lockPath)) {
        unlinkSync(backend.lockPath);
      }
      backend.lockAcquired = false;
    } catch (error) {
      throwStorageError('Failed to release file lock during close()', error);
    }
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new ClosedDatastoreError('Datastore has been closed.');
    }
  }
}
