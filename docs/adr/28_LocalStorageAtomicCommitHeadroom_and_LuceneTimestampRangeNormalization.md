# ADR-28: LocalStorage Atomic-Commit Headroom and Lucene Timestamp-Range Normalization

Status: Accepted  
Date: 2026-03-06

## Context

Specification review surfaced two remaining ambiguity points:

1. `localStorage` commit safety requires "old committed generation stays readable on failed new write".
   In practice this implies generation-level copy-on-write and temporary double-footprint risk.
2. Lucene range literal typing rule said unquoted non-numeric bounds remain strings, while
   timestamp rules required timestamp-string normalization to epoch milliseconds. The rule
   needed explicit range-bound scope for the `timestamp` field.

## Decision

1. Clarify localStorage commit-time headroom requirement

- Keep atomic generation-swap rule: write full new generation before manifest switch.
- Explicitly state transient usage can approach `oldGeneration + newGeneration`.
- Add operational guidance that practical steady-state capacity is often around
  50% of browser localStorage quota when generation sizes are similar.

2. Clarify Lucene timestamp range normalization

- Keep existing parse-stage literal typing for Lucene ranges:
  unquoted numeric -> `number`, quoted -> `string`, unquoted non-numeric -> `string`.
- Add field-aware exception for reserved `timestamp`:
  accepted timestamp-string range bounds (inclusive/exclusive) are normalized to epoch-ms numbers
  before native execution.
- Invalid timestamp-string bounds for `timestamp` ranges raise `QueryValidationError`.

## Consequences

Positive:

- Makes localStorage durability guarantees actionable for capacity planning.
- Removes ambiguity between Lucene range typing and timestamp normalization behavior.
- Reduces implementation divergence risk across query-engine modules.

Trade-offs:

- localStorage users must account for lower effective capacity under safe commit mode.
- Query modules need an explicit field-aware normalization pass after parse-stage typing.
