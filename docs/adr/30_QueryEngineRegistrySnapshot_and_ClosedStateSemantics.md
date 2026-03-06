# ADR-30: Query Engine Registry Snapshot and Closed-State Semantics

Status: Accepted  
Date: 2026-03-06

## Context

After introducing datastore-integrated `query(language, queryText, options?)`, two
runtime-semantics gaps remained:

1. Close-state behavior for `query`, `registerQueryEngine`, and `unregisterQueryEngine`
   was not explicitly specified.
2. The effect boundary of registry mutation during in-flight `query(...)` execution
   (replace/unregister while another query is running) was not explicit.

Without explicit rules, implementations can diverge under concurrent async usage.

## Decision

1. Closed-state contract

- `Datastore.query(...)` MUST fail with `ClosedDatastoreError` after datastore is closed.
- `registerQueryEngine(...)` and `unregisterQueryEngine(...)` MUST fail with
  `ClosedDatastoreError` after datastore is closed.

2. In-flight query engine snapshot contract

- `Datastore.query(...)` resolves the target engine once per invocation boundary.
- Registry changes after this resolution (`registerQueryEngine` / `unregisterQueryEngine`)
  MUST NOT alter the engine instance used by that in-flight query.
- Registry changes apply only to subsequent query invocations.
- If no engine is registered at resolution time, `Datastore.query(...)` fails with
  `QueryEngineNotRegisteredError`.

## Consequences

Positive:

- Removes ambiguity for async race scenarios.
- Makes integrated query behavior deterministic and testable.
- Aligns implementation expectations across engines and datastore adapters.

Trade-off:

- Implementations must preserve per-call engine resolution snapshot, adding small internal
  lifecycle complexity.
