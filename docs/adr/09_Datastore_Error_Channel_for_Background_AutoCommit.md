# ADR-09: Datastore Error Channel for Background Auto-Commit Failures

Status: Accepted  
Date: 2026-03-06

## Context

`autoCommit.frequency` supports non-`"immediate"` schedules for durable backends.
Those commits run in background tasks and are not directly tied to a caller-visible Promise.

The Datastore API spec already required that auto-commit failures surface as `StorageEngineError`,
but it did not define a concrete delivery path ("error channel"). Without an explicit channel,
production systems could miss durability failures silently.

## Decision

1. Introduce a datastore-level error event channel

- Add `on("error", listener)` and `off("error", listener)` to `Datastore`.
- `on` returns an unsubscribe function equivalent to `off`.

2. Define structured error event payload

- Event payload type is `DatastoreErrorEvent`.
- Initial `source` scope is `"autoCommit"` for background scheduled commit failures.
- `event.error` MUST be `StorageEngineError` for background auto-commit failures.
- `event.occurredAt` carries epoch milliseconds for operational observability.

3. Preserve existing Promise rejection behavior

- Foreground API failures (`insert`, explicit `commit`, etc.) continue to reject their own Promise.
- Error channel is additive and intended for asynchronous failures without direct Promise ownership.

4. Delivery safety rules

- Emission with zero listeners MUST NOT throw.
- Listener failure MUST NOT block delivery to other listeners.
- `close()` stops background scheduling; no new auto-commit error events are emitted after close.

## Consequences

Positive:

- Removes ambiguity from "error channel" in public API contract.
- Enables robust production monitoring and alerting for background durability failures.
- Keeps API evolution minimal and backward-compatible with existing Promise-based error handling.

Trade-off:

- Runtime must manage listener lifecycle and delivery isolation logic.
- Implementers must add explicit tests for async event emission semantics.
