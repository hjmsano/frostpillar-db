# Specification: Development Workflow

Status: Draft  
Last Updated: 2026-03-07

## 1. Purpose

This specification defines the shared execution workflow for contributors who implement or update Frostpillar behavior.
It complements:

- `docs/architecture/vision-and-principles.md`
- `docs/architecture/overview.md`
- `docs/testing/strategy.md`
- `docs/adr/01_DevelopmentPlan.md`

## 2. Scope

In scope:

- session-level execution order for feature work
- phase gates and quality checks
- required documentation updates during behavior change

Out of scope:

- release calendar and staffing
- milestone-level product prioritization details

## 3. Normative Workflow Order

Step order is mandatory: intent alignment -> spec update -> failing tests -> implementation -> verification.

A contributor MUST follow this order for every behavior change.
Skipping or reordering steps is non-compliant unless an ADR explicitly introduces an exception.

## 4. Phase Model

Each phase MUST define entry criteria, execution tasks, and exit criteria.

### 4.1 Phase A: Intent Alignment

Entry criteria:

- request/problem statement is available
- related specs and ADRs are identified

Execution tasks:

- restate scope, non-goals, and affected modules
- identify acceptance criteria and risk boundaries

Exit criteria:

- one clear implementation intent and boundary is documented

### 4.2 Phase B: Spec Update

Entry criteria:

- intent alignment is complete

Execution tasks:

- add or update normative clauses in `docs/specs`
- define explicit success and failure behavior
- map expected error classes and invariants

Exit criteria:

- spec text is implementation-ready and reviewable

### 4.3 Phase C: Failing Tests (TDD Red)

Entry criteria:

- spec update is committed in working tree

Execution tasks:

- add tests that encode the new/changed clauses
- confirm tests fail for the expected reason

Exit criteria:

- failing tests prove the new behavior is not yet implemented

A phase MUST NOT start implementation tasks before its failing tests are committed.

### 4.4 Phase D: Implementation (TDD Green)

Entry criteria:

- failing tests exist for targeted behavior

Execution tasks:

- implement minimal code required to pass tests
- preserve type safety and named-export rules
- avoid unrelated refactors

Exit criteria:

- targeted tests pass

### 4.5 Phase E: Verification and Refactor

Entry criteria:

- targeted tests pass

Execution tasks:

- refactor while preserving behavior
- run full quality gate (`pnpm test --run`, `pnpm check`)
- ensure no regressions in existing contracts

Exit criteria:

- full quality gate is green

## 5. Documentation and ADR Requirements

Any behavior change MUST update user docs in both English and Japanese.

Required updates when behavior changes:

- normative spec (`docs/specs`)
- user-facing usage docs (`docs/usage/*` and `docs/usage/*-JA`)
- ADR under `docs/adr` when architectural consequences exist

## 6. Completion Criteria

A task is considered complete only when all items are true:

- workflow order compliance is preserved
- relevant tests were written first and are passing
- quality gate commands are green
- spec/usage/ADR alignment is current

## 7. Non-Compliance Handling

If any required phase is skipped, contributors MUST stop additional implementation and return to the earliest missing phase.

Examples:

- if tests were added after implementation, rewrite sequence by revalidating spec and restoring explicit red-green evidence
- if usage docs are missing in one language, task remains incomplete

## 8. TypeScript Source Organization Policy

To keep implementation maintainable as milestones grow, contributors MUST apply the
following code-organization policy for `src/**/*.ts`.

### 8.1 Module Granularity and Split Triggers

- Public entry files include `src/core/index.ts`, `src/queryEngine/index.ts`,
  and `src/storageEngine/index.ts`; they MUST stay thin barrel entries with exports only
  and no domain logic.
- A TypeScript module MUST be split when at least one condition is true:
  - the module mixes multiple high-level responsibilities (for example:
    orchestration + validation + error taxonomy)
  - the module exceeds 300 non-empty, non-comment lines
- Contributors SHOULD split proactively before adding features when a module exceeds
  220 non-empty, non-comment lines.
- Shared types SHOULD be declared in dedicated type modules rather than mixed into
  orchestration classes.
- Validation and normalization logic SHOULD be implemented as pure functions where practical.
- Public orchestration classes (for example `Datastore`) SHOULD delegate backend-specific
  lifecycle logic (open/load/commit/schedule/close) to dedicated modules instead of
  embedding adapter/snapshot operations directly.

### 8.2 Barrel Export Policy

- One `index.ts` barrel SHOULD be used at each public package/directory boundary.
- Barrel files MUST be side-effect free and MUST contain only re-export declarations.
- Barrels MUST use explicit re-exports (`export { Symbol } from './module'`).
- Broad wildcard re-export (`export * from`) MUST NOT be used for runtime values.
- Cross-domain imports (`core` <-> `queryEngine` <-> `storageEngine`) MUST go through
  each domain's public barrel.
- Imports within the same domain SHOULD use direct module paths to keep dependency
  edges explicit.

### 8.3 Refactor Safety

- Structure-only refactors (split/rename/move without behavior change) MUST keep tests green.
- A change that introduces or updates split rules SHOULD include module-structure tests
  or import-surface assertions where practical.
