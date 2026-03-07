# Plan: Phase Work Item (M3 Query Scalability Index Hardening)

Status: Completed  
Version: 0.2 execution  
Last Updated: 2026-03-07

## 1. Purpose

This work item defines the dedicated M3 execution slice from
`docs/adr/01_DevelopmentPlan.md`.

Goal:

- move `select` from functional correctness baseline to index-backed scalable range query
- harden B+ tree split/merge behavior and duplicate timestamp ordering stability
- keep public `Datastore` API signature unchanged while improving internal query path

## 2. Scope

In scope:

- in-memory B+ tree runtime index for logical key `(timestamp, insertionOrder)`
- deterministic linked-leaf range scan path for `select`
- split/merge/rebalance behavior for insert + internal eviction delete path
- property-style invariant tests and split/merge regression tests
- turnover eviction integration with deterministic oldest-key lookup from index

Out of scope:

- browser backend implementation
- SQL/Lucene parser expansion
- public delete API exposure
- unrelated refactors in file durability/bundle delivery areas

## 3. Execution Requirements

- Contributors MUST follow workflow order:
  intent alignment -> spec update -> failing tests -> implementation -> verification.
- Behavior MUST align with:
  - `docs/specs/04_DatastoreAPI.md`
  - `docs/specs/09_CapacityAndRetention.md`
  - `docs/specs/11_BTreeIndexInvariants.md`
- Public API compatibility MUST be preserved (`insert`, `select`, `commit`, `on/off`, `close`).
- Implementation MUST avoid introducing new npm dependencies.

## 4. Acceptance Criteria

- `select({ start, end })` executes through index lower-bound seek + linked-leaf scan.
- duplicate timestamp ordering remains deterministic by insertion-order key after heavy split/merge patterns.
- internal underflow handling (borrow/merge) preserves routing and leaf-link invariants.
- turnover policy oldest eviction is deterministic and index-consistent under repeated inserts.
- no known balancing regression remains in M3 split/merge suite.

## 5. Phased Work Breakdown

### Phase A: Spec and Criteria Hardening

- [x] add/adjust normative clauses for M3 query path and complexity expectations
- [x] align usage docs (EN/JA) for user-visible query behavior notes
- [x] record architecture decision for runtime index hardening strategy

### Phase B: TDD Red (Failing Tests First)

- [x] add `tests/core/time-index-btree.test.mjs`
  - split propagation and leaf-link invariants
  - merge/rebalance regressions under repeated oldest-pop operations
  - property-style deterministic insertion/order checks
- [x] add `tests/core/datastore-index-hardening.test.mjs`
  - regression proving `select` path does not depend on full-dataset `filter + sort`
  - heavy mixed insert/select correctness checks
- [x] run targeted tests and confirm red before implementation

### Phase C: Implementation (Green)

- [x] implement internal B+ tree index module under `src/core/datastore/`
- [x] integrate datastore insert/select/turnover paths with index
- [x] keep deterministic ordering and typed error behavior consistent

### Phase D: Verification and Closure

- [x] run targeted M3 tests
- [x] run full suite `pnpm test --run`
- [x] run quality gate `pnpm check`
- [x] update checklist and close remaining unchecked items

## 6. Verification Gate

Work item completion requires:

- targeted M3 tests pass
- full suite passes (`pnpm test --run`)
- quality gate passes (`pnpm check`)
- docs/ADR/plans remain aligned

## 7. Completion Notes (2026-03-07)

- M3 runtime index hardening implemented with modularized B+ tree components:
  - `timeIndexBTree.ts`
  - `timeIndexBTreeTypes.ts`
  - `timeIndexBTreeNavigation.ts`
  - `timeIndexBTreeMutations.ts`
  - `timeIndexBTreeIntegrity.ts`
- Datastore `select` moved to index-backed range path, and turnover eviction now uses index oldest-pop.
- Verification commands:
  - `pnpm test --run tests/core/time-index-btree.test.mjs tests/core/datastore-index-hardening.test.mjs tests/specs/m3-index-hardening-docs.test.mjs`
  - `pnpm test --run`
  - `pnpm check`
