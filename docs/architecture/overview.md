# Architecture Overview

## System Context

frostpillar-db sits between application code and the storage engine in the Frostpillar ecosystem:

```
Application Code
       │
       ▼
┌─────────────────────┐
│   frostpillar-db    │  ← Query API, filtering, aggregation
│  (this package)     │
└────────┬────────────┘
         │
         ▼
┌─────────────────────────────┐
│ frostpillar-storage-engine  │  ← Key-value CRUD, persistence, drivers
│                             │
│  ┌────────────────────┐     │
│  │  frostpillar-btree │     │  ← B+ tree indexing
│  └────────────────────┘     │
└─────────────────────────────┘
         │
         ▼
   Storage Backend
   (Memory / File / localStorage / IndexedDB / OPFS / SyncStorage)
```

## Internal Architecture

### Component Diagram

```
┌──────────────────────────────────────────────────────┐
│                      Database                         │
│                                                       │
│  ┌──────────────────┐    ┌──────────────────┐        │
│  │  Collection       │    │  Collection       │  ...  │
│  │  "users"          │    │  "posts"          │       │
│  │                   │    │                   │       │
│  │  ┌─────────────┐ │    │  ┌─────────────┐ │       │
│  │  │ Query Engine │ │    │  │ Query Engine │ │       │
│  │  │  Filter      │ │    │  │  Filter      │ │       │
│  │  │  Update      │ │    │  │  Update      │ │       │
│  │  │  ResultChain │ │    │  │  ResultChain │ │       │
│  │  │  Aggregation │ │    │  │  Aggregation │ │       │
│  │  └──────┬──────┘ │    │  └──────┬──────┘ │       │
│  │         │         │    │         │         │       │
│  │         ▼         │    │         ▼         │       │
│  │    Datastore      │    │    Datastore      │       │
│  │  (storage engine) │    │  (storage engine) │       │
│  └──────────────────┘    └──────────────────┘        │
│                                                       │
└──────────────────────────────────────────────────────┘
```

Each collection has its own dedicated `Datastore` instance with independent B+ tree autoscaling and rebalancing. See [ADR-012](../adr/012-per-collection-datastore-isolation.md).

### Key Components

#### Database

The top-level entry point. Manages per-collection `Datastore` instances and provides collection access. Coordinates lifecycle operations (`commit`, `close`) across all datastores.

#### Collection

Each collection owns a dedicated `Datastore` instance. Provides CRUD methods (`insert`, `find`, `update`, `remove`) and delegates storage operations directly to its datastore. Document keys are just the `_id` string — no prefix encoding needed.

#### Query Engine

Processes queries in a pipeline:

1. **Filter Evaluator** — evaluates `$`-operator filter predicates against documents.
2. **Update Applier** — applies `$set`, `$unset`, `$inc`, `$rename`, `$push`, `$pull`, `$addToSet` operations to documents.
3. **ResultChain Pipeline** — orchestrates sort → skip → limit → project for `toArray()`.
4. **Aggregation Functions** — computes `count`, `sum`, `avg`, `min`, `max`, `percentile`, `median`, `distinct`, `groupBy` over filtered sets.

## Data Flow

### Insert

```
insert({ name: 'Alice', age: 30 })
  → Generate _id (crypto.randomUUID())
  → Datastore.put({ key: _id, payload: { _id, name, age } })
```

### Find

```
find({ age: { $gt: 25 } }).sort({ name: 1 }).limit(10).toArray()
  → Datastore.getAll()
  → Filter Evaluator: apply { age: { $gt: 25 } }
  → Sort: by name ascending
  → Limit: take 10
  → Return documents
```

### Update

```
update({ name: 'Alice' }, { $set: { age: 31 } })
  → getRecordsByFilter (fast path or getAll)
  → Filter: match { name: 'Alice' }
  → Update Applier: apply $set
  → Datastore.replaceById(entryId, updatedDoc) per match
  → Return count
```

### Remove

```
remove({ status: 'inactive' })
  → Fast path: _id equality without TTL → Datastore.delete(key) directly
  → Otherwise: getRecordsByFilter (fast path or getAll)
  → Filter: match { status: 'inactive' }
  → Datastore.deleteByIds(entryIds) batch delete
  → Return count
```

## Design Decisions

All architectural decisions are recorded in [docs/adr/](../adr/):

| ADR                                                          | Title                                                     |
| ------------------------------------------------------------ | --------------------------------------------------------- |
| [001](../adr/001-storage-engine-delegation.md)               | Storage engine delegation                                 |
| [002](../adr/002-schema-less-document-model.md)              | Schema-less document model                                |
| [003](../adr/003-fluent-query-api.md)                        | Fluent query API                                          |
| [004](../adr/004-collection-key-prefix-namespacing.md)       | Collection key-prefix namespacing (superseded by ADR-012) |
| [005](../adr/005-scan-based-query-execution.md)              | Scan-based query execution                                |
| [006](../adr/006-update-replacement-for-unset-and-rename.md) | Record replacement strategy for `$unset` / `$rename`      |
| [007](../adr/007-concurrency-model.md)                       | Single-threaded concurrency model                         |
| [008](../adr/008-collection-metadata-storage.md)             | Collection metadata storage                               |
| [009](../adr/009-bloom-filter-insert-optimization.md)        | Bloom filter insert optimization (superseded by ADR-012)  |
| [010](../adr/010-ttl-support.md)                             | TTL (Time-To-Live) support                                |
| [011](../adr/011-lazy-field-level-deserialization.md)        | Lazy field-level deserialization (future optimization)    |
| [012](../adr/012-per-collection-datastore-isolation.md)      | Per-collection Datastore isolation                        |
| [013](../adr/013-internal-deep-equal.md)                     | Internal `deepEqual` utility to replace `node:util.isDeepStrictEqual` |
| [014](../adr/014-strict-collection-option-reaccess.md)       | Strict collection option re-access                        |
| [015](../adr/015-weakmap-inclusion-set-cache.md)              | WeakMap cache for `$in` / `$nin` inclusion sets            |
| [016](../adr/016-ttl-createdat-automatic-protection.md)      | Automatic `_createdAt` protection on TTL collections       |
| [017](../adr/017-multi-dimension-group-by.md)                | Multi-dimension `groupBy`                                  |
| [018](../adr/018-percentile-and-median-aggregation.md)       | Percentile and median aggregation                          |
| [019](../adr/019-stddev-and-variance-aggregation.md)          | Standard deviation and variance aggregation                |
| [020](../adr/020-chain-sort-aware-aggregation.md)             | Chain-sort-aware aggregation (`distinct`/`groupBy` honor a preceding `.sort()`) |
