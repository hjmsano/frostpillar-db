# ADR-021: `$first` / `$last` groupBy Accumulators

- **Status:** Accepted
- **Date:** 2026-07-11
- **Deciders:** Hajime Sano

## Context

`groupBy` accumulators so far are numeric reducers (`$sum`, `$avg`, `$min`, `$max`, `$median`, `$percentile`, the stddev/variance family) plus `$count`. None can answer "what was the *value* of a field on the first (or last) document of each group" — the "latest status per user", "first event per session" question. [ADR-020](./020-chain-sort-aware-aggregation.md) made `groupBy` honor a preceding `.sort()`, so each group's documents now have a well-defined order (the chain's `.sort()` order, or storage order otherwise). That ordering rule is exactly what `$first` / `$last` need to be meaningful.

MongoDB provides `$first` / `$last` accumulators with these semantics. This ADR adds them as the first **non-numeric** accumulators — they return the field's value verbatim, of any type.

## Decision

### 1. Accumulators only — no terminal methods

`$first` / `$last` are added to `groupBy` only. The top-level "first/last document" case is already covered by `find().sort().limit(1).toArray()`, so no `ResultChain` terminal is added.

### 2. Plain field-path string operands

```ts
interface GroupAccumulator {
  // ... existing keys ...
  $first?: string; // field path
  $last?: string;  // field path
}
```

`$first: 'status'` returns the value of `status` on the **first document of the group in aggregation input order**; `$last: 'status'` returns it from the **last document**. "Aggregation input order" is defined by ADR-020: the chain's `.sort()` order when a sort is present, otherwise storage order. Canonical usage:

```ts
// latest status per user
await events.find({}).sort({ updatedAt: -1 }).groupBy('userId', {
  latestStatus: { $first: 'status' },
});
```

Operand validation reuses the existing string-operand branch of `validateAccumulators` (must be a string, then `validateFieldPath`) — no new validation branch, unlike `$percentile`. The "exactly one accumulator key per entry" rule is unchanged.

### 3. Missing field on the selected document → `null`

If the selected document (first or last of the group) does not have the field path, the result is `null`. This is deliberately **not** "the first/last document that *has* the field" — the accumulator picks the positional document first, then reads the field, mirroring MongoDB. A group always has at least one document, so there is always a document to select.

### 4. Any value type; defensive cloning

`$first` / `$last` return the field value **of any type** — string, number, boolean, `null`, object, or array — the first accumulators that are not numeric-only. Because group documents are references to stored documents and every other frostpillar API returns clones, object/array values are **defensively cloned** before being placed in the result, so a caller mutating a returned value cannot corrupt stored data.

A shared helper `cloneAccumulatorValue(value)` is introduced, reusing `cloneDocument`'s internals (which already handles primitives as pass-through and deep-clones JSON-safe objects/arrays). It is exported for reuse by `$push` / `$addToSet` in [ADR-023](./023-push-addtoset-accumulators.md) (PR 6). Primitives (including `null`) are returned as-is; only objects/arrays incur a clone.

### 5. Tie-breaking is deterministic

Inherited from ADR-020's stable sort: documents with equal sort keys keep storage order, so the "first"/"last" document of a group is deterministic under `.sort()`. Without `.sort()`, storage order applies directly. There is no nondeterminism.

### 6. No new exported types, no storage changes

`GroupAccumulator` gains two optional string keys; `GroupResultEntry`'s `unknown` value type already accommodates arbitrary values. No storage or index involvement (consistent with [ADR-005](./005-scan-based-query-execution.md)). Existing group limits apply unchanged.

## Rejected Alternatives

- **Per-accumulator `sortBy` operand** (`{ $first: { sortBy: {...}, field: 'status' } }`, MongoDB `$top`/`$bottom` style): superseded by ADR-020, which put ordering at the chain level. `$first`/`$last` stay plain field-path strings.
- **"First non-null" / "first document that has the field" semantics**: rejected in favor of positional-then-read (§3). Positional semantics match MongoDB and compose cleanly with the ordering rule; a "first non-null" variant would be a different accumulator if ever needed.

## Consequences

### Positive

- Enables "latest/earliest value per group" — a very common reporting need — with no new syntax beyond a field path, riding on ADR-020's ordering rule.
- `cloneAccumulatorValue` establishes the clone-on-return guarantee for value-returning accumulators, reused by PR 6.

### Negative

- First accumulators to return non-numeric values, so `computeAccumulatorValue` gains a dedicated branch that bypasses the numeric-extraction path.
- The "missing field on selected document → `null`" rule can surprise users expecting "first document that has the field"; documented explicitly in the spec and both READMEs.

## Future Considerations

- **`$topN` / `$bottomN`** N-ary variants (return the first/last N values as an array) — a natural extension once single-value `$first`/`$last` exist; would need a memory caveat like `$push`.
- Remaining deferred candidates from ADR-018: `countDistinct` (ADR-022), `$push`/`$addToSet` (ADR-023, reuses `cloneAccumulatorValue` from this ADR).
