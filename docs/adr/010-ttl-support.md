# ADR-010: TTL (Time-To-Live) Support

- **Status:** Accepted
- **Date:** 2026-04-03

## Context

Frostpillar-db is used in environments such as browser extensions and lightweight Node.js applications where automatic session/cache cleanup is desirable. Users need a way to define documents that expire after a specified duration without manual tracking.

## Decision

We implement lazy TTL support at the collection level.

### Design choices

1. **Collection-level `ttl` option (seconds):** Configured via `db.collection('sessions', { ttl: 3600 })`. Applies uniformly to all documents in the collection.

2. **`_createdAt` timestamp injection:** On `insert()`, if the collection has a `ttl` option, the system injects `_createdAt: Date.now()` (milliseconds since epoch). **Revised by [ADR-016](./016-ttl-createdat-automatic-protection.md):** this injection is now unconditional whenever `ttl` is set — a caller-supplied `_createdAt` is always overwritten, not merely used as a fallback. See ADR-016 for rationale.

3. **Lazy expiration on reads:** Expired documents are filtered out during `find()`, `findOne()`, `count()`, and other read operations. They are not immediately deleted from storage, just excluded from results.

4. **Explicit cleanup via `purgeExpired()`:** A dedicated method allows users to remove expired documents from storage on their own schedule. Returns the count of removed documents.

5. **No background timer:** We deliberately avoid background timers for deletion. Reasons:
   - Keeps implementation simple and deterministic.
   - No timer management complexity or cleanup lifecycle concerns.
   - Browser extensions may not support reliable background timers.
   - No interference with auto-commit timing or transaction boundaries.

6. **`update()` does not reset `_createdAt`:** TTL is based on creation time. Updates do not extend document lifetime. **Revised by [ADR-016](./016-ttl-createdat-automatic-protection.md):** on a `ttl` collection this is now enforced, not just a convention — any update operator targeting `_createdAt` throws `ValidationError`.

### Expiration formula

A document is expired when:

```ts
Date.now() - document._createdAt > ttl * 1000;
```

### Where filtering happens

The TTL check is applied in `executeFilter()` and `executeFilterWithStats()` after deserialization but before the filter predicate. This means expired documents are never visible to any read operation.

## Consequences

- Collections without `ttl` have zero overhead: no `_createdAt` injection, no expiration checks.
- Storage is not automatically reclaimed. Users must call `purgeExpired()` or `remove()` explicitly.
- The `_createdAt` field is not reserved; it is a normal document field that users can set explicitly.
- `purgeExpired()` performs a full collection scan, similar to `remove()`.

## Opt-in `immutableCreatedAt` option (superseded for TTL collections by ADR-016)

By default, `_createdAt` is client-writable: users may seed it on insert and change it via `$set`. This is a TTL tamper or bypass surface for untrusted callers.

To address this, the `immutableCreatedAt` collection option (default `false`) was added as a backward-compatible opt-in lock:

- When `true`, user-supplied `_createdAt` on insert is ignored and the server timestamp is always used.
- Any update operator targeting `_createdAt` (`$set`, `$unset`, `$inc`, `$push`, `$pull`, `$addToSet`, or `$rename`) is rejected with `ValidationError`.
- Existing behavior is completely unchanged when the option is absent or `false`.

> **Superseded for `ttl` collections by [ADR-016](./016-ttl-createdat-automatic-protection.md):** making this protection opt-in left every `ttl`-configured collection tamperable by default, since nothing else in the codebase reads `_createdAt` besides TTL bookkeeping — the opt-in step provided no real security benefit and was easy to forget. ADR-016 makes the protection above automatic whenever `ttl` is set, independent of `immutableCreatedAt`. `immutableCreatedAt: true` remains meaningful only for collections that do **not** use `ttl`.
