# ADR-38: Roadmap Phase Model and Plans Authority for Live Status

Status: Accepted  
Date: 2026-03-07

## Context

After introducing `docs/plans/01_DevelopmentStatusChecklist.md` (ADR-35),
`docs/architecture/development-roadmap.md` still included live "current focus"
and checkbox-style task tracking.

This caused partial overlap and occasional conflict between:

- phase/task status in roadmap
- current execution status in `docs/plans`

The overlap made ownership unclear during daily updates.

## Decision

- Keep `docs/architecture/development-roadmap.md` as a stable phase model and governance document.
- Keep live progress and active work-item interpretation in `docs/plans/`.
- Define document precedence for overlap resolution:
  1. ADR (`docs/adr/`)
  2. Normative specs (`docs/specs/`)
  3. Execution status and work-item plans (`docs/plans/`)
  4. Roadmap phase model (`docs/architecture/development-roadmap.md`)
- If roadmap and plans conflict on current status, `docs/plans/` is authoritative.

## Consequences

Positive:

- single place for day-to-day status updates
- reduced risk of contradictory checkboxes across architecture/plans docs
- roadmap can remain stable and easier to review as governance

Trade-off:

- contributors must keep two doc types intentionally separate (model vs. status)
