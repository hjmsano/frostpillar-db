# Spec 01: Database and Collection

- **Status:** Accepted
- **Date:** 2026-04-03

## Overview

This spec defines the `Database` class (top-level entry point) and the `Collection` class (per-collection query interface). Together they provide the public API for managing collections and documents.

## 0. Incremental Delivery Scope

To enable strict SDD/TDD delivery from an empty repository, this spec is implemented in milestones.

### Milestone 1

- `Database` foundation:
  - Constructor stores the base config for per-collection `Datastore` creation.
  - `collection(name, options?)` lazily creates a dedicated `Datastore` per collection with the collection's own `duplicateKeys` policy.
  - `commit()` and `close()` iterate all per-collection `Datastore` instances.
  - `on('error', listener)` registers on all current and future `Datastore` instances.
  - After `close()`, all `Database` operations throw `ClosedDatabaseError`.
- Collection name validation:
  - Non-empty string.
  - No `\x00`.
  - Must not start with `_`.
- `Collection` class is introduced as a typed shell (no CRUD/query execution yet).

### Milestone 2+

`Collection` CRUD semantics, filter/update operators, and `ResultChain` behavior are implemented per [Spec 02](./02-crud-and-query.md) and [Spec 03](./03-aggregation-and-chain.md).

## 1. Database

### 1.1 Constructor

```ts
new Database(config?: DatabaseConfig)
```

`DatabaseConfig` extends the storage engine's `DatastoreConfig` (excluding `duplicateKeys`), passing through all options (driver, autoCommit, capacity, etc.) as the base configuration for per-collection `Datastore` instances.

