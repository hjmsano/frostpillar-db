# Plan: Phase Work Item (M1 Memory Vertical Slice)

Status: Draft  
Version: 0.1 planning  
Last Updated: 2026-03-06

## 1. Purpose

This planning document defines the first implementation target for the early coding phase.
It converts the phase roadmap into one concrete, execution-ready work item.

## 2. Scope

In scope:

- `Phase 1: Memory Vertical Slice` execution start
- memory-backed public API baseline behavior (`insert`, `select`, `commit`, `on/off("error")`, `close`)
- deterministic ordering and closed-state behavior required by existing core specs
- explicit TDD red-test plan before implementation

Out of scope:

- file-backend durability implementation details
- browser-backend implementation
- optional SQL/Lucene engine integration behavior
- post-`v0.1` mutation APIs (`getById`, `updateById`, `deleteById`)

## 3. Execution Requirements

- The current active implementation phase MUST be `Phase 1: Memory Vertical Slice`.
- In this work item, version target MUST remain aligned to `v0.1` short-term scope from `docs/adr/01_DevelopmentPlan.md`.
- Contributors MUST NOT implement `v0.2`-planned APIs in this work item.
- Contributors MUST follow workflow order defined by `docs/specs/12_DevelopmentWorkflow.md`:
  intent alignment -> spec update -> failing tests -> implementation -> verification.
- Implementation scope MUST stay within modules required for memory-vertical-slice behavior and MUST avoid unrelated refactors.

## 4. Acceptance Criteria

- `new Datastore({ location: "memory" })` initialization works with async-only contract.
- `insert(...)` accepts valid timestamp inputs and rejects invalid timestamp/payload boundaries according to current specs.
- `select({ start, end })` returns inclusive-range results in deterministic `(timestamp, insertion-order)` order.
- `commit()` resolves safely for memory backend baseline behavior.
- `close()` transitions datastore to closed state and subsequent operations fail with typed closed-state error.
- Public API shape remains limited to `v0.1` baseline surface for this phase.

## 5. Failing Tests (TDD Red)

Before implementation, add failing tests that codify the clauses above:

- `tests/core/datastore-memory-contract.test.mjs`
  - memory initialization and config boundary checks
  - `insert/select` baseline behavior and deterministic ordering
  - closed-state failure checks after `close()`
- `tests/core/datastore-memory-validation-boundaries.test.mjs`
  - timestamp normalization and invalid timestamp rejection
  - payload boundary checks required by current specs
- `tests/core/datastore-memory-commit-baseline.test.mjs`
  - memory `commit()` baseline resolution semantics

Each test MUST fail first for the expected reason before implementation starts.

## 6. Verification Gate

Work item completion requires:

- targeted new tests pass
- full suite passes (`pnpm test --run`)
- quality gate passes (`pnpm check`)
- related docs remain aligned (`docs/specs`, `docs/plans`, `docs/usage` EN/JA when user-visible, and ADR when decisions change)
