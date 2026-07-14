# ADR-024: Collection-Aware Driver Factory

- **Status:** Accepted
- **Date:** 2026-07-11
- **Deciders:** Hajime Sano
- **Relates to:** [ADR-012](./012-per-collection-datastore-isolation.md)

## Context

ADR-012 replaced the shared-Datastore model with one `Datastore` per collection. However, `DatabaseConfig.driver` remained a single `DatastoreDriver` instance that `Database` spread into every per-collection `Datastore`. A `DatastoreDriver` is bound to exactly one physical namespace (file path, localStorage key prefix, IndexedDB database/object store, OPFS directory, sync-storage key prefix), so all durable collections targeted the same underlying storage:

- **File driver:** the second collection's `Datastore` attempted to acquire the same lock/file, raising `DatabaseLockedError`.
- **Browser drivers (localStorage, IndexedDB, OPFS, syncStorage):** each collection's commit overwrote the shared snapshot — last-writer-wins data loss surfaced after reopen.

This silently contradicted the per-collection isolation that ADR-012 established.

## Decision

`DatabaseConfig.driver` accepts either a `DatastoreDriver` or a **collection-aware driver factory**:

```ts
export type DatabaseDriverFactory = (collectionName: string) => DatastoreDriver;

export type DatabaseConfig = Omit<
  DatastoreConfig,
  'duplicateKeys' | 'driver'
> & {
  driver?: DatastoreDriver | DatabaseDriverFactory;
  // ...
};
```

- When `driver` is a **function**, `Database` invokes it with the collection name each time a per-collection `Datastore` is created lazily by `collection()`. The factory derives a distinct physical namespace per collection (e.g., a per-collection `fileName`, `keyPrefix`, `databaseName`, or `directoryName` built from the name).
- When `driver` is a **plain `DatastoreDriver` object**, it remains valid for a single collection. Creating a second collection while another driver-backed collection is registered throws `ConfigurationError` with guidance to use a factory. After `dropCollection()` closes the only driver-backed collection, the plain driver may be reused by a new collection.
- Databases without a `driver` (in-memory) are unaffected.

Collection names are validated (`^[a-zA-Z0-9][a-zA-Z0-9_.-]*$`, no leading `_`, no `..`) before the factory runs, so they cannot escape their directory or key space.

> **Superseded in part by [ADR-029](./029-driver-namespace-derivation.md).** A validated name is safe to _place_ in a file name, but it is **not** safe to use as a namespace fragment: it may contain `.`, the delimiter the drivers build their own key spaces from, which let the collections `foo` and `foo.fpdb.g.0` destroy each other's files. Factories must derive the fragment with `collectionNamespace(name)`. ADR-029 also corrects the claim below that an IndexedDB **database/object store** pair is a namespace — the snapshot is stored per _database_, so each collection needs a distinct `databaseName`.

## Alternatives Considered

1. **Return to a shared Datastore with encoded collection prefixes (ADR-004).** Rejected — it reintroduces every drawback ADR-012 removed (global autoscaling, cross-collection rebalancing, key prefix overhead, Bloom-filter duplicate handling).
2. **Auto-namespacing wrappers around the re-exported drivers.** frostpillar-db would rewrite driver options (file names, key prefixes) behind the user's back. Rejected — a `DatastoreDriver` is an opaque closure whose options cannot be introspected, and implicit renaming would silently relocate existing single-collection data.
3. **Keep the shared-driver behavior and document it.** Rejected — silent last-writer-wins data loss is not an acceptable documented behavior.

## Consequences

### Positive

- Multiple durable collections work correctly with every driver; each factory call yields an isolated namespace.
- Misconfiguration (a plain driver with two collections) fails fast with `ConfigurationError` instead of `DatabaseLockedError` at the storage layer or silent data loss.
- Single-collection configurations remain fully backward compatible — existing on-disk data stays where it is.

### Negative

- Multi-collection durable users must migrate to the factory form. This is intentional: the previous behavior lost data.
- The factory is invoked once per collection creation; drivers must be cheap to construct (all first-party drivers are — they capture options and defer backend work to `init()`).
