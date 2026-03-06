# ADR-17: Adopt CRC-32C for Page Header Checksum

Status: Accepted  
Date: 2026-03-06

## Context

ADR-16 fixed page-header checksum parameters, but selected `CRC-32/ISO-HDLC`
(CRC32-IEEE). We want to standardize on `CRC-32C` (Castagnoli) instead for better
alignment with modern hardware acceleration and common storage-system practice.

The checksum field and coverage remain unchanged:

- field: page header `Header CRC32` (`Uint32`)
- coverage: bytes at offset `0..27` (inclusive)
- `0` means checksum unused for that page

## Decision

1. Replace checksum algorithm with CRC-32C

- Page header checksum algorithm is now `CRC-32C` (Castagnoli).
- Parameters are fixed to:
  - width: `32`
  - poly: `0x1EDC6F41` (normal form; reflected form `0x82F63B78`)
  - init: `0xFFFFFFFF`
  - refin: `true`
  - refout: `true`
  - xorout: `0xFFFFFFFF`
- Reference check value for ASCII `"123456789"` is fixed to `0xE3069283`.

2. Keep all other checksum semantics unchanged

- `Header CRC32 = 0` means unused.
- `Header CRC32 != 0` MUST be validated on read/open.
- Mismatch MUST be treated as corruption.

3. Supersession

- This ADR supersedes only the checksum algorithm choice in ADR-16.
- ADR-16 decision about internal delete boundary for turnover remains active.

## Consequences

Positive:

- Better compatibility with CPU-assisted CRC32C paths where available.
- Clear, fixed parameters prevent cross-implementation checksum mismatch.

Trade-offs:

- Existing implementations/tests targeting CRC32-IEEE must migrate vectors and code paths.
- If on-disk pages with non-zero header CRC32 were already written using CRC32-IEEE,
  open/read compatibility requires explicit migration handling.
