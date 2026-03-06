# ADR-41: Source Granularity and Barrel Boundary Policy for src

Status: Accepted  
Date: 2026-03-07

## Context

ADR-34 established responsibility-based module split and a thin core barrel entry.
However, it did not define concrete split triggers or consistent barrel boundary rules
for all domains under `src/`.

As a result, large files can grow again during feature work, and import patterns can
become inconsistent:

1. no objective trigger to split a growing module
2. ambiguous use of barrel vs direct import
3. higher risk of hidden dependency edges and review overhead

## Decision

Adopt explicit source-granularity and barrel-boundary rules across `src/**/*.ts`.

- Keep each domain entry `index.ts` as a thin, side-effect-free barrel.
- Split modules when responsibilities are mixed or size exceeds 300 non-empty,
  non-comment lines.
- Encourage proactive splitting once a module exceeds 220 non-empty,
  non-comment lines before adding new features.
- Use explicit re-exports in barrel files and avoid runtime `export *`.
- Route cross-domain imports through public barrels and prefer direct imports inside
  the same domain.

Normative details live in `docs/specs/12_DevelopmentWorkflow.md` section 8.

## Consequences

Positive:

- predictable split timing before files become difficult to review
- clearer public import surfaces and safer domain boundaries
- reduced chance of accidental cyclic or opaque dependency wiring

Trade-off:

- more files and additional barrel maintenance in exchange for long-term readability
