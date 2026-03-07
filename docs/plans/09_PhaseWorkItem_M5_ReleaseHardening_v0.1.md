# Plan: Phase Work Item (M5 Release Hardening v0.1)

Status: Active  
Version: 0.2 execution  
Last Updated: 2026-03-07

## 1. Purpose

This work item starts the M5 scope from `docs/adr/01_DevelopmentPlan.md`.

Primary goal:

- close release hardening requirements for a trustworthy `v0.1`

## 2. Scope

In scope:

- performance baseline report (method + measured results + environment metadata)
- reproducible benchmark script and execution contract
- release-readiness regression verification across memory and file backends
- documentation refresh for explicit v0.1 limitations and non-goals
- explicit post-v0.1 direction alignment with ADR-51

Out of scope:

- new runtime features for browser backends
- new public mutation/query APIs beyond current runtime slice
- npm publishing credential/process automation

## 3. Execution Requirements

- Contributors MUST follow workflow order:
  intent alignment -> spec update -> failing tests -> implementation -> verification.
- Release-hardening behavior MUST align with:
  - `docs/adr/01_DevelopmentPlan.md`
  - `docs/testing/strategy.md`
  - `docs/specs/12_DevelopmentWorkflow.md`
- Architectural/process direction changes MUST be captured in ADR updates.
- Implementation MUST avoid unrelated runtime refactors.

## 4. Acceptance Criteria

- performance baseline report is published with dataset shape, commands, and environment notes
- reproducible benchmark script is committed and runnable by contributors
- release-readiness verification commands are documented and green
- README and usage docs (EN/JA) explicitly document v0.1 limitations and non-goals
- active plans/checklists and ADR references are synchronized

## 5. Phased Work Breakdown

### Phase A: Scope and Criteria Alignment

- [x] activate dedicated M5 work-item plan and status-checklist snapshot
- [x] align ADR status/history and record explicit v0.2 direction (ADR-51)
- [ ] define benchmark dataset shapes and pass/fail interpretation policy

### Phase B: TDD Red

- [ ] add failing docs/spec tests for benchmark-method contract and v0.1 limitations coverage
- [ ] add failing verification test for release-readiness checklist synchronization
- [ ] confirm expected red failures before implementation

### Phase C: Implementation (Green)

- [ ] implement benchmark script and baseline-report documentation
- [ ] update README + usage EN/JA with v0.1 limitations and non-goals
- [ ] update checklist/plan/ADR artifacts to match implemented release-hardening state

### Phase D: Verification and Closure

- [ ] targeted M5 tests pass
- [ ] full suite passes (`pnpm test --run`)
- [ ] quality gate passes (`pnpm check`)
- [ ] status checklist marks M5 exit criteria complete

## 6. Verification Gate

Work item completion requires:

- targeted M5 tests pass
- full suite passes (`pnpm test --run`)
- quality gate passes (`pnpm check`)
- docs/specs/plans/usage EN/JA and ADR remain aligned
