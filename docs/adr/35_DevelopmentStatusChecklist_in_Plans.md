# ADR-35: Development Status Checklist Location in `docs/plans`

Status: Accepted  
Date: 2026-03-07

## Context

Development progress tracking existed in multiple places:

- phase tasks in `docs/architecture/development-roadmap.md`
- work-item details in `docs/plans/02_PhaseWorkItem_M1_MemoryVerticalSlice.md`
- workflow/session checklist in `docs/usage/03_DevelopmentWorkflow.md`

This made it harder to answer a simple question: "What is the current status of development?"
We needed one canonical checklist document dedicated to execution status.

## Decision

Adopt `docs/plans/01_DevelopmentStatusChecklist.md` as the canonical status checklist.

- Keep high-level phase/task definition in `docs/architecture/development-roadmap.md`.
- Keep work-item specification and acceptance criteria in per-item plan files.
- Use the status checklist file as the single place to mark execution progress.
- Link roadmap current-focus section to the status checklist for discovery.

## Consequences

Positive:

- one clear place to inspect and update progress
- easier status handoff between contributors
- lower risk of conflicting status interpretation across docs

Trade-off:

- one additional planning artifact to keep updated
