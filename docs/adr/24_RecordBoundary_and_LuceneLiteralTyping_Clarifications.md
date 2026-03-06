# ADR-24: Record Boundary and Lucene Literal Typing Clarifications

Status: Accepted  
Date: 2026-03-06

## Context

Cross-spec review highlighted three points that still caused implementation ambiguity:

1. Payload string byte limits were defined at record validation boundary, but readers
   could misinterpret them as sufficient for persistence in fixed-size pages.
2. TLV type table started at `0x01` without an explicit reserved `0x00` statement,
   leaving undefined behavior for zero-filled or sentinel-like bytes.
3. Lucene subset needed explicit rules for null predicates and range-bound literal
   typing in a schema-less payload model.

## Decision

1. Clarify validation limit vs page-fit boundary

- Payload string byte limits remain `<= 65535` in record validation.
- These limits are explicitly independent from page-fit constraints.
- `insert` documentation now states that records can pass payload validation yet
  still fail page-fit checks based on configured `pageSize`.

2. Reserve Type ID `0x00`

- Type ID `0x00` remains reserved in v0.2.
- `0x00` MUST NOT be emitted for valid TLV fields.
- Decoder must treat encountered `Type = 0x00` as typed format failure.

3. Define Lucene null and range literal typing

- `field:*` continues to map to `exists` and therefore matches explicit `null` values.
- Unquoted `field:NULL` (case-insensitive) maps to native `is_null`.
- Quoted `field:"NULL"` remains a normal string term.
- For range bounds, unquoted numeric literals map to `number`; quoted bounds remain `string`.
- Unquoted non-numeric bounds remain `string`.

## Consequences

Positive:

- Removes a recurrent misunderstanding between API validation and storage-page limits.
- Makes TLV type-space behavior explicit for safer decode implementations.
- Eliminates Lucene ambiguity around null and range comparisons in mixed-type data.

Trade-offs:

- Lucene parser behavior is now stricter and must implement deterministic literal typing.
- Some existing loosely interpreted Lucene inputs may now fail with typed query errors.
