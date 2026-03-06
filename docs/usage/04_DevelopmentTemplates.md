# Usage: Development Templates

Status: Draft  
Last Updated: 2026-03-06

This guide provides reusable templates for spec-first and TDD-first collaboration.

## 1. Spec Update Template

```md
# Specification: <Feature Name>

Status: Draft
Last Updated: <YYYY-MM-DD>

## 1. Purpose

## 2. Scope

In scope:

- <item>

Out of scope:

- <item>

## 3. Normative Requirements

- The system MUST <behavior>.
- The system MUST NOT <forbidden behavior>.
- On <failure condition>, the system MUST throw `<ErrorType>`.

## 4. Acceptance Criteria

- <observable criterion>

## 5. Test Implications

- Add failing test for <requirement>
- Add regression test for <boundary>
```

## 2. ADR Template

```md
# ADR-XX: <Decision Title>

Status: Proposed
Date: <YYYY-MM-DD>

## Context

## Decision

## Alternatives Considered

1. <alternative>
2. <alternative>

## Consequences

Positive:

- <impact>

Trade-off:

- <impact>
```

## 3. Phased Task Breakdown Template

```md
# <Feature Name> Delivery Plan

## Phase 0: Intent Alignment

Entry:

- <criterion>

Tasks:

- [ ] <task>

Exit:

- <criterion>

## Phase 1: Spec Update

Tasks:

- [ ] <task>

## Phase 2: Failing Tests

Tasks:

- [ ] <task>

## Phase 3: Implementation

Tasks:

- [ ] <task>

## Phase 4: Verification

Tasks:

- [ ] <task>

## Risks and Mitigations

- Risk: <risk>
  Mitigation: <mitigation>
```

## 4. PR Checklist Template

```md
- [ ] Scope and non-goals are clear
- [ ] Spec updated before implementation
- [ ] Failing tests added before implementation
- [ ] Implementation passes targeted tests
- [ ] Full quality gate passes (`pnpm test --run`, `pnpm check`)
- [ ] EN/JA usage docs updated when user-visible behavior changed
- [ ] ADR updated if architectural consequences exist
```
