# ADR-016: Automatic `_createdAt` Protection on TTL Collections

- **Status:** Accepted
- **Date:** 2026-07-02
- **Deciders:** Hajime Sano

## Context

[ADR-010](./010-ttl-support.md) introduced TTL support and, later, an opt-in `immutableCreatedAt` collection option to stop callers from tampering with `_createdAt` (the sole field TTL expiry is computed from). The option defaulted to `false` and was completely independent of whether the collection had `ttl` configured at all.

A security re-audit found this gating was ineffective in practice: `_createdAt` has no purpose other than TTL bookkeeping — nothing else in the codebase reads it. Yet the common case, `db.collection('sessions', { ttl: 3600 })`, left it fully client-writable unless the caller separately remembered to also pass `immutableCreatedAt: true`. Confirmed exploit paths on a default TTL collection (no `immutableCreatedAt`):

- `update({_id}, { $set: { _createdAt: <+1yr> } })` (or the equivalent `$inc`) pushes expiry arbitrarily into the future, defeating TTL entirely.
- `insert({ ..., _createdAt: <-1day> })` forges a past timestamp, expiring a document immediately (denial of service against the record the caller just wrote, or a way to make a document invisible to `find()` without triggering a `remove()` watch event).

Both were rejected correctly when `immutableCreatedAt: true` was set — the underlying mechanism was already sound — but requiring an extra opt-in flag on top of `ttl` meant the secure configuration was not the default one, which is the wrong default for a field that exists purely as a security/expiry boundary.

## Decision

Whenever a collection has `ttl !== undefined`, `_createdAt` is protected exactly as `immutableCreatedAt: true` already protected it — **regardless of the `immutableCreatedAt` flag's actual value**:

1. **Insert time** (`prepareInsertRecord` in `src/internal/collectionUtils.ts`): `_createdAt` is unconditionally overwritten with the server-generated `createdAt` whenever `ttl !== undefined`. A caller-supplied `_createdAt` is never used. The `immutableCreatedAt` parameter this function previously took is removed — it no longer affects insert-time behavior at all (the ttl check subsumes it).
2. **Update time** (`Collection.update()` / `Collection.performUpsert()` in `src/collection.ts`): the `protectCreatedAt` flag passed to `applyUpdateOperations()` / `buildUpsertDocument()` is now `this.immutableCreatedAt || this.ttl !== undefined`, so any `$set` / `$unset` / `$inc` / `$push` / `$pull` / `$addToSet` / `$rename` touching `_createdAt` throws `ValidationError` on any TTL collection, with or without `immutableCreatedAt`.

`immutableCreatedAt: true` remains meaningful for collections **without** `ttl`, but only for the **update-time** half of the protection: it is the only way to make `_createdAt` reject `$set`/`$unset`/`$inc`/`$push`/`$pull`/`$addToSet`/`$rename` on a collection that doesn't expire documents (e.g. an audit log where `_createdAt`, once set, should never change again). The **insert-time** server-timestamp override is tied specifically to `_createdAt`'s role as TTL bookkeeping (`prepareInsertRecord` only ever writes it when `ttl !== undefined`) and is unaffected by `immutableCreatedAt` alone — this was already true before this ADR and is unchanged by it. So on a non-TTL collection, `immutableCreatedAt: true` gives a "write-once" guarantee (the value present right after insert, whatever it is, can never change), not a "server-assigned" one. On a `ttl` collection, setting `immutableCreatedAt: true` is redundant but harmless for both halves — protection was already on because of `ttl` alone.

### Behavioral consequences

| Collection config                         | Insert: caller `_createdAt`        | Update: `$set`/`$inc`/etc. on `_createdAt` |
| ------------------------------------------ | ----------------------------------- | -------------------------------------------- |
| `{ ttl: N }` (before ADR-016)              | preserved as-is                     | allowed                                      |
| `{ ttl: N }` (after ADR-016)               | **overwritten by server timestamp** | **`ValidationError`**                        |
| `{ ttl: N, immutableCreatedAt: true }`     | overwritten (unchanged)             | `ValidationError` (unchanged)                |
| `{}` (no `ttl`, no `immutableCreatedAt`)   | preserved as-is (unchanged)         | allowed (unchanged)                          |
| `{ immutableCreatedAt: true }` (no `ttl`)  | preserved as-is (unchanged)         | `ValidationError` (unchanged)                |

