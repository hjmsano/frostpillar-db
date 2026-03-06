# ADR-18: Page-0 Meta Root Anchor and Derived RecordId

Status: Accepted  
Date: 2026-03-06

## Context

Spec review surfaced three alignment risks:

1. Page layout spec defined leaf/branch pages but did not define a fixed in-file anchor
   for discovering the current B+ tree root after restart.
2. Record-identity requirements did not define how `id` is reconstructed when binary
   encoding persists tuple fields (`timestamp`, `insertionOrder`) but no standalone id bytes.
3. Sidecar metadata and in-file page state could diverge without a normative consistency rule.

## Decision

1. Introduce fixed meta page at `Page ID = 0`

- `docs/specs/03_PageStructure.md` defines `Page Type 0x00` as meta page.
- Every committed generation MUST include page `0` with root/allocation payload
  (`rootPageId`, `nextPageId`, `freePageHeadId`, `metaLayoutVersion`).
- Restart/open MUST read page `0` and use its `rootPageId` as root-anchor source of truth.

2. Define deterministic RecordId derivation from tuple key

- `docs/specs/01_RecordFormat.md` and `docs/specs/02_BinaryEncoding.md` define:
  `RecordId = "<timestamp>:<insertionOrder>"`.
- `RecordId` is derived state (not independently encoded in binary bytes).
- `RecordId` MUST NOT be user-provided and MUST NOT be derived from physical slot/page position.

3. Make sidecar/meta consistency mandatory

- `docs/specs/04_DatastoreAPI.md` and `docs/specs/10_FlushAndDurability.md` define
  sidecar root/allocation fields as mirrored values.
- On open/restart, mirrored sidecar fields MUST match page-0 meta payload;
  mismatch MUST fail as typed corruption.

## Consequences

Positive:

- Root lookup is deterministic across restart without relying on mutable runtime state.
- Record identity is reproducible from persisted tuple key, preventing encode/decode mismatch.
- Corruption detection improves by checking sidecar/page-0 consistency.

Trade-off:

- One reserved page (`Page ID = 0`) is consumed per generation.
- Implementations must maintain and validate mirrored metadata consistency.
