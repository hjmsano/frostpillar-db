# ADR-43: Query Regex Safety and File Path Containment

Status: Accepted  
Date: 2026-03-07

## Context

Two security risks were identified in current core behavior:

1. query predicates (`like` / `regexp`) could build or execute attacker-controlled patterns
   with unbounded complexity
2. file datastore path resolution accepted unchecked path components, allowing path escape
   outside intended working scope

Frostpillar targets lightweight and deterministic operation, so query and storage configuration
must keep worst-case execution and write targets bounded.

## Decision

Bound query-time pattern complexity and enforce file datastore path containment.

- `like` no longer relies on dynamic regular-expression compilation from user pattern text.
- `like` and `regexp` patterns are length-bounded (256 UTF-16 code units).
- `regexp` rejects patterns that include look-around assertions, backreferences,
  or nested-quantifier group forms (for example `(a+)+`).
- File datastore resolved paths must stay within `process.cwd()`.
- `target.filePrefix` and `target.fileName` are restricted to safe file-name fragments
  (no path separator and no traversal token `..`).

## Consequences

Positive:

- lower ReDoS risk surface for query execution
- deterministic pattern-evaluation bounds under hostile input
- reduced path-traversal/arbitrary-write risk for file backend configuration

Trade-off:

- some advanced regular-expression constructs are intentionally unsupported
- file datastore paths outside `process.cwd()` require explicit runtime/environment design change
