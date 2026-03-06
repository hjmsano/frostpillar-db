# ADR-05: Nested Payload and Durable Auto-Commit Frequency

Status: Accepted  
Date: 2026-03-06

## Context

The previous baseline constrained `payload` to a flat object. This was too limiting for
real event data that naturally carries grouped attributes (for example `user.profile`).

The previous datastore config also lacked an explicit periodic commit contract for durable
backends. The architecture fundamentals require write-frequency control for disk/browser
targets, but user-facing API spec details were not explicit enough.

## Decision

1. Record payload model

- Allow nested plain objects in `payload`.
- Keep leaf scalar values as `string | number | boolean | null`.
- Keep arrays unsupported in this phase.
- Reject cyclic object graphs during encode/validation.

2. TLV encoding

- Add `OBJECT` TLV support for nested payload values.
- Keep canonical key ordering requirements for deterministic byte output.

3. Datastore API config

- Add `autoCommit` option for non-memory backends only.
- Define `frequency` input with `"immediate"` plus milliseconds number or duration string (`ms`, `s`, `m`, `h`).
- Set default auto-commit frequency to `"immediate"` for durable backends.
- `location: "memory"` with `autoCommit` is invalid and must raise `ConfigurationError`.

4. Runtime behavior

- `"immediate"` commits after each successful write on durable backends.
- Non-`"immediate"` frequency schedules periodic internal `commit()` calls.
- Manual `commit()` remains available when auto-commit is enabled.
- `close()` stops auto-commit scheduling before resource release.

## Consequences

Positive:

- Better fit for realistic nested event payloads.
- Explicit and user-friendly durability scheduling contract (for example every 5 seconds, every 1 minute).
- Improved alignment between architecture intent and public API specification.

Trade-off:

- Encoding/validation complexity increases due to recursive object handling.
- Query-language modules must follow a canonical nested field path convention.
