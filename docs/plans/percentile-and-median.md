# Implementation Plan: Percentile and Median Aggregation

- **Status:** Awaiting approval (design phase complete, no implementation yet)
- **Design:** [ADR-018](../adr/018-percentile-and-median-aggregation.md)
- **Branch:** `feat/percentile-median`
- **Date:** 2026-07-11

## Goal

Add `percentile` / `median` terminal methods to `ResultChain` and `$percentile` / `$median` accumulators to `groupBy`, with exact linear-interpolation semantics (`PERCENTILE_CONT`), `p` as a fraction in `[0, 1]`, and value-selection rules identical to the existing numeric aggregations.

**Definition of done:** all work items below checked; `pnpm check` and `pnpm test` pass; spec 03, README.md, README-JA.md updated; ADR-018 status flipped to Accepted.

## API summary (from ADR-018)

```ts
// ResultChain terminals
percentile(field: string, p: number): Promise<number | null>;
percentile(field: string, p: number[]): Promise<(number | null)[]>;
median(field: string): Promise<number | null>; // ≡ percentile(field, 0.5)

// groupBy accumulators (GroupAccumulator gains:)
$median?: string;
$percentile?: { field: string; p: number };
```

## Work items (SDD → TDD → implement, strictly in order)

### Phase 1 — Spec (SDD)

- [ ] **1.1** Update `docs/specs/03-aggregation-and-chain.md`:
  - §1.3: add `.percentile(field, p)` (both overloads) and `.median(field)` method sections — semantics, `[0,1]` range, linear interpolation formula, `p=0`→min / `p=1`→max property, array-form positional result, defensive copy of `p` array.
  - §1.3 `groupBy`: extend the `GroupAccumulator` type listing and the accumulator behavior list with `$median` / `$percentile`; document the object-operand validation rule (exactly `field` + `p` keys).
  - §1.4: add `percentile`, `median` to the aggregation-scope method list.
  - §2: add `percentile`/`median` to pipeline step 3.
  - §4 empty-results table: new columns — `.percentile(f,p)` → `null` / `.percentile(f,p[])` → all-`null` array / `.median(f)` → `null` for all three scenarios.
  - §5 error table: `p` not a finite number in `[0,1]`; `p` array empty; `$percentile` operand not an object with exactly `field` and `p` keys; field-path errors same as existing aggregations.

### Phase 2 — Core computation (unit-test first)

- [ ] **2.1** Unit tests in `tests/unit/aggregation-utils.test.ts` for a new `computePercentile(values: number[], p: number): number | null`:
  - interpolation correctness (odd/even counts, e.g. median of `[1,2,3,4]` = `2.5`), unsorted input, `p=0`/`p=1` = min/max, single value, duplicates, empty → `null`, extreme `p` like `0.999` on small n.
- [ ] **2.2** Unit tests for eager `p` validation (`validatePercentile`): non-number, `NaN`, `Infinity`, `-0.1`, `1.1` → `ValidationError`; boundary `0` and `1` accepted; array form: empty array rejected, per-element validation, defensive copy returned.
- [ ] **2.3** Implement in `src/internal/aggregationUtils.ts`: `computePercentile` (sort copy + linear interpolation) and `validatePercentile(p: number | number[])`. Strict typing, named exports.

### Phase 3 — ResultChain terminals (integration-test first)

- [ ] **3.1** Integration tests in `tests/integration/aggregation.test.ts` (and `result-chain.test.ts` where the existing suites cover reuse):
  - `.percentile()` scalar and array forms with filters; non-numeric/missing/non-finite field values skipped; no-match and no-numeric-values → `null` / all-`null` array; sort/skip/limit ignored per §1.4; eager validation throws before fetch (closed-DB ordering consistent with existing terminals); chain reuse; `.median()` equals `.percentile(f, 0.5)`.
- [ ] **3.2** Implement `percentile()` (overloaded) and `median()` in `src/resultChain.ts`, reusing `getNumericValues`; array `p` validated + copied synchronously before the fetch `await`.

### Phase 4 — groupBy accumulators (test first)

- [ ] **4.1** Unit tests in `tests/unit/aggregation-utils-groupby.test.ts` + integration tests in `tests/integration/groupby.test.ts`:
  - `$median` / `$percentile` values per group (string and array `groupBy` forms); groups with no numeric values → `null`; multiple percentile output fields (p50/p95/p99) on one call; validation errors — `$percentile` operand not an object, missing/extra keys, bad `field` path, bad `p`; exactly-one-key rule still enforced.
- [ ] **4.2** Implement in `src/internal/aggregationUtils.ts`: add `$median`/`$percentile` to `VALID_ACCUMULATOR_KEYS`, extend `validateAccumulators` (object-operand branch for `$percentile`), extend `computeAccumulatorValue`. Extend `GroupAccumulator` in `src/types.ts`.

### Phase 5 — Documentation & finalization

- [ ] **5.1** `README.md`: feature bullet (line ~30), aggregation section (`.percentile`/`.median` examples ~line 615), `groupBy` accumulator list (line ~662, add `$median`, `$percentile`), API reference table (~line 1026).
- [ ] **5.2** `README-JA.md`: same updates in Japanese.
- [ ] **5.3** Flip ADR-018 status Proposed → Accepted; add ADR-018 to the ADR index table in `docs/architecture/overview.md`. *(Side cleanup, same table: index is stale — ADR-013 through 017 are missing; backfill them.)*
- [ ] **5.4** `pnpm check` and `pnpm test` green; verify each plan item against ADR-018; delete this plan file (or mark Completed) in the final commit.

## Non-goals (this feature)

- Approximate percentile algorithms, `method: 'nearest'` option, stdDev/variance, `$first`/`$last`, `countDistinct`, `$push`/`$addToSet` — recorded as future candidates in ADR-018.
