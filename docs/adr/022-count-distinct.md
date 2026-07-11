# ADR-022: `countDistinct` Terminal and `$countDistinct` Accumulator

- **Status:** Accepted
- **Date:** 2026-07-11
- **Deciders:** Hajime Sano

## Context

`ResultChain.distinct(field)` returns the array of unique values for a field; `groupBy` has no per-group distinct-count accumulator at all. A very common need — "how many unique X" (unique visitors, distinct SKUs per order, cardinality per group) — currently forces the caller to materialize the whole distinct array and read its `.length`, and is simply inexpressible inside `groupBy`.

`distinct` already implements the exact equality semantics this needs (spec 03 §1.3): missing/`undefined` skipped, `null` counted, deep equality for objects/arrays (via a recursively key-sorted canonical string), strict equality for primitives, capped at `MAX_DISTINCT_COUNT` (100,000). `countDistinct` should be *the count of exactly that set* — nothing more.

## Decision

### 1. Terminal method and accumulator

```ts
// ResultChain terminal
countDistinct(field: string): Promise<number>;

// groupBy accumulator (plain field-path string operand)
interface GroupAccumulator {
  // ... existing keys ...
  $countDistinct?: string; // field path
}
```

### 2. Semantics: exactly `distinct`, reduced to a count

`countDistinct` counts precisely the values `distinct` would return. The guarantee, for any field on any filtered set:

```
countDistinct(f) === (await distinct(f)).length
```

Missing/`undefined` skipped; `null` counted as one distinct value; objects/arrays deduped by deep equality; primitives by strict equality — identical to `distinct`. The `$countDistinct` accumulator applies the same rule per group.

### 3. Returns `0` when empty (a count, not `null`)

No matching documents, or matches but no present values, → `0`. This follows `count()` and `sum()` (which return `0`, not `null`), because `countDistinct` is a *count*. It deliberately does not mirror `avg`/`min`/`max`/`median`'s `null`-on-empty, which return a *value* that is undefined on an empty set; a cardinality of zero is well-defined.

### 4. Order-insensitive

A distinct *count* does not depend on order, so `countDistinct` is unaffected by the ADR-020 chain-sort rule. Per that ADR's §3, it is defined *as if* the input were sorted but the implementation **skips the sort** as a pure optimization. `$countDistinct` likewise ignores per-group order.

### 5. `MAX_DISTINCT_COUNT` cap applies — including per group

The 100,000-unique-value cap that guards `distinct` applies identically to `countDistinct`, and to `$countDistinct` **per group**. Exceeding it throws `ValidationError` with the same failure behavior as `distinct` — the count is bounded by the same memory ceiling (the seen-sets grow the same way whether or not the values are also collected). The diagnostic identifies the actual caller: `countDistinct() result` for the terminal and `$countDistinct accumulator` for the group accumulator. Because `MAX_GROUP_DOCUMENTS` and `MAX_DISTINCT_COUNT` are both currently 100,000 and each document contributes at most one resolved field value, groupBy reaches the document cap before its `$countDistinct` accumulator can exceed the distinct cap; the accumulator-specific context remains correct if those limits diverge.

### 6. Implementation: shared distinct-scan core

`computeDistinct` is refactored to sit on a shared internal core that tracks the seen-sets (the primitive `Set` and the canonical-object-key `Set`) and enforces the cap, **without requiring the result array to be materialized**:

- `computeDistinct` = run the core, collecting each newly-seen value into the result array (unchanged output and behavior — existing `distinct` tests stay green untouched).
- `computeCountDistinct` = run the same core, only incrementing a counter on each newly-seen value — no result array allocated.

The dedup logic, equality semantics, and cap check live in one place, so `distinct` and `countDistinct` cannot drift apart. This is a pure refactor for `distinct`: no behavior change.

### 7. No new exported types, no storage changes

`GroupAccumulator` gains one optional string key; the terminal returns `number`. No storage or index involvement (consistent with [ADR-005](./005-scan-based-query-execution.md)).

## Rejected Alternatives

- **Uncapped counting** (drop `MAX_DISTINCT_COUNT` for `countDistinct` because it "only counts"): rejected. The cap bounds the seen-sets' memory, which `countDistinct` allocates just as `distinct` does — the count is exact, so every distinct value must be remembered to avoid double-counting. Keeping the identical cap keeps the equivalence guarantee (§2) and one failure mode to document.
- **Approximate cardinality (HyperLogLog / probabilistic counters):** rejected. HLL exists to bound memory on unbounded streams; Frostpillar aggregates an in-memory set already capped at `maxMatchedDocuments`, so exact counting is cheap and gives a simpler, exact contract. Could be a future opt-in for very-high-cardinality workloads, but not the default.

## Consequences

### Positive

- "Unique count" is now a first-class terminal and a `groupBy` accumulator, with an exact, easy-to-reason-about contract (`=== distinct(f).length`).
- The shared-core refactor removes the risk of `distinct` and `countDistinct` diverging in equality or cap behavior.
- `countDistinct` avoids allocating the full value array — cheaper than `distinct().length` for the count-only use case.

### Negative

- Refactoring `computeDistinct` touches a well-tested hot path; mitigated by keeping `distinct`'s existing tests untouched and green as the regression guard.
- Same memory ceiling as `distinct` (cannot count beyond `MAX_DISTINCT_COUNT` unique values); documented, and the approximate-counting escape hatch is noted as a future option.

## Future Considerations

- Optional approximate mode (HLL) for very-high-cardinality fields, if a real workload needs to exceed the exact cap.
- Remaining deferred candidate from ADR-018: `$push` / `$addToSet` (ADR-023).
