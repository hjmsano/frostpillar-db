# Spec: Datastore API (v0.2 draft)

Status: Draft  
Version: 0.2  
Last Updated: 2026-03-06

This document defines the public contract of the `Datastore` class.
It is the only user-facing entry point in the current baseline.

## 1. Contract Principles

- Async-only API surface.
- Configuration-driven backend selection.
- Deterministic query ordering.
- Core-native query execution model.
- Explicit typed errors.
- Named exports only.

## 2. Public Types

```typescript
import type { TimeseriesRecord } from './01_RecordFormat';

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

export type CapacityPolicy = 'strict' | 'turnover';

export type CapacityConfig = {
  maxSize: ByteSizeInput;
  policy?: CapacityPolicy;
};

export type AutoCommitConfig = {
  frequency?: AutoCommitFrequencyInput;
  maxPendingBytes?: number;
};

export type MemoryDatastoreConfig = {
  location: 'memory';
  autoCommit?: never;
  capacity?: CapacityConfig;
};

export type FileTargetByPathConfig = {
  kind: 'path';
  filePath: string;
  directory?: never;
  fileName?: never;
  filePrefix?: never;
};

export type FileTargetByDirectoryConfig = {
  kind: 'directory';
  directory: string;
  fileName?: string;
  filePrefix?: string;
  filePath?: never;
};

export type FileTargetConfig =
  | FileTargetByPathConfig
  | FileTargetByDirectoryConfig;

export type FileDatastoreConfig = {
  location: 'file';
  target?: FileTargetConfig;
  filePath?: string;
  autoCommit?: AutoCommitConfig;
  capacity?: CapacityConfig;
};

export type OpfsConfig = {
  directoryName?: string;
};

export type IndexedDBConfig = {
  databaseName?: string;
  objectStoreName?: string;
  version?: number;
};

export type LocalStorageConfig = {
  keyPrefix?: string;
  databaseKey?: string;
  maxChunkChars?: number;
  maxChunks?: number;
};

export type BrowserStorageType = 'auto' | 'opfs' | 'indexedDB' | 'localStorage';

export type BrowserDatastoreConfig = {
  location: 'browser';
  browserStorage?: BrowserStorageType;
  opfs?: OpfsConfig;
  indexedDB?: IndexedDBConfig;
  localStorage?: LocalStorageConfig;
  autoCommit?: AutoCommitConfig;
  capacity?: CapacityConfig;
};

export type DatastoreConfig =
  | MemoryDatastoreConfig
  | FileDatastoreConfig
  | BrowserDatastoreConfig;

export type TimeRangeQuery = {
  start: TimestampInput;
  end: TimestampInput;
};

export type InputTimeseriesRecord = Omit<TimeseriesRecord, 'timestamp'> & {
  timestamp: TimestampInput;
};

export type DatastoreErrorEvent = {
  source: 'autoCommit';
  error: Error;
  occurredAt: number;
};

export type DatastoreErrorListener = (
  event: DatastoreErrorEvent,
) => void | Promise<void>;
```

Notes:

- M1 implementation supports `location: "memory"` only.
- `autoCommit` is allowed only when `location !== "memory"` (durable backend configuration).
- Setting `autoCommit` for `location: "memory"` MUST throw `ConfigurationError`.
- `capacity` applies to all backends and follows `docs/specs/09_CapacityAndRetention.md`.
- `autoCommit.maxPendingBytes` is valid only for durable backends and follows `docs/specs/10_FlushAndDurability.md`.
- Passing `location: "file"` before M2 MUST throw `UnsupportedBackendError`.
- Passing `location: "browser"` before M3 MUST throw `UnsupportedBackendError`.
- `filePath` is a backward-compatible shorthand for `target: { kind: "path", filePath }`.
- `filePath` and `target` MUST NOT be specified together.

## 3. `Datastore` Class

```typescript
export class Datastore {
  constructor(config: DatastoreConfig);

  insert(record: InputTimeseriesRecord): Promise<void>;
  select(query: TimeRangeQuery): Promise<TimeseriesRecord[]>;
  commit(): Promise<void>;
  on(event: 'error', listener: DatastoreErrorListener): () => void;
  off(event: 'error', listener: DatastoreErrorListener): void;
  close(): Promise<void>;
}
```

