# ADR-029: Driver Namespace Derivation

- **Status:** Accepted
- **Date:** 2026-07-13
- **Deciders:** Hajime Sano
- **Relates to:** [ADR-024](./024-collection-aware-driver-factory.md), [ADR-012](./012-per-collection-datastore-isolation.md)

## Context

ADR-024 gave each collection its own driver via a factory `(collectionName) => DatastoreDriver`, and stated that a validated collection name is "safe to embed in file names and storage keys". Validation (letters, digits, `_`, `.`, `-`; no leading `_`; no `..`) does make a name safe as a _path fragment_ — it cannot escape its directory. It does not make it safe as a _namespace_ fragment, and two durability gaps followed.

**1. The file backend deletes by prefix.** Data files are named `<fileName>.fpdb.g.<generation>`, and opening a datastore deletes every entry in the directory that begins with `<fileName>.fpdb.g.` and is not its own active generation (`cleanupStaleGenerationFiles`). A dot in a collection name lets one collection's name land inside another's deletion prefix. The collections `foo` and `foo.fpdb.g.0` are both valid: the latter's data file is `foo.fpdb.g.0.fpdb.g.0`, which begins with `foo.fpdb.g.`. Both persisted correctly, but reopening `foo` deleted the other collection's generation file and sidecar, and `foo.fpdb.g.0` came back empty. Silent cross-collection data loss from two legal names.

**2. An IndexedDB object store is not a namespace.** ADR-024 listed "IndexedDB database/object store" as the physical namespace. The storage engine stores a datastore's snapshot in a fixed slot — object store `_meta`, key `config` — and its load and commit paths take `objectStoreName` but ignore it (`loadIndexedDBSnapshot`, `commitIndexedDBSnapshot`, whose parameter is `_objectStoreName`). A factory that varies only `objectStoreName` within one `databaseName` therefore hands every collection the same snapshot slot, and each commit overwrites the last — precisely the last-writer-wins loss ADR-024 exists to prevent.

## Decision

Namespace fragments are **derived, not copied**. frostpillar-db exports:

```ts
collectionNamespace(name: string): string;
```

It validates the name, then percent-escapes every character outside `[A-Za-z0-9_-]` — for a valid collection name, the dots: `orders.2026` → `orders%2E2026`. The result is **injective** (`%` cannot occur in a valid collection name, so it is free as an escape character) and **delimiter-free** (no `.` survives, so no fragment can be a delimited prefix of another fragment). `foo` and `foo.fpdb.g.0` encode to `foo` and `foo%2Efpdb%2Eg%2E0`, which share no delimited prefix, so the file backend's cleanup can no longer cross collections.

Every documented factory — `fileName`, `databaseKey`, `databaseName`, `directoryName`, `keyPrefix` — passes the collection name through `collectionNamespace()`, so the choice does not have to be re-audited per driver.

For IndexedDB, the namespace is the **database**: factories must vary `databaseName` per collection. `objectStoreName` may be varied for readability but must not be relied on for isolation.

## Alternatives Considered

1. **Hash the collection name (e.g. SHA-256 hex).** Collision-proof and delimiter-free, but the derived file names and IndexedDB databases become unreadable, which matters when a user inspects `./data` or the browser's storage inspector. Percent-escaping is equally sufficient here because the input alphabet is already restricted, and it stays legible. Hashing also needs Web Crypto (async) or `node:crypto` (Node-only) — neither fits a synchronous, multi-runtime helper.
2. **Forbid `.` in collection names.** A breaking change to a validation rule callers already depend on, and it would silently invalidate existing collections named `orders.2026`.
3. **Fix the cleanup matcher upstream** (match only `<base>.g.<digits>` exactly). This is the right upstream fix and is worth making, but frostpillar-db cannot ship it: the matcher lives in frostpillar-storage-engine. The encoding is safe regardless of which engine version is installed, so it is the correct fix _here_, not a workaround for one.
4. **Auto-namespace inside `Database`** (rewrite driver options behind the user's back). Rejected in ADR-024 and still rejected: a `DatastoreDriver` is an opaque closure whose options cannot be introspected.

## Consequences

- Multi-collection durable configurations are safe for every legal collection name, including the adversarial ones. `tests/integration/multi-collection-durability.test.ts` covers the `foo` / `foo.fpdb.g.0` pair.
- Users who wrote a factory before this ADR and used raw names keep working **only** if none of their collection names contains a dot. Names with dots must be migrated: encode the fragment, and rename the existing on-disk file/key to the encoded form.
- The IndexedDB constraint is pinned by a test that asserts the _broken_ shared-database behavior. If the storage engine gains per-object-store snapshots, that test fails — the signal to relax this ADR's requirement rather than to discover the change by data loss.
- ADR-024's "safe to embed" sentence is superseded by this ADR.
