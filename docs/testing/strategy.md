# Frostpillar Testing Strategy

Status: Draft  
Last Updated: 2026-03-06

## 1. Purpose

This document defines how Frostpillar validates correctness, durability boundaries, and performance claims.
It is aligned with:

- `docs/architecture/vision-and-principles.md`
- `docs/architecture/overview.md`
- `docs/adr/01_DevelopmentPlan.md`

## 2. Testing Principles

1. Spec-Driven + TDD first

- Step order is mandatory:
  intent alignment -> spec update -> failing tests -> implementation -> verification.
- Refactor is allowed only after targeted tests are green and before final full verification.

2. Determinism over convenience

- Tests must be reproducible with fixed seeds and controlled clocks/timers.

3. Behavior-first validation

- Validate externally observable behavior and invariants, not private implementation details.

4. Safety

- No tests should require network access.
- Tests should not depend on files outside the project root.

## 3. Test Layers

1. Unit Tests

- Target pure logic (TLV codec, page layout math, index helper functions).
- Fast and isolated.

2. Component Tests

- Validate one subsystem with real collaborators (pager + page format, index + traversal).

3. Integration Tests

- Validate datastore API with backend adapters (memory first, then file).
- Validate persistence/reload and policy behavior.

4. End-to-End Scenario Tests

- Validate realistic workflows: ingest, query, commit, reopen, range scan, retention behavior.

5. Performance/Baseline Tests

- Produce measured baselines with reproducible dataset and environment notes.
- Not a correctness gate for local dev, but required before release claims.

## 4. Mandatory Test Matrix by Subsystem

TLV codec:

- round-trip for supported primitive/object shapes
- malformed byte input rejection
- deterministic encoding output for equivalent input
- nested object payload round-trip
- reject arrays and cyclic payload graphs at encode/validation boundary
- payload nesting depth boundary (`64` accepted, `65` rejected)
- payload per-object key count boundary (`256` accepted, `257` rejected)
- payload total key count boundary (`4096` accepted, `4097` rejected)
- payload aggregate validation byte budget boundary (`1 MiB` accepted, overflow rejected)
- timestamp conversion boundary tests (`number` safe integer <-> `Int64` `bigint`)
- reject decode when `TIMESTAMP_I64` is outside JavaScript safe integer range
- verify no precision loss at boundary values (`MIN_SAFE_INTEGER`, `MAX_SAFE_INTEGER`)

Page manager / slotted pages:

- insert and read within fixed page size
- free-space accounting and fragmentation/compaction behavior
- boundary conditions at exact capacity
- compaction must not change logical tie-break ordering for equal timestamps
- header CRC32 validation with fixed CRC-32C algorithm parameters and known-vector check (`"123456789"` -> `0xE3069283`)

B+ tree:

- ordered insertion behavior
- split/merge invariants
- duplicate timestamp handling
- range scan correctness across multiple leaves
- M3 regression that `select` uses index seek + leaf scan path (no full-dataset `filter + sort`)
- equal-timestamp tie-break order must remain stable through split/merge/rebalance

Datastore API:

- async behavior contract
- input validation and domain error mapping
- timestamp normalization tests (`number`, ISO 8601 string, `Date`)
- invalid timestamp string rejection (non-ISO / timezone-missing / unparseable)
- `commit` semantics and visibility guarantees
- nested payload acceptance and deep key validation
- `autoCommit` config rejection for `location: "memory"`
- `autoCommit.frequency` parsing/validation (`"immediate"` default, `5000`, `"5s"`, `"1m"`, invalid values)
- `autoCommit.maxPendingBytes` parsing/validation (positive integer only, invalid values rejected)
- datastore error channel contract (`on`/`off`) for asynchronous background failures
- background auto-commit failure emits exactly one `"error"` event with `StorageEngineError`
- `on("error", ...)` unsubscribe behavior (returned disposer and explicit `off`) is idempotent
- no-listener case does not throw when background auto-commit fails
- listener failure isolation (one failing listener does not block others)
- update mutation must preserve original tie-break order for equal timestamps
- future upsert update-path must preserve original tie-break order; insert-path must allocate new order key

Memory backend:

- correctness baseline for all API operations
- no cross-test state leakage

File backend:

