# ADR-22: Payload BigInt Boundary and Page Cell Boundary Clarity

Status: Accepted  
Date: 2026-03-06

## Context

Recent spec review highlighted two recurring interpretation gaps:

1. `docs/specs/01_RecordFormat.md` and `docs/specs/02_BinaryEncoding.md` allow
   internal `insertionOrder` as `Uint64`/`bigint`, while payload numeric encoding
   is `FLOAT64`-based.
2. Some readers inferred payload `bigint`/int64 support from internal tuple usage,
   which is not the intended v0.2 contract.
3. B+ tree and binary specs rely on page-layout rules; record byte boundaries
   within slots and branch-cell tuple bytes should be explicit enough to verify
   invariants without ambiguity.

## Decision

1. Keep payload `bigint` out of scope in v0.2

- Payload leaf values remain `string | number | boolean | null`.
- `bigint` payload values are explicitly rejected.
- For exact 64-bit integer preservation in payload, users should store decimal
  strings and parse at the application boundary.

2. Keep payload numeric TLV domain as `FLOAT64` only in v0.2

- `Int64`/`Uint64` payload value TLV types are not defined in v0.2.
- `Uint64` remains reserved for internal tuple fields such as
  `INSERTION_ORDER_U64`.

3. Clarify page-level record boundaries and branch-cell layout

- Slot-backed record bytes are defined as `[cellOffset, cellOffset + cellLength)`.
- `cellLength` must equal one contiguous TLV record byte stream length.
- B+ tree routing section includes an inline byte-layout summary for branch cells
  (`ChildPageID(4) || SeparatorTimestampI64(8) || SeparatorInsertionOrderU64(8)`).

4. Reflect these constraints in user docs (EN/JA)

- Add explicit guidance for exact 64-bit payload values via decimal strings.

## Consequences

Positive:

- Reduces confusion between internal tuple `Uint64` and user payload types.
- Improves cross-spec reviewability for slot/record boundary correctness.
- Makes precision-preserving payload strategy explicit for users.

Trade-offs:

- Payload numeric type remains limited to JavaScript finite `number` semantics.
- Applications requiring numeric int64 operations must handle string conversion.
