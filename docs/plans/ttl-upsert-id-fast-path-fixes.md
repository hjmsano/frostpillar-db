# Plan: TTL upsert and conjunctive `_id` fast-path fixes

- **Created:** 2026-07-14
- **Last updated:** 2026-07-14
- **Status:** done

## Goal

Expired TTL records must not block same-key writes, and conjunctive `_id`
filters must use indexed candidate lookup without changing filter semantics.
Correct stale documentation and repository metadata in the same change.

## Achieved when

- [x] Expired, unpurged records do not cause `DuplicateIdError` for TTL
      `insert`, `insertMany`, or upsert writes. Verified by the TTL regression
      test and `pnpm check` on 2026-07-14.
- [x] A live collision still throws `DuplicateIdError` under the `'reject'`
      policy. Verified by the TTL regression test and `pnpm check`.
- [x] Conjunctive `_id` equality and `$in` queries avoid `getAll()` while
      evaluating every predicate before returning, updating, or removing.
      Verified by the instrumented integration test and `pnpm check`.
- [x] TTL behavior is specified and documented in both READMEs.
- [x] `SECURITY.md`, `database.ts`, and `AGENTS.md` contain the requested
      current wording.
- [x] Targeted tests, `pnpm check`, and `pnpm build` pass. Verification
      completed on 2026-07-14.

**Out of scope:** Dependency changes, unrelated refactors, branches, commits,
and pull requests.

## Work items

### Phase 1 — Specification and plan

| # | Item | Done-condition | Depends on | Status |
| - | ---- | -------------- | ---------- | ------ |
| 1.1 | Create this execution plan | Plan records goal, acceptance criteria, and decisions | — | done |
| 1.2 | Specify TTL write conflict and conjunctive `_id` candidate semantics | Specs and affected ADRs state the behavior and shortcut boundaries | 1.1 | done |

### Phase 2 — Regression tests

| # | Item | Done-condition | Depends on | Status |
| 2.1 | Add TTL conflict tests | Expired insert/upsert/batch reuse and live duplicate rejection are covered | 1.2 | done |
| 2.2 | Add conjunctive `_id` candidate tests | Equality and `$in` use index candidates and preserve all predicates | 1.2 | done |

### Phase 3 — Implementation

| # | Item | Done-condition | Depends on | Status |
| - | ---- | -------------- | ---------- | ------ |
| 3.1 | Reclaim expired TTL collision records | Writes remove only expired colliding entries before duplicate enforcement | 2.1 | done |
| 3.2 | Extend `_id` candidate extraction safely | Candidate retrieval accepts conjunctive filters; direct shortcut paths remain exact-only | 2.2 | done |

### Phase 4 — Documentation and metadata

| # | Item | Done-condition | Depends on | Status |
| - | ---- | -------------- | ---------- | ------ |
| 4.1 | Document TTL write behavior | English and Japanese README TTL sections match the specification | 3.1 | done |
| 4.2 | Apply stale-document nits | Security support table, database comment, and AGENTS title are current | — | done |

### Phase 5 — Verification

| # | Item | Done-condition | Depends on | Status |
| - | ---- | -------------- | ---------- | ------ |
| 5.1 | Run focused and complete verification | Targeted tests, `pnpm check`, and `pnpm build` pass | 2.1, 2.2, 3.1, 3.2, 4.1, 4.2 | done |

## Decision log

- 2026-07-14 — Treat expired TTL records as absent only for a colliding write:
  reclaim the expired entry or entries for that storage key rather than running
  a collection-wide purge. This applies to `insert`, `insertMany`, and upsert
  because upsert delegates to `insert`. (Agent; approved implementation plan.)
- 2026-07-14 — Let `_id` equality and `$in` extractors narrow candidates when
  additional top-level predicates exist. `findOne` and `remove` retain their
  direct shortcut only for an exact one-key filter, because those shortcuts do
  not evaluate remaining predicates. (Agent; approved implementation plan.)
- 2026-07-14 — Support the latest `1.x` release line and mark older releases
  unsupported. (User-approved assumption.)
- 2026-07-14 — Verified the completed change with `pnpm test`, `pnpm check`,
  and `pnpm build`. (Agent.)
- 2026-07-14 — Verified final documentation wording with `pnpm textlint`.
  (Agent.)

## Open questions

None.
