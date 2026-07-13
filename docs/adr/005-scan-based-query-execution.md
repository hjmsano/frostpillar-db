# ADR-005: Scan-Based Query Execution

- **Status:** Accepted
- **Date:** 2026-04-03
- **Deciders:** Hajime Sano

## Context

When executing a `find()` query with filter predicates, the system needs a strategy to locate matching documents. The two primary approaches are:

1. **Full scan + in-memory filter** — load all documents in the collection, apply predicates in JavaScript.
2. **Secondary indexes** — maintain additional B+ tree indexes on arbitrary fields; use index lookups to narrow the scan.

## Decision

Adopt **scan-based query execution** (Option 1) as the general path. Queries without an applicable `_id` candidate lookup perform a full collection scan via the storage engine's `getAll()`, followed by in-memory filtering, sorting, and aggregation in JavaScript.

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
> - `_id` equality and `$in` filters — use `Datastore.getFirst()` / `get()` / `getMany()` to obtain candidates before applying the filter to each document.
> - `findOne({ _id: 'value' })` — under the default key definition, uses `Datastore.getFirst(key)` as the complete result. With a custom key, the indexed result is only a candidate set and the stored `_id` is checked exactly.
> - Bounded `_id` ranges — use `Datastore.getRange()` only under the default key definition. A custom key may order normalized keys differently from `_id` strings, so ranges use `getAll()`.
> - `remove({ _id: 'value' })` — uses `Datastore.delete(key)` directly only on non-TTL, default-key collections whose duplicate policy is not `'allow'`. Custom-key removals confirm each candidate's stored `_id` and call `deleteById()`.
> - `insertMany(docs)` — uses `Datastore.putMany()` for batch insertion.
> - `count()` without filter — uses `Datastore.count()` for O(1) result (non-TTL collections).
> - `update(filter, ops)` — persists changes via `Datastore.replaceById()` (atomic, no TOCTOU).
> - General `remove(filter)` — deletes each confirmed record via `Datastore.deleteById()` so event attribution stays exact.
> - `purgeExpired()` — batch-deletes expired records via `Datastore.deleteByIds()`.
> - `find({ _id: { $in: [...] } })` — uses `Datastore.getMany(keys)` for batch candidate lookup, followed by exact filter evaluation.
> - `remove({ _id: { $in: [...] } })` — uses `Datastore.deleteMany(keys)` only for eligible default-key, non-TTL collections; otherwise it confirms and deletes individual records.
> - `exists(id)` — uses `Datastore.has(key)` only for default-key, non-TTL collections. A custom key loads colliding candidates and compares their stored `_id` values.
> - `ids()` — uses `Datastore.keys()` only without TTL, a custom key, or `duplicateKeys: 'allow'`; otherwise it reads `_id` from each document.

Custom-key behavior is defined in [ADR-027](./027-custom-key-id-identity.md): equality and `$in` index lookups are candidate-set optimizations, never proof of document identity.

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
