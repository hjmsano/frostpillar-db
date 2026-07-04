# ADR-005: Scan-Based Query Execution

- **Status:** Accepted
- **Date:** 2026-04-03
- **Deciders:** Hajime Sano

## Context

When executing a `find()` query with filter predicates, the system needs a strategy to locate matching documents. The two primary approaches are:

1. **Full scan + in-memory filter** — load all documents in the collection, apply predicates in JavaScript.
2. **Secondary indexes** — maintain additional B+ tree indexes on arbitrary fields; use index lookups to narrow the scan.

## Decision

Adopt **scan-based query execution** (Option 1). All queries perform a full collection scan via the storage engine's `getAll()`, followed by in-memory filtering, sorting, and aggregation in JavaScript.

No secondary index support is provided in this package.

## Rationale

- **Simplicity** — no index management, no index selection heuristics, no write amplification from maintaining secondary indexes.
- **Predictable performance** — every query has the same execution path; no surprising plan changes.
- **Small dataset focus** — frostpillar-db targets lightweight, embedded use cases (browser apps, extensions, small Node.js services) where collections typically hold thousands to low tens-of-thousands of documents. Scan-based execution is adequate for these sizes.
- **Storage engine alignment** — the storage engine does not expose hooks for secondary index maintenance. Building secondary indexes would require intercepting all writes at the frostpillar-db layer and maintaining a parallel data structure, adding significant complexity.

## Execution Pipeline

```
find(filter)
  → getAll()                                      // Step 1: Fetch all docs in collection
  → applyFilter(docs, filter)                    // Step 2: In-memory predicate evaluation
  → applySort(docs, sortSpec)                    // Step 3: Array.sort()
  → applySkip(docs, n)                           // Step 4: Array.slice(n)
  → applyLimit(docs, n)                          // Step 5: Array.slice(0, n)
  → applyProjection(docs, projectSpec)           // Step 6: Field selection
  → return docs                                  // Step 7: Terminal output
```

> **Optimizations:** The following operations bypass the full scan when applicable:
>
> - `findOne({ _id: 'value' })` — uses `Datastore.getFirst(key)` for O(1) lookup.
> - `update({ _id: 'value' }, ...)` — uses `Datastore.get(key)` for targeted fetch.
> - `remove({ _id: 'value' })` — uses `Datastore.delete(key)` for direct deletion (non-TTL collections).
> - `insertMany(docs)` — uses `Datastore.putMany()` for batch insertion.
> - `count()` without filter — uses `Datastore.count()` for O(1) result (non-TTL collections).
> - `update(filter, ops)` — persists changes via `Datastore.replaceById()` (atomic, no TOCTOU).
> - `remove(filter)` — batch-deletes matched records via `Datastore.deleteByIds()`.
> - `purgeExpired()` — batch-deletes expired records via `Datastore.deleteByIds()`.
> - `find({ _id: { $in: [...] } })` — uses `Datastore.getMany(keys)` for batch key lookup.
> - `remove({ _id: { $in: [...] } })` — uses `Datastore.deleteMany(keys)` for batch key deletion (non-TTL collections).
> - `exists(id)` — uses `Datastore.has(key)` for O(1) existence check.
> - `ids()` — uses `Datastore.keys()` to return all IDs without loading payloads.

## Consequences

### Positive

- Zero write overhead — inserts and updates are as fast as the storage engine allows.
- No index corruption or out-of-sync risks.
- Simple, auditable query execution.

### Negative

- Query performance degrades linearly with collection size (O(n) per query).
- No optimization for highly selective filters on large collections.
- Sorting large result sets requires loading all matching documents into memory.

### Future Considerations

- If performance becomes a concern, secondary indexes can be introduced as an opt-in feature in a future version without changing the query API surface.
- The `ResultChain` abstraction allows inserting index-aware optimizations transparently behind the same method chain.
