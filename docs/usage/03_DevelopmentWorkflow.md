# Usage: Phased Collaboration Workflow

Status: Draft  
Last Updated: 2026-03-07

This guide explains how we execute feature work together using a consistent phase gate flow.
It is based on `docs/specs/12_DevelopmentWorkflow.md`.

## 1. Session Checklist

Use this checklist at the beginning of each task:

- identify scope and non-goals
- identify impacted specs and ADRs
- decide acceptance criteria before coding
- update spec first
- write failing tests next
- implement minimum code to pass
- run full verification (`pnpm test --run`, `pnpm check`)
- update EN/JA usage docs if user-visible behavior changed
- add/update ADR when architecture-level tradeoffs were made

## 2. Working Steps (Practical)

1. Intent alignment

- confirm what will and will not change
- link exact existing specs/ADRs you are extending

2. Spec update

- write normative clauses first (`MUST`, `MUST NOT`, failure behavior)

3. Failing tests (Red)

- add tests that prove current behavior is insufficient

4. Implementation (Green)

- implement smallest safe change

5. Refactor and verify

- simplify internals while tests stay green
- run full gates and confirm no regressions

## 3. Definition of Done (PR Ready)

A change is PR ready only when all items below are true:

- scope and acceptance criteria are explicit
- specs are updated before code
- failing tests were added before implementation
- all related tests pass
- `pnpm check` passes
- user-facing docs are updated in English and Japanese when relevant
- ADR is updated when the decision affects architecture or long-term maintenance

## 4. Review Tips

For reviewers, prioritize:

- spec and test alignment over implementation style
- deterministic behavior at boundaries (time range, capacity, durability)
- error typing and explicit failure semantics

## 5. TypeScript Code Organization Policy

Use the following practical policy for TypeScript implementation files:

- keep domain entry `index.ts` files as thin, side-effect-free barrels
- split a module once it mixes multiple responsibilities or exceeds 300 non-empty lines
- proactively split before feature work when a module is around 220+ non-empty lines
- use explicit barrel re-exports (`export { X } from './x'`) and avoid `export *` for runtime symbols
- route cross-domain imports through public barrels; keep same-domain imports direct
- keep validation/normalization helpers as pure functions when possible
- prefer behavior-preserving split refactors before adding new features in the same area

## 6. GitHub Actions CI/CD

Repository automation follows this trigger split:

- for pull request create/update (`opened`, `reopened`, `synchronize`, `ready_for_review`), run:
  - `pnpm check`
  - `pnpm test --run`
- for pushes that land on the default branch (for example merge completion), run:
  - `pnpm check`
  - `pnpm test --run`
  - `pnpm build`
  - `pnpm build:bundle`

Current policy does not publish artifacts to external destinations.
Build outputs are generated only as workflow-local validation artifacts.

## 7. Feature PR Checklist Enforcement

Feature pull requests must use `.github/pull_request_template.md`.
The template checklist is the minimum execution gate and must be completed before merge:

- intent alignment
- spec update first
- failing tests first (TDD Red)
- implementation after red tests (TDD Green)
- full verification (`pnpm test --run`, `pnpm check`)
- EN/JA usage updates when user-visible behavior changes
- ADR updates for architecture/process decisions

## 8. Docs Index Consistency Rule

When adding or renaming files:

- update `docs/specs/INDEX.md` for spec files
- update `docs/adr/INDEX.md` for ADR files

These consistency checks are test-backed and treated as governance gates.
