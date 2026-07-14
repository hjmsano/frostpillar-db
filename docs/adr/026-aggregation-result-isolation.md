# ADR-026: Aggregation Result Isolation

- **Status:** Accepted
- **Date:** 2026-07-12
- **Deciders:** Hajime Sano
- **Relates to:** [ADR-021](./021-first-last-accumulators.md), [ADR-023](./023-push-addtoset-accumulators.md), [ADR-025](./025-write-path-input-isolation.md)

## Context

Aggregation runs over the stored documents themselves: `ResultChain` passes the filtered records to `aggregationUtils`, which resolves field paths on them via `getValueByPath`. Any object or array a resolved path returns is therefore a **live reference into storage**, not a copy.

The accumulators that can emit non-numeric values — `$first`/`$last` (ADR-021) and `$push`/`$addToSet` (ADR-023) — were written with this in mind and clone through `cloneAccumulatorValue`. Two other result surfaces were not:

- **`distinct(field)`** pushed each newly-distinct resolved value into the result array verbatim. For an object- or array-valued field, the caller received the stored value itself.
- **`groupBy(field, ...)`'s `_key`** carried the resolved group value verbatim — the raw value in the string form, and each dimension's raw value inside the composite `_key` object in the array form.

Mutating either result mutated the stored document in place: no validation, no payload-limit check, no TTL bookkeeping, and no `watch()` event. Under `skipPayloadValidation: true` (ADR-025 §Context) nothing downstream re-checks the record either, so a cycle or an over-limit value introduced this way stays in storage. This is the read-path twin of ADR-025, and it made ADR-025's own "aggregation results are already defensively copied" note untrue.

## Decision

Every value an aggregation terminal hands back is cloned out of storage before it leaves `aggregationUtils`:

- `computeDistinct` clones each newly-distinct value as it enters the result array, reusing `cloneAccumulatorValue` (an alias of `cloneDocument`), exactly as `$addToSet` already did on the same shared scan core.
- `computeGroupBy` clones the group key value when a group is first created — once per group, in both the scalar and the composite form (the composite `_key` object is built from the cloned dimension values).

Cloning happens **at group/value creation, not per document**: the clone count is bounded by the number of distinct values or groups, not by the size of the scanned set. Primitives (the overwhelmingly common key and distinct-value shape) pass through `cloneDocument` untouched.

`computeCountDistinct` is deliberately left alone. It never materializes values, so there is nothing to isolate; adding a clone there would only slow the count-only path that ADR-022 exists to keep allocation-free.

Grouping and dedup keys are still computed from the **original** value (`serializeGroupKey` / `serializeCanonical` run before the clone), so equality semantics are byte-for-byte unchanged.

## Alternatives Considered

1. **Clone the whole document set before aggregating.** Rejected — it costs a deep copy of every scanned document to protect the handful of values that actually escape, on the hot read path.
2. **Freeze the returned values.** Rejected — freezing a stored value mutates storage-owned state, is shallow unless the whole graph is walked (which costs the same as cloning), and fails silently outside strict mode.
3. **Document "do not mutate aggregation results".** Rejected for the same reason as ADR-025 §Alternatives 3: silent, unvalidated corruption of stored data is not an acceptable outcome of an ordinary caller mistake, and the other accumulators already set the opposite precedent.

## Consequences

### Positive

- Every aggregation terminal now returns caller-owned data. Mutating a `distinct()` element or a `groupBy()` `_key` cannot reach storage.
- The isolation rule is uniform across the aggregation surface, so `$first`/`$last`/`$push`/`$addToSet` are no longer special cases; ADR-025's read-path note is now accurate.

### Negative

- `distinct()` on an object/array-valued field pays one deep copy per distinct value, and `groupBy()` one per group with an object/array key. Primitive fields — the normal case — are unaffected.

### Not covered

Documents returned from `find()` / `findOne()` / `watch()` payloads keep their existing contract (spec 02 §12); this ADR is limited to the aggregation terminals in `aggregationUtils.ts`.
