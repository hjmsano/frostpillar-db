# Spec: Page Structure (v0.2 draft)

Status: Draft  
Version: 0.2  
Last Updated: 2026-03-06

This document defines Frostpillar page layout used by memory and file backends.

## 1. Core Principles

- Fixed-size pages for predictable allocation and I/O behavior.
- Slotted-page design for variable-size record storage.
- Deterministic metadata invariants to support reliable tests.
- Every committed generation has one fixed root-anchor meta page (`Page ID = 0`)
  so restart logic can locate B+ tree state deterministically.

## 2. Page Size Rules

- Default page size is `4096` bytes.
- v0.2 page size MUST be a multiple of `1024`.
- Because in-page offsets are `Uint16`, page size MUST be `<= 65535` bytes.

### 2.1 Single-Record Page-Fit Boundary (Normative)

- In v0.2, one persisted record maps to one leaf cell.
- Single record bytes MUST NOT span multiple pages.
- Overflow/continuation pages are out of scope in v0.2.
- For configured `pageSize`, the maximum encoded bytes for one record cell is:
  - `maxSingleRecordBytes = pageSize - 32 - 4`
- `32` is page header size and `4` is one slot entry size.
- If encoded record bytes exceed `maxSingleRecordBytes`, insertion MUST fail with
  a page-capacity error before page split/compaction/eviction logic for that record.

## 3. Physical Layout

```text
┌──────────────────────────────────────────────────────────────┐
│ Page Header (32 bytes)                                       │
├──────────────────────────────────────────────────────────────┤
│ Slot Array (slotCount * 4 bytes, grows forward)             │
├──────────────────────────────────────────────────────────────┤
│ Free Space                                                   │
├──────────────────────────────────────────────────────────────┤
│ Cell Data (TLV records, grows backward from page end)        │
└──────────────────────────────────────────────────────────────┘
```

## 4. Page Header (32 bytes)

All multi-byte numeric values are little-endian.

| Offset | Length | Field          | Type     | Description                                  |
| :----- | :----- | :------------- | :------- | :------------------------------------------- |
| 0      | 4      | Magic          | bytes    | ASCII `FPGE`                                 |
| 4      | 1      | Format Version | `Uint8`  | page format version (`1` for v0.2)           |
| 5      | 1      | Page Type      | `Uint8`  | `0x00` meta, `0x01` leaf, `0x02` branch      |
| 6      | 2      | Flags          | `Uint16` | reserved for future use, MUST be `0` in v0.2 |
| 8      | 4      | Page ID        | `Uint32` | logical page identifier                      |
| 12     | 2      | Cell Count     | `Uint16` | number of live cells                         |
| 14     | 2      | Slot Count     | `Uint16` | number of slots (includes tombstones if any) |
| 16     | 2      | Free Start     | `Uint16` | first byte after slot array                  |
| 18     | 2      | Free End       | `Uint16` | first byte of cell-data region               |
| 20     | 4      | Next Page ID   | `Uint32` | next leaf page, `0xFFFFFFFF` means none      |
| 24     | 4      | Prev Page ID   | `Uint32` | previous leaf page, `0xFFFFFFFF` means none  |
| 28     | 4      | Header CRC32   | `Uint32` | optional integrity field (CRC-32C), `0` if unused |

## 4.1 Header CRC32 Definition (Normative)

- Header CRC32 algorithm is fixed to `CRC-32C` (Castagnoli).
- Parameters MUST be:
  - width: `32`
  - poly: `0x1EDC6F41` (normal form; reflected form `0x82F63B78`)
  - init: `0xFFFFFFFF`
  - refin: `true`
  - refout: `true`
  - xorout: `0xFFFFFFFF`
- Reference check value for ASCII `"123456789"` MUST be `0xE3069283`.
- Checksum coverage for page header is fixed to bytes at offset `0..27` (inclusive).
- If `Header CRC32 = 0`, checksum is unused for that page.
- If `Header CRC32 != 0`, implementation MUST validate this value on read/open; mismatch MUST be treated as corruption.

## 5. Slot Entry Format (4 bytes per slot)

Each slot entry has:

- `cellOffset` (`Uint16`)
- `cellLength` (`Uint16`)

Rules:

- Live slot: `cellLength > 0`
- Empty/tombstone slot: `cellLength = 0`

## 6. Invariants (Normative)

