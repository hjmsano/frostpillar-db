# ADR-21: Key and String Byte-Length Limits for Lightweight Bounds

Status: Accepted  
Date: 2026-03-06

## Context

Spec review identified a bounded-resource gap in payload text handling:

1. `docs/specs/02_BinaryEncoding.md` uses `Uint32` TLV length fields.
2. Without explicit payload key/string limits, pathological inputs can request very
   large allocations in validation and decode paths.
3. Frostpillar vision emphasizes lightweight, bounded behavior for memory- and
   page-constrained environments.

Although page-fit limits already constrain one encoded record in paged storage,
a spec-level key/string bound is still required for API validation and non-paged
execution paths.

## Decision

1. Set payload key UTF-8 byte length to `1024`

- Applies at every nested object level.
- Empty keys remain invalid as previously defined.

2. Set payload string UTF-8 byte length to `65535`

- Applies to all `string` payload values, including nested object values.
- This bound is independent from page-fit checks; paged storage may reject earlier
  when `maxSingleRecordBytes` is smaller.

3. Enforce alignment across API, record format, and binary encoding specs

- API `insert` validation documents both limits.
- Binary encoding documents encoder/decoder failure for violations.
- Usage guides (EN/JA) expose the same limits to users.

## Consequences

Positive:

- Reduces memory amplification risk from unbounded key/value text input.
- Keeps behavior predictable for lightweight deployments.
- Clarifies that `Uint32` TLV length is envelope capacity, not a user-facing
  allowance target.

Trade-offs:

- Some very long payload strings/keys that are technically encodable are rejected.
- Future limit changes require coordinated spec, docs, and ADR updates.
