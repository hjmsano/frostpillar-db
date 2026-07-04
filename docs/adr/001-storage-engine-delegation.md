# ADR-001: Delegate All Storage to frostpillar-storage-engine

- **Status:** Accepted
- **Date:** 2026-04-03
- **Deciders:** Hajime Sano

## Context

frostpillar-db is a database middleware that provides query capabilities (filtering, aggregation, sorting) on top of persistent storage. We need a storage layer that handles CRUD operations, persistence drivers, capacity control, and auto-commit across Node.js and browser environments.

frostpillar-storage-engine already provides:

- Key-value CRUD (`put`, `get`, `getAll`, `getRange`, `delete`, etc.)
- Pluggable drivers (in-memory, file, localStorage, IndexedDB, OPFS, sync storage)
- B+ tree indexing via frostpillar-btree
- Capacity control and auto-commit
- Payload validation and defensive cloning
- Custom key definitions

## Decision

frostpillar-db delegates **all** storage operations to `@frostpillar/frostpillar-storage-engine`. We do not implement any storage management, persistence, or indexing in this package.

## Consequences

### Positive

- **Zero duplication** — no redundant storage logic to maintain.
- **Proven foundation** — storage engine is already tested and released.
- **Driver ecosystem** — all existing and future drivers are automatically available.
- **Separation of concerns** — frostpillar-db focuses purely on query semantics.

### Negative

- **Coupled to storage engine API** — changes in frostpillar-storage-engine may require updates here.
- **Performance ceiling** — query performance is bounded by what the storage engine exposes (e.g., no custom scan iterators beyond `getRange`).

### Trade-offs Accepted

- We accept the storage engine's payload size limits (1 MB per payload, 64 nesting levels, 4096 keys).
- We accept ephemeral `EntryId` — frostpillar-db generates its own persistent document IDs.
- We trust the storage engine's B+ tree ordering and do not re-sort at the storage level.
