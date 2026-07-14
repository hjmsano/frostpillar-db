# ADR-015: WeakMap Cache for `$in`/`$nin` Inclusion Sets

## Status

Accepted; cross-call identity reuse is partially superseded by [ADR-030](./030-read-once-input-snapshots.md).

## Context

`src/internal/filterCache.ts` exports `inclusionSetCache`, a `WeakMap<unknown[], Set<unknown>>` that caches the `Set` built from a `$in`/`$nin` operand array. The key is the array object reference. `getInclusionSet` in `src/internal/filterOperatorEvaluators.ts` reads from this cache on every evaluation.

A review raised concern that in high-throughput server workloads building a distinct filter per request, entries might accumulate faster than GC reclaims them, causing unbounded heap growth.

## Decision

Retain the WeakMap for reuse within an owned filter snapshot:

- Each public query call snapshots operand arrays before evaluation. The cache key is that internal array, not the caller's array.
- Every candidate document in one scan sees the same snapshot array, so the inclusion `Set` and primitive check are each computed once per scan.
- When the query snapshot becomes unreachable, its WeakMap entries are eligible for collection; no manual eviction is needed.
- Reusing a long-held caller filter across separate calls intentionally does **not** reuse its identity-keyed entries. Correct call-boundary snapshots take precedence over cross-call identity hits (ADR-030).

## Evidence

Benchmark (`scripts/benchmarks/scenarios/filter-in-cache.bench.ts`, run with `--expose-gc`):

| Filter count | Heap before | Heap after iters | Heap after GC | Delta (after GC) |
| ------------ | ----------- | ---------------- | ------------- | ---------------- |
| 10,000       | 5.83 MB     | 122.72 MB        | 5.99 MB       | +0.15 MB         |
| 100,000      | 5.92 MB     | 64.24 MB         | 5.94 MB       | +0.01 MB         |

The historical pre-snapshot run measured ~6,500 `$in` filter evaluations/sec on a 200-document collection. It documents the original decision, not a current cross-call throughput guarantee.

Delta after forced GC is negligible (< 0.2 MB) and does not scale with N. The WeakMap holds no entries after GC because no filter array reference is retained between iterations.

## Consequences

- The cache remains useful within each scan, but no public contract promises cross-call reuse.
- `inclusionSetCache` carries an inline comment summarising the above.
- If a future workload pattern holds large numbers of filter arrays in memory simultaneously, revisit with a bounded LRU (Map-keyed by array identity, MAX_ENTRIES ≈ 1024).

## Mutation safety

Cached entries still record operand length as an internal consistency check. Public callers may mutate or reuse their original arrays between calls: the next call snapshots their then-current contents and receives a new cache identity. Mutating the original array while a call is pending cannot change that call's snapshot.
