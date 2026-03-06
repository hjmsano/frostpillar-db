# Plan: Development Status Checklist

Status: Draft  
Version: 0.1 planning  
Last Updated: 2026-03-07

## 1. Purpose

This document is the canonical, single-page checklist for active development status.
Use it to track progress across phases and the currently active work item.

## 2. Update Rules

- Update this file when a task starts, completes, or is intentionally deferred.
- A checkbox can be marked complete only after the workflow gate is satisfied:
  spec update -> failing tests -> implementation -> verification.
- Keep this file aligned with:
  - `docs/architecture/development-roadmap.md`
  - `docs/plans/02_PhaseWorkItem_M1_MemoryVerticalSlice.md`
  - relevant ADRs when decisions change.

## 3. Current Snapshot (2026-03-07)

- Active phase: `Phase 1: Memory Vertical Slice`
- Active work item: `docs/plans/02_PhaseWorkItem_M1_MemoryVerticalSlice.md`
- Scope lock: `v0.1` deliverables only (ADR-32)

## 4. Phase Status Checklist

### Phase 0: Foundation Sync

- [x] baseline toolchain commands are available
- [x] workflow spec and templates are published
- [ ] confirm `docs/specs` and `docs/adr` references are consistent in new changes
- [ ] enforce phase-gate checklist in every feature PR
- [ ] keep test strategy and workflow docs aligned
- [ ] exit criteria met: every new work item follows intent -> spec -> tests -> implementation -> verification

### Phase 1: Memory Vertical Slice

- [x] phase declared active with explicit scope lock (ADR-32)
- [x] close remaining gaps between `docs/specs/01..04` and current memory behavior
- [x] add boundary tests for record validation, range query edges, and ordering stability
- [x] document unresolved ambiguities as ADR candidates
- [x] exit criteria met: memory flow is spec-aligned with deterministic test coverage

### Phase 2: File Durability Slice

- [ ] expand failure-path tests for lock, corruption, and interrupted commit recovery
- [ ] verify sidecar metadata consistency across restart paths
- [ ] ensure usage docs include practical file-backend troubleshooting in EN/JA
- [ ] exit criteria met: durability and lock semantics are test-proven and documented

### Phase 3: Query and Capacity Hardening

- [ ] add parity tests across native, SQL subset, and Lucene subset query paths
- [ ] strengthen capacity-boundary tests for strict/turnover policy edges
- [ ] add regression suites for scheduler coalescing and error-channel propagation
- [ ] exit criteria met: query and capacity behavior stays deterministic under mixed workloads

## 5. Active Work-Item Checklist (M1)

Use this section as the day-to-day completion board for the current work item.

- [x] memory init contract validated
- [x] insert/select deterministic ordering validated
- [x] timestamp and payload boundary validation completed
- [x] memory `commit()` baseline semantics completed
- [x] closed-state failure behavior completed
- [x] quality gates green: `pnpm test --run` and `pnpm check`
- [x] related docs updated (`docs/specs`, `docs/plans`, usage EN/JA when user-visible)
- [x] ADR updated if architecture-level decisions were introduced
