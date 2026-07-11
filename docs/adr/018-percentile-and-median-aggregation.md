# ADR-018: Percentile and Median Aggregation

- **Status:** Accepted
- **Date:** 2026-07-11
- **Deciders:** Hajime Sano

## Context

`ResultChain` provides the numeric aggregation terminals `sum`, `avg`, `min`, and `max`, and `groupBy` mirrors them as accumulators (`$sum`, `$avg`, `$min`, `$max`). Percentile and median are missing. They are standard in the database domain — SQL defines `PERCENTILE_CONT` / `PERCENTILE_DISC` (implemented by PostgreSQL, SQL Server, Oracle, BigQuery), and MongoDB 7.0 added the `$percentile` / `$median` accumulators — and they are the canonical tool for latency/score/price distribution questions ("p95 response time", "median salary") that `avg` answers poorly on skewed data.

Callers today must fetch the full result set with `.toArray()` and compute percentiles by hand, losing the aggregation API's validation, consistency guarantees, and conciseness.

Per [ADR-005](./005-scan-based-query-execution.md), all aggregation runs as a single in-memory scan over the filtered document set. The matched set is bounded by `maxMatchedDocuments` (default 100,000), so an exact sort-based percentile is computationally trivial — no approximate algorithm (t-digest etc.) is needed. The existing building blocks apply directly:

- `extractNumericValues` — resolves a field path per document and keeps only finite numbers (the exact value-selection rule used by `sum`/`avg`/`min`/`max`).
- `validateAggregationField` / `validateFieldPath` — eager field-path validation shared by every aggregation terminal.

## Decision

### 1. New `ResultChain` terminal methods

```ts
percentile(field: string, p: number): Promise<number | null>;
median(field: string): Promise<number | null>;
```

- `median(field)` is defined as exactly `percentile(field, 0.5)` — one concept, one implementation, two entry points.
- Like the other numeric terminals, both operate on the **filtered** set (sort/skip/limit/projection not applied, spec 03 §1.4), skip non-numeric and non-finite values via `extractNumericValues`, and return `null` when no numeric values exist.

### 2. `p` is a fraction in `[0, 1]`

`p = 0.95` means the 95th percentile. Matches MongoDB's `$percentile` (`p: [0.9]`), the SQL standard (`PERCENTILE_CONT(0.5)`), and numpy's `quantile`. `p` must be a finite number with `0 <= p <= 1`; anything else throws `ValidationError` eagerly, before any document is fetched.

**Rejected — percent scale (0–100):** familiar from the phrase "p95", but it diverges from every major database API, and a scale mismatch bug (passing `0.95` where `95` is expected, or vice versa) silently produces a valid-looking wrong answer. Following the dominant database convention makes the mistake less likely, and the docs state the scale explicitly.

### 3. Linear interpolation (continuous percentile)

The percentile of the sorted numeric values `v[0..n-1]` is computed with linear interpolation between closest ranks — the `PERCENTILE_CONT` / numpy-`'linear'` definition:

```
rank = p * (n - 1)
lo = floor(rank), frac = rank - lo
result = v[lo] + frac * (v[lo + 1] - v[lo])   // v[lo] when frac = 0
```

Properties:

- `percentile(f, 0)` equals `min(f)` and `percentile(f, 1)` equals `max(f)` on the same value set.
- `median` of an even-count set is the average of the two middle values — the standard median definition.
- A single value is returned unchanged for every `p`.

**Rejected — nearest-rank (`PERCENTILE_DISC`):** returns only values that actually occur, which some use cases prefer, but the continuous definition is the default in every reference implementation (SQL `PERCENTILE_CONT`, numpy, pandas) and is what users expect of "median" on an even count. A `method` option can be layered on later without breaking this default (see Future Considerations).

**Rejected — approximate algorithms (t-digest, KLL):** these exist to bound memory on unbounded streams. Frostpillar's aggregation is already an in-memory scan capped at `maxMatchedDocuments`; an exact `O(n log n)` sort of at most ~100,000 numbers is negligible, and exactness is a simpler contract to document and test.

### 4. Scalar-only terminal API

`percentile` accepts one `p` value and always returns one `number | null`. Callers request multiple percentiles with separate terminal calls. Each call performs its own filtered-set execution and sort, consistent with every other `ResultChain` terminal.

