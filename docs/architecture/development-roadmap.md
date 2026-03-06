# Development Phase Model and Governance

Status: Draft  
Last Updated: 2026-03-07

This document defines the stable phase model, entry/exit gates, and governance rules.
It operationalizes `docs/adr/01_DevelopmentPlan.md` and `docs/specs/12_DevelopmentWorkflow.md`.

## Document Role

- This file is not the live progress board.
- Live status, active phase snapshot, and checkbox tracking are maintained in
  `docs/plans/01_DevelopmentStatusChecklist.md`.
- Active execution scope and acceptance criteria are maintained in the active work-item file
  under `docs/plans/`.

## Source-of-Truth Order

If documents partially overlap, resolve in this order:

1. ADR decisions under `docs/adr/`
2. Normative product behavior in `docs/specs/`
3. Execution status and active work-item scope in `docs/plans/`
4. Phase model and governance in this file

When this file conflicts with `docs/plans/` about current status, `docs/plans/` is authoritative.
Update this file only when the phase model or governance itself changes.

## Phase 0: Foundation Sync

Goal: Ensure execution discipline and baseline quality gates are stable.

Entry criteria:

- baseline toolchain commands are available
- workflow spec and templates are published

Expected activities:

- confirm `docs/specs` and `docs/adr` references are consistent in new changes
- enforce phase-gate checklist in every feature PR
- keep test strategy and workflow docs aligned

Exit criteria:

- every new work item follows intent -> spec -> tests -> implementation -> verification

## Phase 1: Memory Vertical Slice

Goal: Keep memory-backend behavior deterministic and ready as reference implementation.

Entry criteria:

- Phase 0 exit criteria met

Expected activities:

- close any remaining gaps between `docs/specs/01..04` and current memory behavior
- add boundary tests for record validation, range query edges, and ordering stability
- document unresolved ambiguities as ADR candidates

Exit criteria:

- memory flow is spec-aligned with deterministic test coverage

## Phase 2: File Durability Slice

Goal: Hard proof of durable correctness through open/commit/reopen cycles.

Entry criteria:

- memory vertical slice is stable

Expected activities:

- expand failure-path tests for lock, corruption, and interrupted commit recovery
- verify sidecar metadata consistency across restart paths
- ensure usage docs include practical file-backend troubleshooting in EN/JA

Exit criteria:

- durability and lock semantics are test-proven and documented

## Phase 3: Query and Capacity Hardening

Goal: Reduce ambiguity in query semantics and bounded-capacity behavior.

Entry criteria:

- file durability slice is stable

Expected activities:

- add parity tests across native, SQL subset, and Lucene subset query paths
- strengthen capacity-boundary tests for strict/turnover policy edges
- add regression suites for scheduler coalescing and error-channel propagation

Exit criteria:

- query and capacity behavior stays deterministic under mixed workloads

## Phase 4: Distribution Delivery Tracks

Goal: Make Frostpillar shippable through both package-manager and browser-first delivery styles.

Entry criteria:

- Phase 3 exit criteria met

Expected activities:

- harden installable NPM package delivery contract
- produce browser bundle artifacts for at least `core` profile
- define and document bundle profile matrix (`core`, adapter-specific, or `full-browser`)
- add smoke verification for NPM install/import and browser bundle load paths

Exit criteria:

- dual-track delivery artifacts are test-proven and documented in EN/JA usage docs
- delivery policy and execution plan stay aligned with spec/ADR/plans artifacts

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