Only the first row is a breaking change, and it closes a live security gap rather than removing a feature: user code that relied on setting `_createdAt` on a `ttl` collection to control expiry timing, or on extending a document's lifetime via `$set { _createdAt: Date.now() }`, must instead let the server assign `_createdAt`, and must remove + re-insert a document to reset its TTL clock. The last row is included for completeness, not as a change — it was already the pre-ADR-016 behavior and stays that way, since `prepareInsertRecord`'s server-timestamp write was, and remains, gated on `ttl !== undefined` alone (see Decision item 1).

## Rationale

- **Security default should not require an extra opt-in.** A field whose only purpose is expiry bookkeeping should not be tamperable by default just because a second, easy-to-forget flag wasn't also set. Tying the protection to `ttl` itself makes the secure configuration the *only* configuration for TTL collections.
- **`immutableCreatedAt` is not made meaningless.** It still controls update-time protection on non-TTL collections, which is a real, distinct use case (e.g. audit trails that want a tamper-proof `_createdAt` after the fact, without any expiry semantics or insert-time server assignment).
- **No new mechanism.** The enforcement code path (`protectCreatedAt` threading into `updateValidator.ts` / `updateApplier.ts` / `collectionQueryHelpers.ts`) already existed and was already correct, and already applied to non-TTL collections with `immutableCreatedAt: true` — this change only widens *when* it is engaged for TTL collections, not *how* it behaves.

## Consequences

### Positive

- Every `ttl`-configured collection is secure by default; there is no longer a footgun configuration for the common case.
- `immutableCreatedAt` retains a clear, non-overlapping purpose (protecting `_createdAt` on non-TTL collections).

### Negative

- **Breaking behavioral change** for any caller that was relying on a `ttl` collection's `_createdAt` being client-writable (e.g. to backdate seed data in tests, or to extend session lifetime via `$set`). See the table above.

### Mitigation

- Callers that need a controllable creation timestamp without TTL semantics should use a different field name (e.g. `createdAt` without the underscore, or a domain-specific field) — `_createdAt` is now unconditionally reserved for TTL bookkeeping on any `ttl` collection.
- Callers that need to extend a TTL document's lifetime should remove and re-insert it rather than mutating `_createdAt` in place.

### Addendum: dotted sub-path bypass (round-2 follow-up)

The update-time protection described above (`assertUpdatablePath` / `validateRenameEntry` in `src/internal/updateValidator.ts`) originally matched `_createdAt` by **exact string equality**, which missed a dotted sub-path such as `_createdAt.tamper`. This was moot while `_createdAt` was always a plain number on any protected document — `setValueByPath` refuses to create a nested field under a non-object — but a document that has never had `_createdAt` written to it (e.g. a legacy document inserted before `ttl` was configured on the collection, then the same collection reopened later with `ttl` added) has no `_createdAt` field at all, and `setValueByPath` happily *creates* it as a nested object via the dotted path, bypassing the check and leaving the document permanently un-expirable. The check now matches `_createdAt` itself or any path starting with `_createdAt.`, closing this gap. See `tests/integration/collection-immutable-createdat.test.ts` for the end-to-end repro (fileDriver, collection created without `ttl`, reopened with `ttl` added).

## References

- `src/internal/collectionUtils.ts` — `prepareInsertRecord`.
- `src/collection.ts` — `Collection.update()`, `Collection.performUpsert()`.
- `docs/specs/01-database-and-collection.md` §1.3, §2.7 — updated wording.
- `docs/adr/010-ttl-support.md` — original TTL and `immutableCreatedAt` design; partially superseded by this ADR.
- `tests/integration/collection-immutable-createdat.test.ts` — coverage for both the pre-existing `immutableCreatedAt: true` path and the new default-TTL-protection path.