## 4. Method Semantics (Normative)

### 4.1 `insert(record)`

- Validates record using `docs/specs/01_RecordFormat.md`.
- `record.timestamp` accepts `number | string | Date`.
- `string` input MUST be ISO 8601 date-time with timezone (`Z` or `+/-HH:MM`).
- input is normalized to canonical epoch milliseconds before persistence.
- payload object max nesting depth is `64` (root depth `0`, +1 per nested object).
- payload key UTF-8 byte length max is `1024` at every nested object level.
- payload string UTF-8 byte length max is `65535` at every nested object level.
- datastore MUST assign one immutable internal `insertionOrder` key on first insert and
  persist it as `INSERTION_ORDER_U64` per `docs/specs/02_BinaryEncoding.md`.
- For paged storage, implementation MUST check encoded record byte length against
  `maxSingleRecordBytes` from `docs/specs/03_PageStructure.md` section 2.1.
- If encoded record bytes exceed `maxSingleRecordBytes`, insert MUST reject with `QuotaExceededError`.
- A record that passes payload string-length validation can still fail page-fit checks
  because page-fit boundary is computed from configured `pageSize`.
- This page-fit rejection MUST occur before strict/turnover capacity policy evaluation
  and MUST NOT attempt turnover eviction.
- On success, record becomes visible to subsequent `select` in the same instance.
- MUST reject if datastore has been closed.

### 4.2 `select({ start, end })`

- Range is inclusive: `[start, end]`.
- `start` and `end` accept `number | string | Date`.
- `string` input MUST be ISO 8601 date-time with timezone (`Z` or `+/-HH:MM`).
- `start` and `end` are normalized to epoch milliseconds before validation.
- normalized `start` and `end` MUST be safe integers.
- MUST reject when `start > end`.
- Result ordering MUST be deterministic:
  - `timestamp` ascending
  - insertion order ascending for equal timestamps
- Effective ordering key is logical `(timestamp, insertion-order key)` and MUST be
  independent from physical page/leaf placement.
- returned `timestamp` values are canonical epoch milliseconds (`number`).
- internal insertion-order key is not exposed in v0.2 API response shape.

### 4.3 Binary Timestamp Boundary (Durable Backends)

- For durable backends, record decode path MUST read binary timestamp as signed `Int64` and apply conversion rules from `docs/specs/02_BinaryEncoding.md`.
- If decoded `Int64` timestamp is outside JavaScript safe integer range, operation MUST fail (no rounding/clamping).

### 4.4 `commit()`

- Defines durability boundary for durable backends.
- Durable commit protocol and crash-safe ordering MUST follow `docs/specs/10_FlushAndDurability.md`.
- For memory backend in M1, `commit` is a no-op and MUST resolve successfully.
- MUST reject if datastore has been closed.

### 4.5 `close()`

- Releases resources and transitions instance to closed state.
- `close` MUST be idempotent.
- For durable backends, `close` MUST stop auto-commit scheduling before releasing resources.
- After close, `insert`, `select`, and `commit` MUST reject with `ClosedDatastoreError`.

### 4.6 Auto-commit (`config.autoCommit`)

- Auto-commit applies only to non-memory backends.
- For durable backends, default auto-commit behavior is enabled with `frequency: "immediate"`.
- If `autoCommit` is specified without `frequency`, effective frequency MUST be `"immediate"`.
- `frequency` accepts:
  - `"immediate"` (commit after each successful write operation)
  - positive integer milliseconds (for example `5000`)
  - duration strings: `${number}ms`, `${number}s`, `${number}m`, `${number}h`
- `frequency` examples:
  - immediate: `"immediate"` (default)
  - every 5 seconds: `5000` or `"5s"`
  - every 1 minute: `"1m"`
