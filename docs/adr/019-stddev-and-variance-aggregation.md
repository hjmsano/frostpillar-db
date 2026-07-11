# ADR-019: Standard Deviation and Variance Aggregation

- **Status:** Accepted
- **Date:** 2026-07-11
- **Deciders:** Hajime Sano

## Context

`ResultChain` provides the numeric aggregation terminals `sum`, `avg`, `min`, `max`, and — as of [ADR-018](./018-percentile-and-median-aggregation.md) — `percentile` / `median`, each mirrored by a `groupBy` accumulator. Standard deviation and variance are the remaining staples of the descriptive-statistics toolbox: they quantify dispersion, the natural companion to the central-tendency measures (`avg`, `median`) already present. They are standard across the database domain — SQL defines `STDDEV_POP` / `STDDEV_SAMP` and `VAR_POP` / `VAR_SAMP`, and MongoDB exposes `$stdDevPop` / `$stdDevSamp` accumulators — and answer the canonical "how spread out is this?" question (latency jitter, score variance, price volatility) that no current terminal covers.

Per [ADR-005](./005-scan-based-query-execution.md), all aggregation runs as a single in-memory scan over the filtered document set, bounded by `maxMatchedDocuments` (default 100,000). The existing building blocks apply directly:

- `extractNumericValues` — resolves a field path per document and keeps only finite numbers (the exact value-selection rule used by every other numeric aggregation).
- `validateAggregationField` / `validateFieldPath` — eager field-path validation shared by every aggregation terminal.

## Decision

### 1. Four new `ResultChain` terminal methods

```ts
stdDevPop(field: string): Promise<number | null>;
stdDevSamp(field: string): Promise<number | null>;
variancePop(field: string): Promise<number | null>;
varianceSamp(field: string): Promise<number | null>;
```

All four operate on the **filtered** set (sort/skip/limit/projection not applied, spec 03 §1.4), skip non-numeric and non-finite values via `extractNumericValues`, and return `null` when no numeric values exist. Naming follows the MongoDB accumulator names (`$stdDevPop` / `$stdDevSamp`) and the SQL population/sample distinction (`VAR_POP` / `VAR_SAMP`), giving both a `Pop` and a `Samp` variant for standard deviation and variance.

**Rejected — a single `stdDev(field, opts)` method with an options object** (e.g. `{ sample: true }`): four flat methods match the naming users already know from SQL and MongoDB, keep the return type monomorphic, and let `groupBy` mirror each one as a distinct accumulator key. An options object would have no accumulator analogue and would hide the pop/samp choice behind a parameter.

### 2. Population vs sample distinction

- **Population** (`stdDevPop`, `variancePop`) divides the sum of squared deviations by `n`. Use when the matched set *is* the whole population.
- **Sample** (`stdDevSamp`, `varianceSamp`) divides by `n − 1` (Bessel's correction), the unbiased estimator of a larger population's variance from a sample.

Both are provided because the correct choice is domain-dependent and picking one silently would give wrong answers for the other use case. This matches SQL and MongoDB, which both expose the pair.

### 3. Algorithm: Welford's single-pass online algorithm

Variance is computed with **Welford's method**, a numerically stable single-pass recurrence that accumulates `count`, running `mean`, and `m2` (the sum of squared deviations from the running mean):

```
for each value x:
  count += 1
  delta = x - mean
  mean += delta / count
  m2 += delta * (x - mean)

variancePop  = m2 / count           // n
varianceSamp = m2 / (count - 1)     // n - 1
stdDevPop    = sqrt(variancePop)
stdDevSamp   = sqrt(varianceSamp)
```

A single shared internal helper `computeWelford(values): { count: number; mean: number; m2: number }` produces the three accumulators; the four public results are pure derivations of it, computed once and reused (a `groupBy` row requesting several of the four for one field pays the scan/reduce cost once per accumulator entry, but each entry is O(n)).

**Rejected — the naive "sum of squares" formula `E[x²] − E[x]²`** (or `Σx² − (Σx)²/n`): algebraically correct but numerically catastrophic — for large-magnitude, low-variance data (e.g. values near `1e9` differing by single digits) it subtracts two nearly-equal large numbers and loses all significant digits, and can even yield a small negative variance. Welford avoids the cancellation entirely at the same O(n) cost. A regression test pins this (values `1e9 + {0, 1, 2}`).

### 4. Edge semantics (MongoDB-aligned)

| `n` (numeric values) | `variancePop` / `stdDevPop` | `varianceSamp` / `stdDevSamp` |
| -------------------- | --------------------------- | ----------------------------- |
| `0`                  | `null`                      | `null`                        |
| `1`                  | `0`                         | `null`                        |
| `≥ 2`                | computed                    | computed                      |

- `n = 0` → `null` for all four, consistent with `avg`/`min`/`max`/`median` returning `null` on an empty numeric set.
- `n = 1` → population variance/stddev is `0` (a single point has zero dispersion from itself); sample variance/stddev is `null` because `n − 1 = 0` makes the sample estimator undefined (division by zero). This is exactly MongoDB's `$stdDevSamp` behavior.

### 5. Four new `groupBy` accumulators

```ts
interface GroupAccumulator {
  // ... existing keys ...
  $stdDevPop?: string;    // field path
  $stdDevSamp?: string;   // field path
  $variancePop?: string;  // field path
  $varianceSamp?: string; // field path
}
```

Each is a plain field-path string operand (like `$sum`/`$avg`/`$min`/`$max`/`$median`), validated by the existing string-operand branch of `validateAccumulators` — no new object-operand handling is needed (unlike `$percentile`). Per-group semantics are identical to the terminals: extract the group's numeric values, run `computeWelford`, apply the same `n = 0` / `n = 1` edge rules. The existing "exactly one accumulator key per entry" rule is unchanged.

### 6. No new exported types, no storage changes

- `GroupAccumulator` gains four optional string keys; no new exported type. `GroupResultEntry` is unchanged (`unknown` values already carry `number | null`).
- Consistent with [ADR-005](./005-scan-based-query-execution.md): no storage or index involvement; the computation lives entirely in `src/internal/aggregationUtils.ts` and `src/resultChain.ts`.
- Existing limits apply unchanged (`maxMatchedDocuments` for terminals; `MAX_GROUP_COUNT` / `MAX_GROUP_DOCUMENTS` for `groupBy`).

## Consequences

### Positive

- Completes the descriptive-statistics set (central tendency + dispersion) with SQL/MongoDB parity.
- Welford gives numerically stable results in one pass at O(n), no worse than `avg`.
- One shared `computeWelford` helper backs all four terminals and all four accumulators — a single well-tested core.
- Value-selection semantics are identical to the other numeric aggregations, so spec 03's "empty results" table extends without special cases (beyond the `n = 1` sample nuance, which is documented explicitly).

### Negative

- Four new terminal methods plus four new accumulator keys is the largest single addition to the aggregation surface so far; mitigated by their uniformity (all share one core and one value-selection rule).
- The `n = 1` asymmetry (population `0`, sample `null`) is a real edge users must understand; documented in the spec's empty-results discussion and both READMEs.

## Future Considerations

- **Covariance / correlation** across two fields would need a different two-field extraction shape; out of scope here and would warrant its own ADR.
- Deferred aggregation candidates recorded in ADR-018 remain: chain-sort-aware aggregation, `$first` / `$last`, `countDistinct`, `$push` / `$addToSet` — each its own ADR.
