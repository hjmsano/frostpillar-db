# ADR-39: Dedicated M2 File Durability Completion Plan

Status: Accepted  
Date: 2026-03-07

## Context

ADR-37 started a combined `Phase 2 + Phase 3 kickoff` to move implementation quickly.
That kickoff established a useful baseline, but ADR-01 M2 obligations were not tracked
as an explicit completion checklist item-by-item.

Gap examples:

- explicit corrupt-header and unsupported-version failure coverage
- explicit lock release and reopen proof after `close()`
- explicit durable default auto-commit (`frequency: "immediate"`) validation

Without a dedicated M2 closure artifact, these requirements can be missed while
Phase 3 tasks expand.

## Decision

- Introduce a dedicated M2 completion work item:
  `docs/plans/04_PhaseWorkItem_M2_FileDurabilitySlice.md`.
- Set active execution snapshot to M2 completion until these obligations are closed.
- Keep `docs/plans/03_PhaseWorkItem_P2P3_FileDurability_and_QueryCapacityKickoff.md`
  as historical kickoff context and reference it as prior baseline work.

## Consequences

Positive:

- ADR-01 M2 obligations are tracked explicitly with TDD-first checkpoints.
- reduces risk of advancing Phase 3 while M2 durability obligations remain implicit.
- improves review clarity by separating kickoff baseline from completion requirements.

Trade-off:

- one additional planning document must be maintained in `docs/plans/`.
