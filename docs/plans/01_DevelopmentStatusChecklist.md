# Plan: Development Status Checklist

Status: Draft  
Version: 0.2 planning  
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
  - active work-item plan under `docs/plans/`
  - relevant ADRs when decisions change.
- Treat this file and active work-item files in `docs/plans/` as the canonical source
  for current status.
- If status statements conflict with `docs/architecture/development-roadmap.md`,
  this file takes precedence for execution tracking.

## 3. Current Snapshot (2026-03-07)

- Active phase: `M6: Browser Runtime Baseline (active)`
- Active work item: `docs/plans/10_PhaseWorkItem_M6_BrowserRuntimeBaseline.md (active)`
- Scope note: Post-v0.1 direction from ADR-51 is now active; execution starts with browser backend runtime support before mutation API expansion.

## 4. Phase Status Checklist

### Phase 0: Foundation Sync

- [x] baseline toolchain commands are available
- [x] workflow spec and templates are published
- [x] confirm `docs/specs` and `docs/adr` references are consistent in new changes
- [x] enforce phase-gate checklist in every feature PR
- [x] keep test strategy and workflow docs aligned
- [x] exit criteria met: every new work item follows intent -> spec -> tests -> implementation -> verification

### Phase 1: Memory Vertical Slice

- [x] phase declared active with explicit scope lock (ADR-32)
- [x] close remaining gaps between `docs/specs/01..04` and current memory behavior
- [x] add boundary tests for record validation, range query edges, and ordering stability
- [x] document unresolved ambiguities as ADR candidates
- [x] exit criteria met: memory flow is spec-aligned with deterministic test coverage

### Phase 2: File Durability Slice

- [x] expand failure-path tests for lock, corruption, and interrupted commit recovery
- [x] verify sidecar metadata consistency across restart paths
- [x] ensure usage docs include practical file-backend troubleshooting in EN/JA
- [x] add explicit tests for sidecar corrupt-header and unsupported-version failures
- [x] prove lock release after `close()` via reopen from independent instance/process
- [x] verify durable default auto-commit behavior (`frequency: "immediate"`)
- [x] exit criteria met: durability and lock semantics are test-proven and documented

### Phase 3: Query and Capacity Hardening

- [x] add parity tests across native, SQL subset, and Lucene subset query paths
- [x] strengthen capacity-boundary tests for strict/turnover policy edges
- [x] implement M3 B+ tree index hardening (split/merge, linked leaves, duplicate ordering stability)
- [x] add M3 property-style insertion/order invariants and split/merge regression suites
- [x] add regression suites for scheduler coalescing and error-channel propagation
- [x] exit criteria met: query and capacity behavior stays deterministic under mixed workloads

### Phase 4: Distribution Delivery Tracks

- [x] define release-ready NPM delivery contract with smoke verification
- [x] produce browser bundle artifacts for mandatory `core` profile
- [x] define and verify bundle profile matrix for optional browser adapters
- [x] publish EN/JA usage guidance for delivery/profile selection
- [x] exit criteria met: dual delivery tracks are test-proven and documented

### Phase 5: Browser Runtime Baseline (Post-v0.1)

- [x] phase declared active with explicit ADR-51 alignment
- [ ] define initial browser runtime slice scope (`localStorage` baseline first)
- [ ] add failing tests for browser runtime baseline open/commit/reopen behavior
- [ ] implement browser runtime baseline with typed availability failures
- [ ] publish EN/JA usage notes for browser runtime baseline behavior and limits
- [ ] exit criteria met: at least one browser backend runtime path is test-proven and documented

## 5. Active Work-Item Checklist (M1 Historical)

Use this section as the day-to-day completion board for the current work item.

- [x] memory init contract validated
- [x] insert/select deterministic ordering validated
- [x] timestamp and payload boundary validation completed
- [x] memory `commit()` baseline semantics completed
- [x] closed-state failure behavior completed
- [x] quality gates green: `pnpm test --run` and `pnpm check`
- [x] related docs updated (`docs/specs`, `docs/plans`, usage EN/JA when user-visible)
- [x] ADR updated if architecture-level decisions were introduced

