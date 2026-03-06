# ADR-20: Payload Object Depth Limit for Stability

Status: Accepted  
Date: 2026-03-06

## Context

Spec review identified a stability gap in nested payload handling:

1. `docs/specs/01_RecordFormat.md` allows nested plain objects and rejects cycles.
2. `docs/specs/02_BinaryEncoding.md` defines recursive TLV object encoding/decoding.
3. Prior specs did not define a maximum nesting depth.

Without an explicit limit, extremely deep payloads can trigger stack overflow or
resource exhaustion in recursive traversal paths.

## Decision

1. Set max nesting depth to `64`

- Payload root object depth is `0`.
- Each nested plain object / `OBJECT` TLV increments depth by `1`.
- Any payload/object tree deeper than `64` is invalid in v0.2.

2. Enforce depth at all relevant boundaries

- API validation path rejects over-depth payload input.
- Binary encoder rejects over-depth payload before byte emission.
- Binary decoder rejects over-depth payload bytes as typed format failure.

3. Keep rule aligned across specs and usage docs

- `docs/specs/01_RecordFormat.md` and `docs/specs/02_BinaryEncoding.md` share
  the same normative value and counting rule.
- User-facing usage guides (EN/JA) include the same limit.

## Consequences

Positive:

- Prevents unbounded recursive traversal behavior from becoming a crash vector.
- Improves deterministic resource bounds for payload validation and binary parsing.
- Reduces ambiguity between API and binary layers.

Trade-offs:

- Very deeply nested JSON-like payloads are rejected even if otherwise valid.
- Future relaxation requires explicit spec/ADR update and non-recursive implementation proof.