- `maxPendingBytes` (when provided) MUST be a positive safe integer in bytes.
- For non-`"immediate"` frequency, datastore MUST schedule periodic internal `commit()` calls.
- When `maxPendingBytes` is configured, reaching or exceeding threshold MUST trigger internal commit.
- If periodic frequency and size threshold are both configured, commit trigger is OR semantics.
- Invalid or non-positive frequency values MUST throw `ConfigurationError`.
- Invalid `maxPendingBytes` MUST throw `ConfigurationError`.
- Manual `commit()` MUST remain available even when auto-commit is enabled.
- Auto-commit failure from scheduled background execution MUST surface through datastore error channel (`on("error", ...)`).
- For background auto-commit failures, emitted `DatastoreErrorEvent.error` MUST be an instance of `StorageEngineError`.
- Method-level promise rejection contract remains unchanged: foreground failures from explicit `insert`/`commit` still reject their returned `Promise`.
- Detailed scheduler/coalescing behavior MUST follow `docs/specs/10_FlushAndDurability.md`.

### 4.7 Datastore Error Channel (`on`/`off`)

- Datastore MUST expose an event channel for asynchronous failures that are not tied to a caller-visible Promise.
- Initial supported event is `"error"` only.
- `on("error", listener)` MUST register listener and return an unsubscribe function equivalent to `off("error", listener)`.
- `off("error", listener)` MUST remove only the matching listener and MUST be idempotent.
- One background auto-commit failure MUST emit one `"error"` event.
- Emitting `"error"` with no registered listeners MUST NOT throw.
- Listener exceptions/rejections MUST NOT prevent delivery to other listeners.
- `DatastoreErrorEvent.occurredAt` MUST be epoch milliseconds (`number`) and SHOULD represent failure detection time.
- After `close()`, datastore MUST stop background scheduling and MUST NOT emit new auto-commit `"error"` events.

### 4.8 Capacity and Retention (`config.capacity`)

- If `capacity` is omitted, datastore has no spec-level `maxSize` limit.
- `capacity.maxSize` and `capacity.policy` semantics MUST follow `docs/specs/09_CapacityAndRetention.md`.
- Default `capacity.policy` is `"strict"`.
- Under `"strict"`, overflow insert MUST reject with `QuotaExceededError` and MUST NOT mutate visible state.
- Under `"turnover"`, datastore MUST evict oldest records deterministically before accepting new record.
- Turnover eviction path uses internal deletion and is required for retention behavior.
- This internal deletion path MUST NOT be exposed as a public delete API in v0.2.
- If one record cannot fit even when datastore is empty, insert MUST reject with `QuotaExceededError`.

## 5. Durable Storage Naming and Layout (Normative)

### 5.1 File Backend (`location: "file"`)

Configuration resolution:

- If `target` is omitted, effective target is `{ kind: "path", filePath: "./frostpillar.fpdb" }`.
- If `target.kind === "path"`, datastore file path is exactly `target.filePath`.
- If `target.kind === "directory"`, datastore file path is:
  - `<directory>/<filePrefix><fileName>.fpdb`
  - `filePrefix` default: empty string
  - `fileName` default: `"frostpillar"`

Physical files:

- Metadata sidecar file: `${resolvedDataFilePath}.meta.json`.
- Committed generation data files: `${resolvedDataFilePath}.g.<commitId>`.
- Lock file (single-writer guard): `${resolvedDataFilePath}.lock`.
- Implementations MUST use metadata sidecar for format version and durable open/reopen checks.
- Active generation MUST be resolved by sidecar pointer (`activeDataFile`) only.

### 5.1.0 File Backend Open Lock (Single-Writer Requirement)

- File backend MUST enforce single-writer access across processes for one resolved datastore path.
- On `Datastore` open/initialization, implementation MUST acquire an exclusive lock before any
  read/write operation on sidecar or generation files.
- Exclusive lock MUST be represented by `${resolvedDataFilePath}.lock` and MUST be acquired with
  an atomic cross-process primitive (for example atomic create with exclusive flag, or equivalent
  OS-level mechanism).
- If exclusive lock acquisition fails because another live process already owns the lock, open
  MUST fail fast and MUST NOT proceed in read-only or best-effort mode.
- Lock-acquisition failure due to existing owner MUST throw `DatabaseLockedError`, which is a
  subtype of `StorageEngineError`.
