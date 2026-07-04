# ADR-012: Per-Collection Datastore Isolation

- **Status:** Accepted
- **Date:** 2026-04-03
- **Deciders:** Hajime Sano
- **Supersedes:** [ADR-004](./004-collection-key-prefix-namespacing.md), [ADR-009](./009-bloom-filter-insert-optimization.md)

## Context

ADR-004 introduced key-prefix namespacing: all collections share a single `Datastore` instance, with document keys encoded as `{collectionName}\x00{documentId}`. This was chosen for simplicity — one file handle, one lock, one commit cycle.

However, the storage engine's B+ tree provides per-instance **autoscaling** (dynamically adjusts node capacity based on entry count) and **rebalancing** (borrow-or-merge after deletions). With a shared Datastore, these mechanisms operate on the combined key space of all collections:

1. **Autoscaling is global** — BTree node sizes scale based on total entry count across all collections. A small collection is forced into oversized nodes if a large collection drives the tier up.
2. **Cross-collection rebalancing** — Deleting documents from one collection can trigger rebalancing on leaf nodes that also contain another collection's data.
3. **Key storage overhead** — Every key carries the collection name prefix. For a collection named `"transactions"` with 100K documents, this wastes `13 × 100,000 = 1.3 MB` of key storage.
4. **Comparison overhead** — Every BTree key comparison includes the redundant prefix bytes, slowing insert, lookup, and range operations.
5. **Duplicate-key policy workaround** — The shared Datastore must be set to `duplicateKeys: 'allow'` (the most permissive mode), and per-collection policies are re-implemented in frostpillar-db with a Bloom filter optimization (ADR-009). The storage engine already supports `'reject'` and `'replace'` natively.

## Decision

Replace the shared-Datastore model with **one `Datastore` instance per collection**. The `Database` class manages a `Map<string, Datastore>`, creating each Datastore lazily when `collection()` is first called.

### Key changes

| Aspect                 | Before (ADR-004)                     | After (ADR-012)                           |
| ---------------------- | ------------------------------------ | ----------------------------------------- |
| Storage key            | `{collection}\x00{docId}`            | `{docId}`                                 |
| Datastore instances    | 1 shared                             | 1 per collection                          |
| Duplicate key policy   | Re-implemented in frostpillar-db     | Delegated to storage engine natively      |
| Bloom filter (ADR-009) | Required for `'reject'` optimization | Removed — native `'reject'` is sufficient |
| Autoscaling            | Global across all collections        | Independent per collection                |
| `commit()`             | Single call                          | Iterates all Datastores                   |
| `close()`              | Single call                          | Iterates all Datastores                   |
| `listCollections()`    | Scans all keys, decodes prefixes     | Returns in-memory registry keys           |
| `dropCollection()`     | Range-scan + delete each record      | `Datastore.clear()` + `Datastore.close()` |

### Datastore creation

```ts
// Per-collection Datastore with native duplicate-key policy
new Datastore({
  ...baseConfig, // driver, capacity, autoCommit from DatabaseConfig
  duplicateKeys: collectionOptions.duplicateKeys,
});
```

### Error mapping

The storage engine throws its own `ValidationError` when `duplicateKeys: 'reject'` encounters a duplicate key. frostpillar-db catches this and re-throws as `DuplicateIdError` to preserve the existing error API.

## Rationale

- **Leverage engine strengths** — The storage engine's B+ tree was designed for per-instance optimization (autoscaling tiers, node-level rebalancing). Per-collection isolation lets each collection benefit independently.
- **Reduced key size** — Keys shrink from `{collection}\x00{docId}` to just `{docId}`, saving storage and speeding up comparisons.
- **Native duplicate-key handling** — Eliminates the Bloom filter workaround and the frostpillar-db-layer duplicate detection logic.
- **Minimal overhead** — Each Datastore instance costs ~200 bytes of fixed overhead. Even 100 collections add only ~20 KB.

## Consequences

### Positive

- Each collection gets independent BTree autoscaling (optimal node sizes for its data volume).
- Rebalancing is isolated — mutations in one collection never affect another.
- Smaller keys → less memory, faster comparisons.
- Simpler collection code — no prefix encoding, no Bloom filter.
- `dropCollection()` becomes O(1) via `clear()` instead of O(n) range-scan + per-record delete.

### Negative

- `commit()` must iterate all Datastores — O(k) where k = number of collections. Acceptable for typical use cases (few collections).
- No single atomic commit across collections — each Datastore commits independently. This is acceptable given ADR-007 (single-threaded concurrency model, non-atomic compound operations).
- Error listener registration must propagate to all current and future Datastores.

### Mitigation

- Error listeners are stored in the `Database` and registered on each Datastore at creation time.
- `listCollections()` uses the in-memory collection registry, which is already maintained by `Database`.
