# ADR-50: Phase 0 Governance Closure with PR Template and Docs Index Guards

Status: Accepted  
Date: 2026-03-07

## Context

After Phase 4 delivery closure, the status checklist still had open Phase 0 governance items:

- enforce phase-gate checklist in every feature PR
- confirm `docs/specs` and `docs/adr` references are consistent in new changes
- keep testing strategy and workflow docs aligned

These are process-critical quality controls and must be executable, not aspirational text.

## Decision

Adopt explicit, test-backed governance controls:

- add mandatory feature PR template at `.github/pull_request_template.md`
  with phase-gate checklist items aligned to workflow spec order
- require index consistency checks for:
  - `docs/specs/INDEX.md`
  - `docs/adr/INDEX.md`
- align workflow/testing-strategy command and step-order language around:
  - `intent alignment -> spec update -> failing tests -> implementation -> verification`
  - `pnpm test --run`
  - `pnpm check`

Verification is enforced by dedicated tests for:

- PR template checklist content
- docs index file coverage consistency
- Phase 0 plan/checklist closure state

## Consequences

Positive:

- every feature PR gets explicit TDD/spec/docs/ADR checkpoints
- doc-index drift for specs/ADRs becomes detectable by tests
- workflow and testing governance language stays synchronized

Trade-off:

- contributors must maintain PR template and index files with document changes
- governance-oriented tests increase documentation maintenance obligations
