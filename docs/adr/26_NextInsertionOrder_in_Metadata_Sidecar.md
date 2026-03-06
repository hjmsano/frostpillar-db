# ADR-26: Persist Next Insertion-Order Counter in Metadata Sidecar

Status: Accepted  
Date: 2026-03-06

## Context

Spec review found a restart-allocation gap in file-backend durability metadata:

1. Records are globally assigned immutable, strictly increasing `insertionOrder`.
2. B+ tree key order is `(timestamp, insertionOrder)`, so backfilled timestamps can place
   newer `insertionOrder` values before the rightmost leaf key.
3. Without persisted allocator state, reopen cannot derive the next safe `insertionOrder`
   in O(1), and scanning all records is the only safe fallback.

This creates avoidable startup cost and increases risk of allocator collisions if
implementations attempt heuristic recovery.

## Decision

1. Extend sidecar schema with `nextInsertionOrder`

- `docs/specs/04_DatastoreAPI.md` now requires sidecar field:
  `nextInsertionOrder` (unsigned base-10 integer string).
- Range is unsigned 64-bit domain: `0` to `18446744073709551615`.

2. Make O(1) restart allocation mandatory

- On open/restart, implementations MUST initialize insertion-order allocator directly from
  sidecar `nextInsertionOrder`.
- Implementations MUST NOT derive allocator state from rightmost/last B+ tree key.

3. Include allocator state in crash-safe sidecar activation payload

- `docs/specs/10_FlushAndDurability.md` commit protocol now includes writing
  `nextInsertionOrder` in temporary sidecar before atomic activation.
- Activated sidecar value is normative allocator state for reopen.

4. Align tests and user docs

- `docs/testing/strategy.md` adds reopen checks for sidecar `nextInsertionOrder` recovery.
- `docs/usage/01_DatastoreAPI.md` and `docs/usage/01_DatastoreAPI-JA.md` describe the new
  sidecar field and O(1) restart rationale.

## Consequences

Positive:

- Restart allocation is deterministic and O(1) without full-record scan.
- Prevents tie-break allocator collisions caused by incorrect tail-key inference.
- Keeps behavior consistent with immutable globally increasing insertion-order contract.

Trade-off:

- Sidecar schema gains one additional required field that implementations must validate.
