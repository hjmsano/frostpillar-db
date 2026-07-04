# ADR-008: Collection Metadata Storage

- **Status:** Accepted
- **Date:** 2026-04-03
- **Deciders:** Hajime Sano

## Context

When a user calls `db.collection('users', { duplicateKeys: 'allow' })`, the `Database` instance must remember these options so that subsequent calls to `db.collection('users')` return a collection with the same policy, and calls with conflicting options throw `ConfigurationError`.

The question is whether these collection options (metadata) should be persisted to the storage engine or held only in-memory.

## Decision

Collection options are held **in-memory only**, within the `Database` instance's `collectionOptions` map. They are **not** persisted to the storage engine.

## Rationale

- **Simplicity** -- No special storage format or migration logic is needed for metadata records.
- **No cross-session dependency** -- Each `Database` instance is independently configured. Applications declare collection options at startup, which is a natural pattern for embedded databases.
- **Consistent with current usage** -- The `_meta\x00` key prefix referenced in ADR-004 is reserved but not yet written to storage. There is no existing metadata persistence to maintain backward compatibility with.
- **Avoids storage overhead** -- No extra records in the B+ tree for bookkeeping.

## Consequences

### Positive

- Zero storage overhead for collection configuration.
- `dropCollection()` only needs to delete document records and clear in-memory maps; no metadata cleanup in storage.
- Simpler implementation with fewer failure modes.

### Negative

- Collection options must be re-declared each time a `Database` instance is created. If application code changes the options between restarts (e.g., switching from `'reject'` to `'allow'`), the change takes effect silently without migration.
- No way to inspect a stored collection's intended policy without application-level knowledge.

### Future Considerations

- If persistent collection metadata becomes necessary (e.g., for schema validation, indexing hints, or cross-session option enforcement), a dedicated metadata Datastore per database could provide a natural storage location.
- Such a change would require a migration path and versioning strategy for metadata records.
