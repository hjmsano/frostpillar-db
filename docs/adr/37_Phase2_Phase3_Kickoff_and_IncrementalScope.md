# ADR-37: Phase 2 and Phase 3 Kickoff with Incremental Scope

Status: Accepted  
Date: 2026-03-07

## Context

Phase 1 (memory vertical slice) completion provides a stable baseline, but remaining roadmap
work for durability and query/capacity hardening is still pending.

Team request is to start Phase 2 and Phase 3 immediately without pausing between sub-steps,
while preserving the mandatory workflow order and quality gates.

## Decision

- Start a combined kickoff work item for:
  - `Phase 2: File Durability Slice`
  - `Phase 3: Query and Capacity Hardening`
- Keep implementation incremental:
  - first establish file durability/lock/restart baseline
  - then add query-integration and capacity hardening baseline
- Require each behavior delta to remain TDD-first:
  spec update -> failing tests -> implementation -> verification.

## Alternatives Considered

1. Keep strict single-phase sequencing (finish all Phase 2 before any Phase 3 work).
2. Start browser backend together with file backend.

## Consequences

Positive:

- improves delivery flow by parallelizing planning while keeping implementation slices small
- reduces idle time between phase boundaries
- keeps deterministic verification as the merge gate

Trade-off:

- checklist management becomes more important to avoid mixing incomplete tasks across phases
