# Plan: Phase Work Item (P2/P3 File Durability and Query/Capacity Kickoff)

Status: Completed  
Version: 0.2 planning  
Last Updated: 2026-03-07

## 1. Purpose

This work item starts implementation for:

- `Phase 2: File Durability Slice`
- `Phase 3: Query and Capacity Hardening`

The goal is to establish one safe, test-backed baseline that advances both phases without
scope-expanding into browser storage or full SQL/Lucene parser implementation.

## 2. Scope

In scope:

- file backend baseline open/commit/reopen durability cycle
- exclusive open lock behavior with typed conflict failure
- interrupted-commit temp-file handling and sidecar consistency checks
- capacity policy baseline (`strict` and `turnover`) in active backends
- datastore-integrated query registry baseline (`registerQueryEngine`, `unregisterQueryEngine`, `query`, `queryNative`)
- parity behavior tests using engine-module stubs for SQL/Lucene language routes

Out of scope:

- browser backend implementation
- full SQL parser and full Lucene parser implementation
- complex native aggregation planner beyond baseline parity coverage
- post-v0.2 API expansion

## 3. Execution Requirements

- Contributors MUST follow workflow order:
  intent alignment -> spec update -> failing tests -> implementation -> verification.
- File durability behavior MUST respect sidecar/lock semantics from:
  - `docs/specs/04_DatastoreAPI.md`
  - `docs/specs/10_FlushAndDurability.md`
- Query behavior MUST align with:
  - `docs/specs/04_DatastoreAPI.md`
  - `docs/specs/05_QueryEngineContract.md`
- Capacity behavior MUST align with:
  - `docs/specs/09_CapacityAndRetention.md`
- Implementation MUST avoid unrelated refactors.

## 4. Acceptance Criteria

- `new Datastore({ location: "file", ... })` opens with exclusive lock and rejects concurrent lock acquisition with `DatabaseLockedError`.
- `commit()` for file backend writes one new committed generation and activates sidecar atomically through temp files.
- reopen after `close()` restores persisted records and insertion-order state.
- leftover temp files from interrupted commit paths are ignored or removed on open and do not become active state.
- sidecar mismatch or missing/corrupt active generation fails open with typed storage corruption error.
- `capacity.policy: "strict"` rejects overflow insert atomically with `QuotaExceededError`.
- `capacity.policy: "turnover"` evicts oldest records deterministically before insert.
- `query(...)` and `runQueryWithEngine(...)` produce equivalent behavior for the same engine and query text/options.
- after `close()`, query registration and query execution fail with `ClosedDatastoreError`.

## 5. Failing Tests (TDD Red)

Before implementation, add failing tests:

- `tests/core/datastore-file-durability-slice.test.mjs`
  - lock conflict, commit/reopen persistence, sidecar mismatch detection, interrupted temp-file handling
- `tests/core/datastore-query-capacity-kickoff.test.mjs`
  - strict/turnover capacity boundaries
  - integrated query registry parity and closed-state checks

Each test MUST fail first for expected reasons before implementation.

## 6. Verification Gate

Work item progress update requires:

- targeted tests pass
- full suite passes (`pnpm test --run`)
- quality gate passes (`pnpm check`)
- related docs remain aligned (`docs/specs`, `docs/plans`, `docs/usage` EN/JA, ADR)

## 7. Follow-Up Work

- Dedicated closure of remaining M2 durability obligations is tracked in:
  - `docs/plans/04_PhaseWorkItem_M2_FileDurabilitySlice.md`