| Field                   | Type                    | Description                                                                                                                                                                                                        |
| ----------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `driver`                | `DatastoreDriver \| DatabaseDriverFactory` | Optional. Storage driver, or a collection-aware factory `(collectionName: string) => DatastoreDriver` (see §1.6)                                                                                                   |
| `autoCommit`            | `AutoCommitConfig`      | Optional. Auto-commit configuration                                                                                                                                                                                |
| `capacity`              | `CapacityConfig`        | Optional. Capacity control                                                                                                                                                                                         |
| `index`                 | `IndexConfig`           | Optional. B+ tree index configuration (see §1.5)                                                                                                                                                                   |
| `payloadLimits`         | `PayloadLimitsConfig`   | Optional. Per-document validation limits (see §1.2)                                                                                                                                                                |
| `skipPayloadValidation` | `boolean`               | Optional. Skip payload validation entirely (for trusted input)                                                                                                                                                     |
| `maxErrorListeners`     | `number \| 'unlimited'` | Optional. Threshold for error-listener count warning (default: `32`). `'unlimited'` disables the warning.                                                                                                          |
| `maxMatchedDocuments`   | `number`                | Optional. Maximum documents buffered per scan (`find().toArray()`, `update`, `remove`) before `ValidationError` is thrown (default: `100000`). See [Spec 02 §11](./02-crud-and-query.md#11-result-set-size-limit). |

The `Database` constructor does not create any `Datastore` instance upfront. Instead, a dedicated `Datastore` is created lazily for each collection when `collection()` is first called, configured with the collection's own `duplicateKeys` policy (see §2.5). This enables per-collection autoscaling, independent rebalancing, and native duplicate-key enforcement by the storage engine. See [ADR-012](../adr/012-per-collection-datastore-isolation.md).

#### Payload Validation Strategy

frostpillar-db **always** sets `skipPayloadValidation: true` on the underlying datastore to avoid redundant validation on internal write paths (e.g., duplicate-key `'replace'` policy re-inserts). Instead, payload validation is performed at the **Collection level** on user-facing write paths (`insert()`, `insertMany()`, and `update()`). This ensures:

- User-provided documents are validated for structural correctness (circular references, unsupported types, depth/size limits) before storage.
- `update()` validates the resulting document after operators are applied, preventing updates from producing documents that would be rejected on insert.
- The collection-level validator supports all JSON-compatible types including arrays, avoiding inconsistencies with the datastore-level validator.

When the user explicitly sets `skipPayloadValidation: true`, the full structural validator is skipped, but a lightweight security-only validator still runs. The security validator checks for reserved keys, circular references, and enforces a nesting-depth cap (default `DEFAULT_MAX_DEPTH` = 64, or the configured `payloadLimits.maxDepth`) to prevent stack-overflow DoS. Documents exceeding the depth cap are rejected with `ValidationError` even in skip mode.

### 1.2 Payload Limits

`DatabaseConfig` accepts an optional `payloadLimits` field to customize per-document validation constraints. Consistent with §1.1, frostpillar-db enforces these limits at the **Collection level** on user-facing `insert()` and `insertMany()` paths — the underlying datastore is always constructed with `skipPayloadValidation: true`. All fields are optional — omitted fields retain the documented defaults below.

```ts
interface PayloadLimitsConfig {
  maxDepth?: number; // Max nesting depth (default: 64)
  maxKeyBytes?: number; // Max key UTF-8 byte length (default: 1024)
  maxStringBytes?: number; // Max string value UTF-8 byte length (default: 65535)
  maxKeysPerObject?: number; // Max keys per object level (default: 256)
  maxTotalKeys?: number; // Max total keys across the document (default: 4096)
  maxTotalBytes?: number; // Max total estimated JSON bytes (default: 1048576 = 1 MB)
}
```

| Field              | Default          | Description                                                                      |
| ------------------ | ---------------- | -------------------------------------------------------------------------------- |
| `maxDepth`         | 64               | Maximum nesting depth of objects and arrays (each container counts as one level) |
| `maxKeyBytes`      | 1,024            | Maximum UTF-8 byte length of a single key                                        |
| `maxStringBytes`   | 65,535           | Maximum UTF-8 byte length of a single string value                               |
| `maxKeysPerObject` | 256              | Maximum number of keys in a single object                                        |
| `maxTotalKeys`     | 4,096            | Maximum total keys across the entire document                                    |
| `maxTotalBytes`    | 1,048,576 (1 MB) | Maximum estimated JSON byte size of the document                                 |

**Key validation:** In addition to byte-length limits, keys must be non-empty after trimming whitespace. Keys consisting entirely of whitespace characters (e.g. `" "`, `"\t"`) are rejected with `ValidationError`. This prevents invisible-key confusion in stored documents.

**`maxTotalBytes` approximation:** The byte count is an approximation of `JSON.stringify` output size. It accounts for UTF-8 character widths and JSON delimiters (quotes, colons, braces, brackets, commas) but does not reproduce every detail of the JSON serializer — for example, escape sequences for control characters inflate the real output beyond the estimate. Users setting `maxTotalBytes` near a hard downstream cap (e.g. an HTTP body limit) should add a safety margin.

Each value must be a positive safe integer. Invalid values throw `ConfigurationError` at `Database` construction time.

**Example — raising the limit to 16 MB:**

```ts
const db = new Database({
  payloadLimits: {
    maxTotalBytes: 16 * 1024 * 1024, // 16 MB
    maxStringBytes: 4 * 1024 * 1024, // 4 MB per string
  },
});
```

**Scope:** Payload limits are database-wide and apply to all collections. They are enforced at the Collection level on every `insert`, `insertMany`, and `update` operation. For `update`, the resulting document is validated after operators are applied but before it is persisted. When `skipPayloadValidation` is `true`, size limits (bytes, key counts, etc.) are not enforced, but the `maxDepth` cap is still enforced by the security validator to prevent stack-overflow DoS.

**Depth applies to both objects and arrays:** `maxDepth` counts each container (plain object or array) as one nesting level. For example, `{ a: [1] }` puts the array at depth 2 (same as `{ a: { b: 1 } }` puts the nested object). This consistent counting prevents deeply nested array structures from bypassing the depth cap.

**`cloneDocument` safety note:** The internal `cloneDocument` helper is recursive but is only ever called on payloads that have already passed validation. Because validation enforces `maxDepth` on all code paths (including `skipPayloadValidation` mode), stored documents cannot exceed `maxDepth`, keeping clone and deep-equal operations safe without a separate depth counter in the hot path. This ordering also holds for the write-path deep copy that isolates stored records from caller-owned objects (see [Spec 02 §12](./02-crud-and-query.md#12-write-path-input-isolation) and [ADR-025](../adr/025-write-path-input-isolation.md)).

#### Supported Value Types

The payload validator accepts the following JSON-compatible value types for document fields:

| Type             | Notes                                                              |
| ---------------- | ------------------------------------------------------------------ |
| `string`         | UTF-8 byte length must be `<= maxStringBytes`                      |
| `number`         | Must be finite (no `Infinity`, `-Infinity`, or `NaN`)              |
| `boolean`        | `true` or `false`                                                  |
| `null`           | Allowed                                                            |
| `object` (plain) | Recursively validated; must be a plain object (no class instances) |
| `array`          | Recursively validated; each element must be a supported value type |

`bigint`, class instances, functions, `undefined`, `Symbol`, and circular references are rejected with `ValidationError`. Arrays are supported as field values and may be nested — each element is validated using the same rules as top-level field values.

#### Reserved Keys

To defend against prototype-pollution, the payload validator rejects the keys `__proto__`, `constructor`, `prototype`, `__defineGetter__`, `__defineSetter__`, `__lookupGetter__`, and `__lookupSetter__` at any nesting level. Attempting to insert a document containing any of these keys throws `ValidationError`. The restriction is centralised in `src/internal/objectUtils.ts` and also applies to filter keys and dot-notation path segments (see Spec 02 §8 Reserved Keys).

### 1.3 Methods

#### `db.collection<T>(name: string, options?: CollectionOptions): Collection<T>`

Returns a `Collection` instance for the given name. If the collection does not exist, it is created lazily (no upfront registration required).

**`CollectionOptions`:**

| Field                | Type                               | Default     | Description                                                                                                                                                                          |
| -------------------- | ---------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `duplicateKeys`      | `'allow' \| 'replace' \| 'reject'` | `'reject'`  | Duplicate `_id` handling policy                                                                                                                                                      |
| `ttl`                | `number`                           | `undefined` | Time-to-live in seconds. Documents expire after this duration from creation. See [Section 2.7](#27-ttl-time-to-live).                                                                |
| `capacity`           | `CapacityConfig`                   | `undefined` | Per-collection capacity override. See [Section 2.8](#28-capacity).                                                                                                                   |
| `autoCommit`         | `AutoCommitConfig`                 | `undefined` | Per-collection auto-commit override. See [Section 2.9](#29-auto-commit).                                                                                                             |
| `index`              | `IndexConfig`                      | `undefined` | Per-collection B+ tree index override. See [Section 2.10](#210-index-configuration).                                                                                                 |
| `key`                | `DatastoreKeyDefinition`           | `undefined` | Custom key type with user-defined normalize, compare, serialize, and deserialize functions. See [Section 2.11](#211-custom-key-types).                                               |
| `immutableCreatedAt` | `boolean`                          | `false`     | Rejects any update targeting `_createdAt`. **Automatically active whenever `ttl` is set**, regardless of this flag's value; set `true` explicitly to get the same update-time protection on a collection **without** `ttl`. Insert-time server-timestamp assignment (ignoring a caller-supplied `_createdAt`) only happens when `ttl` is set — this flag alone does not force it on a non-TTL collection. See [Section 2.7](#27-ttl-time-to-live). |

Once a collection is created, the resolved options (after defaults are filled in) are persisted for that collection name within the `Database` instance. **Every subsequent call to `db.collection(name, options?)` must resolve to options that match the stored options exactly**, or `ConfigurationError` is thrown. Bare re-access `db.collection(name)` resolves to the documented defaults (`{ duplicateKeys: 'reject' }`, no `ttl`, etc.) and therefore only succeeds when the stored options already equal those defaults. See [ADR-014](../adr/014-strict-collection-option-reaccess.md) for rationale.

**Validation:**

- `name` must be a string at runtime.
- `name` must be a non-empty string.
- `name` must not contain the null byte (`\x00`).
- `name` must not start with `_` (reserved for internal use).
- `name` must not contain `..` (consecutive dots); rejected to prevent path traversal interpretation.
- `name` must start with an ASCII letter or digit (`[a-zA-Z0-9]`); leading `.`, `-`, or other characters are rejected.
- Remaining characters must match `[a-zA-Z0-9_.-]`; spaces, `/`, `@`, and non-ASCII characters are rejected.
- The full validation regex is `/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/`.
- `options.duplicateKeys` (if provided) must be one of `'allow'`, `'replace'`, or `'reject'`.

Throws `ValidationError` on invalid names or collection options.

#### `db.dropCollection(name: string): Promise<void>`

Removes all documents in the named collection from the underlying Datastore and clears the collection's persisted options from the `Database` instance's internal registry. After this call, `collection(name)` returns a fresh, empty collection.

> After `dropCollection(name)`, the collection's persisted options (e.g., `duplicateKeys`) are cleared from the `Database` instance. The collection can be re-accessed with different options without triggering `ConfigurationError`.

**Error resilience:** If `datastore.clear()` throws, the method still performs full registry cleanup (removes the collection and its options from internal maps, unsubscribes error listeners, and closes the datastore) before re-throwing the error. This prevents half-cleaned state that would cause issues on a subsequent `db.close()`.

**Stale references:** After `dropCollection(name)`, any previously obtained `Collection` instance for that name is invalidated. Subsequent operations on the stale reference throw `ClosedDatabaseError`. Callers must re-acquire the collection via `db.collection(name)` to obtain a valid reference.

#### `db.listCollections(): Promise<string[]>`

Returns the names of all collections registered in the current session (via `db.collection()`), sorted alphabetically. Empty collections are included; the result reflects collection existence, not document count.

> **Session-scoped limitation:** `listCollections()` only iterates collections that have been accessed in the current session via `db.collection()`. Collections persisted from a previous session but not yet accessed will not appear in the results. To include a previously persisted collection, call `db.collection(name)` first to register it in the current session.

> **Performance:** `listCollections()` returns tracked collection names directly without consulting the storage engine. It is O(n) in the number of registered collections and does not run `Datastore.count()`.

#### `db.commit(): Promise<void>`

Iterates all per-collection `Datastore` instances **sequentially** and calls `commit()` on each. Flushes all pending writes for all collections to durable storage. If any individual `commit()` throws, the error propagates immediately and remaining collections are **not** committed.

#### `db.close(): Promise<void>`

Iterates all per-collection `Datastore` instances **sequentially** and calls `close()` on each. Releases resources and locks. After calling `close()`, all subsequent operations throw `ClosedDatabaseError`. If any individual `close()` throws, the error propagates immediately and remaining datastores are **not** closed.

#### `db.on(event: 'error', listener): () => void`

Registers the listener on all existing per-collection `Datastore` instances and stores it for registration on future instances created by `collection()`. Returns an unsubscribe function that removes the listener from all current and future instances.

**Idempotent registration:** If the same listener function reference is already registered, the call is a no-op and returns a no-op unsubscribe function. This prevents leaking duplicate underlying subscriptions and matches `EventTarget.addEventListener` semantics.

**Error-listener cap (`maxErrorListeners`):**

The `DatabaseConfig` field `maxErrorListeners` (default `32`) sets a threshold for the number of registered error listeners. When the count crosses the threshold for the first time, a single `console.warn` is emitted with an actionable message that includes the method name, current count, and instructions to increase or disable the threshold. The warning fires **once per crossing**: if listeners are later removed so the count drops back to or below the threshold, the flag resets and the warning fires again if the count rises above the threshold again. Setting `maxErrorListeners: 'unlimited'` disables the warning entirely.

### 1.4 Lifecycle

```
new Database(config)
  → collection('users')    // lazy collection access
  → insert / find / ...    // operations
  → commit()               // explicit flush (or auto-commit)
  → close()                // release resources
```

### 1.5 Index Configuration

`DatabaseConfig` accepts an optional `index` field to control B+ tree node sizing for all collections. This configuration is passed through to each per-collection `Datastore`.

```ts
interface IndexConfig {
  autoScale?: boolean;
  maxLeafEntries?: number;
  maxBranchChildren?: number;
  deleteRebalancePolicy?: DeleteRebalancePolicy; // 'standard' | 'lazy'
}
```

| Field                   | Type                    | Default      | Description                                                                     |
| ----------------------- | ----------------------- | ------------ | ------------------------------------------------------------------------------- |
| `autoScale`             | `boolean`               | `true`       | When true, B+ tree node capacity automatically increases as entry count grows   |
| `maxLeafEntries`        | `number`                | `undefined`  | Maximum entries per leaf node (3–16,384). Only valid when `autoScale: false`    |
| `maxBranchChildren`     | `number`                | `undefined`  | Maximum children per branch node (3–16,384). Only valid when `autoScale: false` |
| `deleteRebalancePolicy` | `DeleteRebalancePolicy` | `'standard'` | Strategy for rebalancing after deletes (`'standard'` or `'lazy'`)               |

**Auto-scale mode (default):**

When `autoScale` is `true` (or `index` is omitted), the B+ tree automatically increases node capacity as data grows. This is the recommended setting for most use cases.

```ts
const db = new Database(); // auto-scale enabled by default
```

**Fixed mode:**

When `autoScale` is `false`, the tree uses fixed node sizes. Both `maxLeafEntries` and `maxBranchChildren` may be specified.

```ts
const db = new Database({
  index: { autoScale: false, maxLeafEntries: 128, maxBranchChildren: 32 },
});
```

**Validation rules:**

- Setting `maxLeafEntries` or `maxBranchChildren` while `autoScale` is `true` throws `ConfigurationError`.
- Values must be safe integers between 3 and 16,384 (inclusive).

### 1.6 Durable Drivers and Collection Namespacing

Each collection is backed by its own `Datastore` ([ADR-012](../adr/012-per-collection-datastore-isolation.md)), so each durable collection needs its own physical namespace (file path, key prefix, IndexedDB database, OPFS directory, etc.). A single `DatastoreDriver` instance is bound to exactly one physical namespace and therefore cannot back more than one collection.

`DatabaseConfig.driver` accepts either form:

```ts
type DatabaseDriverFactory = (collectionName: string) => DatastoreDriver;

interface DatabaseConfig {
  driver?: DatastoreDriver | DatabaseDriverFactory;
  // ...
}
```

- **`DatabaseDriverFactory` (recommended for durable storage):** called once per collection when its `Datastore` is created lazily by `collection()`. The factory derives a per-collection namespace from the collection name:

  ```ts
  const db = new Database({
    driver: (name) =>
      fileDriver({
        target: { kind: 'directory', directory: './data', fileName: `${name}.fpdb` },
      }),
  });
  ```

  Collection names are validated by `collection()` before the factory is invoked (letters, digits, `_`, `.`, `-`; no leading `_`; no `..`), so they are safe to embed in file names and storage keys.

- **Plain `DatastoreDriver`:** supported for single-collection databases. Creating a **second** collection while another driver-backed collection exists throws `ConfigurationError`, because sharing one driver instance across collections would target the same lock/file (`DatabaseLockedError` on the file driver) or silently overwrite snapshots (last-writer-wins data loss on browser drivers). After `dropCollection()` closes the only driver-backed collection, a new collection may reuse the plain driver.

Databases without a `driver` (in-memory) are unaffected: any number of collections may coexist.

## 2. Collection

### 2.1 Access

Collections are accessed via `db.collection(name)`. Each `Collection` instance has its own dedicated `Datastore` instance, providing isolated storage with independent B+ tree autoscaling and rebalancing.

### 2.2 Document Model

A **document** is a plain JSON-compatible object. When stored, the system adds an `_id` field:

```ts
interface Document {
  _id: string;
  [key: string]: unknown;
}
```

- `_id` is a persistent identifier generated by frostpillar-db (not the storage engine's ephemeral `EntryId`).
- Users may provide their own `_id` at insertion time. If omitted, the system generates one using `crypto.randomUUID()`.
- A user-supplied `_id` must be a non-empty string of at most 1024 characters and must not contain control characters (codepoints `< 0x20` other than tab/newline/carriage-return, or `0x7f`); otherwise `ValidationError` is thrown. The same constraint applies to `_id` values used in filters (`$eq`, `$in`, and range bounds).
- `_id` is immutable once assigned.
- Whether `_id` is unique within a collection depends on the `duplicateKeys` policy (see §2.5).

### 2.3 Storage Mapping

Each document is stored as a record in the collection's dedicated Datastore:

| Datastore Field | Value                                 |
| --------------- | ------------------------------------- |
| `key`           | `{_id}`                               |
| `payload`       | The document object (including `_id`) |

Under the `'allow'` policy, multiple records may share the same storage key.

### 2.4 Collection Methods Summary

| Method                                 | Returns                     | Description                                                                                            |
| -------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------ |
| `insert(doc)`                          | `Promise<string>`           | Insert one document; returns `_id`                                                                     |
| `insertMany(docs)`                     | `Promise<string[]>`         | Insert multiple documents; returns `_id[]`                                                             |
| `find(filter?)`                        | `ResultChain`               | Query documents with optional filter                                                                   |
| `findOne(filter?)`                     | `Promise<Document \| null>` | First matching document                                                                                |
| `update(filter, operations, options?)` | `Promise<UpdateResult>`     | Update matching documents; returns `{ modifiedCount, upsertedId }`                                     |
| `remove(filter)`                       | `Promise<number>`           | Remove matching documents; returns count. The filter argument is required; see Spec 02 §4 for details. |
| `count(filter?)`                       | `Promise<number>`           | Count matching documents                                                                               |
| `exists(id)`                           | `Promise<boolean>`          | Check whether a non-expired document with the given `_id` exists. See Spec 02 §6.                      |
| `ids()`                                | `Promise<string[]>`         | Return all non-expired document IDs without loading payloads. See Spec 02 §7.                          |
| `watch(listener)`                      | `() => void`                | Subscribe to change events; returns unsubscribe function                                               |
| `purgeExpired()`                       | `Promise<number>`           | Remove expired documents from storage; returns count removed                                           |

Detailed behavior for each method is specified in [Spec 02](./02-crud-and-query.md).

### 2.5 Duplicate Key Policy

The `duplicateKeys` option controls how the collection handles `insert()` when a document with the same `_id` already exists. Each collection's dedicated `Datastore` is configured with the corresponding policy, delegating enforcement to the storage engine natively (see [ADR-012](../adr/012-per-collection-datastore-isolation.md)).

| Policy      | Behavior                                                      | Use case                                 |
| ----------- | ------------------------------------------------------------- | ---------------------------------------- |
| `'reject'`  | Throws `DuplicateIdError` on duplicate `_id`                  | User accounts, unique entities (default) |
| `'replace'` | Silently overwrites the existing document with the same `_id` | Configuration, settings, cache           |
| `'allow'`   | Multiple documents may share the same `_id`                   | Logs, events, time-series                |

#### Behavior per Policy

**`'reject'` (default):**

```ts
const users = db.collection('users'); // duplicateKeys: 'reject' by default
await users.insert({ _id: 'u1', name: 'Alice' }); // OK
await users.insert({ _id: 'u1', name: 'Bob' }); // throws DuplicateIdError
```

- The storage engine rejects the duplicate key natively. frostpillar-db catches the engine's error and re-throws as `DuplicateIdError`.
- `findOne({ _id })` returns at most one document.

**`'replace'`:**

```ts
const settings = db.collection('settings', { duplicateKeys: 'replace' });
await settings.insert({ _id: 'theme', value: 'dark' }); // stored
await settings.insert({ _id: 'theme', value: 'light' }); // overwrites previous
```

- The storage engine handles replacement natively — the old record is removed and replaced with the new one.
- `findOne({ _id })` returns at most one document.

**`'allow'`:**

```ts
const logs = db.collection('logs', { duplicateKeys: 'allow' });
await logs.insert({ _id: 'session-1', event: 'login' });
await logs.insert({ _id: 'session-1', event: 'logout' });
// Both documents coexist
```

- The storage engine allows multiple records with the same key natively.
- `find({ _id: 'session-1' })` may return multiple documents.
- Documents with the same `_id` are ordered by insertion order.

#### Impact on Other Operations

| Operation | `'reject'`                 | `'replace'`                | `'allow'`                  |
| --------- | -------------------------- | -------------------------- | -------------------------- |
| `insert`  | Throws on dup              | Overwrites                 | Always appends             |
| `findOne` | At most 1 per `_id`        | At most 1 per `_id`        | First match                |
| `update`  | Updates all filter matches | Updates all filter matches | Updates all filter matches |
| `remove`  | Removes all filter matches | Removes all filter matches | Removes all filter matches |
| `count`   | No difference              | No difference              | No difference              |

### 2.6 Change Events (watch)

#### Types

```ts
type ChangeEventType = 'insert' | 'update' | 'remove';

interface ChangeEvent<
  TDocument extends FrostpillarDocument = FrostpillarDocument,
> {
  /** Type of change */
  type: ChangeEventType;
  /** Collection name */
  collection: string;
  /** The document's _id */
  documentId: string;
  /** The document after the change (null for 'remove') */
  document: FrostpillarStoredDocument<TDocument> | null;
}

type ChangeListener<
  TDocument extends FrostpillarDocument = FrostpillarDocument,
> = (event: ChangeEvent<TDocument>) => void;
```

#### `collection.watch(listener: ChangeListener<TDocument>): () => void`

Registers a listener that is called synchronously after each successful mutation operation. Returns an unsubscribe function.

**Behavior per operation:**

| Operation                         | Event `type`             | `document` field                         |
| --------------------------------- | ------------------------ | ---------------------------------------- |
| `insert()`                        | `'insert'`               | The inserted document (defensive clone)  |
| `insertMany()`                    | `'insert'` (one per doc) | Each inserted document (defensive clone) |
| `update()` (match found)          | `'update'`               | The updated document (defensive clone)   |
| `update()` with upsert (no match) | `'insert'`               | The upserted document (via `insert()`)   |
| `remove()`                        | `'remove'`               | `null`                                   |

**Semantics:**

- Events are emitted **after** the storage operation succeeds, not before.
- The `document` field is a defensive clone to prevent external mutation of internal state.
- Multiple listeners can be registered; each receives all events.
- Calling the returned unsubscribe function removes only that listener.
- `watch()` does **not** accept a filter parameter. All changes are emitted. Consumers can filter in their listener callback.
- **Snapshot semantics:** The listener list is copied before iteration, so calling `unsubscribe()` or registering a new `watch()` from within a listener callback takes effect on the _next_ emit, not the current one.

### 2.7 TTL (Time-To-Live)

Collections can be configured with a `ttl` option (in seconds) to automatically expire documents based on their creation time.

```ts
const sessions = db.collection('sessions', { ttl: 3600 }); // 1 hour TTL
```

#### `_createdAt` auto-injection and protection

`_createdAt` exists purely as TTL bookkeeping; no other feature reads it. Because of that, **any collection with a `ttl` option always protects `_createdAt`**, independent of the `immutableCreatedAt` flag's value:

- On insert, `_createdAt` is unconditionally overwritten with the server timestamp (`Date.now()`, milliseconds since epoch), even if the caller supplied their own value.
- Any update operator targeting `_createdAt` — the exact field, or any dotted sub-path of it (e.g. `_createdAt.tamper`) — (`$set`, `$unset`, `$inc`, `$push`, `$pull`, `$addToSet`) or a `$rename` using `_createdAt` or a dotted sub-path of it as source or destination is rejected with `ValidationError`. This applies to the upsert path as well. The dotted-sub-path check exists because a document missing `_createdAt` (e.g. a legacy document from before `ttl` was configured) would otherwise let a dotted `$set`/`$rename` silently create `_createdAt` as a nested object instead of a number.

This prevents a client from forging a past `_createdAt` to force immediate expiry, or pushing it into the future (via `$set`/`$inc`) to defeat expiry entirely.

Collections **without** `ttl` do not inject `_createdAt` at insert time and, by default, do not protect it either — it behaves like any other field. Set `immutableCreatedAt: true` explicitly on a non-TTL collection to reject updates targeting `_createdAt` (the same update-time protection a TTL collection gets automatically). This does **not** force a server timestamp at insert time on a non-TTL collection — that override is tied specifically to `_createdAt`'s role as TTL bookkeeping and only happens when `ttl` is set. On a non-TTL collection, `immutableCreatedAt: true` is therefore a "write-once" guarantee: whatever value `_createdAt` has right after insert (caller-supplied, or absent) can never be changed by a later update.

**`immutableCreatedAt` option:** `true` unconditionally forces the update-time rejection described above. On a TTL collection this is redundant (the same protection is already automatic because of `ttl`) but harmless. On a non-TTL collection it is the only way to get that update-time protection — insert-time values remain caller-controlled either way (see above). `false` (the default) has no effect on TTL collections (protection stays on because of `ttl`); on non-TTL collections it leaves `_createdAt` fully client-writable, both at insert and via update.

#### Lazy expiration on reads

Expired documents are filtered out during all read operations (`find()`, `findOne()`, `count()`, etc.). A document is considered expired when:

```ts
Date.now() - document._createdAt > ttl * 1000;
```

Expired documents remain in storage until explicitly removed. They are simply excluded from query results.

#### `purgeExpired()` explicit cleanup

```ts
const removedCount = await sessions.purgeExpired();
```

Scans all documents in the collection and removes those that have expired. Returns the number of expired documents identified by this call (i.e., `expiredIds.length`), regardless of how many records the storage engine actually deleted. This ensures the count reflects what this invocation observed as expired, even if another concurrent caller already removed some of those records. If the collection has no `ttl` option, returns `0`.

#### Interaction with update

`update()` does **not** reset `_createdAt`. TTL is based on creation time only. Because `_createdAt` is always protected on a TTL collection (see above), it can no longer be changed via `$set`/`$inc`/etc. to extend a document's lifetime — attempting to do so throws `ValidationError`. To keep a logically-related document alive past its original TTL, remove and re-insert it (which assigns a fresh `_createdAt`).

### 2.8 Capacity

Collections can be configured with a `capacity` option to limit storage size. This overrides any database-level capacity configuration for that specific collection.

```ts
const logs = db.collection('logs', {
  capacity: { maxSize: '10MB', policy: 'turnover' },
});
```

**`CapacityConfig`:**

| Field     | Type                     | Default    | Description                                                                                                                                                  |
| --------- | ------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `maxSize` | `ByteSizeInput`          | (required) | Maximum storage size. Accepts a number (bytes), a string like `'10MB'`, or `'backendLimit'`.                                                                 |
| `policy`  | `'strict' \| 'turnover'` | `'strict'` | What happens when capacity is reached. `'strict'` rejects new inserts with `QuotaExceededError`. `'turnover'` evicts the oldest entries (FIFO) to make room. |

**Precedence:** Per-collection `capacity` overrides database-level `capacity`. If neither is set, no capacity limit is enforced.

**Conflict detection:** When a collection is accessed again with different `capacity` options, `ConfigurationError` is thrown (same behavior as `duplicateKeys` and `ttl`).

### 2.9 Auto-Commit

Collections can be configured with an `autoCommit` option to override database-level auto-commit behavior. This allows per-collection control over commit frequency and byte thresholds.

```ts
const logs = db.collection('logs', {
  autoCommit: { frequency: '5s', maxPendingBytes: 1024 * 1024 },
});
```

**`AutoCommitConfig`:**

| Field             | Type                       | Default     | Description                                                                                                                                                             |
| ----------------- | -------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `frequency`       | `AutoCommitFrequencyInput` | `undefined` | Commit frequency. `'immediate'` commits after every write; a number is treated as milliseconds; strings like `'5s'`, `'100ms'`, `'1m'`, `'1h'` are parsed as durations. |
| `maxPendingBytes` | `number`                   | `undefined` | Byte threshold that triggers an automatic commit when pending writes exceed this size.                                                                                  |

**Precedence:** Per-collection `autoCommit` overrides database-level `autoCommit`. If neither is set, no auto-commit is configured (manual `db.commit()` required).

**Conflict detection:** When a collection is accessed again with different `autoCommit` options, `ConfigurationError` is thrown (same behavior as `duplicateKeys`, `ttl`, and `capacity`).

### 2.10 Index Configuration

Collections can be configured with an `index` option to override database-level B+ tree index configuration. This allows per-collection control over node sizing.

```ts
const logs = db.collection('logs', {
  index: { autoScale: false, maxLeafEntries: 256, maxBranchChildren: 64 },
});
```

**`IndexConfig`:**

| Field                   | Type                    | Default      | Description                                                                     |
| ----------------------- | ----------------------- | ------------ | ------------------------------------------------------------------------------- |
| `autoScale`             | `boolean`               | `true`       | When true, B+ tree node capacity automatically increases as entry count grows   |
| `maxLeafEntries`        | `number`                | `undefined`  | Maximum entries per leaf node (3–16,384). Only valid when `autoScale: false`    |
| `maxBranchChildren`     | `number`                | `undefined`  | Maximum children per branch node (3–16,384). Only valid when `autoScale: false` |
| `deleteRebalancePolicy` | `DeleteRebalancePolicy` | `'standard'` | Strategy for rebalancing after deletes (`'standard'` or `'lazy'`)               |

**Precedence:** Per-collection `index` overrides database-level `index`. If neither is set, auto-scale is enabled by default.

**Conflict detection:** When a collection is accessed again with different `index` options, `ConfigurationError` is thrown (same behavior as `duplicateKeys`, `ttl`, `capacity`, and `autoCommit`).

### 2.11 Custom Key Types

Collections can be configured with a `key` option to use custom key types instead of the default string keys. This enables Date-ordered collections, composite keys, or domain-specific ordering.

```ts
interface DatastoreKeyDefinition<TKey = unknown, TInput = TKey> {
  normalize: (value: TInput, fieldName: string) => TKey;
  compare: (left: TKey, right: TKey) => number;
  serialize: (key: TKey) => string;
  deserialize: (serialized: string) => TKey;
}
```

**Example — numeric keys with custom ordering:**

```ts
const numericKey: DatastoreKeyDefinition<number> = {
  normalize: (v) => Number(v),
  compare: (a, b) => a - b,
  serialize: (k) => String(k),
  deserialize: (s) => Number(s),
};

const items = db.collection('items', { key: numericKey });
```

**Conflict detection:** Since `DatastoreKeyDefinition` contains functions, structural comparison is used: each of the four function properties (`normalize`, `compare`, `serialize`, `deserialize`) is compared by reference equality (`===`). Two key definition objects that reference the same four functions are considered equal, even if the outer objects are different references. Two collections created with different function references (even if functionally equivalent) are considered to have different options and will throw `ConfigurationError`.

**Document identity is unaffected by the key definition.** `_id` stays the string stored on the document, and every operation that takes an `_id` — `find`, `findOne`, `exists`, `remove`, `update` — matches it by exact string equality. A `normalize` function may be non-injective: with `normalize: (v) => Number(v)`, the `_id`s `"01"` and `"1"` collapse onto the same storage key. The key definition then governs only storage-level behavior, never query results:

| Surface                            | Behavior under a non-injective `normalize`                                                                                                                |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `find` / `findOne` / `exists`      | Match the stored `_id` string. With only `_id: "01"` stored, `_id: "1"` matches nothing.                                                                    |
| `remove`                           | Deletes only the documents whose stored `_id` matches; `watch()` reports the stored `_id`.                                                                  |
| `ids()`                            | Returns the stored `_id` strings (`["01"]`), never the normalized keys.                                                                                     |
| `insert` under `duplicateKeys`     | Applies at the **key** level: `"01"` and `"1"` share a key, so the second insert is rejected (`'reject'`) or replaces the first (`'replace'`), as for any key collision. |

Colliding `_id`s are therefore best avoided: keep `normalize` injective over the `_id` strings the collection actually stores. See [ADR-027](../adr/027-custom-key-id-identity.md) for the rationale and the fast-path implications.

## 3. Error Types

| Error                 | Extends            | Description                                                                                                                                                                  |
| --------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ClosedDatabaseError` | `FrostpillarError` | Operation on a closed database                                                                                                                                               |
| `ValidationError`     | `FrostpillarError` | Invalid collection name or document                                                                                                                                          |
| `DuplicateIdError`    | `FrostpillarError` | Inserting a document with an existing `_id` under `'reject'` policy                                                                                                          |
| `ConfigurationError`  | `FrostpillarError` | Invalid database/index configuration, invalid `maxErrorListeners` value, or re-accessing a collection with conflicting options (re-exported from frostpillar-storage-engine) |

All errors from the underlying storage engine propagate unchanged. `ConfigurationError` is the same class used by the storage engine, re-exported for consistency.

## 4. TypeScript Generics

Collections support an optional type parameter for document shape:

```ts
interface User {
  _id: string;
  name: string;
  age: number;
}

const users = db.collection<User>('users');
// insert, find, etc. are typed to User
```

This is a convenience for type checking — no runtime validation is performed (see [ADR-002](../adr/002-schema-less-document-model.md)).
