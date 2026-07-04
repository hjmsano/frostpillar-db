# ADR-015: WeakMap Cache for `$in`/`$nin` Inclusion Sets

## Status

Accepted

## Context

`src/internal/filterCache.ts` exports `inclusionSetCache`, a `WeakMap<unknown[], Set<unknown>>` that caches the `Set` built from a `$in`/`$nin` operand array. The key is the array object reference. `getInclusionSet` in `src/internal/filterOperatorEvaluators.ts` reads from this cache on every evaluation.

A review raised concern that in high-throughput server workloads building a distinct filter per request, entries might accumulate faster than GC reclaims them, causing unbounded heap growth.

## Decision

Retain the WeakMap. The design is intentional and correct:

- **Per-request filters** (fresh array created per call, dropped after): the WeakMap entry becomes unreachable when the caller drops the filter. GC reclaims both.
- **Long-held filters** (module-level or session-scope arrays): the entry persists for the array's lifetime, which is the intended optimisation — no repeated `Set` construction.
- **No manual eviction needed** because WeakMap entries cannot be leaked by this cache alone; reachability is fully controlled by the caller.

## Evidence

Benchmark (`scripts/benchmarks/scenarios/filter-in-cache.bench.ts`, run with `--expose-gc`):

| Filter count | Heap before | Heap after iters | Heap after GC | Delta (after GC) |
| ------------ | ----------- | ---------------- | ------------- | ---------------- |
| 10,000       | 5.83 MB     | 122.72 MB        | 5.99 MB       | +0.15 MB         |
| 100,000      | 5.92 MB     | 64.24 MB         | 5.94 MB       | +0.01 MB         |

Throughput: ~6,500 `$in` filter evaluations/sec on a 200-document collection.

Delta after forced GC is negligible (< 0.2 MB) and does not scale with N. The WeakMap holds no entries after GC because no filter array reference is retained between iterations.

## Consequences

- No code change to the cache implementation.
- `inclusionSetCache` carries an inline comment summarising the above.
- If a future workload pattern holds large numbers of filter arrays in memory simultaneously, revisit with a bounded LRU (Map-keyed by array identity, MAX_ENTRIES ≈ 1024).

## Mutation safety

Each cached entry now stores the operand length alongside the cached value: `{ set: Set<unknown>; length: number }` for `inclusionSetCache` and `{ value: boolean; length: number }` for `operandAllPrimitiveCache`. On each lookup, if `operand.length` differs from the stored length, the cache entry is rebuilt. This is O(1) and fixes the common foot-gun where a caller pushes or pops elements from a reused operand array between queries.

Operands should still be treated as effectively immutable. A same-length in-place element replacement on a reused array (e.g. `ops[0] = 'z'`) is not detected and yields undefined results. Pass a fresh array when the contents change.
