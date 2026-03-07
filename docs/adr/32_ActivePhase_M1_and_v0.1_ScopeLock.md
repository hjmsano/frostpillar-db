# ADR-32: Active Phase M1 and v0.1 Scope Lock

Status: Superseded (Superseded by ADR-51)  
Date: 2026-03-06

## Context

The repository contains mature draft specifications, but implementation has not started.
Current docs include both `v0.1` short-term delivery commitments and `v0.2` planned API content.
Before coding starts, the team needs one explicit execution focus to prevent scope drift.

Superseded by ADR-51.
This ADR remains as historical evidence for initial M1 scope-lock decisions.

## Decision

- Set the current active implementation phase to `Phase 1` (`Memory Vertical Slice`).
- lock immediate implementation scope to `v0.1` deliverables defined in `docs/adr/01_DevelopmentPlan.md`.
- treat `v0.2`-planned sections as forward-looking references only for this phase.
- require each new coding task to have one explicit work-item artifact with acceptance criteria and red-test plan.

## Alternatives Considered

1. Start with file durability (`Phase 2`) immediately.
2. Implement selected `v0.2` APIs in parallel with `v0.1` scope.

## Consequences

Positive:

- reduces early-phase ambiguity and prevents parallel scope expansion
- keeps TDD cycles smaller and easier to verify
- aligns roadmap sequencing with the shortest path to a trustworthy first release

Trade-off:

- some already-specified `v0.2` capabilities remain intentionally unimplemented in the initial coding phase
