# Plan: Phase Work Item (P0 Foundation Sync Governance Closure)

Status: Completed  
Version: 0.2 execution  
Last Updated: 2026-03-07

## 1. Purpose

This work item closes remaining Phase 0 governance obligations that are still open in
`docs/plans/01_DevelopmentStatusChecklist.md`.

Primary goal:

- make governance checks executable and consistently enforced for every feature PR

## 2. Scope

In scope:

- PR-level phase-gate checklist enforcement template
- docs reference consistency guardrails for `docs/specs`, `docs/adr`, and their indexes
- explicit alignment rules between development workflow docs and testing strategy docs
- status checklist closure for remaining Phase 0 items

Out of scope:

- browser backend runtime implementation
- new datastore API features
- changes to existing Phase 1-4 runtime behavior semantics

## 3. Execution Requirements

- Contributors MUST follow workflow order:
  intent alignment -> spec update -> failing tests -> implementation -> verification.
- Governance behavior MUST align with:
  - `docs/specs/12_DevelopmentWorkflow.md`
  - `docs/testing/strategy.md`
  - `docs/architecture/development-roadmap.md`
- Architectural/process policy changes MUST be captured in ADR updates.
- Implementation MUST avoid unrelated refactors.

## 4. Acceptance Criteria

- feature PR template includes explicit phase-gate checklist items
- docs index/reference consistency is test-backed
- workflow/testing-strategy alignment rules are explicit and test-backed
- all remaining Phase 0 checklist items are complete and traceable to tests/docs

## 5. Phased Work Breakdown

### Phase A: Spec and Criteria Alignment

- [x] add governance enforcement clauses to workflow spec (`docs/specs/12_DevelopmentWorkflow.md`)
- [x] align testing strategy wording with canonical workflow order and verification commands
- [x] align usage workflow docs (EN/JA) with governance obligations
- [x] record process-level decision in ADR

### Phase B: TDD Red (Failing Tests First)

- [x] add `tests/specs/p0-foundation-governance-closure-docs.test.mjs`
- [x] add `tests/tooling/pull-request-template-phase-gate.test.mjs`
- [x] add `tests/tooling/docs-index-consistency.test.mjs`
- [x] confirm expected red failures before implementation

### Phase C: Implementation (Green)

- [x] add `.github/pull_request_template.md` with mandatory phase-gate checklist
- [x] implement docs index consistency guardrails (test-backed)
- [x] update plans/checklist and workflow/testing docs to close remaining Phase 0 items
- [x] add ADR-50 and ADR index entry

### Phase D: Verification and Closure

- [x] targeted governance tests pass
- [x] full suite passes (`pnpm test --run`)
- [x] quality gate passes (`pnpm check`)
- [x] Phase 0 checklist closure marked complete

## 6. Verification Gate

Work item completion requires:

- targeted governance tests pass
- full suite passes (`pnpm test --run`)
- quality gate passes (`pnpm check`)
- docs/specs/plans/ADR remain aligned

## 7. Completion Notes (2026-03-07)

- Added governance tests:
  - `tests/specs/p0-foundation-governance-closure-docs.test.mjs`
  - `tests/tooling/pull-request-template-phase-gate.test.mjs`
  - `tests/tooling/docs-index-consistency.test.mjs`
- Added required PR checklist template:
  - `.github/pull_request_template.md`
- Added governance ADR:
  - `docs/adr/50_Phase0_GovernanceClosure_PRTemplate_and_DocsIndexGuards.md`
- Verification commands:
  - `pnpm test --run tests/specs/p0-foundation-governance-closure-docs.test.mjs tests/tooling/pull-request-template-phase-gate.test.mjs tests/tooling/docs-index-consistency.test.mjs`
  - `pnpm test --run`
  - `pnpm check`