- On successful `close()`, implementation MUST release the lock and remove lock ownership state.
- Implementations MUST NOT silently break or steal an existing lock during normal open flow.
- Implementations MAY provide explicit operator-controlled stale-lock recovery flow, but default
  open behavior MUST be fail-fast when lock is not acquirable.

### 5.1.1 Metadata Sidecar Schema

The sidecar file (`.meta.json`) MUST contain the following JSON structure:

```json
{
  "magic": "FPGE_META",
  "version": 1,
  "activeDataFile": "frostpillar.fpdb.g.0",
  "rootPageId": 1,
  "nextPageId": 2,
  "freePageHeadId": null,
  "nextInsertionOrder": "0",
  "commitId": 0
}
```

- `activeDataFile`: file name of the committed generation selected as active.
- `rootPageId`: mirrored root page ID from fixed page-0 meta payload.
- `nextPageId`: mirrored next page ID from fixed page-0 meta payload.
- `freePageHeadId`: mirrored free-list head page ID from fixed page-0 meta payload, or `null` if none.
- `nextInsertionOrder`: next allocatable insertion-order value for new inserts.
  - MUST be serialized as unsigned base-10 integer string (no sign, no zero padding except `"0"`).
  - MUST satisfy `0 <= value <= 18446744073709551615`.
- `commitId`: monotonic durable commit sequence number.
- Commit ordering and restart recovery semantics MUST follow `docs/specs/10_FlushAndDurability.md`.
- open MUST fail with typed storage corruption error when `activeDataFile` is missing or invalid.
- page-0 meta layout/source-of-truth rules MUST follow `docs/specs/03_PageStructure.md` section 8.1.
- on open/restart, implementation MUST initialize insertion-order allocator from `nextInsertionOrder` in O(1) without full data scan.
- implementation MUST NOT derive allocator state from rightmost/last B+ tree key because key order is `(timestamp, insertionOrder)` and backfilled timestamps break monotonic key-tail inference.
- on open/restart, implementation MUST validate that sidecar mirrored fields
  (`rootPageId`, `nextPageId`, `freePageHeadId`) match page-0 meta payload;
  mismatch MUST fail with typed corruption error.

### 5.2 Browser Backend (`location: "browser"`)

Configuration defaults:

- `browserStorage` supports `"auto" | "opfs" | "indexedDB" | "localStorage"`.
- default `browserStorage`: `"auto"`.
- `"auto"` resolution order MUST be:
  1. `"opfs"`
  2. `"indexedDB"`
  3. `"localStorage"`
- If no browser backend is available, datastore MUST reject with `UnsupportedBackendError`.
- If `browserStorage` is explicitly set to one backend and that backend is unavailable, datastore MUST reject with `UnsupportedBackendError` (no implicit override to other backends).
- `opfs` and `indexedDB` are async-native browser APIs and SHOULD be preferred to align with async-only architecture.
- `localStorage` is synchronous and MUST be treated as compatibility fallback.

OPFS-specific notes:

- `opfs` uses browser Origin Private File System storage.
- `opfs` availability depends on runtime constraints (for example secure context and browser mode).

IndexedDB-specific notes:

- `indexedDB` uses browser IndexedDB storage.
- `indexedDB` SHOULD be the fallback when `opfs` is unavailable and `browserStorage` is `"auto"`.

LocalStorage defaults (only effective when `browserStorage === "localStorage"`):

- `keyPrefix` default: `"frostpillar"`.
- `databaseKey` default: `"default"`.
- `maxChunkChars` default: `32768`.
- `maxChunks` default: `64`.

LocalStorage key naming rules:

- Manifest key: `<keyPrefix>:<databaseKey>:manifest`
- Chunk key: `<keyPrefix>:<databaseKey>:g:<generation>:chunk:<index>`
- `<index>` is a zero-based integer in decimal.

LocalStorage chunking and quota behavior:

- Persisted binary snapshot MUST be converted to string and chunked when it exceeds `maxChunkChars`.
- One logical snapshot MAY span multiple localStorage keys.
- Required chunk count MUST be `<= maxChunks`; otherwise datastore MUST reject with `QuotaExceededError`.
- On browser quota errors from localStorage writes, datastore MUST reject with `QuotaExceededError`.
- Existing committed generation MUST remain readable when a new generation write fails.
- To satisfy the previous rule, localStorage commit MUST use generation-level copy-on-write:
  all chunks for the new generation are written before manifest switch.
