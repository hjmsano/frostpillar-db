# ADR-16: CRC32 Standardization and Internal Eviction Delete Boundary

Status: Superseded (Partially)  
Date: 2026-03-06

Superseded in part by `docs/adr/17_CRC32C_for_PageHeaderChecksum.md`
for the checksum algorithm choice.  
The turnover internal-delete boundary decision in this ADR remains active.

## Context

Two specification gaps were identified:

1. The page header had a `Header CRC32` field, but algorithm parameters were not fixed.
   This risks checksum mismatches across implementations.
2. `turnover` retention requires deterministic eviction, which implies deletion behavior,
   while current baseline API explicitly omits public delete mutations.

Without explicit wording, these can be interpreted inconsistently.

## Decision

1. Fix page-header checksum algorithm

- Standardize header checksum to `CRC-32/ISO-HDLC` (CRC32-IEEE).
- Fix algorithm parameters (`poly`, `init`, reflection flags, `xorout`) and reference check value.
- Fix checksum coverage to page header bytes at offset `0..27` (inclusive), excluding CRC field.
- Keep `Header CRC32 = 0` as "unused", but require validation when non-zero.

2. Clarify delete boundary for turnover retention

- Keep v0.2 baseline with no public delete API.
- Require internal delete path for turnover eviction.
- Align wording across page layout, capacity policy, datastore API, and B+ tree invariants.

## Consequences

Positive:

- Interoperable checksum behavior across future implementations and adapters.
- Clear corruption handling boundary for header checksum mismatch.
- No ambiguity between retention requirements and v0.2 public API scope.

Trade-offs:

- Implementations must conform to fixed CRC32 parameters instead of choosing alternatives.
- Specs and tests must explicitly cover internal-eviction delete behavior separately from public CRUD scope.