## 6. Active Work-Item Checklist (P2/P3 Kickoff)

- [x] file lock conflict path tested and passing
- [x] file commit/reopen durability baseline tested and passing
- [x] interrupted commit temp-file recovery path tested and passing
- [x] sidecar consistency validation path tested and passing
- [x] strict/turnover capacity boundary tests added and passing
- [x] query registry parity tests added and passing
- [x] full verification green (`pnpm test --run`, `pnpm check`)

## 7. Active Work-Item Checklist (M2 File Durability Completion)

- [x] sidecar corrupt-header and unsupported-version failure tests added (red -> green)
- [x] lock conflict path verified across independent process/instance scenarios
- [x] lock release and reopen success after `close()` verified
- [x] durable default auto-commit behavior validated when omitted and when `autoCommit: {}` is used
- [x] restart behavior validates sidecar/page-0 mirrored metadata consistency
- [x] full verification green (`pnpm test --run`, `pnpm check`)

## 8. Active Work-Item Checklist (P4 Distribution Delivery Tracks)

- [x] npm install/import smoke tests added first and confirmed red
- [x] browser bundle `core` profile smoke test added first and confirmed red
- [x] package artifact/export shape implemented and verified
- [x] bundle profile artifacts and metadata matrix implemented and verified
- [x] EN/JA usage docs updated for delivery choices
- [x] full verification green (`pnpm test --run`, `pnpm check`)

## 9. Active Work-Item Checklist (M3 Query Scalability Index Hardening)

- [x] scope/acceptance criteria aligned with ADR-01 M3 and B+ tree spec updates
- [x] failing tests added first for split/merge + linked-leaf + property-style invariants
- [x] failing datastore-level regression added for index-based `select` path (no full scan dependency)
- [x] B+ tree index module implemented with split/merge/rebalance and oldest-pop path
- [x] datastore integrated with index for `select` and turnover eviction path
- [x] full verification green (`pnpm test --run`, `pnpm check`)

## 10. Active Work-Item Checklist (P3 Scheduler Coalescing and Error-Channel Regression)

- [x] scope/acceptance criteria aligned for remaining Phase 3 scheduler/error-channel clauses
- [x] failing tests added first for coalescing and background-error propagation/retry
- [x] file backend controller coalescing + in-flight close-wait behavior implemented
- [x] background auto-commit failed-attempt event emission verified (`StorageEngineError`)
- [x] full verification green (`pnpm test --run`, `pnpm check`)

## 11. Active Work-Item Checklist (P0 Foundation Sync Governance Closure)

- [x] scope/acceptance criteria aligned for remaining Phase 0 governance clauses
- [x] failing tests added first for PR checklist, docs index consistency, and workflow/testing alignment
- [x] feature PR template includes mandatory phase-gate checklist
- [x] docs index consistency guardrails implemented and verified
- [x] workflow/testing-strategy alignment clauses and usage guidance updated
- [x] full verification green (`pnpm test --run`, `pnpm check`)

## 12. Active Work-Item Checklist (M5 Release Hardening v0.1)

- [x] M5 work-item plan activated and indexed
- [x] ADR cleanup applied for current execution state and v0.2 direction
- [x] benchmark method and reproducible script draft defined
- [x] v0.1 limitations and non-goals documented in README and usage EN/JA
- [x] targeted M5 release-hardening docs/tests added and confirmed red before implementation
- [x] full verification green (`pnpm test --run`, `pnpm check`)

## 13. Active Work-Item Checklist (M6 Browser Runtime Baseline)

- [x] M6 work-item plan activated and indexed
- [ ] scope/acceptance criteria aligned with ADR-51 browser-first direction
- [ ] failing browser runtime baseline tests added and confirmed red before implementation
- [ ] initial browser runtime baseline implementation completed (localStorage-first)
- [ ] EN/JA usage docs updated for browser runtime status and guardrails
- [ ] full verification green (`pnpm test --run`, `pnpm check`)