- Until manifest switch and old-generation cleanup complete, transient usage can approach
  `previousGenerationSize + newGenerationSize` (worst case near 2x steady-state footprint).
- For capacity planning, effective steady-state writable size in localStorage is typically
  around half of browser quota when generation sizes are similar.
- Generation switch order MUST follow `docs/specs/10_FlushAndDurability.md`.

## 6. Error Taxonomy

- `ValidationError`: malformed record or invalid field values.
- `TimestampParseError`: timestamp input cannot be parsed or violates accepted ISO 8601 rules.
- `InvalidQueryRangeError`: invalid query bounds (`start > end`).
- `ConfigurationError`: invalid config shape/values.
- `UnsupportedBackendError`: config is valid but backend is not available in current milestone.
- `ClosedDatastoreError`: operation attempted after `close()`.
- `StorageEngineError`: adapter-level I/O or storage failure.
- `DatabaseLockedError`: file-backend exclusive lock acquisition failed because datastore is already opened by another process (subtype of `StorageEngineError`).
- `BinaryFormatError`: binary decode/encode format violation (subtype of `StorageEngineError`).
- `PageCorruptionError`: page-structure invariant violation (subtype of `StorageEngineError`).
- `IndexCorruptionError`: B+ tree invariant violation (subtype of `StorageEngineError`).
- `QuotaExceededError`: storage limit reached (capacity policy, or browser storage quota/chunk bound).
- `DatastoreErrorEvent`: structured event payload for asynchronous datastore error channel (`source`, `error`, `occurredAt`).

## 7. Non-Goals for Current Baseline

- No synchronous API variants.
- No public delete/update mutation API.
- No built-in SQL/Lucene parser in core.
- No external datetime dependency (for example, no moment.js).

## 8. Post-Baseline Native Query and Mutation Requirements

The following requirements are mandatory for the next API evolution after the current baseline.

### 8.1 Record Identity

- each persisted record MUST have immutable internal `RecordId`.
- identified record field name MUST be `_id` (see `docs/specs/01_RecordFormat.md`).
- `RecordId` MUST be generated by Frostpillar (not user-provided on insert).
- `RecordId` MUST be unique within one datastore.
- `RecordId` MUST stay stable across commit/reopen for durable backends.
- `RecordId` MUST be deterministically derived from tuple key
  `(timestamp, insertionOrder)` using canonical form
  `"<timestamp>:<insertionOrder>"` (see `docs/specs/01_RecordFormat.md`).
- `RecordId` MUST NOT be independently persisted as extra top-level TLV field
  in binary record bytes (see `docs/specs/02_BinaryEncoding.md`).

### 8.2 Native CRUD Surface

```typescript
export class Datastore {
  getById(id: RecordId): Promise<TimeseriesRecord | null>;
  updateById(
    id: RecordId,
    patch: Partial<TimeseriesRecord['payload']>,
  ): Promise<boolean>;
  deleteById(id: RecordId): Promise<boolean>;
}
```

Semantics:

- `getById` returns `null` when id does not exist.
- `updateById` updates payload fields of one record by id and returns whether the target existed.
- `updateById` MUST preserve the target record timestamp and original insertion-order key.
- `deleteById` performs logical deletion of one record by id and returns whether the target existed.
- `select({ start, end })` remains as optimized native time-range query shorthand.
- If a future upsert API is introduced, it MUST follow:
  - update path (target exists): preserve original insertion-order key
  - insert path (target missing): assign a new insertion-order key as normal insert

### 8.3 Native Query Request

Core MUST provide a typed native query request API so external query engines can delegate execution:

