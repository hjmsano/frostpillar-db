# ADR-023: `$push` / `$addToSet` groupBy Accumulators

- **Status:** Accepted
- **Date:** 2026-07-11
- **Deciders:** Hajime Sano

## Context

`groupBy` can reduce a group to scalars (`$sum`, `$avg`, `$count`, `$median`, `$countDistinct`, …) and pick a single positional value (`$first` / `$last`, [ADR-021](./021-first-last-accumulators.md)), but it cannot **collect** a group's field values into an array. "All tags per post", "the set of countries per customer" — the array-valued collectors — are inexpressible inside `groupBy` today.

MongoDB provides exactly these as `$push` (collect all, with duplicates, in order) and `$addToSet` (collect distinct). This ADR adds them as the final accumulators of the aggregation suite. Two prerequisites are already in place: [ADR-020](./020-chain-sort-aware-aggregation.md) gives each group a well-defined document order (the chain's `.sort()`, or storage order), and [ADR-021](./021-first-last-accumulators.md) introduced `cloneAccumulatorValue` for returning stored values safely.

## Decision

### 1. Accumulators only

`$push` / `$addToSet` are added to `groupBy` only. The top-level equivalents already exist: `find().toArray()` (with projection) collects all values, and `distinct()` collects the set. No `ResultChain` terminals are added.

### 2. Field-path string operands

```ts
interface GroupAccumulator {
  // ... existing keys ...
  $push?: string;      // field path
  $addToSet?: string;  // field path
}
```

- **`$push: 'path'`** — an array of the resolved value of `path` for **every document in the group, in aggregation input order** (ADR-020: the chain's `.sort()` order, or storage order). Missing/`undefined` values are **skipped**; `null` is **included**. Duplicates are preserved.
- **`$addToSet: 'path'`** — an array of the **distinct** resolved values, in first-occurrence order within the aggregation input order, using **exactly `distinct`'s equality semantics** (missing/`undefined` skipped, `null` a valid member, deep equality for objects/arrays, strict equality for primitives).

Both reuse the existing string-operand branch of `validateAccumulators` (string, then `validateFieldPath`) — no new validation branch. The "exactly one accumulator key per entry" rule is unchanged. An empty group field set (no present values) yields `[]`.

### 3. Deliberate name reuse with the update operators

`$push` / `$addToSet` are **already** operator names in `UpdateOperations` (the update DSL). Reusing them here is intentional: they carry the same collect/collect-distinct meaning users know from MongoDB, in a different syntactic context. In an **update** spec the operand is an update instruction; in a **groupBy accumulator** the operand is a **field-path string**. The two are structurally distinct types on distinct interfaces (`UpdateOperations` vs `GroupAccumulator`) and never coexist, so there is no ambiguity — but the ADR records the reuse explicitly so it is a conscious choice, not an accident.

### 4. Ordering

Both collectors consume the group's documents **in aggregation input order**, which is already established before `computeGroupBy` runs (ResultChain applies the sort via `orderForAggregation`, ADR-020). No re-sorting happens inside the accumulators — they iterate the group's documents as given, so `$push` output order and `$addToSet` first-occurrence order both follow the chain's `.sort()` when present, storage order otherwise.

### 5. Defensive cloning

Object/array values are **defensively cloned** via `cloneAccumulatorValue` (ADR-021) before entering the result array, because group documents are references to stored documents. Primitives/`null` pass through. A caller mutating a returned array or any object inside it cannot corrupt stored data. (This closes the same mutation surface `$first`/`$last` already handle.)

### 6. Limits

- **`$push` needs no new limit.** A group holds at most `MAX_GROUP_DOCUMENTS` (100,000) documents, and `$push` emits at most one value per document, so its output is already bounded.
- **`$addToSet` reuses `MAX_DISTINCT_COUNT` (100,000) per group** — the same cap and the same `ValidationError` failure as `distinct` / `$countDistinct`, applied within each group. It is implemented on the shared `scanDistinctValues` core, passing an `$addToSet`-specific context string so the cap error identifies the accumulator.
- Both are **memory-bound collectors**: a large group produces a large array. The READMEs document this caveat (prefer scalar accumulators, or narrow the group, when cardinality is high).

### 7. No new exported types, no storage changes

`GroupAccumulator` gains two optional string keys; `GroupResultEntry`'s `unknown` value type already accommodates array values. No storage or index involvement (consistent with [ADR-005](./005-scan-based-query-execution.md)).

## Rejected Alternatives

- **A new dedicated `$push` limit** (separate from `MAX_GROUP_DOCUMENTS`): unnecessary — the group-size cap already bounds `$push` output. Adding a second knob would be redundant surface.
- **Expression operands** (`$push: { $concat: [...] }` / computed expressions, MongoDB-style): out of scope. Frostpillar accumulators take field paths, not an expression language; a field-path string keeps `$push`/`$addToSet` consistent with every other accumulator. An expression layer, if ever wanted, is a separate, much larger design.

## Consequences

### Positive

- Completes the MongoDB-parity accumulator set: scalars, positional (`$first`/`$last`), count (`$countDistinct`), and now collectors (`$push`/`$addToSet`).
- `$addToSet` reuses the `scanDistinctValues` core and `cloneAccumulatorValue`, and `$push` reuses `cloneAccumulatorValue` — no new dedup or clone machinery.
- Ordering and cloning come for free from ADR-020 and ADR-021.

### Negative

- Memory-bound: a high-cardinality group yields a large array. Documented as a caveat; `$addToSet` is additionally hard-capped by `MAX_DISTINCT_COUNT`, `$push` by `MAX_GROUP_DOCUMENTS`.
- Reusing the update-operator names `$push`/`$addToSet` in a second context could momentarily confuse a reader; mitigated by the distinct interfaces and explicit documentation (§3).

## Future Considerations

- **`$topN`/`$bottomN`** collectors (bounded-N variants) noted in ADR-021 would pair naturally with these.
- Expression-operand accumulators (see rejected alternatives) remain a possible future direction.
- With this PR the aggregation-function suite (ADR-018 through ADR-023) is complete; no further aggregation candidates are queued.
