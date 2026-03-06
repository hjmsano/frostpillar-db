# ADR-36: Datastore Event-Name Strictness for Error Channel

Status: Accepted  
Date: 2026-03-07

## Context

The datastore error channel is specified as `on("error", ...)` and `off("error", ...)`.
However, runtime behavior for unsupported event names (for example `"warn"`) was not
explicitly fixed in implementation.

Without an explicit rule, JavaScript callers could register unsupported names silently,
creating inconsistent behavior and hidden integration mistakes.

## Decision

Adopt strict runtime validation for datastore event names.

- Only `"error"` is supported in current datastore event channel.
- Calling `on(...)` or `off(...)` with any other event name MUST throw `ValidationError`.
- This rule applies to runtime JavaScript usage as well, not only TypeScript type checking.

## Consequences

Positive:

- prevents silent misconfiguration at runtime
- keeps event-channel behavior explicit and deterministic
- aligns implementation with spec intent and error taxonomy

Trade-off:

- callers using ad-hoc event strings will now fail fast and must migrate to `"error"`
