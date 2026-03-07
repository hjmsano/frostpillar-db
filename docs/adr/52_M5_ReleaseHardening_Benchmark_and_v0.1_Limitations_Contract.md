# ADR-52: M5 Release Hardening Benchmark and v0.1 Limitations Contract

Status: Accepted  
Date: 2026-03-07

## Context

M5 release hardening required closure for three open gaps:

1. No reproducible benchmark contract for `v0.1` release evidence.
2. No explicit README + usage EN/JA disclosure of `v0.1` limitations and non-goals.
3. No test-backed synchronization gate between M5 plan/checklist and release-hardening docs.

Without these controls, release-readiness claims could drift from documented scope.

## Decision

Adopt a documentation-first and test-backed M5 closure contract:

- define normative release-hardening specification in
  `docs/specs/14_ReleaseHardening_v0.1.md`
- add repository benchmark command and script:
  - `pnpm benchmark:v0.1`
  - `scripts/benchmark-v0.1.mjs`
- publish explicit `v0.1` limitations and non-goals in:
  - `README.md`
  - `docs/usage/06_ReleaseHardening-v0.1.md`
  - `docs/usage/06_ReleaseHardening-v0.1-JA.md`
- enforce plan/checklist/doc synchronization with M5 docs tests

Benchmark policy decision:

- dataset shapes are fixed (`tiny-memory`, `small-file`, `medium-memory`)
- results are release evidence, not strict local performance pass/fail gate
- regressions greater than 20% require explicit release-note rationale and mitigation plan

## Consequences

Positive:

- release-hardening claims become reproducible and auditable
- users can see exact `v0.1` support boundaries before adoption
- M5 progress tracking is tied to executable tests, not manual interpretation

Trade-off:

- benchmark numbers can vary by local machine and require contextual reading
- additional documentation maintenance is required when release-hardening policy changes
