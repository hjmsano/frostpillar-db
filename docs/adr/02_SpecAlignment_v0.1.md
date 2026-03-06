# ADR-02: v0.1 Spec Alignment Baseline

Status: Accepted  
Date: 2026-03-06

## Context

Initial spec drafts were directionally correct but had ambiguities that would cause implementation and test drift:

- timestamp encoding type and byte-level details were not strict enough
- page header and slot layout were underspecified for deterministic validation
- datastore API did not define lifecycle methods or closed-state behavior
- user-facing usage docs (EN/JA) were missing for updated API expectations

## Decision

Adopt a stricter v0.1 baseline across `docs/specs`:

1. Record contract

- Timestamp is safe-integer epoch milliseconds.
- Payload is flat object with primitive values only.
- Query ordering is deterministic by timestamp then insertion order.

2. TLV encoding contract

- All multi-byte numbers are little-endian.
- Timestamp uses `TIMESTAMP_I64` with fixed 8-byte value.
- Payload keys are encoded in canonical UTF-8 lexicographic order.
- Decoder rejects unknown types and malformed lengths in v0.1.

3. Page layout contract

- 32-byte concrete page header.
- 4-byte slot entries (`cellOffset`, `cellLength`).
- Explicit free-space invariants and corruption rejection rules.

4. Datastore API contract

- Add `commit()` and `close()` to public API.
- Define idempotent close behavior and closed-state errors.
- Keep config union for memory/file while requiring `UnsupportedBackendError` for file before M2.

5. User documentation

- Add `docs/usage/01_DatastoreAPI.md` (EN).
- Add `docs/usage/01_DatastoreAPI-JA.md` (JA).

## Consequences

Positive:

- Spec-first and TDD workflows now have unambiguous targets.
- Reduced risk of implementation variance across storage/query layers.
- Clearer migration path for M2+ without changing v0.1 core semantics.

Trade-off:

- Some details are now fixed earlier and may require explicit ADR updates for later format evolution.
