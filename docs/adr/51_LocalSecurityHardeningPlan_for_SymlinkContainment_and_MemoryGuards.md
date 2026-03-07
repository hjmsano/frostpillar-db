# 51. Local Security Hardening Plan for Symlink Containment and Memory Guards

- Status: Accepted
- Date: 2026-03-07

## Context

A focused security review identified unresolved local-risk areas despite prior hardening:

1. Lexical path containment under `process.cwd()` can be bypassed by symlinked directories.
2. Query execution currently materializes multiple large intermediate arrays.
3. Payload validation lacks aggregate-size and breadth bounds.
4. Query-expression recursion lacks explicit depth limit.

The project is not exposed as a public internet API, but these still create practical crash,
resource exhaustion, and policy-bypass risks in local/integration environments.

## Decision

We will execute security hardening in the following order:

1. **Path containment canonicalization (P1 / High)**
   - Canonicalize both base and target paths via `realpath` before containment checks.
   - Reject targets that resolve outside allowed roots.
   - Add symlink escape regression tests.

2. **Payload aggregate guardrails (P2 / Medium)**
   - Introduce aggregate payload byte cap and total-key cap.
   - Keep existing depth/per-key/per-string limits.

3. **Query recursion and memory guardrails (P2 / Medium-Low)**
   - Add maximum filter expression depth validation.
   - Add row scan/output limits for native query execution.

4. **Pipeline optimization follow-up (P3 / Medium)**
   - Reduce query intermediate allocations where sort/distinct semantics allow.

## Consequences

### Positive

- Closes containment gap where symlink indirection can escape configured boundary intent.
- Reduces OOM/stack-overflow probability from malformed or accidental large inputs.
- Makes failure mode deterministic (`ValidationError` / `QueryValidationError`) rather than
  VM-level crash behavior.

### Negative / Trade-offs

- Additional validation checks add small runtime overhead.
- Some currently accepted large payloads/queries will be rejected in hardened mode.
- Implementation requires coordinated spec + test + docs updates across multiple modules.

## Compliance

This ADR provides the canonical decision record for future implementation PRs that land
security hardening for the four review findings.
