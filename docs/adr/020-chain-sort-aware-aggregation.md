# ADR-020: Chain-Sort-Aware Aggregation

- **Status:** Accepted
- **Date:** 2026-07-11
- **Deciders:** Hajime Sano

## Context

Until now, aggregation terminals (`sum`, `avg`, `min`, `max`, `percentile`, `median`, the stddev/variance family, `distinct`, `groupBy`) operate on the **filtered** set in **storage order**, ignoring any `.sort()` on the chain (spec 03 §1.4). `.sort()`, `.skip()`, `.limit()`, and `.project()` affect only `.toArray()` / `.cursor()` (and `.count()` honors `skip`/`limit`).

For the order-sensitive terminals this is a limitation. The canonical "latest value per group" question —

```ts
await events.find({}).sort({ updatedAt: -1 }).groupBy('userId', { latest: { $first: 'status' } });
```

— cannot be expressed, because `groupBy` today ignores the `.sort()`. The upcoming `$first` / `$last` accumulators (ADR-021) and `$push` / `$addToSet` collectors (ADR-023) are only meaningful relative to a defined order, and `distinct`'s "first occurrence" order is currently storage-only.

This ADR changes the aggregation input-ordering rule so the chain's `.sort()` composes with aggregation the way MongoDB's `$sort → $group` pipeline does. It is a **behavior change** for existing code that calls `.sort()` before `distinct` / `groupBy`, and ships as a breaking change (`feat!`). It changes **ordering only**, never the *contents* of any result.

## Decision

### 1. New aggregation input-ordering rule (spec 03 §1.4)

> Aggregation input order = **storage order, or `.sort()` order if a sort is specified**. `skip`, `limit`, and `projection` are still **not applied** to aggregation input.

`.count()`'s existing exception (it applies `skip`/`limit`) is unchanged. This single rule replaces the old "sort not applied to aggregation" statement wherever it appears in spec 03 (including any sentences added by the percentile and stddev PRs).

### 2. Observably affected terminals

- **`distinct`** — returned values follow first occurrence **in sorted order** when `.sort()` is present.
- **`groupBy`** — group ordering (first occurrence of each key) follows sorted order; and each group's internal document order becomes the sorted order. That per-group order is what the order-sensitive accumulators consume: `$first` / `$last` (ADR-021) and `$push` / `$addToSet` (ADR-023).

### 3. Order-insensitive terminals — defined as-if-sorted, implemented unsorted

`sum`, `avg`, `min`, `max`, `count`, `percentile`, `median`, `stdDevPop`, `stdDevSamp`, `variancePop`, `varianceSamp`, and the future `countDistinct` are **mathematically order-independent**. The spec defines their behavior *as if* the input were sorted; the implementation **skips the sort** for these terminals as a pure optimization with no observable difference. Only `distinct` and `groupBy` actually sort.

### 4. Implementation

In `ResultChain`, only the order-sensitive aggregation methods (`distinct`, `groupBy`) apply ordering. After the existing `getFilteredDocuments(false)` fetch, when `state.sort` is defined they run the existing stable `applySort(filtered, state.sort, pathCache)` — **with no `limit` argument**, so it takes the full-sort branch (`Array.prototype.sort`, stable), never the top-K path — before calling `computeDistinct` / `computeGroupBy`:

```ts
const filtered = await this.getFilteredDocuments(false);
const ordered =
  this.state.sort === undefined
    ? filtered
    : applySort(filtered, this.state.sort, this.context.pathCache);
return computeDistinct(ordered, normalizedField, this.context.pathCache);
```

Sort semantics are exactly spec 03 §1.2 (missing-field placement, `NaN`, type ranks, codepoint string comparison, stability). **No changes to `aggregationUtils.ts`** in this PR — the numeric aggregation helpers and `computeDistinct` / `computeGroupBy` are untouched; they simply receive a reordered array. The numeric terminals continue to use `getNumericValues`, which does not sort.

### 5. Stability guarantee carried forward

`applySort`'s no-limit branch uses `Array.prototype.sort`, guaranteed stable in ES2019+. Documents with equal sort keys keep their storage order (by key ascending, then insertion order — the same guarantee spec 03 §1.2 already states, holding under the `'allow'` duplicate-key policy). This determinism is what later gives `$first` / `$last` free, deterministic tie-breaking, and makes `$push` / `$addToSet` ordering reproducible.

### 6. Breaking-change handling

- Any existing chain that calls `.sort()` **before** `distinct` / `groupBy` changes its result **ordering** (the order of returned values / groups, and per-group document order) — never the set of values or the group contents. Chains without `.sort()` are byte-identical to before; numeric terminals are byte-identical with or without `.sort()`.
- Ships as a Conventional Commit `feat!` with a `BREAKING CHANGE:` footer; release-please handles the pre-1.0 version bump.
- README migration note: *"Aggregation now honors a preceding `.sort()`. If you relied on storage-ordered `distinct` / `groupBy` results while also calling `.sort()` on the same chain, remove the `.sort()` to keep storage order."*

### 7. Cost

One O(n log n) stable sort per order-sensitive aggregation call **only when `.sort()` is present**, bounded by `maxMatchedDocuments`. Zero added cost when no `.sort()` is set, and zero for the numeric terminals regardless.

## Rejected Alternatives

- **Per-accumulator `sortBy` objects** (MongoDB `$top` / `$bottom` style, e.g. `{ $first: { sortBy: { updatedAt: -1 }, field: 'status' } }`): rejected in favor of the pipeline model. One ordering rule for the whole chain, no per-accumulator spec syntax to design/validate/document, and it matches how every other chain method already composes. `$first` / `$last` / `$push` / `$addToSet` become plain field-path operands (ADR-021, ADR-023).
- **Also applying `skip` / `limit` to aggregation input** (windowed aggregation, e.g. "avg of the top 10"): deferred. It is a much larger semantic change that would silently alter the *numeric* results of existing code, not just ordering. A possible future ADR; explicitly out of scope here.

## Consequences

### Positive

- Enables "latest/earliest per group" and ordered collectors (`$first`/`$last`/`$push`/`$addToSet`) with no new per-accumulator syntax — they inherit one chain-level ordering rule.
- Mental model matches MongoDB's `$sort → $group`; one sentence in the spec covers all terminals.
- No `aggregationUtils.ts` changes: the ordering concern stays in `ResultChain`, keeping the compute helpers pure functions of their input array.

### Negative

- Breaking change for the narrow case of `.sort()` + `distinct`/`groupBy` (ordering only). Mitigated by the migration note and the pre-1.0 status.
- Adds an O(n log n) sort to `distinct`/`groupBy` when `.sort()` is present (bounded by `maxMatchedDocuments`).

## Future Considerations

- Windowed aggregation (applying `skip`/`limit` to aggregation input) — see rejected alternatives.
- Remaining deferred candidates from ADR-018: `$first`/`$last` (ADR-021, depends on this ordering rule), `countDistinct` (ADR-022), `$push`/`$addToSet` (ADR-023, depends on this ordering rule).
