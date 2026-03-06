# ADR-15: Persist Insertion-Order Key in Leaf Record Encoding

Status: Accepted  
Date: 2026-03-06

## Context

The B+ tree logical key and branch separators were already specified as:
`(timestamp_i64, insertion_order_u64)`.

However, record-level specs did not explicitly require persisting `insertion_order_u64`
inside each leaf record. That gap risks nondeterministic ordering when rebuilding state from
storage, including restart, compaction/rewrite, and split/merge flows.

## Decision

1. Persisted record model includes internal insertion-order key

- Update `docs/specs/01_RecordFormat.md` to define `PersistedTimeseriesRecord` with immutable
  `insertionOrder: bigint`.
- Require `insertionOrder` for every persisted record and prohibit user-provided assignment.

2. Binary format includes required top-level `INSERTION_ORDER_U64`

- Update `docs/specs/02_BinaryEncoding.md` with TLV type `0x03`:
  `INSERTION_ORDER_U64` (8-byte little-endian `Uint64`).
- Require top-level record TLV order:
  `TIMESTAMP_I64` -> `INSERTION_ORDER_U64` -> `PAYLOAD_OBJECT`.

3. Cross-spec alignment for leaf persistence

- Update `docs/specs/03_PageStructure.md` and
  `docs/specs/11_BTreeIndexInvariants.md` to require that leaf records persist both tuple
  components, not reconstructed from volatile counters or physical positions.

## Consequences

Positive:

- Deterministic equal-timestamp ordering remains stable across restart and structural maintenance.
- Split/merge and compaction can preserve logical order using persisted tuple keys only.
- Corruption detection is clearer when required tuple component is missing.

Trade-off:

- Record bytes increase by one fixed-width `Uint64` field.
- Decoder/encoder must enforce additional required-field validation.
