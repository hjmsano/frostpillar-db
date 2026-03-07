# ADR-46: Runtime B+ Tree Index for M3 Query Scalability

Status: Accepted  
Date: 2026-03-07

## Context

M1/M2 established functional correctness and durability, but current `select` path still
uses full-dataset `filter + sort` execution.

This does not satisfy ADR-01 M3 intent:

- scalable range query behavior
- explicit split/merge hardening
- deterministic duplicate timestamp ordering through structural changes

Turnover retention also needs deterministic oldest-record access that remains stable under
heavy mutation.

## Decision

Adopt an internal runtime B+ tree index keyed by `(timestamp, insertionOrder)` and route
`select` through index lower-bound seek + linked-leaf forward scan.

- Public API remains unchanged.
- Index is an internal module under `src/core/datastore`.
- Turnover oldest eviction uses leftmost-leaf head access from the same logical index.
- M3 test suite MUST include property-style invariants and split/merge regression coverage.

## Alternatives Considered

1. Keep full-scan query path and rely on future optimization.
2. Introduce a sorted array index with binary search only.
3. Introduce a B+ tree runtime index now with split/merge/linked-leaf invariants.

## Consequences

Positive:

- aligns runtime behavior with M3 scalability intent (`O(log N + K)` style range reads)
- unifies deterministic ordering and retention oldest-pop path on one logical key model
- creates explicit regression safety net for split/merge/leaf-link invariants

Trade-off:

- internal implementation complexity increases
- additional invariant tests are required and must remain stable in CI
