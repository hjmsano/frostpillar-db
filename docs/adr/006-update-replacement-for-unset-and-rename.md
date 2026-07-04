# ADR-006: Record Replacement Strategy for `$unset` / `$rename`

- **Status:** Accepted
- **Date:** 2026-04-03
- **Deciders:** Hajime Sano

## Context

Spec 02 requires update operators that can remove or move fields:

- `$unset` removes fields
- `$rename` moves values between field paths

`frostpillar-storage-engine` provides `Datastore.updateById(id, patch)`, but this operation is a **shallow merge**. Shallow merge cannot remove keys from the payload, so `$unset` and `$rename` cannot be represented with `updateById()` alone.

## Decision

For update operations that require exact payload replacement semantics (`$unset`, `$rename`), frostpillar-db updates documents by:

1. Reading and transforming the matched document in memory.
2. Deleting the original record by entry id (`deleteById`).
3. Writing the transformed payload back with the same storage key (`put`).

For shallow-merge-compatible operations (`$set`, `$inc` only), implementations may use `updateById`.

## Rationale

- Preserves Spec 02 semantics for field removal and rename.
- Avoids introducing storage-engine-specific delete sentinels.
- Keeps update logic explicit and easy to audit.

## Consequences

### Positive

- `$unset` and `$rename` behave exactly as defined in Spec 02.
- The approach works consistently across all datastore drivers.

### Negative

- Replacement is heavier than in-place merge.
- Entry ids are reissued for replaced records.
- Duplicate-key insertion order can shift for replaced records under `'allow'`.
