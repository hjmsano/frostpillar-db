# Frostpillar DB

[English/英語](./README.md) | [Japanese/日本語](./README-JA.md)

[![npm version](https://img.shields.io/npm/v/@frostpillar/frostpillar-db)](https://www.npmjs.com/package/@frostpillar/frostpillar-db)
[![Node.js >=24](https://img.shields.io/badge/Node.js-%3E%3D24-green.svg)](https://nodejs.org/)
[![CI](https://github.com/hjmsano/frostpillar-db/actions/workflows/ci.yml/badge.svg)](https://github.com/hjmsano/frostpillar-db/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A tiny, light and fast flexible database for TypeScript, Node.js, and browser JavaScript, with no third-party runtime dependencies.

Built on top of [frostpillar-storage-engine](https://github.com/hjmsano/frostpillar-storage-engine), it provides a familiar query API with filtering, update operators, and method chaining — all without an SQL parser or external dependencies.

```
frostpillar-db          ← Database management and query API (this package)
├── frostpillar-query-interface  ← SQL-like / Lucene-like query API (planned)
├── frostpillar-storage-engine   ← Core storage and chunk handling
│   └── frostpillar-btree        ← B+ tree indexing
frostpillar-http-api    ← RESTful API layer (planned)
frostpillar-mcp         ← MCP interface for AI agent integration (planned)
frostpillar-cli         ← Command-line interface (planned)
```

## Features

- **Multi-runtime** — works in Node.js, browsers, and browser extensions
- **Fluent query API** — method chaining with `$`-operator filters and lazy execution (`find`, `sort`, `skip`, `limit`, `project`, `toArray`, `count`)
- **CRUD + update operators** — `insert`, `insertMany`, `find`, `findOne`, `update`, `remove`, `count` with `$set`, `$unset`, `$inc`, `$rename`, `$push`, `$pull`, `$addToSet`
- **Upsert support** — `update` with `{ upsert: true }` inserts when no document matches
- **Built-in aggregation** — `sum`, `avg`, `min`, `max`, `percentile`, `median`, `distinct`, `groupBy` (single- or multi-field) on filtered result sets
- **Change events** — `watch()` listeners for insert, update, and remove operations
- **TTL (Time-To-Live)** — automatic document expiration per collection
- **Async cursor** — iterate results with `for await...of`
- **Schema-less** — store any JSON-compatible document; no upfront schema required
- **Pluggable storage** — in-memory, file, localStorage, IndexedDB, OPFS, and browser extension sync storage (via frostpillar-storage-engine)
- **Zero third-party runtime dependencies** — only Frostpillar family packages
- **Tree-shakable** — ESM with `sideEffects: false`

## Quick Start

### Node.js / TypeScript

**1. Install**

```bash
npm install @frostpillar/frostpillar-db
```

**2. Create `example.mjs`**

```js
import { Database } from '@frostpillar/frostpillar-db';

const db = new Database({});
const users = db.collection('users');

// Insert
await users.insert({ name: 'Alice', age: 30, dept: 'engineering' });
await users.insert({ name: 'Bob', age: 25, dept: 'design' });
await users.insert({ name: 'Carol', age: 35, dept: 'engineering' });

// Find with filtering, sorting, and pagination
const results = await users
  .find({ age: { $gte: 25 } })
  .sort({ age: -1, name: 1 })
  .limit(10)
  .toArray();

console.log(results);
// [{ name: 'Carol', age: 35, ... }, { name: 'Alice', age: 30, ... }, ...]

// Update
await users.update({ name: 'Alice' }, { $set: { age: 31 } });

// Remove
await users.remove({ dept: 'design' });

await db.close();
```

**3. Run**

```bash
node example.mjs
```

### Browser

Download an IIFE bundle from [GitHub Releases](https://github.com/hjmsano/frostpillar-db/releases) and load it with a `<script>` tag.

| Bundle                       | Global              | Includes                                                  |
| ---------------------------- | ------------------- | --------------------------------------------------------- |
| `frostpillar-db.min.js`      | `FrostpillarDB`     | Full package (all drivers)                                |
| `frostpillar-db-core.min.js` | `FrostpillarDBCore` | Core + `localStorageDriver` + `indexedDBDriver` (lighter) |

All exports are available on the corresponding global object (`window.FrostpillarDB` or `window.FrostpillarDBCore`).

```html
<script src="frostpillar-db.min.js"></script>
<script>
  const { Database } = window.FrostpillarDB;

  async function main() {
    const db = new Database({});
    const tasks = db.collection('tasks');

    // Insert
    await tasks.insert({ title: 'Buy milk', done: false, priority: 1 });
    await tasks.insert({ title: 'Write code', done: false, priority: 3 });
    await tasks.insert({ title: 'Go for a run', done: true, priority: 2 });

    // Find pending tasks
    const pending = await tasks
      .find({ done: false })
      .sort({ priority: -1 })
      .toArray();
    console.log(pending);

    await db.close();
  }

  main().catch(console.error);
</script>
```

> **Note:** `async`/`await` at the top level only works inside `<script type="module">`. When loading the IIFE bundle via a plain `<script>` tag, wrap your code in an `async` function as shown above.

---

## When to Use Frostpillar

**Good for:** embedded apps, prototyping, browser-local data, browser extensions, small-to-medium datasets, CLI tools, Electron/Tauri apps.

**Not for:** multi-GB datasets, concurrent write-heavy servers, relational data with complex joins.

## Table of Contents

- [Quick Start](#quick-start)
- [Compatibility](#compatibility)
- [Entry Points](#entry-points)
- [User Manual](#user-manual)
  - [Database](#database)
    - [Error Monitoring](#error-monitoring)
  - [Collections](#collections)
    - [Per-Collection Options](#per-collection-options)
    - [Collection Introspection](#collection-introspection)
  - [CRUD Operations](#crud-operations)
  - [Identity Queries](#identity-queries)
  - [Query Filters](#query-filters)
  - [Performance Notes](#performance-notes)
  - [ResultChain (Sorting, Pagination, Projection)](#resultchain)
  - [Aggregation](#aggregation)
  - [Grouping](#grouping)
  - [Update Operators](#update-operators)
  - [Change Events](#change-events)
  - [TTL (Time-To-Live)](#ttl-time-to-live)
  - [Async Cursor](#async-cursor)
  - [Persistent Storage](#persistent-storage)
  - [Payload Limits](#payload-limits)
  - [Operational Limits](#operational-limits)
    - [Reserved Keys](#reserved-keys)
  - [Index Configuration](#index-configuration)
  - [Error Handling](#error-handling)
- [API Reference](#api-reference)
- [How to Contribute](#how-to-contribute)
- [License](#license)

---

## Compatibility

| Environment | Requirement                                                       |
| ----------- | ----------------------------------------------------------------- |
| Node.js     | >= 24.0.0 (ESM and CJS)                                           |
| Browser     | ES2020-compatible (Chrome 80+, Firefox 74+, Safari 14+, Edge 80+) |
| TypeScript  | >= 5.0                                                            |

> **Pre-1.0 notice:** While the major version is `0`, minor version bumps may include breaking changes. Pin your dependency version and review the [GitHub Releases](https://github.com/hjmsano/frostpillar-db/releases) page before upgrading.

---

## Entry Points

### ESM / CJS Subpath Exports

| Import path                           | Exports                                                      |
| ------------------------------------- | ------------------------------------------------------------ |
| `frostpillar-db`                      | Database, Collection, errors, and types — no drivers bundled |
| `frostpillar-db/core`                 | Identical to `frostpillar-db` — kept as a stable alias       |
| `frostpillar-db/drivers/file`         | `fileDriver` (Node.js file storage)                          |
| `frostpillar-db/drivers/localStorage` | `localStorageDriver` (browser localStorage)                  |
| `frostpillar-db/drivers/indexedDB`    | `indexedDBDriver` (browser IndexedDB)                        |
| `frostpillar-db/drivers/opfs`         | `opfsDriver` (Origin Private File System)                    |
| `frostpillar-db/drivers/syncStorage`  | `syncStorageDriver` (browser extension sync)                 |

Neither `frostpillar-db` nor `frostpillar-db/core` bundles drivers — both entry points export the same symbols. Always import drivers separately from the `frostpillar-db/drivers/*` subpaths listed above. `frostpillar-db/core` is retained as a stable alias for compatibility.

### Browser IIFE Bundles

| Bundle                       | Global              | Includes                                                        |
| ---------------------------- | ------------------- | --------------------------------------------------------------- |
| `frostpillar-db.min.js`      | `FrostpillarDB`     | Full package (all drivers)                                      |
| `frostpillar-db-core.min.js` | `FrostpillarDBCore` | Core + `localStorageDriver` + `indexedDBDriver` (lighter build) |

Both bundles are available from [GitHub Releases](https://github.com/hjmsano/frostpillar-db/releases).

---

## User Manual

### Database

`Database` is the top-level entry point. It manages per-collection `Datastore` instances and provides collection access.

**Node.js / TypeScript:**

```ts
import { Database } from '@frostpillar/frostpillar-db';

const db = new Database({});
```

**Browser:**

```js
const { Database } = window.FrostpillarDB;

const db = new Database({});
```

**Lifecycle:**

```js
// Use the database...
await db.commit(); // Explicit flush to durable storage
await db.close(); // Release resources and locks
```

> **Sequential processing:** `commit()` and `close()` iterate collections sequentially. If any individual collection's operation throws, the error propagates immediately and remaining collections are skipped. Callers who need best-effort semantics should wrap the call in a try/catch per collection.

#### Error Monitoring

Asynchronous errors from background tasks (such as auto-commit) are not thrown from user calls. Subscribe to them via `db.on('error', ...)`:

```ts
const unsubscribe = db.on('error', (event) => {
  console.error(event.source, event.error, event.occurredAt);
});

// Later, to stop listening
unsubscribe();
```

The listener is registered on all current and future per-collection datastores. The returned function removes it from every datastore it was attached to.

> **Listener cap:** `maxErrorListeners` (default `32`) sets a threshold for the number of registered error listeners. When the count exceeds the threshold, a `console.warn` is emitted. If listeners are later removed so the count drops back to or below the threshold, the warning resets and fires again on the next crossing. Set `maxErrorListeners: 'unlimited'` to disable the warning entirely.
>
> ```ts
> const db = new Database({ maxErrorListeners: 64 });
> ```

### Collections

Collections are logical groupings of documents, accessed by name:

```ts
const users = db.collection('users');
const posts = db.collection('posts');
```

Collections are created lazily — no upfront registration needed.

```ts
// List all registered collections (including empty ones)
const names = await db.listCollections();

// Drop a collection (removes all its documents)
await db.dropCollection('posts');
```

> **Note:** After `dropCollection()`, any previously obtained `Collection` reference for that name becomes invalid. Subsequent operations on a stale reference throw `ClosedDatabaseError`. Re-acquire the collection via `db.collection(name)` if needed.

> **Note:** `listCollections()` only returns collections accessed in the current session via `db.collection()`. Collections persisted from a previous session but not yet accessed will not appear. Call `db.collection(name)` first to register a collection before it shows up in results.

> **Performance:** `listCollections()` returns tracked collection names directly without querying the storage engine. It is O(n) in the number of registered collections.

#### Duplicate Key Policy

Each collection can be configured with a duplicate key policy that controls how `insert()` handles documents with the same `_id`. This aligns with the storage engine's key handling model.

```ts
const users = db.collection('users'); // default: 'reject'
const settings = db.collection('settings', { duplicateKeys: 'replace' });
const logs = db.collection('logs', { duplicateKeys: 'allow' });
```

| Policy      | Behavior                                     | Use case                                 |
| ----------- | -------------------------------------------- | ---------------------------------------- |
| `'reject'`  | Throws `DuplicateIdError` on duplicate `_id` | User accounts, unique entities (default) |
| `'replace'` | Silently overwrites the existing document    | Configuration, settings, cache           |
| `'allow'`   | Multiple documents may share the same `_id`  | Logs, events, time-series                |

```ts
// 'reject' (default) — unique _id enforcement
const users = db.collection('users');
await users.insert({ _id: 'u1', name: 'Alice' });
await users.insert({ _id: 'u1', name: 'Bob' }); // throws DuplicateIdError

// 'replace' — last-write-wins
const settings = db.collection('settings', { duplicateKeys: 'replace' });
await settings.insert({ _id: 'theme', value: 'dark' });
await settings.insert({ _id: 'theme', value: 'light' }); // overwrites

// 'allow' — append-only
const logs = db.collection('logs', { duplicateKeys: 'allow' });
await logs.insert({ _id: 'session-1', event: 'login' });
await logs.insert({ _id: 'session-1', event: 'logout' }); // both stored
```

> **Performance note:** Under the `'reject'` policy, duplicate detection is accelerated by an internal Bloom filter in the storage engine — most negative lookups are answered without touching the B+ tree. This is transparent to the caller and requires no configuration.

**Re-accessing a collection with conflicting options** throws `ConfigurationError`. Strict equality applies to every re-access, including bare lookup: `db.collection(name)` (no options) resolves to defaults and only succeeds when the stored options also equal defaults. If you configured a collection with non-default options, you must pass the same options on every subsequent `collection()` call, or cache the `Collection` reference from the first call. See [ADR-014](docs/adr/014-strict-collection-option-reaccess.md).

**TypeScript generics** provide type hints (no runtime validation):

```ts
interface User {
  _id: string;
  name: string;
  age: number;
}

const users = db.collection<User>('users');
```

#### Per-Collection Options

In addition to `duplicateKeys`, `ttl`, and `immutableCreatedAt`, each collection can override database-level settings or declare collection-specific ones by passing options to `db.collection(name, { ... })`:

```ts
import type {
  AutoCommitConfig,
  CapacityConfig,
  DatastoreKeyDefinition,
  IndexConfig,
} from '@frostpillar/frostpillar-db';

// Capacity — cap a collection to 10 MB with FIFO eviction
const logs = db.collection('logs', {
  capacity: { maxSize: '10MB', policy: 'turnover' },
});

// Auto-commit — flush this collection every 5 seconds
const events = db.collection('events', {
  autoCommit: { frequency: '5s', maxPendingBytes: 1024 * 1024 },
});

// Index — disable auto-scale and use fixed node sizes
const archive = db.collection('archive', {
  index: { autoScale: false, maxLeafEntries: 256, maxBranchChildren: 64 },
});

// Custom key type — numeric keys with natural ordering
const numericKey: DatastoreKeyDefinition<number> = {
  normalize: (v) => Number(v),
  compare: (a, b) => a - b,
  serialize: (k) => String(k),
  deserialize: (s) => Number(s),
};
const items = db.collection('items', { key: numericKey });
```

Per-collection options take precedence over database-level configuration. Re-accessing a collection with a different value for any of these fields throws `ConfigurationError`. See [Spec 01](docs/specs/01-database-and-collection.md) §2.8–§2.11 for full details.

#### Collection Introspection

Each `Collection` instance exposes its resolved configuration as readonly fields, useful for logging, metrics, or conditional logic:

```ts
const users = db.collection('users', { ttl: 3600 });

users.name; // 'users'
users.duplicateKeys; // 'reject' (default)
users.ttl; // 3600 (or undefined when TTL is not configured)
```

These fields reflect the resolved options after merging database-level defaults with per-collection overrides.

### CRUD Operations

#### Insert

```ts
// Single document — returns the generated _id
const id = await users.insert({ name: 'Alice', age: 30 });

// With custom _id
await users.insert({ _id: 'user-001', name: 'Bob', age: 25 });

// Multiple documents
const ids = await users.insertMany([
  { name: 'Carol', age: 35 },
  { name: 'Dave', age: 28 },
]);
```

> **Note:** A custom `_id` must be a non-empty string of at most 1,024 characters with no control characters; otherwise `insert` throws `ValidationError`. The same constraint applies to `_id` values used in filters.

> **Note:** `insertMany` is not transactional. If an error occurs mid-batch (e.g., a duplicate `_id` on a `'reject'` collection), documents already inserted are not rolled back. The caller receives the thrown error, not a partial result.

#### Find

```ts
// All documents
const all = await users.find().toArray();

// With filter
const seniors = await users.find({ age: { $gte: 30 } }).toArray();

// Single document
const alice = await users.findOne({ name: 'Alice' });
```

#### Update

```ts
// Update matching documents — returns an UpdateResult
const { modifiedCount } = await users.update(
  { dept: 'engineering' },
  { $set: { active: true }, $inc: { loginCount: 1 } },
);

// Upsert — insert if no document matches the filter
const { modifiedCount: m, upsertedId } = await users.update(
  { name: 'Eve' },
  { $set: { age: 22, dept: 'marketing' } },
  { upsert: true },
);
// If 'Eve' exists: modifiedCount >= 1, upsertedId === null
// If 'Eve' does not exist: modifiedCount === 0, upsertedId === '<new _id>'
```

`UpdateResult` shape:

```ts
interface UpdateResult {
  modifiedCount: number; // number of documents actually modified
  upsertedId: string | null; // _id of the upserted document, or null
}
```

> **Note:** `update` is not transactional. If an update operator throws (e.g., `$inc` on a non-numeric field), documents already modified in the same call are not rolled back.

#### Remove

```ts
// Remove matching documents — returns count of removed documents
const count = await users.remove({ age: { $lt: 18 } });
```

> **Note:** The `filter` argument is required. Omitting it or passing `null` throws `ValidationError`. To remove all documents, pass an empty object: `users.remove({})`.

#### Count

```ts
const total = await users.count();
const active = await users.count({ status: 'active' });
```

> **Note:** On collections with `duplicateKeys: 'allow'`, `count()` returns the **total record count** including duplicates — not the number of unique `_id` values.

### Identity Queries

When you only need to check existence or enumerate document IDs, use the lightweight `exists()` and `ids()` helpers instead of `find()` / `findOne()`:

```ts
// Fast existence check — does not load the document payload
if (await users.exists('user-001')) {
  // ...
}

// List every document _id in the collection
const allIds = await users.ids();
```

- `exists(id)` uses `Datastore.has(key)` as a fast path and returns `false` for expired documents on TTL collections.
- `ids()` uses `Datastore.keys()` as a fast path; on TTL collections it filters out expired documents so its output stays consistent with `find()` and `count()`.

### Query Filters

Filters use `$`-prefixed operators:

#### Comparison

<!-- prettier-ignore -->
```ts
{ age: 30 } // implicit $eq
{ age: { $eq: 30 } } // explicit $eq
{ age: { $ne: 30 } } // not equal
{ age: { $gt: 25 } } // greater than
{ age: { $gte: 25 } } // greater than or equal
{ age: { $lt: 50 } } // less than
{ age: { $lte: 50 } } // less than or equal
```

> **Cross-type comparisons return no matches.** No type coercion is performed. If the field type differs from the operand type (e.g. `{ age: { $gt: '30' } }` against a numeric `age` field), the predicate evaluates to `false` and the document is excluded from results. This mirrors MongoDB semantics.

#### Inclusion

<!-- prettier-ignore -->
```ts
{ status: { $in: ['active', 'pending'] } }
{ role: { $nin: ['guest'] } }
```

> **Deep equality note:** `$in`, `$nin`, `$eq`, `$ne`, `$all`, `$pull`, and `$addToSet` use an internal deep equality implementation that supports primitives, `Date`, plain arrays, and plain objects. `Map`, `Set`, `RegExp`, and typed arrays (e.g. `Uint8Array`) are not supported as filter or operand values.

#### Logical

<!-- prettier-ignore -->
```ts
{ $and: [{ age: { $gte: 18 } }, { age: { $lt: 65 } }] }
{ $or: [{ status: 'active' }, { role: 'admin' }] }
{ age: { $not: { $lt: 18 } } }
```

Multiple top-level keys are implicitly `$and`:

<!-- prettier-ignore -->
```ts
{ age: { $gt: 20 }, status: 'active' }
```

#### String

<!-- prettier-ignore -->
```ts
{ name: { $regex: /^Ali/i } }
```

> `$regex` accepts a `RegExp` object or a string pattern. For `RegExp` operands, the `g` (global) and `y` (sticky) flags are automatically stripped to ensure stateless evaluation; all other flags (e.g. `i`, `m`, `s`) are preserved.

#### Existence

<!-- prettier-ignore -->
```ts
{ email: { $exists: true } }
{ deletedAt: { $exists: false } }
```

#### Array

<!-- prettier-ignore -->
```ts
{ tags: { $elemMatch: { $gt: 5 } } } // at least one element matches
{ tags: { $all: ['a', 'b'] } } // array contains all listed values
{ tags: { $size: 3 } } // array has exactly 3 elements
```

#### Nested Fields (Dot Notation)

<!-- prettier-ignore -->
```ts
{ 'address.city': 'Tokyo' }
{ 'metadata.tags.primary': { $eq: 'featured' } }
```

### Performance Notes

- **`_id` equality fast path** — `findOne({ _id })` and internal `_id` lookups call `Datastore.getFirst(key)` directly, skipping the full scan pipeline.
- **`_id` range scan** — When a filter uses `$gt`/`$gte` together with `$lt`/`$lte` on `_id` (both bounds present, matching types), the query engine delegates to a B+Tree leaf-level range scan via `Datastore.getRange(start, end)`. Additional non-`_id` conditions are evaluated in-memory on the narrowed range. Mixed-type bounds (e.g. `string` lower + `number` upper) throw `ValidationError`.
- **`$in` on `_id` fast path** — `find({ _id: { $in: [...] } })`, `update`, and `remove` with an `_id` `$in` filter use `Datastore.getMany(keys)` for a batch lookup, avoiding a full scan. The same optimization applies to the `remove` delete path via `Datastore.deleteMany(keys)`.
- **`exists()` / `ids()` fast paths** — These bypass payload loading on non-TTL collections (see [Identity Queries](#identity-queries)).

### ResultChain

`find()` returns a `ResultChain` for composable queries:

```ts
const results = await users
  .find({ status: 'active' })
  .sort({ age: -1, name: 1 }) // sort descending by age, then ascending by name
  .skip(20) // skip first 20
  .limit(10) // take 10
  .project({ name: 1, age: 1 }) // include only name and age (plus _id)
  .toArray();
```

`.sort()` accepts either a `SortSpec` object or a `SortSpecEntries` array of `[field, direction]` tuples. Use the array form when field names are non-negative integer strings — JavaScript reorders integer-like keys in object literals before any code runs, so the object form does not guarantee key order in that case:

```ts
// Object form — integer-like keys are reordered by JavaScript: '1' becomes primary
.sort({ '2': 1, '1': 1 })

// Array form — order is preserved: '2' is the primary sort key
.sort([['2', 1], ['1', 1]])
```

**Chains are reusable:**

```ts
const activeUsers = users.find({ status: 'active' }).sort({ name: 1 });

const page1 = await activeUsers.skip(0).limit(10).toArray();
const page2 = await activeUsers.skip(10).limit(10).toArray();
const total = await activeUsers.count();
```

### Aggregation

Aggregation methods are terminal methods on `ResultChain`:

```ts
const sum = await users.find({ dept: 'eng' }).sum('salary');
const avg = await users.find({ dept: 'eng' }).avg('salary');
const min = await users.find({ dept: 'eng' }).min('salary');
const max = await users.find({ dept: 'eng' }).max('salary');
```

`sum`, `avg`, `min`, and `max` operate on the full filtered set — sort, skip, and limit are not applied. `count()` is an exception: it applies skip and limit so it matches what `.toArray()` would return. See [ResultChain](#resultchain) for `count()`.

Non-numeric values are skipped. `avg`/`min`/`max` return `null` when no numeric values exist. `sum` returns `0`.

#### Percentile and Median

```ts
const p95 = await requests.find({ route: '/api' }).percentile('latencyMs', 0.95);
const [p50, p95all, p99] = await requests
  .find({ route: '/api' })
  .percentile('latencyMs', [0.5, 0.95, 0.99]);
const medianLatency = await requests.find({ route: '/api' }).median('latencyMs');
```

`p` is a fraction in `[0, 1]` (`0.95` = 95th percentile), not the 0–100 percent scale. Percentiles are computed with linear interpolation between closest ranks (`PERCENTILE_CONT` — the same definition used by SQL, numpy, and pandas): `percentile(f, 0)` equals `min(f)`, `percentile(f, 1)` equals `max(f)`, and the median of an even-count set is the average of the two middle values.

Passing an array of fractions fetches and sorts the filtered set **once**, then returns each percentile positionally — the efficient way to compute p50/p95/p99 together. `median(field)` is exactly `percentile(field, 0.5)`. Both skip non-numeric values and return `null` (or an all-`null` array, for the array form) when no numeric values exist.

#### Distinct

```ts
const departments = await users.find().distinct('dept');
// ['design', 'engineering', 'marketing']
```

### Grouping

`groupBy` groups filtered documents by a field and computes accumulators per group. Pass a single field path to group by one dimension, or an array of field paths to group by a composite key across multiple dimensions:

```ts
const result = await users.find().groupBy('dept', {
  total: { $count: true },
  avgAge: { $avg: 'age' },
  maxSalary: { $max: 'salary' },
});
// [
//   { _key: 'engineering', total: 5, avgAge: 32, maxSalary: 120000 },
//   { _key: 'design',      total: 3, avgAge: 28, maxSalary: 95000 },
// ]
```

**Multi-dimension grouping** — pass an array of field paths to group by a composite key. `_key` becomes an object with one property per requested path, keyed by the literal path string:

```ts
const result = await users.find().groupBy(['dept', 'address.city'], {
  count: { $count: true },
});
// [
//   { _key: { dept: 'engineering', 'address.city': 'Tokyo' }, count: 7 },
//   { _key: { dept: 'engineering', 'address.city': 'Osaka' }, count: 5 },
//   { _key: { dept: 'design',      'address.city': 'Tokyo' }, count: 3 },
// ]
```

A document missing one of the requested fields contributes `null` for that dimension. A single-element array (e.g. `['dept']`) still produces an object `_key` — it is not collapsed to the scalar form used by the single-field form.

Available accumulators: `$count`, `$sum`, `$avg`, `$min`, `$max`, `$median`, `$percentile`.

`$median: 'fieldPath'` and `$percentile: { field: 'fieldPath', p: 0.95 }` mirror `.median()` / `.percentile()`: same interpolation, same `null`-when-empty behavior. `p` is **scalar-only** inside `groupBy` — request multiple percentiles as multiple output fields:

```ts
const result = await requests.find({}).groupBy('route', {
  p50: { $percentile: { field: 'latencyMs', p: 0.5 } },
  p95: { $percentile: { field: 'latencyMs', p: 0.95 } },
  p99: { $percentile: { field: 'latencyMs', p: 0.99 } },
});
```

> **Object key ordering:** When grouping by a field whose value is an object or array, keys are serialized via `JSON.stringify`. Objects with the same properties in different insertion order (e.g. `{a:1, b:2}` vs `{b:2, a:1}`) become **different** groups. Normalize property order before insertion if consistent grouping is required. This applies independently to each dimension in the multi-dimension form.

### Update Operators

| Operator    | Description                                          | Example                             |
| ----------- | ---------------------------------------------------- | ----------------------------------- |
| `$set`      | Set field values                                     | `{ $set: { name: 'Bob' } }`         |
| `$unset`    | Remove fields                                        | `{ $unset: { temp: true } }`        |
| `$inc`      | Increment numeric fields                             | `{ $inc: { views: 1 } }`            |
| `$rename`   | Rename fields (throws if destination already exists) | `{ $rename: { old: 'new' } }`       |
| `$push`     | Append a value to an array                           | `{ $push: { tags: 'new' } }`        |
| `$pull`     | Remove all matching values from an array             | `{ $pull: { tags: 'old' } }`        |
| `$addToSet` | Add a value to an array only if not already present  | `{ $addToSet: { tags: 'unique' } }` |

Dot notation works in update operators:

```ts
{ $set: { 'address.city': 'Osaka' } }
{ $inc: { 'stats.visits': 1 } }
```

Array operator examples:

```ts
// Append to an array (creates the array if the field is missing)
await users.update({ name: 'Alice' }, { $push: { hobbies: 'cycling' } });

// Remove all occurrences of a value (deep equality for objects)
await users.update({ name: 'Alice' }, { $pull: { hobbies: 'cycling' } });

// Add only if not already present
await users.update({ name: 'Alice' }, { $addToSet: { hobbies: 'reading' } });
```

### Change Events

Use `watch()` to subscribe to insert, update, and remove events on a collection:

```ts
const users = db.collection('users');

const unsubscribe = users.watch((event) => {
  console.log(event.type); // 'insert' | 'update' | 'remove'
  console.log(event.collection); // 'users'
  console.log(event.documentId); // the document's _id
  console.log(event.document); // the document after the change (null for 'remove')
});

await users.insert({ name: 'Alice', age: 30 });
// watch callback fires with type: 'insert'

// Unsubscribe when done
unsubscribe();
```

Events are emitted synchronously after each write operation. The `document` in the event is a deep clone, so mutating it does not affect stored data.

> **Note:** If a `watch()` listener throws an error, the error is caught and logged via `console.warn` — it does not propagate to the caller or to `db.on('error')`. This ensures that a faulty listener does not break the write operation that triggered the event.

### TTL (Time-To-Live)

Collections can be configured with a TTL (in seconds). Documents are automatically excluded from query results once expired:

```ts
// Documents expire 1 hour (3600 seconds) after insertion
const sessions = db.collection('sessions', { ttl: 3600 });

await sessions.insert({ userId: 'u1', token: 'abc123' });

// After 1 hour, the document is no longer returned by find/findOne/count
```

Because `_createdAt` exists purely as TTL bookkeeping, **any collection with a `ttl` option automatically protects it**, regardless of `immutableCreatedAt`: on insert, `_createdAt` is always overwritten with the server timestamp (`Date.now()`, milliseconds since epoch), even if the caller supplies their own value. Collections without `ttl` do not inject or protect this field by default.

> **Note:** `update()` does not reset `_createdAt`, and — on a TTL collection — `_createdAt` cannot be changed at all: any operator that targets it (`$set`, `$unset`, `$inc`, `$push`, `$pull`, `$addToSet`, `$rename`) throws `ValidationError`. TTL expiration is based on creation time only and cannot be extended in place; remove and re-insert the document to reset it.

#### `immutableCreatedAt` option

TTL collections protect `_createdAt` automatically (see above), so `immutableCreatedAt` is not needed to secure them. Set `immutableCreatedAt: true` to get the update-time part of that protection on a collection that does **not** use `ttl`:

```ts
const auditLog = db.collection('audit-log', {
  immutableCreatedAt: true,
});
```

When `immutableCreatedAt: true`:

- Updates targeting `_createdAt` (`$set`, `$unset`, `$inc`, `$push`, `$pull`, `$addToSet`, `$rename`) throw `ValidationError`, unconditionally.
- Insert-time server-timestamp assignment (ignoring a caller-supplied `_createdAt`) is **not** part of this flag by itself — that override is tied to `_createdAt`'s role as TTL bookkeeping and only happens when `ttl` is also set. On a collection with no `ttl`, `immutableCreatedAt: true` is a "write-once" guarantee: whatever `_createdAt` ends up as right after insert (caller-supplied or absent) can never be changed afterward.

The default (`false`) only matters for collections **without** `ttl`: `_createdAt` is then a normal, fully client-writable field, both at insert and via update.

To permanently remove expired documents from storage, call `purgeExpired()`:

```ts
const removedCount = await sessions.purgeExpired();
```

### Async Cursor

`cursor()` provides an iteration interface over the result set. Internally it buffers the full filtered set before yielding, so it has the same memory profile as `toArray()` and is subject to the same `maxMatchedDocuments` cap. To bound memory, add `.limit(n)` (and `.skip()` for paging) instead of relying on `cursor()` alone.

```ts
for await (const user of users
  .find({ status: 'active' })
  .sort({ name: 1 })
  .cursor()) {
  console.log(user.name);
}
```

`cursor()` returns an `AsyncGenerator` and respects `sort`, `skip`, `limit`, and `project` settings just like `toArray()`.

### Persistent Storage

frostpillar-db delegates all persistence to frostpillar-storage-engine. Pass a driver to the `Database` constructor.

**Node.js / TypeScript:**

```ts
import { Database } from '@frostpillar/frostpillar-db';
import { fileDriver } from '@frostpillar/frostpillar-db/drivers/file';

const db = new Database({
  driver: fileDriver({ filePath: './data/myapp.fpdb' }),
  autoCommit: { frequency: '5s', maxPendingBytes: 1024 * 1024 },
});
```

**Browser:**

```js
const { Database, indexedDBDriver } = window.FrostpillarDB;

const db = new Database({
  driver: indexedDBDriver({
    databaseName: 'my-app',
    objectStoreName: 'records',
    version: 1,
  }),
  autoCommit: { frequency: '5s' },
});
```

See the [frostpillar-storage-engine documentation](https://github.com/hjmsano/frostpillar-storage-engine) for all available drivers and configuration options.

### Payload Limits

By default, each document is limited to 1 MB. You can customize per-document validation limits via the `payloadLimits` option:

```ts
import { Database } from '@frostpillar/frostpillar-db';
import type { PayloadLimitsConfig } from '@frostpillar/frostpillar-db';

const db = new Database({
  payloadLimits: {
    maxTotalBytes: 16 * 1024 * 1024, // 16 MB per document
    maxStringBytes: 4 * 1024 * 1024, // 4 MB per string value
  },
});
```

All fields are optional — omitted fields retain the defaults:

| Field              | Default          | Description                                        |
| ------------------ | ---------------- | -------------------------------------------------- |
| `maxDepth`         | 64               | Maximum nesting depth                              |
| `maxKeyBytes`      | 1,024            | Maximum UTF-8 byte length of a single key          |
| `maxStringBytes`   | 65,535           | Maximum UTF-8 byte length of a single string value |
| `maxKeysPerObject` | 256              | Maximum number of keys per object                  |
| `maxTotalKeys`     | 4,096            | Maximum total keys in the document                 |
| `maxTotalBytes`    | 1,048,576 (1 MB) | Maximum estimated JSON byte size                   |

Payload limits apply to all collections in the database and are enforced on `insert`, `insertMany`, and `update`. For `update`, the resulting document is validated after operators are applied. Invalid limit values throw `ConfigurationError` at construction time; documents exceeding limits throw `ValidationError` at write time.

> **`maxTotalBytes` is approximate:** The byte count approximates `JSON.stringify` output size. It accounts for UTF-8 character widths and JSON delimiters but not escape sequences for control characters, which inflate the real output. If you are setting `maxTotalBytes` near a hard downstream cap (e.g. an HTTP body limit), add a safety margin.

> **Whitespace-only keys:** Document keys that consist entirely of whitespace (e.g. `" "`, `"\t"`) are rejected with `ValidationError`. Keys must be non-empty after trimming.

> **Note:** For `update`, payload limits are checked against the **resulting document** after all operators have been applied. If the result exceeds any limit, the update is rejected with `ValidationError` and the original document remains unchanged.

> **Rejected types:** `bigint`, class instances, functions, `undefined`, `Symbol`, and circular references are not JSON-compatible and are rejected with `ValidationError` on insert.

#### `skipPayloadValidation`

For trusted input where validation overhead is not desired, set `skipPayloadValidation: true` on `DatabaseConfig`. This disables payload validation on every write path, including user-facing `insert`, `insertMany`, and `update`, and causes `payloadLimits` to be ignored.

```ts
const db = new Database({
  skipPayloadValidation: true,
});
```

Only use this option when you fully control the data being inserted — skipping validation lets malformed, circular, or oversized documents reach storage.

#### `maxMatchedDocuments`

`find().toArray()`, `update()`, and `remove()` buffer matched documents in memory. To prevent unbounded memory growth on large collections, frostpillar-db caps the number of matched documents per scan.

```ts
const db = new Database({ maxMatchedDocuments: 10_000 });
```

- Must be a positive safe integer. Passing `0`, a negative number, or a non-integer throws `ConfigurationError`.
- Default: `100,000`.
- When the matched count exceeds the cap during a scan, a `ValidationError` is thrown with a message directing you to use `limit()`.
- `count()` is **not** affected by this cap because it does not buffer documents.

> **Tip:** If you only need the first _n_ results, add `.limit(n)` to your query — this short-circuits the scan (when no `sort` is applied) and avoids hitting the cap.

### Operational Limits

In addition to per-document payload limits, frostpillar-db enforces fixed operational limits on filters, update operators, and aggregation outputs. These are not configurable — they protect against pathological inputs and runaway resource use.

| Limit                           | Value   | Scope                                                             |
| ------------------------------- | ------- | ----------------------------------------------------------------- |
| Max field path depth            | 32      | Dot-notation segments per field path (e.g. `a.b.c` = 3)           |
| Max field path length           | 512     | Character length of a dot-notation field path                     |
| Max filter nesting depth        | 32      | Nesting levels for `$and` / `$or` and nested `$not` expressions   |
| Max logical operand count       | 1,000   | Elements in a single `$and` / `$or` operand array                 |
| Max operand array size          | 10,000  | Elements in a `$in` / `$nin` / `$all` operand array               |
| Max `$regex` pattern length     | 1,024   | Characters in a `$regex` string pattern                           |
| Max `$regex` quantifiers        | 20      | Quantifier tokens (`*`, `+`, `?`, `{n,m}`) in a `$regex` pattern  |
| Max `$regex` alternation groups | 4       | Parenthesized alternation groups (`(a\|b)`) in a `$regex` pattern |
| Max `$regex` test length        | 8,192   | Characters in a field value tested against a `$regex`             |
| Max document array length       | 100,000 | Per-document array size after `$push` / `$addToSet`               |
| Max `groupBy` group count       | 100,000 | Distinct group keys produced by a single `groupBy()`              |
| Max `groupBy` docs per group    | 100,000 | Documents collected into a single `groupBy()` group               |
| Max `distinct` value count      | 100,000 | Distinct values returned by a single `distinct()`                 |

`$regex` patterns are additionally screened for catastrophic-backtracking shapes and rejected with `ValidationError` before compilation. Exceeding any of the limits above throws `ValidationError` at operation time. Three mechanisms cover this:

- A general, structural nested-quantifier check: any parenthesized group that is _repeated_ (`+`, `*`, or a `{n,m}` whose maximum is 2 or more / unbounded) whose own content contains another quantifier — at any nesting depth, in any combination of quantifier syntax on either side — is rejected (e.g. `(a+)+`, `([a-z]+)+`, `(a{1,2})+`, and combinations like `(a{1,10}){1,10}` that an enumerated pattern list would otherwise have to special-case one shape at a time). A group quantified by `?` or a max-≤1 bound (e.g. `(\d+)?`, `(a+){0,1}`) matches at most once and so cannot backtrack exponentially, so such patterns are accepted.
- A structural quantified-alternation-group check: a _repeating_ quantifier — `+`, `*`, unbounded `{n,}`, or a `{n}`/`{n,m}` whose maximum is 2 or more — applied to a group that contains an unescaped `|` **at any nesting depth** is rejected (e.g. `(a|a)+`, `(a|ab)*`, `(aa|a){2,}`, `(?:aa|a){2,50}`, and wrapped forms such as `((a|aa))+` and `(?:(?:a|ab))+` where a redundant group would otherwise hide the alternation from the outer repeat). The screen is conservative and does no ambiguity analysis, so a repeated group carrying a pipe anywhere within it (e.g. `(x(a|b)y)+`) is also rejected. A non-repeating quantifier (`?`, `{0,1}`, `{1}`) or a bare alternation group with no quantifier is accepted.
- Hand-written detectors for other catastrophic shapes: overlapping wildcards, adjacent quantifiers, and backreferences with quantifiers.

The alternation-group cap is a backstop against manually-unrolled ambiguous alternation (e.g. repeating `(a|aa)` several times with no quantifier character at all), which carries no quantifier token and so would otherwise evade the quantifier-based checks above. As with the other pattern heuristics, all of the above are defense-in-depth screens against known catastrophic-backtracking shapes, not a formal proof that every `$regex` pattern executes in linear time — they narrow the risk significantly but do not eliminate the category.

#### Reserved Keys

To defend against prototype-pollution attacks, the names `__proto__`, `constructor`, `prototype`, `__defineGetter__`, `__defineSetter__`, `__lookupGetter__`, and `__lookupSetter__` are rejected with `ValidationError` wherever user input meets an object:

- As keys in inserted document payloads (including nested objects and `$set` / `$rename` targets).
- As top-level keys in filter objects.
- As segments inside any dot-notation path (filter keys, sort specs, projection specs, update operators).

Avoid these names as document fields. Any JSON-compatible alternative (for example, `type`, `kind`, `ctor`) works.

### Index Configuration

By default, frostpillar-db enables **auto-scale** for B+ tree indexes — node capacity automatically increases as data grows. This is the recommended setting for most use cases and requires no configuration.

To use fixed node sizes instead, pass an `index` option:

```ts
import { Database } from '@frostpillar/frostpillar-db';
import type { IndexConfig } from '@frostpillar/frostpillar-db';

// Auto-scale (default — no configuration needed)
const db = new Database();

// Fixed node sizes
const dbFixed = new Database({
  index: { autoScale: false, maxLeafEntries: 128, maxBranchChildren: 32 },
});
```

| Field                   | Default      | Description                                                                 |
| ----------------------- | ------------ | --------------------------------------------------------------------------- |
| `autoScale`             | `true`       | Automatically increase node capacity as data grows                          |
| `maxLeafEntries`        | —            | Max entries per leaf node (3–16,384). Only valid when `autoScale: false`    |
| `maxBranchChildren`     | —            | Max children per branch node (3–16,384). Only valid when `autoScale: false` |
| `deleteRebalancePolicy` | `'standard'` | Strategy for rebalancing after deletes (`'standard'` or `'lazy'`)           |

Setting `maxLeafEntries` or `maxBranchChildren` while `autoScale` is `true` throws `ConfigurationError`. Database-level index configuration serves as the default for all collections, but can be overridden per-collection.

### Error Handling

All errors extend `FrostpillarError`.

**Node.js / TypeScript:**

```ts
import { FrostpillarError } from '@frostpillar/frostpillar-db';

try {
  await users.insert({ _id: 'duplicate', name: 'Test' });
} catch (error) {
  if (error instanceof FrostpillarError) {
    console.error(error.name, error.message);
  }
}
```

**Browser:**

```js
const { FrostpillarError } = window.FrostpillarDB;

try {
  await users.insert({ _id: 'duplicate', name: 'Test' });
} catch (error) {
  if (error instanceof FrostpillarError) {
    console.error(error.name, error.message);
  }
}
```

| Error                 | Description                                                             |
| --------------------- | ----------------------------------------------------------------------- |
| `ValidationError`     | Invalid input (filter, update, collection name, etc.)                   |
| `DuplicateIdError`    | Inserting a document with an existing `_id`                             |
| `ClosedDatabaseError` | Operation on a closed database                                          |
| `ConfigurationError`  | Invalid database/index configuration, or conflicting collection options |
| `QuotaExceededError`  | Storage quota exceeded                                                  |
| `DatabaseLockedError` | Database file is locked by another process                              |

---

## API Reference

### Database

| Method                       | Returns             | Description                          |
| ---------------------------- | ------------------- | ------------------------------------ |
| `new Database(config?)`      | `Database`          | Create a database instance           |
| `collection(name, options?)` | `Collection`        | Get or create a collection           |
| `dropCollection(name)`       | `Promise<void>`     | Remove all documents in a collection |
| `listCollections()`          | `Promise<string[]>` | List all registered collection names |
| `commit()`                   | `Promise<void>`     | Flush to durable storage             |
| `close()`                    | `Promise<void>`     | Release resources                    |
| `on('error', listener)`      | `() => void`        | Monitor async errors                 |

### Collection

| Method                          | Returns                     | Description                                              |
| ------------------------------- | --------------------------- | -------------------------------------------------------- |
| `insert(doc)`                   | `Promise<string>`           | Insert; returns `_id`                                    |
| `insertMany(docs)`              | `Promise<string[]>`         | Insert multiple; returns `_id[]`                         |
| `find(filter?)`                 | `ResultChain`               | Query with optional filter                               |
| `findOne(filter?)`              | `Promise<Document \| null>` | First match                                              |
| `update(filter, ops, options?)` | `Promise<UpdateResult>`     | Update matches; supports `{ upsert: true }`              |
| `remove(filter)`                | `Promise<number>`           | Remove matches; returns count                            |
| `count(filter?)`                | `Promise<number>`           | Count matches                                            |
| `watch(listener)`               | `() => void`                | Subscribe to change events; returns unsubscribe function |
| `exists(id)`                    | `Promise<boolean>`          | Check if a document with the given `_id` exists          |
| `ids()`                         | `Promise<string[]>`         | Return all document IDs without loading payloads         |
| `purgeExpired()`                | `Promise<number>`           | Remove expired documents (TTL collections only)          |

### ResultChain

| Method                          | Returns                       | Description                                                   |
| ------------------------------- | ----------------------------- | ------------------------------------------------------------- |
| `.sort(spec)`                   | `ResultChain`                 | Set sort order (`SortSpec` object or `SortSpecEntries` array) |
| `.limit(n)`                     | `ResultChain`                 | Limit results                                                 |
| `.skip(n)`                      | `ResultChain`                 | Skip results                                                  |
| `.project(spec)`                | `ResultChain`                 | Field selection                                               |
| `.toArray()`                    | `Promise<Document[]>`         | Execute and return documents                                  |
| `.cursor()`                     | `AsyncGenerator<Document>`    | Async iterator over the result set                            |
| `.count()`                      | `Promise<number>`             | Count matching documents                                      |
| `.sum(field)`                   | `Promise<number>`             | Sum of numeric field                                          |
| `.avg(field)`                   | `Promise<number \| null>`     | Average of numeric field                                      |
| `.min(field)`                   | `Promise<number \| null>`     | Minimum numeric value                                         |
| `.max(field)`                   | `Promise<number \| null>`     | Maximum numeric value                                         |
| `.percentile(field, p)`         | `Promise<number \| null>`     | `p`-th percentile (`p` a fraction in `[0, 1]`)                 |
| `.percentile(field, p[])`       | `Promise<(number \| null)[]>` | Multiple percentiles, computed from one fetch/sort              |
| `.median(field)`                | `Promise<number \| null>`     | Median (≡ `percentile(field, 0.5)`)                            |
| `.distinct(field)`              | `Promise<unknown[]>`          | Unique values for a field                                     |
| `.groupBy(field, accumulators)` | `Promise<GroupResultEntry[]>` | Group by field(s) (`string \| string[]`); array form yields a composite `_key` |

---

## How to Contribute

### Requirements

- Node.js `>=24.0.0`
- pnpm `>=10.0.0`

### Development Commands

| Command             | Description                                  |
| ------------------- | -------------------------------------------- |
| `pnpm check`        | Run type checking, lint, tests, and textlint |
| `pnpm test`         | Run tests                                    |
| `pnpm build`        | Build the package                            |
| `pnpm build:bundle` | Build the browser IIFE bundle                |

### Development Workflow

This project follows a strict SDD/TDD workflow:

1. **Spec** — update or create a spec in `docs/specs/` before implementation.
2. **Test** — write tests before code.
3. **Code** — implement minimal logic to pass the tests.
4. **Verify** — run `pnpm check` to ensure everything passes.

### Documentation

- [Architecture overview](docs/architecture/overview.md)
- [Vision and principles](docs/architecture/vision-and-principles.md)
- [Testing strategy](docs/architecture/testing-strategy.md)
- [Specs index](docs/specs/README.md)
- [ADRs](docs/adr)

---

## License

[MIT](LICENSE)
