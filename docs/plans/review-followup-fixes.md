# Plan: Review Follow-up Fixes

- **Created:** 2026-07-14
- **Last updated:** 2026-07-14
- **Status:** complete

## Goal

Close the remaining correctness and compatibility gaps found in the read-once input snapshots, database-level custom-key handling, and variable-width regular-expression counter. Keep all work on the current branch and leave it uncommitted.

## Achieved when

- [x] Every reproduced gap has a regression test that fails without its implementation fix and passes with it.
- [x] Specs, ADRs, and both READMEs describe the implemented snapshot and regular-expression behavior without stale cache or identity claims.
- [x] Focused tests and the complete `pnpm check` workflow pass.
- [x] No commit is created and unrelated working-tree changes are preserved.

**Out of scope:** Unrelated refactors, existing lint-warning cleanup, dependency changes, and commits.

## Work items

### Phase 1 — Specify

| # | Item | Done-condition | Depends on | Status |
| - | ---- | -------------- | ---------- | ------ |
| 1.1 | Define one-time snapshot behavior for database configuration, update operations/options, filters, and comparison operands | ADR/spec/README text states one implementable contract | — | done |
| 1.2 | Define variable-quantifier counting for lazy modifiers and Unicode-set classes | Spec/README describe actual quantifier tokens and compatibility impact | — | done |

### Phase 2 — Test

| # | Item | Done-condition | Depends on | Status |
| - | ---- | -------------- | ---------- | ------ |
| 2.1 | Add input-snapshot and database-key regression tests | Each reported reproduction is represented | 1.1 | done |
| 2.2 | Add regex regression tests | Lazy modifiers, `v` sets, and separated `{1,2}` chain are represented | 1.2 | done |
| 2.3 | Confirm the new tests fail against the pre-implementation behavior | Focused red run records the expected failures | 2.1, 2.2 | done |
| 2.4 | Add final-review regressions for successful upsert reuse and RegExp comparison properties | Both compatibility paths fail before their final fix and pass afterward | 1.1 | done |

### Phase 3 — Implement

| # | Item | Done-condition | Depends on | Status |
| - | ---- | -------------- | ---------- | ------ |
| 3.1 | Snapshot database config and update call inputs once | Identity/update regression tests pass | 2.3 | done |
| 3.2 | Fully detach filter and comparison operands | Filter/`$pull` regression tests pass | 2.3 | done |
| 3.3 | Correct variable-quantifier tokenization | Regex regression tests pass | 2.3 | done |
| 3.4 | Preserve RegExp enumerable comparison properties in the detached copy | RegExp comparison regression passes | 2.4 | done |

### Phase 4 — Verify

| # | Item | Done-condition | Depends on | Status |
| - | ---- | -------------- | ---------- | ------ |
| 4.1 | Review the integrated diff for contract and typing consistency | No unresolved review findings | 3.1, 3.2, 3.3 | done |
| 4.2 | Run focused tests and `pnpm check` | All commands pass | 4.1 | done |

## Decision log

- 2026-07-14 — The user authorized implementation on the current branch and explicitly requested no commit. (user)
- 2026-07-14 — Loss of cross-call WeakMap identity hits is accepted; per-scan reuse remains the supported optimization. (user and review)
- 2026-07-14 — `+` remains subject to the variable-width cap, while lazy suffixes are modifiers rather than additional quantifiers. (user and review)
- 2026-07-14 — Existing unrelated changes and lint warnings are preserved. (agent assumption, low-risk)
- 2026-07-14 — Final review requires explicit successful-upsert snapshot coverage and preservation of enumerable RegExp comparison properties. (review)

## Open questions

- None.
