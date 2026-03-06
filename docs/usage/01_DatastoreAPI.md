# Usage: Datastore API (v0.2 draft)

Status: Draft  
Last Updated: 2026-03-06

This guide explains the user-facing API described in `docs/specs/04_DatastoreAPI.md`.

## 1. Basic Setup (Memory Backend)

```typescript
import { Datastore } from "frostpillar";

const db = new Datastore({ location: "memory" });
```

`autoCommit` is not available for `location: "memory"`.

## 2. Insert Records

```typescript
await db.insert({
  timestamp: "2025-01-01T00:00:00.000Z",
  payload: {
    event: "login",
    success: true,
  },
});
```

Validation reminders:

- `timestamp` accepts `number | string | Date`.
- `string` must be ISO 8601 date-time with timezone (for example `Z` or `+09:00`).
- canonical timestamp is epoch milliseconds as JavaScript safe integer (`Number.isSafeInteger`).
- `payload` supports nested objects.
- maximum payload object nesting depth is 64 (payload root is depth 0).
- payload key UTF-8 byte length limit is 1024.
- payload string UTF-8 byte length limit is 65535.
- leaf values must be `string | number | boolean | null` (arrays are not supported).
- payload `number` values must be finite (`Number.isFinite`); `NaN`, `Infinity`, and `-Infinity` are rejected.
- payload `bigint` values are not supported in v0.2.
- if exact 64-bit integer precision is required in payload, store the value as a decimal string and parse it in application code.

Additional valid example:

```typescript
await db.insert({
  timestamp: new Date("2025-01-01T00:00:00.000Z"),
  payload: {
    event: "logout",
    user: {
      profile: {
        country: "JP",
      },
    },
  },
});
```

## 3. Query by Time Range

```typescript
const records = await db.select({
  start: "2025-01-01T00:00:00.000Z",
  end: "2025-01-01T00:01:39.999Z",
});
```

Behavior:

- range is inclusive (`start <= timestamp <= end`)
- `start`/`end` accept `number | string | Date` with the same timestamp rules as `insert`
- results are sorted by timestamp ascending
- duplicate timestamps are ordered by insertion order
- insertion order is backed by an internal persisted `insertionOrder` key (`Uint64`)
  so ordering remains stable after restart, page split, compaction, or rewrite
- updating an existing record must preserve its original tie-break position
- future upsert on existing record must preserve original tie-break position
- returned `timestamp` values are epoch milliseconds (`number`)

Timestamp precision note:

- binary storage uses signed `Int64`, but API-visible timestamp remains JavaScript `number` safe integer.
- Frostpillar validates `number -> bigint -> Int64` on write and `Int64 -> bigint -> number` on read.
- if stored `Int64` timestamp is outside JavaScript safe integer range, decode fails explicitly (no truncation or rounding).

## 4. Commit and Close

```typescript
await db.commit(); // no-op on memory backend in M1
await db.close();
```

After `close()`, all operations reject with `ClosedDatastoreError`.

Auto-commit for durable backends (`location !== "memory"`):

```typescript
const db = new Datastore({
  location: "file",
  filePath: "./tmp/events.fpdb",
  autoCommit: {
    frequency: "5s", // also supports "immediate", 5000, "1m", "2h", ...
    maxPendingBytes: 2 * 1024 * 1024, // size-threshold trigger (2 MiB)
  },
});
```

- default is `"immediate"` when `frequency` is omitted
- immediate: `"immediate"` (commit after each successful write)
- every 5 seconds: `5000` or `"5s"`
- every 1 minute: `"1m"`
- size-threshold flush: commit triggers when pending bytes reach `maxPendingBytes`
- if both interval and size-threshold are configured, whichever occurs first triggers commit

Background auto-commit errors (for non-`"immediate"` schedules) are delivered through datastore error channel:

```typescript
import type { DatastoreErrorEvent } from "frostpillar";

const onDatastoreError = (event: DatastoreErrorEvent): void => {
  // event.source === "autoCommit"
  // event.error is StorageEngineError
  // event.occurredAt is epoch milliseconds
  console.error("Datastore background error:", event);
};

const unsubscribe = db.on("error", onDatastoreError);

// Later, when no longer needed:
unsubscribe(); // same effect as db.off("error", onDatastoreError)
```

Notes:

- this channel is for asynchronous/background failures without direct Promise rejection
- explicit foreground calls (`insert`, `commit`) still reject their own Promises on failure
- `close()` stops background auto-commit scheduling and further auto-commit error events

## 4.1 Capacity and Retention Policy

You can enforce bounded storage with `capacity.maxSize` and policy:

```typescript
const db = new Datastore({
  location: "memory",
  capacity: {
    maxSize: "256MB",
    policy: "turnover", // "strict" | "turnover"
  },
});
```

Behavior:

- `strict`: overflow insert fails with `QuotaExceededError` (no mutation)
- `turnover`: oldest records are evicted deterministically, then new record is inserted
- `turnover` eviction is handled by an internal delete path; a public delete API is not available in v0.2
- if one record is larger than `maxSize`, insert fails with `QuotaExceededError`
- v0.2 does not split one record across multiple pages; per-page fit boundary is
  `maxSingleRecordBytes = pageSize - 32 - 4`
- if encoded record bytes exceed `maxSingleRecordBytes`, insert fails with `QuotaExceededError`
- payload string-byte limits and page-fit checks are independent boundaries
- default policy is `"strict"` when omitted

## 5. File Backend: Path, Directory, File Name, Prefix

`location: "file"` supports two ways to specify file location.

Path shorthand (backward compatible):

```typescript
const db = new Datastore({
  location: "file",
  filePath: "./data/events.fpdb",
});
```

Equivalent explicit target:

