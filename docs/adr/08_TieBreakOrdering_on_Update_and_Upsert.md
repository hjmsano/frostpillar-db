# ADR-08: Tie-Break Ordering Stability for Update and Upsert

Status: Accepted  
Date: 2026-03-06

## Context

Frostpillar guarantees deterministic query ordering for duplicate timestamps:
`timestamp` ascending, then insertion order ascending.

Without explicit mutation rules, implementations could accidentally reorder records with equal
timestamps during update/upsert handling or low-level storage maintenance
(compaction, page rewrite, B+ tree split/merge/rebalance). That would violate user-visible
ordering guarantees.

## Decision

1. Preserve original insertion order on update

- Any update operation that targets an existing record MUST preserve that record's original
  insertion-order key.

2. Upsert behavior is split by path

- Upsert update path (target exists): preserve original insertion-order key.
- Upsert insert path (target missing): assign a new insertion-order key exactly as insert.

3. Physical maintenance must not alter logical order

- Compaction, page rewrite, and B+ tree structural operations MUST preserve logical ordering by
  `(timestamp, insertion-order key)`.
- Physical location is not part of query ordering semantics.

4. Testing obligations

- Add invariant tests for equal-timestamp ordering across compaction and split/merge operations.
- Add mutation tests to verify update/upsert path-specific ordering behavior.

## Consequences

Positive:

- Keeps query behavior deterministic and user-friendly.
- Allows lightweight execution: updates avoid reassigning tie-break metadata.
- Reduces risk of subtle regressions from internal storage maintenance.

Trade-off:

- Implementations must treat insertion-order key as immutable metadata and verify it in low-level
  tests, including randomized operation mixes.
