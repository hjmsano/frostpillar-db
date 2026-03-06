# ADR-31: Development Workflow and Phased Execution Playbook

Status: Accepted  
Date: 2026-03-06

## Context

The repository already contains strong technical specifications and ADR history, but day-to-day collaboration can still drift without one explicit execution protocol.

Observed issues:

1. contributors can interpret phase boundaries differently
2. checklist quality can vary across tasks
3. detailed task breakdown can be omitted even when milestones are defined

## Decision

Adopt a shared phased execution playbook for all implementation work.

The playbook is defined by `docs/specs/12_DevelopmentWorkflow.md` and supported by:

- `docs/usage/03_DevelopmentWorkflow.md`
- `docs/usage/03_DevelopmentWorkflow-JA.md`
- `docs/usage/04_DevelopmentTemplates.md`
- `docs/usage/04_DevelopmentTemplates-JA.md`
- `docs/architecture/development-roadmap.md`

Core rule:

- Every task must follow spec-first and TDD-first execution with mandatory phase gates.

## Consequences

Positive:

- higher consistency between contributors and sessions
- clearer PR readiness checks
- less process ambiguity between spec, test, code, and docs updates

Trade-off:

- contributors must spend explicit effort on phase bookkeeping and template usage

## Follow-up

- keep roadmap tasks current at phase boundaries
- update this ADR only when workflow order or gate criteria change
