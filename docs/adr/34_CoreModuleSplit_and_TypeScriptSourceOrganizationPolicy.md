# ADR-34: Core Module Split and TypeScript Source Organization Policy

Status: Accepted  
Date: 2026-03-06

## Context

The initial M1 implementation placed types, errors, validation, ordering logic, and
`Datastore` orchestration in one `src/core/index.ts` file.

As implementation scope grows, this shape increases maintenance cost:

1. higher review overhead from mixed concerns in one file
2. lower reuse of validation/ordering helpers
3. fragile change boundaries for future milestones

## Decision

Adopt a modular source-organization policy for TypeScript core code.

- Keep `src/core/index.ts` as a thin barrel export entry.
- Split core implementation into responsibility-focused modules:
  - domain types
  - typed errors
  - validation/normalization helpers
  - ordering helpers
  - datastore orchestration
- Prefer pure functions for validation/normalization logic.
- Keep behavior-preserving refactors test-backed and separate from feature expansion.

## Consequences

Positive:

- clearer responsibility boundaries
- smaller diff surface per change
- easier targeted unit tests and safer refactors

Trade-off:

- introduces more files and import wiring
