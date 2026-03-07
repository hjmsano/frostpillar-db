# ADR-53: Security Hardening Execution for Symlink, Payload, and Query Guardrails

Status: Accepted  
Date: 2026-03-07

## Context

ADR-51 established an implementation order for four open security findings:

1. symlink-aware file path containment
2. payload aggregate guardrails
3. query recursion depth guard
4. query row-budget guardrails

These items required concrete implementation contracts beyond planning text.

## Decision

Adopt canonical realpath containment, payload aggregate guardrails, and query depth/row budgets.

- File datastore path containment MUST use canonical `realpath`-based checks.
- File datastore MUST re-check canonical containment immediately before lock/data file creation.
- Payload validation MUST enforce:
  - per-object key count limit (`256`)
  - total key count limit (`4096`)
  - aggregate validation byte budget (`1048576`)
- Native query execution MUST enforce:
  - filter-expression depth limit (`64`)
  - scanned-row limit (`10000`)
  - output-row limit (`5000`)
- Native query implementation SHOULD avoid duplicate full-size intermediate arrays.

## Consequences

Positive:

- closes symlink escape path for cwd containment policy
- bounds payload and query memory growth with deterministic typed errors
- reduces stack-overflow risk from excessively deep filter expressions

Trade-off:

- large payloads and very wide query scans now fail with explicit validation errors
- guardrails add small validation overhead per operation
