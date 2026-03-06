# Current Development Phases and Task Breakdown

Status: Draft  
Last Updated: 2026-03-06

This document provides an executable, task-level plan for the next implementation cycles.
It operationalizes `docs/adr/01_DevelopmentPlan.md` and `docs/specs/12_DevelopmentWorkflow.md`.

## Current Focus (2026-03-06)

- Active phase: `Phase 1: Memory Vertical Slice`
- Scope lock: immediate coding target is `v0.1` deliverables only
- Work-item plan: `docs/plans/01_PhaseWorkItem_M1_MemoryVerticalSlice.md`
- Decision record: `docs/adr/32_ActivePhase_M1_and_v0.1_ScopeLock.md`

## Phase 0: Foundation Sync

Goal: Ensure execution discipline and baseline quality gates are stable.

Entry criteria:

- baseline toolchain commands are available
- workflow spec and templates are published

Tasks:

- [ ] confirm `docs/specs` and `docs/adr` references are consistent in new changes
- [ ] enforce phase-gate checklist in every feature PR
- [ ] keep test strategy and workflow docs aligned

Exit criteria:

- every new work item follows intent -> spec -> tests -> implementation -> verification

## Phase 1: Memory Vertical Slice

Goal: Keep memory-backend behavior deterministic and ready as reference implementation.

Entry criteria:

- Phase 0 exit criteria met

Tasks:

- [ ] close any remaining gaps between `docs/specs/01..04` and current memory behavior
- [ ] add boundary tests for record validation, range query edges, and ordering stability
- [ ] document unresolved ambiguities as ADR candidates

Exit criteria:

- memory flow is spec-aligned with deterministic test coverage

## Phase 2: File Durability Slice

Goal: Hard proof of durable correctness through open/commit/reopen cycles.

Entry criteria:

- memory vertical slice is stable

Tasks:

- [ ] expand failure-path tests for lock, corruption, and interrupted commit recovery
- [ ] verify sidecar metadata consistency across restart paths
- [ ] ensure usage docs include practical file-backend troubleshooting in EN/JA

Exit criteria:

- durability and lock semantics are test-proven and documented

## Phase 3: Query and Capacity Hardening

Goal: Reduce ambiguity in query semantics and bounded-capacity behavior.

Entry criteria:

- file durability slice is stable

Tasks:

- [ ] add parity tests across native, SQL subset, and Lucene subset query paths
- [ ] strengthen capacity-boundary tests for strict/turnover policy edges
- [ ] add regression suites for scheduler coalescing and error-channel propagation

Exit criteria:

- query and capacity behavior stays deterministic under mixed workloads

## Phase Governance

For every phase:

- start only with explicit entry criteria
- track tasks with checkboxes and dates in PR notes
- close only when exit criteria and quality gates are met

## Reporting Format (per work item)

Use this mini report in PR descriptions:

- phase: `<phase id>`
- spec delta: `<changed spec files>`
- red tests: `<new failing tests first>`
- implementation scope: `<files/modules>`
- verification: `<commands + results>`
- docs/adr updates: `<changed docs>`
