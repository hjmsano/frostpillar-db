# Plan: Phase Work Item (P3 Scheduler Coalescing and Error-Channel Regression)

Status: Completed  
Version: 0.2 execution  
Last Updated: 2026-03-07

## 1. Purpose

This work item closes the remaining Phase 3 item from
`docs/plans/01_DevelopmentStatusChecklist.md`:

- regression suites for scheduler coalescing and error-channel propagation

## 2. Scope

In scope:

- periodic auto-commit coalescing behavior while one commit is in flight
- background auto-commit failure propagation through datastore `"error"` event channel
- retry readiness after background commit failure (pending dirty state stays queued)
- close-path behavior that waits active commit attempt settlement before resource release

Out of scope:

- browser backend implementation
- new user-facing API additions
- distribution track (P4) implementation

## 3. Execution Requirements

- Contributors MUST follow workflow order:
  intent alignment -> spec update -> failing tests -> implementation -> verification.
- Behavior MUST align with:
  - `docs/specs/04_DatastoreAPI.md`
  - `docs/specs/10_FlushAndDurability.md`
  - `docs/testing/strategy.md`
- Public API signatures MUST remain unchanged.
- No new npm packages may be introduced.

## 4. Acceptance Criteria

- at most one active file-backend commit execution is active at any time
- if trigger fires during in-flight commit, one follow-up commit runs after settle when pending changes remain
- each failed background commit attempt emits exactly one datastore `"error"` event
- emitted background error uses `StorageEngineError` in `DatastoreErrorEvent.error`
- failed background attempt keeps pending dirty state for subsequent trigger retry
- `close()` waits active commit settlement before releasing file lock and resolving

## 5. Phased Work Breakdown

### Phase A: Spec and Criteria Alignment

- [x] update flush/API spec clauses for coalescing and retry semantics
- [x] update EN/JA usage notes for observable auto-commit behavior
- [x] record architecture-level implementation decision in ADR

### Phase B: TDD Red

- [x] add failing coalescing regression test under `tests/core/`
- [x] add failing error-channel propagation/retry regression test under `tests/core/`
- [x] run targeted tests and confirm red before implementation

### Phase C: Implementation (Green)

- [x] update file backend controller commit scheduler/coalescing logic
- [x] ensure close-path waits active commit settlement
- [x] keep foreground (`insert`/`commit`) rejection contract unchanged

### Phase D: Verification and Closure

- [x] targeted regression tests pass
- [x] full suite passes (`pnpm test --run`)
- [x] quality gate passes (`pnpm check`)
- [x] status checklist updated

## 6. Verification Gate

Work item completion requires:

- targeted tests pass
- full suite passes (`pnpm test --run`)
- quality gate passes (`pnpm check`)
- docs/specs/plans/ADR remain aligned

## 7. Completion Notes (2026-03-07)

- Added scheduler/error regression tests:
  - `tests/core/datastore-file-autocommit-scheduler.test.mjs`
  - `tests/specs/p3-scheduler-coalescing-docs.test.mjs`
- File backend controller now enforces single in-flight commit with coalesced follow-up requests.
- Background commit failures emit one error event per failed attempt and preserve pending dirty state for retry.
- `close()` now waits active commit settlement before lock/resource release.
- Verification commands:
  - `pnpm test --run tests/core/datastore-file-autocommit-scheduler.test.mjs tests/specs/p3-scheduler-coalescing-docs.test.mjs`
  - `pnpm test --run`
  - `pnpm check`