For every valid leaf/branch page (`Page Type 0x01` or `0x02`):

- `FreeStart = headerSize + (slotCount * 4)`
- `FreeStart <= FreeEnd`
- Free bytes = `FreeEnd - FreeStart`
- For each live slot:
  - `cellOffset >= FreeEnd`
  - `cellOffset + cellLength <= pageSize`

If an insertion needs more contiguous bytes than available:

1. implementation MAY compact cell data once
2. if still insufficient, insertion MUST fail with a page-capacity error

Section 6 slot/free-space invariants apply only to leaf and branch pages.

## 7. Record Storage

- Cell data stores one TLV-encoded record per live slot.
- For each live slot, record byte boundary is the half-open range
  `[cellOffset, cellOffset + cellLength)`.
- `cellLength` MUST equal the exact byte length of one contiguous record TLV stream.
- TLV format MUST follow `docs/specs/02_BinaryEncoding.md`.
- For leaf pages (`Page Type 0x01`), each record cell MUST persist full logical key material:
  `TIMESTAMP_I64` and `INSERTION_ORDER_U64`.
- Leaf ordering MUST NOT depend on volatile in-memory counters or physical slot positions.
- v0.2 does not define a public delete API.
- Internal in-page deletion for retention turnover eviction is required and MAY mark slots as tombstones (`cellLength = 0`).
- Tombstone-compatible slots are reserved for later public mutation milestones.

## 8. Compatibility and Corruption Handling

- Unknown format version MUST be rejected.
- Invalid magic bytes MUST be rejected.
- Invalid structural invariants MUST be treated as corruption and surfaced as typed format/storage errors.

### 8.1 Fixed Meta Page Root Anchor (Normative)

For every committed generation, implementation MUST persist one fixed meta page:

- `Page ID` MUST be `0`.
- `Page Type` MUST be `0x00` (meta).
- Meta page header uses the same 32-byte header layout from section 4.
- Meta page `Next Page ID` and `Prev Page ID` fields MUST be `0xFFFFFFFF`.
- Meta page MUST set `Cell Count` to `0`.
- Meta page MUST set `Slot Count` to `0`.
- Meta page MUST set `Free Start` and `Free End` to `32`.
- Meta page does not use slotted cell storage; section 6 free-space invariants do not apply.
- Meta payload MUST begin immediately after header (offset `32`) and encode:
  - `rootPageId` (`Uint32`): current B+ tree root page ID
  - `nextPageId` (`Uint32`): next unallocated page ID
  - `freePageHeadId` (`Uint32`): free-list head page ID, or `0xFFFFFFFF` for none
  - `metaLayoutVersion` (`Uint32`): fixed to `1` in v0.2

Root anchor rules:

- `rootPageId` MUST NOT be `0` (`Page ID = 0` is reserved for meta page).
- On restart/open, implementation MUST read page `0` and use its `rootPageId`
  as the source of truth for locating the B+ tree root.
- Implementations MAY mirror root/allocation values into sidecar metadata for diagnostics
  or startup prechecks, but any mismatch with page-0 meta payload MUST be treated
  as typed corruption.

## 9. Branch Node Layout (Page Type 0x02)

Branch nodes use the same slotted structure but store routing data instead of user records.
B+ tree ordering, split/merge, and linked-leaf invariants are defined in
`docs/specs/11_BTreeIndexInvariants.md`.

### 9.1 Branch Cell Format

Each cell in a branch page represents a pivot tuple:
`(ChildPageID, SeparatorTimestampI64, SeparatorInsertionOrderU64)`.

Layout (concatenated bytes):

- `ChildPageID`: `Uint32` (4 bytes, little-endian)
- `SeparatorTimestampI64`: signed `Int64` (8 bytes, little-endian)
- `SeparatorInsertionOrderU64`: `Uint64` (8 bytes, little-endian)

Rules:

- Branch separator key bytes are fixed-length (`16` bytes) in v0.2.
- Branch separator comparison MUST be lexicographic by tuple
  `(SeparatorTimestampI64, SeparatorInsertionOrderU64)`.
- The `ChildPageID` points to a subtree containing keys
  `>= (SeparatorTimestampI64, SeparatorInsertionOrderU64)`.
- Branch separator key encoding is an internal page-layout primitive and MUST NOT
  reuse top-level record TLV envelopes from `docs/specs/02_BinaryEncoding.md`.
