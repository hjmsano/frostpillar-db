# ADR-45: Query Predicate Memory Bound and Regex Compile Reuse

Status: Accepted  
Date: 2026-03-07

## Context

Security review feedback on PR #5 identified two runtime DoS risk points:

1. `like` wildcard matching used a full 2D dynamic-programming table, which scales
   memory as `O(text length * pattern length)` and can over-allocate on large records
2. `regexp` predicate evaluation compiled `RegExp` repeatedly per candidate record,
   adding avoidable CPU and GC pressure during scans

Frostpillar's vision prioritizes deterministic, lightweight execution under bounded
resources. Query predicate execution must preserve safety bounds even when input size
or record count is high.

## Decision

Adopt explicit runtime constraints for native query predicate evaluation.

- `like` wildcard matching MUST use an algorithm with additional working memory
  bounded by pattern length (for example two-row dynamic programming).
- Native query execution MUST validate and compile each `regexp` predicate pattern once
  per query invocation and reuse the compiled matcher across all candidate records.
- Existing pattern-safety constraints remain in effect:
  max pattern length 256, and rejection of backreferences/look-around/nested quantifiers.

## Consequences

Positive:

- avoids memory blow-up risk from adversarially large `like` input text
- reduces repeated regex compilation overhead and scan-time CPU pressure
- keeps query behavior unchanged while tightening execution cost predictability

Trade-off:

- implementation becomes slightly more structured (precompile stage + evaluation context)
  to enforce one-time regexp compilation and matcher reuse
