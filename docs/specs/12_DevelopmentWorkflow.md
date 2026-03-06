# Specification: Development Workflow

Status: Draft  
Last Updated: 2026-03-06

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
