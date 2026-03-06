# Plan: Phase Work Item (M2 File Durability Slice)

Status: Completed  
Version: 0.2 execution  
Last Updated: 2026-03-07

## 1. Purpose

This work item defines the dedicated completion plan for `M2` from
`docs/adr/01_DevelopmentPlan.md`.
It closes durability obligations that were not explicitly tracked in the mixed
`P2/P3 kickoff` plan.

## 2. Scope

In scope:

- file-backend open/close durability correctness completion
- sidecar/header validation hardening (`magic`, `version`, `activeDataFile`)
- explicit lock lifecycle proof:
  - conflict failure while locked
  - lock release on `close()` and reopen success
- durable-backend default auto-commit behavior proof (`frequency: "immediate"`)
- restart path validation for sidecar/page-0 mirror consistency and insertion-order continuity

Out of scope:

- Phase 3 query and capacity hardening tasks
- browser backend implementation
- full SQL/Lucene parser implementation
- post-`v0.2` API expansion

## 3. Execution Requirements

- Contributors MUST follow workflow order:
  intent alignment -> spec update -> failing tests -> implementation -> verification.
- Durability/open semantics MUST align with:
  - `docs/specs/04_DatastoreAPI.md`
  - `docs/specs/10_FlushAndDurability.md`
  - `docs/specs/03_PageStructure.md`
- This work item MUST close remaining M2 obligations before additional Phase 3 expansion.
- Implementation MUST avoid unrelated refactors.

## 4. Acceptance Criteria

- file backend open rejects corrupt-header and unsupported-version sidecar states with typed storage corruption errors.
- file backend open rejects sidecar `activeDataFile` mismatch/missing targets with typed storage corruption errors.
- concurrent open from independent instances/processes fails fast with `DatabaseLockedError`.
- after successful `close()`, lock ownership is released and a new instance can reopen successfully.
- with durable backends, omitted `autoCommit` and `autoCommit: {}` both default to effective `frequency: "immediate"`.
- restart preserves persisted records and resumes `nextInsertionOrder` without full data scan dependency.

## 5. Failing Tests (TDD Red)

Before implementation, add failing tests that codify the clauses above:

- `tests/core/datastore-file-durability-slice.test.mjs`
  - sidecar corrupt-header and unsupported-version failures
  - missing/invalid `activeDataFile` corruption failure
  - lock conflict across independent process/instance paths
  - lock release and reopen success after `close()`
- `tests/core/datastore-file-autocommit-defaults.test.mjs`
  - durable default auto-commit behavior (`frequency: "immediate"`) when omitted
  - durable default auto-commit behavior when `autoCommit: {}` is provided

Each test MUST fail first for expected reasons before implementation.

## 6. Verification Gate

Work item completion requires:

- targeted new tests pass
- full suite passes (`pnpm test --run`)
- quality gate passes (`pnpm check`)
- related docs remain aligned (`docs/specs`, `docs/plans`, `docs/usage` EN/JA when user-visible, and ADR when decisions change)

## 7. Gap-Closure Additions from ADR-01 Cross-Check

The following M2 obligations are explicitly tracked in this plan because they were
not fully explicit in prior kickoff planning artifacts:

- corrupt-header and unsupported-version failure coverage
- lock release and reopen success proof after `close()`
- default auto-commit behavior validation for durable backends

## 8. Completion Tracking (2026-03-07)

- [x] spec clarifications updated for durable auto-commit default equivalence (`autoCommit` omitted / `{}`).
- [x] failing tests added first and confirmed red for file auto-commit defaults.
- [x] implementation updated to honor durable immediate default when `autoCommit` is omitted or `{}`.
- [x] sidecar corruption tests added for corrupt-header and unsupported-version.
- [x] independent-process lock conflict and post-`close()` reopen lifecycle verified.
- [x] sidecar/page-0 mirrored metadata mismatch failure path verified.
- [x] restart insertion-order continuity verified from sidecar `nextInsertionOrder`.
- [x] verification gate passed:
  - targeted: `pnpm test --run tests/core/datastore-file-durability-slice.test.mjs tests/core/datastore-file-autocommit-defaults.test.mjs`
  - full: `pnpm test --run`
  - quality: `pnpm check`