```typescript
export type NativeComparisonOperator =
  | '='
  | '!='
  | '>'
  | '>='
  | '<'
  | '<='
  | 'like'
  | 'regexp'
  | 'is_null'
  | 'is_not_null'
  | 'exists'
  | 'not_exists'
  | 'between';

export type NativeFilterExpression =
  | {
      field: string;
      operator: NativeComparisonOperator;
      value?: NativeScalar;
      range?: readonly [NativeScalar, NativeScalar];
    }
  | { and: NativeFilterExpression[] }
  | { or: NativeFilterExpression[] }
  | { not: NativeFilterExpression };

export type NativeOrderBy = {
  field: string;
  direction: 'asc' | 'desc';
};

export type NativeAggregateFunction =
  | 'count'
  | 'min'
  | 'max'
  | 'sum'
  | 'avg'
  | 'percentile_cont';

export type NativeAggregateExpression = {
  fn: NativeAggregateFunction;
  field?: string;
  as?: string;
  percentile?: number;
};

export type NativeQueryRequest = {
  where?: NativeFilterExpression;
  select?: string[];
  aggregates?: NativeAggregateExpression[];
  orderBy?: NativeOrderBy[];
  groupBy?: string[];
  limit?: number;
  distinct?: boolean;
};

import type {
  QueryEngineModule,
  QueryExecutionOptions,
  QueryLanguage,
} from './05_QueryEngineContract';

export class Datastore {
  registerQueryEngine(engine: QueryEngineModule): void;
  unregisterQueryEngine(language: QueryLanguage): void;
  query(
    language: QueryLanguage,
    queryText: string,
    options?: QueryExecutionOptions,
  ): Promise<NativeQueryResultRow[]>;
  queryNative(request: NativeQueryRequest): Promise<NativeQueryResultRow[]>;
}
```

`NativeQueryRequest` is intentionally typed narrowly in this document and detailed in
`docs/specs/05_QueryEngineContract.md`.

Field reference rules for `NativeQueryRequest`:

- `field`, `select`, `groupBy`, and `orderBy[].field` MUST use canonical payload path encoding.
- canonical path escaping follows `docs/specs/05_QueryEngineContract.md`.
- predicate type/null/missing semantics MUST follow `docs/specs/05_QueryEngineContract.md`.

Integrated query-engine usage rules:

- `registerQueryEngine(engine)` MUST register one active module per `engine.language`.
- registering the same `language` again MUST replace previous module deterministically.
- `query(language, queryText, options)` MUST resolve the registered module by `language`.
- if module is missing, `query(...)` MUST fail with `QueryEngineNotRegisteredError`.
- `query(...)` MUST delegate translation/execution only through:
  `engine.toNativeQuery(queryText, options)` -> `queryNative(request)`.
- `query(...)` MUST NOT mutate translated `NativeQueryRequest` before `queryNative(...)`.
- `query(...)` MUST resolve target engine once at query invocation boundary.
- `registerQueryEngine(...)` / `unregisterQueryEngine(...)` calls that happen after this resolution
  MUST NOT alter engine instance used by that in-flight `query(...)` call.
- engine registration changes MUST apply only to subsequent `query(...)` calls.
- `unregisterQueryEngine(language)` MUST remove module mapping and MUST be idempotent.
- `query(...)` MUST fail with `ClosedDatastoreError` if datastore has been closed.
- `registerQueryEngine(...)` and `unregisterQueryEngine(...)` MUST throw `ClosedDatastoreError`
  if datastore has been closed.

## 9. External Query Language Integration Requirements

- SQL subset and Lucene subset support MUST be implemented as optional query-engine modules.
- Users choose query engine by importing modules in application code.
- Datastore initialization config MUST NOT require query-language selection.
- Query-engine modules MUST translate language text into `queryNative(...)` requests.
- Datastore SHOULD provide integrated language-based query path (`query(...)`) so users are not
  required to manually handle `NativeQueryRequest` in common flows.

## 10. Additional Error Taxonomy (Post-Baseline)

- `RecordNotFoundError`: optional strict mode error for update/delete/get on unknown id.
- `QueryParseError`: invalid SQL/Lucene syntax in external query-engine modules.
- `QueryValidationError`: syntactically valid query that violates Frostpillar subset constraints.
- `UnsupportedQueryFeatureError`: query uses valid language feature outside supported subset.
- `QueryEngineNotRegisteredError`: requested query language has no registered query-engine module.