**Rejected — overloading `p` with `number[]`:** makes the return shape depend on the argument type and requires a separate shared-sort execution path. Although that path can reduce repeated work for p50/p95/p99 requests, a single predictable return shape is easier to understand and maintain. The additional datastore work from separate calls is accepted for this feature. If real usage later demonstrates a need, an explicitly plural `percentiles(field, pValues)` method can add batch computation without changing the scalar method's contract.

### 5. New `groupBy` accumulators: `$median` and `$percentile`

```ts
interface GroupAccumulator {
  $count?: true;
  $sum?: string;
  $avg?: string;
  $min?: string;
  $max?: string;
  $median?: string; // field path
  $percentile?: { field: string; p: number }; // field path + fraction
}
```

- `$median: 'fieldPath'` behaves like the other field-path accumulators: extract numeric values from the group's documents, `null` if none.
- `$percentile` is the first accumulator whose operand is an object rather than a field-path string, because it needs two inputs. Validation: the operand must be a plain object with exactly the keys `field` (a valid field path, same eager validation as other accumulator operands) and `p` (same `[0, 1]` rule as the terminal method). The existing "exactly one accumulator key per entry" rule is unchanged.
- `p` is scalar-only inside `groupBy`. Multiple percentiles of a group are expressed as multiple output fields, which is the natural shape of a `groupBy` result row:

```ts
await requests.find({}).groupBy('route', {
  p50: { $percentile: { field: 'latencyMs', p: 0.5 } },
  p95: { $percentile: { field: 'latencyMs', p: 0.95 } },
});
```

**Rejected — array `p` inside `$percentile`:** would make one output field hold an array value, complicating the result shape for zero expressiveness gain over multiple output fields.

**Rejected — a separate `$p50`/`$p95`-style key family:** unbounded key namespace, no validation story.

### 6. No new exported types, no storage changes

- `GroupAccumulator` gains two optional keys; its operand object type is written inline. `GroupResultEntry` is unchanged (`unknown` values already carry `number | null`).
- Consistent with [ADR-005](./005-scan-based-query-execution.md): no storage or index involvement; the computation lives entirely in `src/internal/aggregationUtils.ts` and `src/resultChain.ts`.
- Existing limits apply unchanged (`maxMatchedDocuments` for terminals; `MAX_GROUP_COUNT` / `MAX_GROUP_DOCUMENTS` for `groupBy`).

## Consequences

### Positive

- Parity with the standard database toolbox (SQL `PERCENTILE_CONT`, MongoDB `$percentile`/`$median`) for the most common distribution questions; `avg` is no longer the only central-tendency tool.
- `median` comes for free once `percentile` exists.
- `percentile` has one input shape and one return shape, matching the scalar-only `$percentile` accumulator.
- Reuses the existing extraction (`extractNumericValues`) and validation building blocks; value-selection semantics are identical to `sum`/`avg`/`min`/`max`, so the spec's "empty results" table extends without special cases.

### Negative

- Computing several percentiles requires separate terminal calls, so the filtered set is fetched and sorted once per requested percentile.
- `$percentile` introduces the first object-shaped accumulator operand, so `validateAccumulators` can no longer assume "operand is a field-path string" uniformly.
- Percentile accumulators sort each group's values: `groupBy` cost gains an `O(Σ nᵢ log nᵢ)` term per percentile accumulator. Bounded by the existing group limits; acceptable for an in-memory engine.

## Future Considerations

- **`method` option** (`'linear' | 'nearest'`) on `percentile` and `$percentile`, mirroring `PERCENTILE_CONT` vs `PERCENTILE_DISC`, if discrete percentiles are requested. The linear default chosen here matches what such an option would default to.
- **Plural `percentiles(field, pValues)` terminal** if repeated scalar calls become a measured bottleneck. A distinct method name would preserve predictable return types while allowing one fetch and one sort.
- **Other aggregation candidates** identified while designing this (each would follow the same pattern — terminal method + `groupBy` accumulator — and each deserves its own ADR): standard deviation / variance (`$stdDevPop` / `$stdDevSamp`, MongoDB parity, single-pass Welford); `$first` / `$last` accumulators (field value of first/last document per group in storage order); `countDistinct` (per-group distinct counting is currently inexpressible); `$push` / `$addToSet` collectors (memory-bound caveats apply).
