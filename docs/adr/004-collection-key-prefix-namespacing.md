# ADR-004: Collection Isolation via Key-Prefix Namespacing

- **Status:** Superseded by [ADR-012](./012-per-collection-datastore-isolation.md)
- **Date:** 2026-04-03
- **Deciders:** Hajime Sano

## Context

frostpillar-db introduces a "collection" concept (analogous to SQL tables) on top of the storage engine's flat key-value model. We need a mechanism to isolate documents belonging to different collections within a single `Datastore` instance.

Options considered:

1. **One Datastore per collection** — each collection maps to a separate `Datastore` instance (separate files, separate B+ trees).
2. **Key-prefix namespacing** — all collections share a single `Datastore`; each document's storage key is prefixed with the collection name (e.g., `users\x00docId`).
3. **Database wrapper managing multiple Datastores** — a `Database` class that creates/destroys Datastore instances per collection.

## Decision

Adopt **key-prefix namespacing** (Option 2). All collections share one `Datastore` instance. Document keys in the storage engine follow the format:

```
{collectionName}\x00{documentId}
```

The null byte (`\x00`) separator is chosen because:

- It lexicographically sorts before any printable character.
- It cleanly separates namespace from document ID.
- `getRange('{collection}\x00', '{collection}\x01')` efficiently retrieves all documents in a collection using the B+ tree's range scan.

## Rationale

- **Single resource** — one file handle, one lock, one auto-commit cycle, one capacity pool.
- **Lightweight** — no overhead of managing multiple Datastore lifecycle (open/close/commit per collection).
- **Simpler persistence** — a single `commit()` flushes all collections atomically.
- **Efficient range scans** — the B+ tree naturally groups keys with the same prefix, making collection-level scans performant.

## Consequences

### Positive

- Minimal resource footprint — a single backing store regardless of collection count.
- Atomic `commit()` across all collections.
- Collection creation is instantaneous (no Datastore initialization).

### Negative

- All collections share one capacity quota — a large collection can crowd out smaller ones.
- No per-collection driver configuration (e.g., different persistence strategies per collection).
- Collection names must not contain the null byte separator.

### Mitigation

- Collection name validation rejects names containing `\x00`.
- Document ID generation uses `crypto.randomUUID()` (available in Node.js 19+ and modern browsers), which does not produce null bytes.
- The key prefix `_meta\x00` is reserved for future internal use (e.g., persisted collection registry). It is not currently written to storage; collection options are held in-memory only for the `Database` instance lifetime. Collection names starting with `_` are excluded from `listCollections()` results to keep this namespace available.

## Duplicate Key Policy

The underlying storage engine supports three duplicate key policies (`'allow'`, `'replace'`, `'reject'`). Because all collections share a single `Datastore` instance, the storage-level policy is set to `'allow'` (the most permissive). Per-collection duplicate key policies are enforced at the frostpillar-db layer.

Each collection is independently configured at creation time:

```ts
const logs = db.collection('logs', { duplicateKeys: 'allow' });
const settings = db.collection('settings', { duplicateKeys: 'replace' });
const users = db.collection('users', { duplicateKeys: 'reject' }); // default
```

| Policy      | Storage engine behavior          | frostpillar-db enforcement                                              |
| ----------- | -------------------------------- | ----------------------------------------------------------------------- |
| `'allow'`   | Multiple records per storage key | Multiple documents share the same `_id` within the collection           |
| `'replace'` | N/A (handled above)              | On insert with existing `_id`, silently overwrite the existing document |
| `'reject'`  | N/A (handled above)              | On insert with existing `_id`, throw `DuplicateIdError`                 |

This approach preserves per-collection flexibility while maintaining a single Datastore resource.
