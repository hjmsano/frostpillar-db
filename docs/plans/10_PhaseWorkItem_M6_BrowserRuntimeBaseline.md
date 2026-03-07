# Plan: Phase Work Item (M6 Browser Runtime Baseline)

Status: Active  
Version: v0.2 execution  
Last Updated: 2026-03-07

## 1. Purpose

This work item starts the post-v0.1 direction defined by ADR-51:

- browser backend runtime support first

Primary goal:

- establish a test-proven first browser runtime baseline before any mutation-API expansion

## 2. Scope

In scope:

- initial browser runtime backend support kickoff under `location: "browser"`
- runtime-availability selection and typed failure semantics
- first persistence baseline for browser runtime slice (localStorage-first)
- EN/JA usage updates for browser runtime status and constraints
- plans/checklist synchronization for active post-v0.1 execution

Out of scope:

- `getById` / `updateById` / `deleteById` public API expansion
- browser performance tuning beyond correctness baseline
- multi-backend browser parity completion in one step

## 3. Execution Requirements

- Contributors MUST follow workflow order:
  intent alignment -> spec update -> failing tests -> implementation -> verification.
- Browser runtime work MUST align with:
  - `docs/adr/51_v0.2_Direction_BrowserBackendFirst_After_M5_ReleaseHardening.md`
  - `docs/specs/04_DatastoreAPI.md`
  - `docs/testing/strategy.md`
- Implementation MUST keep typed error semantics explicit.
- Implementation MUST avoid unrelated runtime refactors.

## 4. Acceptance Criteria

- browser runtime baseline scope is explicitly defined and test-backed
- at least one browser backend runtime path is executable and persisted across reopen
- typed availability failures remain explicit for unsupported/unavailable backends
- usage docs in EN/JA describe current browser runtime status and constraints
- active plans/checklists remain synchronized

## 5. Phased Work Breakdown

### Phase A: Scope and Criteria Alignment

- [x] activate dedicated M6 work-item plan and checklist snapshot
- [ ] define first browser runtime slice target and non-goals
- [ ] align spec clauses for runtime availability and persistence baseline

### Phase B: TDD Red

- [ ] add failing browser runtime baseline tests under `tests/core/`
- [ ] add failing docs-sync test for M6 plan/checklist alignment
- [ ] confirm expected red failures before implementation

### Phase C: Implementation (Green)

- [ ] implement initial browser runtime baseline (localStorage-first)
- [ ] keep unsupported browser backends failing with typed `UnsupportedBackendError`
- [ ] update EN/JA usage docs and plan/checklist synchronization

### Phase D: Verification and Closure

- [ ] targeted M6 tests pass
- [ ] full suite passes (`pnpm test --run`)
- [ ] quality gate passes (`pnpm check`)
- [ ] status checklist marks M6 baseline criteria complete

## 6. Verification Gate

Work item completion requires:

- targeted M6 tests pass
- full suite passes (`pnpm test --run`)
- quality gate passes (`pnpm check`)
- docs/specs/plans/usage EN/JA and ADR remain aligned
