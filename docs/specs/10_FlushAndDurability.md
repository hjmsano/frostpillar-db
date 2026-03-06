# Spec: Flush Strategy and Durable Commit Protocol (v0.2 draft)

Status: Draft  
Version: 0.2  
Last Updated: 2026-03-06

This document defines flush trigger semantics and crash-safe durability boundaries.
It complements `docs/specs/04_DatastoreAPI.md` and `docs/specs/09_CapacityAndRetention.md`.

## 1. Scope

In scope:

- flush trigger model (`immediate`, periodic, size-threshold, manual)
- ordering and coalescing behavior for auto-commit scheduler
- durable commit protocol and restart recovery guarantees

Out of scope:

- benchmark-specific tuning knobs
- distributed transaction semantics

## 2. Auto-Commit Config Extension (Normative)

```typescript
export type AutoCommitConfig = {
  frequency?: 'immediate' | number | `${number}ms` | `${number}s` | `${number}m` | `${number}h`;
  maxPendingBytes?: number;
};
```

Validation rules:

- `maxPendingBytes`, when provided, MUST be a positive safe integer in bytes.
- Non-positive or non-integer values MUST throw `ConfigurationError`.
- `frequency` validation follows `docs/specs/04_DatastoreAPI.md`.

## 3. Flush Trigger Model

For durable backends, flush is triggered by OR semantics:

- immediate trigger: `frequency: "immediate"`
- periodic trigger: valid non-immediate `frequency`
- size trigger: `maxPendingBytes` reached or exceeded
- manual trigger: explicit `commit()` call

Rules:

- If `frequency` is omitted, effective value is `"immediate"`.
- If both periodic and size trigger are configured, whichever condition occurs first MUST trigger commit.
- `commit()` MUST remain callable regardless of auto-commit configuration.

## 4. Scheduler and Concurrency Semantics

- Datastore MUST ensure at most one active commit execution at a time.
- If a commit trigger fires while commit is in progress, datastore MUST coalesce triggers and run one additional commit after the in-flight commit completes (if pending changes remain).
- Background commit failures MUST emit one `DatastoreErrorEvent` per failed commit attempt.
- `close()` MUST stop future scheduling before resource teardown.
- `close()` MUST wait for active commit completion or failure before resolving.

## 5. Durable Boundary

`commit()` resolves successfully only after all of the following for the active backend are completed:

- data bytes for the commit generation are persisted
- commit metadata pointer/state is atomically switched to the new generation
- post-switch persistence barrier is completed for metadata state

Before these conditions are met, durability MUST NOT be implied.

## 6. File Backend Crash-Safe Protocol

For `location: "file"`, implementation MUST follow this order:

1. read current committed metadata and derive `nextCommitId = currentCommitId + 1`
2. materialize next generation data into a temporary generation file (`<dataPath>.g.<nextCommitId>.tmp`)
3. persist temporary generation file bytes to OS boundary
4. atomically rename temporary generation file to committed generation file (`<dataPath>.g.<nextCommitId>`)
5. write sidecar metadata to temporary sidecar (`<dataPath>.meta.json.tmp`) including:
   - incremented `commitId`
   - `activeDataFile` pointing to the generation file name for `<dataPath>.g.<nextCommitId>`
6. persist sidecar temporary bytes to OS boundary
7. atomically replace sidecar file with sidecar temporary file (activation point)
8. optionally remove old unreferenced generation files after successful activation

Sidecar schema extension:

```json
{
  "magic": "FPGE_META",
  "version": 1,
  "activeDataFile": "frostpillar.fpdb.g.0",
  "rootPageId": 1,
  "nextPageId": 2,
  "freePageHeadId": null,
  "commitId": 0
}
```

Rules:

- `commitId` MUST be a monotonic non-negative integer incremented per successful durable commit.
- startup recovery MUST treat sidecar as source of truth for active committed state.
- `activeDataFile` MUST reference one committed generation file in the same directory.
- page-0 meta payload (see `docs/specs/03_PageStructure.md` section 8.1) MUST be
  source of truth for B+ tree root/allocation fields
  (`rootPageId`, `nextPageId`, `freePageHeadId`).
- sidecar root/allocation fields are mirrored values for restart precheck and
  MUST match page-0 meta payload.
- leftover `*.tmp` files from interrupted commits MUST be ignored or removed during open and MUST NOT become active state automatically.
- generation files not referenced by sidecar MUST NOT be auto-selected as active state.
- if sidecar points to a missing/corrupt active generation file, open MUST fail with typed storage corruption error.
- if sidecar mirrored root/allocation fields do not match page-0 meta payload,
  open MUST fail with typed storage corruption error.

## 7. Browser Generation-Swap Rule

For browser durable backends (`opfs`, `indexedDB`, `localStorage`):

- a new generation MUST be written fully before active generation pointer/manifest is switched
- manifest/pointer switch MUST be last
- if failure occurs before switch, previous committed generation MUST remain readable

This rule is mandatory for localStorage chunking as well.

## 8. Error Contract

- invalid flush config: `ConfigurationError`
- backend write failures: `StorageEngineError`
- asynchronous auto-commit failures: surfaced via `DatastoreErrorEvent`

## 9. Test Requirements Link

Implementations MUST satisfy flush/durability tests defined in:

- `docs/testing/strategy.md` (Flush strategies, error propagation, and persistence failure classes)