```typescript
const db = new Datastore({
  location: "file",
  target: {
    kind: "path",
    filePath: "./data/events.fpdb",
  },
});
```

Directory-based target with naming options:

```typescript
const db = new Datastore({
  location: "file",
  target: {
    kind: "directory",
    directory: "./data/frostpillar",
    filePrefix: "prod_",
    fileName: "events",
  },
});
```

Resolved files in this example:

- metadata file: `./data/frostpillar/prod_events.fpdb.meta.json`
- generation data files: `./data/frostpillar/prod_events.fpdb.g.<commitId>`
- active generation is selected by sidecar field `activeDataFile`
- each committed generation reserves page `0` as fixed meta page containing
  `rootPageId`/allocation state for restart
- sidecar `rootPageId`/`nextPageId`/`freePageHeadId` are mirrored values and must match page-0 meta payload

## 6. Browser Storage: Backend Choice and Fallback

`location: "browser"` supports async-native backends first, with a compatibility fallback.

Recommended cross-browser setting:

```typescript
const db = new Datastore({
  location: "browser",
  browserStorage: "auto", // default
});
```

Resolution order for `"auto"`:

1. `opfs`
2. `indexedDB`
3. `localStorage`

Explicit backend examples:

```typescript
const dbIndexed = new Datastore({
  location: "browser",
  browserStorage: "indexedDB",
  indexedDB: {
    databaseName: "frostpillar",
    objectStoreName: "pages",
    version: 1,
  },
});
```

```typescript
const dbLocal = new Datastore({
  location: "browser",
  browserStorage: "localStorage",
  localStorage: {
    keyPrefix: "fp",
    databaseKey: "analytics",
    maxChunkChars: 32768,
    maxChunks: 64,
  },
});
```

Notes:

- `opfs` and `indexedDB` are async-native and align with async-only architecture.
- `localStorage` API is synchronous, so use it as compatibility fallback.
- if an explicitly selected backend is unavailable, datastore rejects with `UnsupportedBackendError`.

When `browserStorage: "localStorage"`:

- key pattern:
  - manifest: `fp:analytics:manifest`
  - chunks: `fp:analytics:g:<generation>:chunk:<index>`
- one snapshot is automatically split into multiple chunk keys if needed
- if required chunks exceed `maxChunks`, datastore rejects with `QuotaExceededError`
- browser quota failures are also reported as `QuotaExceededError`
- failed write of a new generation must not break previous committed generation

## 7. Common Errors

- `ValidationError`
- `TimestampParseError`
- `InvalidQueryRangeError`
- `ConfigurationError`
- `UnsupportedBackendError` (for durable backends before their milestone)
- `ClosedDatastoreError`
- `StorageEngineError`
- `BinaryFormatError` (binary decode/encode format violation)
- `PageCorruptionError` (page-structure invariant violation)
- `IndexCorruptionError` (B+ tree invariant violation)
- `QuotaExceededError`
- `DatastoreErrorEvent` (event payload for `on("error", ...)`)

## 8. Post-v0.1 Native Record Operations (Planned)

```typescript
const one = await db.getById("1735689600000:42");
await db.updateById("1735689600000:42", { success: false });
await db.deleteById("1735689600000:42");
```

Why:

- precise update/delete targeting requires internal record identity
- time-range `select` remains available for native timeseries scans
- tie-break order for equal timestamps remains deterministic by preserving original insertion order on updates
- planned canonical `_id` format is tuple-derived: `"<timestamp>:<insertionOrder>"`
  (for example `"1735689600000:42"`)

## 9. Optional Query Engines (SQL / Lucene, Planned)

Users can import query-engine modules directly instead of choosing query language at datastore initialization.

```typescript
import { Datastore } from "frostpillar";
import { sqlEngine } from "frostpillar/query-sql";
import { luceneEngine } from "frostpillar/query-lucene";

const db = new Datastore({ location: "memory" });

const sqlReq = sqlEngine.toNativeQuery(
  "SELECT COUNT(*) AS c FROM records WHERE status = 404",
);
const sqlResult = await db.queryNative(sqlReq);

const luceneReq = luceneEngine.toNativeQuery(
  "status:[400 TO 499] AND service:api",
  {
    groupBy: ["service"],
    aggregates: [{ fn: "count", as: "c" }],
    orderBy: [{ field: "c", direction: "desc" }],
    limit: 10,
  },
);
const luceneResult = await db.queryNative(luceneReq);
```

Canonical field path escaping rule:

- key segment `service.name` -> `service\\.name`
- key segment `region\\zone` -> `region\\\\zone`

Notes:

- SQL/Lucene modules are optional and external to core.
- Frostpillar core executes TypeScript-native request objects.
- no implicit cross-type coercion is applied in predicate evaluation.
- `field:*` maps to native `exists`, and `NOT field:*` maps to native `not_exists`.
- `field:*` matches explicit `null` values (exists means field path is present).
- Lucene `field:null` maps to native `is_null` (unquoted keyword).
- `IS NULL` targets explicit `null`; missing fields must be checked with `EXISTS(...)` / `NOT EXISTS(...)`.
- Lucene range bounds use typed literals: unquoted numeric -> number, quoted -> string, unquoted non-numeric -> string.
- Lucene `timestamp` accepts ISO-8601 date-time strings with timezone.
- Date-only `YYYY-MM-DD` is interpreted as UTC midnight (`YYYY-MM-DDT00:00:00.000Z`).
- accepted Lucene `timestamp` literals are normalized to epoch milliseconds before evaluation.
- invalid timestamp literals raise `QueryValidationError`.
- Lucene quoted value strings use backslash escaping inside quotes (`\"`, `\\`).
- SQL `REGEXP` and Lucene `field:/pattern/` follow ECMAScript `RegExp` semantics and `RegExp.test(...)` matching behavior.
