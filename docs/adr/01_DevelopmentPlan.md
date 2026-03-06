# ADR-01: Development Plan (Execution-Focused)

Status: Proposed  
Date: 2026-03-06

## Context

The current repository is still in pre-implementation state (mostly design docs).  
To make Frostpillar successful quickly, we need a plan that is:

- aligned with `docs/architecture/vision-and-principles.md`
- realistic for incremental delivery
- measurable (clear exit criteria)
- safe (Spec-Driven + TDD-first)

The previous draft listed major components but did not define quality gates, delivery order risk, or a minimum shippable scope.

## Decision

Adopt a milestone-driven plan with explicit "spec -> tests -> implementation -> verification" gates for every feature.

## Delivery Principles

- Always write or update spec documents first (`docs/specs/*`).
- Write failing tests before implementation code (TDD).
- Implement the smallest vertical slice first, then expand.
- Keep APIs async-only and named-export-only.
- No new npm packages without explicit approval.
- Each milestone closes with `pnpm check` and `pnpm test --run`.

## Definition of Success (Short Term)

Ship a trustworthy `v0.1` that proves the core value:

- append timeseries records
- execute time-range queries correctly
- persist and reload data via memory + file storage
- enforce max size with at least one policy
- provide reproducible tests and usage docs (EN/JA)

## Milestones

### M0. Project Baseline and Missing Core Docs

Goal: Prepare an executable foundation before database logic.

Deliverables:

- Confirm project scripts and minimal source layout (`src/core`, `src/storageEngine`, `src/queryEngine`).
- Add missing architecture and testing docs referenced by `AGENTS.md`:
  - `docs/architecture/overview.md`
  - `docs/testing/strategy.md`
- Define benchmark method (dataset shape, record count, environment notes).

Tests first:

- Smoke tests for toolchain and test runner.
- No feature code until baseline checks pass.

Exit criteria:

- `pnpm check` and `pnpm test --run` are green.
- All architecture/testing references in `AGENTS.md` resolve to existing docs.

### M1. Minimum Vertical Slice (Memory Backend First)

Goal: Deliver the fastest useful path end-to-end with minimal complexity.

Scope:

- Canonical record schema for timeseries events.
- TLV encode/decode for supported value types used in v0.1.
- In-memory pager/page format (fixed-size pages with slotted layout).
- Insert + `select(startTime, endTime)` working through a single public datastore API.

Tests first:

- TLV round-trip and invalid-input tests.
- Page insertion/compaction/free-space tests.
- End-to-end tests for insert/query correctness with deterministic fixtures.

Exit criteria:

- Core end-to-end flow works in memory.
- Public API and error behavior documented in `docs/specs` and `docs/usage` (EN/JA).

### M2. Durable Storage (File Backend)

Goal: Make data survive process restarts.

Scope:

- File storage adapter using `fs/promises`.
- File header/version metadata and safe open/close flow.
- Reload path validating persisted pages and index reconstruction.

Tests first:

- Persistence tests across reopen cycles.
- Corrupt-header / unsupported-version failure tests.

Exit criteria:

- Data written in one process can be read in a new process.
- All persistence failure paths are covered by tests.

### M3. Query Scalability (Index Hardening)

Goal: Move from functional to scalable range queries.

Scope:

- B+ tree node split/merge and linked leaves.
- Stable handling for duplicate timestamps and ordering semantics.
- Clear complexity expectations documented (what is O(log N), what is O(N)).

Tests first:

- Property-style insertion/order invariants (without external libs).
- Split/merge regression suite.

Exit criteria:

- Large-range queries stay correct after heavy insert patterns.
- No known balancing bug in regression tests.

### M4. Write Strategy and Capacity Policies

Goal: Control I/O and bounded storage behavior.

Scope:

- Flush modes: immediate, interval, size-based, manual commit.
- Max-size tracking.
- Capacity policy A (`QuotaExceededError`) and policy B (ring-buffer turnover).

Tests first:

- Flush trigger tests with controlled timers.
- Boundary tests at exact size limits.
- FIFO eviction correctness tests.

Exit criteria:

- Capacity behavior is deterministic and documented.
- Manual and automatic flush behaviors are both test-proven.

### M5. Release Hardening (`v0.1`)

Goal: Make release claims evidence-based.

Scope:

- Performance baseline report (method + measured results, no unsupported claims).
- End-to-end suites across memory and file backends.
- Documentation refresh (`README`, `docs/usage`, migration/limitations notes).

Tests first:

- Regression suite frozen for `v0.1`.
- Reproducible benchmark script committed.

Exit criteria:

- `pnpm check` and full test suite are green.
- Public docs include limitations and non-goals (what `v0.1` does not solve yet).

### M6. Native Mutation API and Optional Query Engines (`v0.2+`)

Goal: Extend API usability while keeping core lightweight and TypeScript-native.

Scope:

- Add internal record identity and native record-level operations (`getById`, `updateById`, `deleteById`).
- Add `queryNative(...)` as common execution request contract.
- Define optional SQL subset query engine contract and translation rules.
- Define optional Lucene subset query engine contract and translation rules.

Tests first:

- Record identity uniqueness and stability tests.
- Deterministic update/delete-by-id behavior tests.
- Query-engine translation tests (text -> native request).
- Cross-language equivalence tests for representative filter patterns.

Exit criteria:

- Native and translated queries return deterministic results.
- SQL/Lucene modules work as optional imports without datastore init coupling.
- Specs and usage docs (EN/JA) are aligned.

## Prioritization Rules (To Move Fast Safely)

- Prioritize correctness and determinism over premature optimization.
- Do not start browser backend before memory + file backends are stable.
- Defer "custom remote storage" until core durability guarantees are proven.

## Risk Register and Mitigations

- Risk: Scope explosion from implementing all backends at once.  
  Mitigation: strict milestone gating (memory -> file -> browser/custom later).

- Risk: Hidden complexity in page layout and B+ tree balancing.  
  Mitigation: invariant-focused tests before optimization.

- Risk: Overstated performance claims.  
  Mitigation: publish benchmark methodology and measured numbers only.

- Risk: Spec drift between docs and implementation.  
  Mitigation: block implementation PRs unless related spec and tests are updated first.

## Consequences

Positive:

- Faster path to a credible first release.
- Better trust through measurable gates and reproducible tests.
- Lower rework risk because architecture decisions are validated incrementally.

Trade-off:

- Some advanced features (browser/custom storage) are intentionally delayed until core reliability is proven.
