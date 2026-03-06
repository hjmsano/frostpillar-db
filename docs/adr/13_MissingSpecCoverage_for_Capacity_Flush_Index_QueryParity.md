# ADR-13: Fill Missing Spec Coverage for Capacity, Flush, Index, and Query Parity

Status: Accepted  
Date: 2026-03-06

## Context

Architecture vision and testing strategy required behaviors that were not yet fully pinned down in normative specs:

- bounded size (`maxSize`) with strict/turnover policy behavior
- size-threshold flush and crash-safe durable commit ordering
- B+ tree occupancy/split/merge/leaf-link invariants
- SQL/Lucene parity contract details for aggregation/grouping/output controls
- canonical field-path escaping for payload keys containing dot/backslash

Without these clauses, implementation and tests could still diverge even with spec-first workflow.

## Decision

Adopt additional/updated specs with explicit normative requirements:

1. Capacity and retention

- Add `docs/specs/09_CapacityAndRetention.md`.
- Define `CapacityConfig` with deterministic accounting and strict/turnover policies.
- Require deterministic oldest-first eviction order for turnover.

2. Flush and durability protocol

- Add `docs/specs/10_FlushAndDurability.md`.
- Extend `autoCommit` spec with `maxPendingBytes` size-trigger.
- Define OR semantics for periodic + size triggers.
- Define crash-safe durable commit ordering and restart recovery rules.

3. B+ tree index invariants

- Add `docs/specs/11_BTreeIndexInvariants.md`.
- Define logical key tuple `(timestamp_i64, insertion_order_u64)`.
- Define occupancy/root exceptions, split/merge invariants, and linked-leaf invariants.

4. Query parity and field-path escaping

- Update query-engine specs to define `QueryExecutionOptions` interop.
- Clarify SQL conflict behavior versus options.
- Clarify Lucene options mapping contract.
- Standardize canonical path escaping for `.` and `\\` in one key segment.

## Consequences

Positive:

- closes previously identified spec gaps with implementation-ready contracts
- reduces ambiguity for TDD cases in retention, flush scheduling, recovery, and query translation
- improves cross-language determinism for SQL/Lucene behavior

Trade-off:

- API/config surface in docs becomes broader before all milestones are implemented
- implementation teams must preserve backward compatibility with these contracts during rollout
