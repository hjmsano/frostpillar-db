# ADR-33: Separate Planning Documents from Specifications

Status: Accepted  
Date: 2026-03-06

## Context

The file `docs/specs/13_EarlyPhaseWorkItem_M1_MemoryVerticalSlice.md` was being used as a phased execution plan.
This caused taxonomy ambiguity because `docs/specs` is intended to contain normative product specifications.

## Decision

- Create a dedicated planning directory at `docs/plans`.
- Move and rename the M1 work-item document to `docs/plans/02_PhaseWorkItem_M1_MemoryVerticalSlice.md`.
- Keep `docs/specs` limited to normative feature and behavior specifications.
- Update roadmap and index references to point planning artifacts to `docs/plans`.

## Alternatives Considered

1. Keep the work-item plan in `docs/specs` and add a naming disclaimer.
2. Move planning docs into `docs/architecture`.

## Consequences

Positive:

- improves document intent clarity for contributors
- avoids mixing normative specs and execution plans
- makes phased/tasked planning artifacts easier to discover

Trade-off:

- introduces one more top-level docs directory to maintain in indexes