- reopen persistence correctness
- exclusive open-lock acquisition for single-writer safety
- second-process open on same datastore path must fail with `DatabaseLockedError`
- lock release on `close()` and subsequent open success
- header/version mismatch handling
- incomplete/corrupt file failure behavior
- `target` resolution tests (`filePath` shorthand vs `target.kind`)
- directory target naming tests (`directory` + `filePrefix` + `fileName`)
- canonical path containment tests against symlink escape paths
- sidecar metadata file open/reopen consistency checks
- sidecar `nextInsertionOrder` persistence and O(1) allocator recovery checks on reopen
- crash-recovery behavior with interrupted commit temp files (must not become active state)
- `commitId` monotonicity across successful durable commits

Browser backend (v0.2+):

- `browserStorage: "auto"` resolution order correctness (`opfs` -> `indexedDB` -> `localStorage`)
- explicit backend unavailability rejection with `UnsupportedBackendError`
- OPFS availability constraints handling (for example secure-context/private-mode restrictions)
- IndexedDB async persistence/reopen correctness
- localStorage manifest/chunk key naming determinism (`keyPrefix`, `databaseKey`, `generation`, `index`)
- localStorage chunk split/reassemble correctness for snapshots larger than one chunk
- localStorage `maxChunks` boundary rejection with `QuotaExceededError`
- localStorage quota failure handling that preserves previous committed generation

Query-engine modules (M6+):

- SQL/Lucene translation parity for representative filter/aggregate/group/order/limit cases
- datastore integrated query path (`registerQueryEngine` + `query`) delegates to
  `toNativeQuery` and `queryNative` without request mutation
- datastore close-state behavior: `query`, `registerQueryEngine`, `unregisterQueryEngine`
  fail with `ClosedDatastoreError`
- in-flight query engine snapshot behavior under concurrent
  `registerQueryEngine` / `unregisterQueryEngine`
- canonical field-path escaping for keys containing dot/backslash
- SQL text vs `QueryExecutionOptions` conflict rejection (`QueryValidationError`)
- Lucene filter text + `QueryExecutionOptions` mapping correctness
- native filter expression depth boundary (`64` accepted, `65` rejected)
- native query scanned-row guardrail (`10000`) rejection behavior
- native query output-row guardrail (`5000`) rejection behavior

Capacity and retention:

- strict capacity throws `QuotaExceededError` at boundary
- turnover evicts oldest records deterministically
- single-record-larger-than-max-size rejection with `QuotaExceededError`

Flush strategies:

- immediate flush
- interval flush with controlled timers
- size-threshold flush
- manual commit
- OR-trigger semantics when interval and size-threshold are both configured
- trigger coalescing while one commit is in flight
- auto-commit scheduler start/stop behavior on datastore lifecycle (`close` stops schedule)
- auto-commit scheduler failure propagation to datastore error channel (no silent drop)

## 5. Invariant Testing

Beyond examples, invariant testing is required for index and page correctness.
Without adding external libraries, we still run property-style checks:

- generate deterministic pseudo-random timestamp streams
- assert sorted query results for every run
- assert index/page structural invariants after each operation batch
- include operation mixes that force compaction and B+ tree split/merge, then assert
  deterministic `(timestamp, insertion-order)` ordering

## 6. Error and Failure Testing

Every critical error class must have direct tests:

- invalid input and schema mismatch
- invalid time range
- unsupported format version
- quota exceed under strict policy
- adapter-level I/O failures
- asynchronous background commit failure surfaced through datastore `"error"` event channel

Errors must be explicit and typed; silent fallback is not acceptable.

## 7. Performance Validation Strategy

To avoid unreliable claims:

- define fixed benchmark dataset shapes
- record runtime environment and command used
- report both throughput and latency-relevant numbers
- compare changes against previous baseline before release

Benchmark results are evidence, not guarantees. They must be documented with method details.

## 8. Tooling and Quality Gates

Primary commands:

- `pnpm check`
- `pnpm test --run`
- `pnpm test --run <path>.test.ts`

Merge gate (minimum):

- all related new behavior has tests
- full test suite green
- no type/lint/format failures
- docs/spec updates included when behavior changes

Workflow alignment guardrails:

- testing workflow order MUST stay aligned with `docs/specs/12_DevelopmentWorkflow.md`
- verification command contract MUST stay aligned with:
  - `pnpm test --run`
  - `pnpm check`

## 9. Test Data and Fixtures

- Prefer small deterministic fixtures checked into repository.
- Keep fixture intent explicit (naming includes scenario and boundary).
- Avoid huge binary fixtures unless they protect a proven regression.

## 10. Release Readiness (v0.1)

Before `v0.1`, confirm:

- regression suite is stable
- persistence and retention behaviors are covered
- benchmark script is reproducible
- documented limitations and non-goals are explicit
