# Spec: Release Hardening for v0.1

Status: Draft  
Version: v0.1 hardening  
Last Updated: 2026-03-07

This specification defines the mandatory release-hardening contract for `v0.1`.
It complements:

- `docs/specs/12_DevelopmentWorkflow.md`
- `docs/testing/strategy.md`
- `docs/adr/01_DevelopmentPlan.md`

## 1. Scope

In scope:

- reproducible benchmark method and execution command contract
- benchmark dataset-shape definitions for release evidence
- benchmark pass/fail interpretation policy for `v0.1` release readiness
- explicit `v0.1` limitations and non-goals disclosure requirements
- checklist/plan synchronization gates for M5 closure

Out of scope:

- runtime performance tuning techniques
- external CI benchmark infrastructure
- post-`v0.1` feature design (`v0.2` runtime expansion work)

## 2. Benchmark Contract

### 2.1 Script Location and Invocation

- Repository MUST provide benchmark script at `scripts/benchmark-v0.1.mjs`.
- Script MUST run with repository-local command:
  - `pnpm benchmark:v0.1`
- Script MUST print environment metadata and deterministic metrics in JSON.

### 2.2 Dataset Shapes

Benchmark execution MUST include the following deterministic dataset shapes:

1. `tiny-memory`
- backend: `memory`
- records: `1000`
- payload shape: narrow object (`event`, `value`, `source`)

2. `small-file`
- backend: `file`
- records: `2000`
- payload shape: nested object (depth up to `3`)
- lifecycle includes commit and reopen query pass

3. `medium-memory`
- backend: `memory`
- records: `10000`
- payload shape: mixed numeric/string/boolean fields

### 2.3 Required Metrics

Script output MUST include:

- insert throughput (`recordsPerSecond`)
- select throughput (`recordsPerSecond`)
- total insert duration (`insertDurationMs`)
- total select duration (`selectDurationMs`)
- node/os/cpu metadata

### 2.4 Pass/Fail Interpretation Policy

- Benchmark metrics are release evidence, not strict deterministic guarantees.
- Local contributor runs are informational and MUST NOT fail solely by threshold miss.
- `v0.1` release-readiness review MUST compare current benchmark report against the previous baseline.
- If measured throughput regresses by more than `20%` in any dataset shape, release notes MUST include explicit rationale and mitigation plan before approval.

## 3. Documentation Contract for v0.1 Limitations

`README.md` and usage docs in EN/JA MUST explicitly document:

- supported runtime backends in `v0.1`
- unsupported or deferred capabilities as non-goals
- known release limitations tied to current implementation scope

Mandatory user docs for this contract:

- `docs/usage/06_ReleaseHardening-v0.1.md`
- `docs/usage/06_ReleaseHardening-v0.1-JA.md`

## 4. Release-Hardening Closure Gates

M5 closure requires synchronized completion across:

- `docs/plans/09_PhaseWorkItem_M5_ReleaseHardening_v0.1.md`
- `docs/plans/01_DevelopmentStatusChecklist.md`

A checkbox in those files can be marked complete only after:

- spec update is present
- failing tests were added first and confirmed red
- implementation/doc updates are applied
- verification commands are green:
  - `pnpm test --run`
  - `pnpm check`

## 5. Documentation and ADR Obligations

When this release-hardening contract changes, contributors MUST update:

- this specification
- usage docs in English and Japanese
- active plan/checklist files
- ADR documents when decision boundaries or release policy interpretation change
