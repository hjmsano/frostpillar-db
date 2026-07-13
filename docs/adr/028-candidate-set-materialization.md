# ADR-028: Candidate-Set Materialization Is Bounded by the Storage Engine

- **Status:** Accepted
- **Date:** 2026-07-13
- **Deciders:** Hajime Sano
- **Relates to:** [ADR-001](./001-storage-engine-delegation.md), [ADR-012](./012-per-collection-datastore-isolation.md), [ADR-027](./027-custom-key-id-identity.md)

## Context

`maxMatchedDocuments` and `.limit(n)` are described as memory bounds, and for the **matched** set they are: `scanRecords` stops pushing once the limit is reached, and throws past the cap. Neither bounds the **candidate** set.

Every scan begins by asking the datastore for candidates (`internal/collectionQueryHelpers.ts`, `getRecordsByFilter`). The storage engine's read API returns arrays — `getAll()`, `getRange(start, end)`, `getMany(keys)` — so by the time frostpillar-db can filter a single record, or honour a single `.limit(1)`, the whole candidate array is already allocated. On a 10-million-document collection, `find({status: 'active'}).limit(10)` allocates ten million `KeyedRecord`s and then keeps ten of them.

The `_id` equality and `$in` paths narrow the candidate set through the index. A bounded `_id` range does so only under the default key definition; with a custom key, normalized storage order may differ from `_id` order, so the range path falls back to `getAll()` (ADR-027). The same candidate-materialization problem affects every path without an applicable `_id` lookup.

## Decision

Accept the limitation and document it, rather than paper over it.

An honest fix requires a **streaming read** on the storage engine — a cursor or async iterator that yields records lazily (`Datastore.iterate()` / `iterateRange()`), so the query layer can filter, apply `.limit()`, and stop early without ever holding the full candidate array. `@frostpillar/frostpillar-storage-engine` (0.1.8) exposes no such API, and frostpillar-db cannot add one from above: it consumes the `Datastore` class, it does not own the B+ tree traversal.

Rejected alternatives:

- **A `maxScannedDocuments` cap that throws on large candidate sets.** It does not reduce peak memory — `getAll()` has already allocated the array by the time the count is known — so it trades a real problem for a false sense of a bound, and turns working queries into errors.
- **Chunked `getRange` paging over the key space.** Only applicable when the filter yields a key range; the general filter case (the one that hurts) still needs the full scan, and the paging would re-walk the index per chunk.

## Consequences

- `maxMatchedDocuments` and `.limit(n)` bound the **result** set, not the memory a scan touches. The documentation says so (README "Performance Notes", spec 02 §11), instead of implying a bound that does not exist.
- Peak scan memory is proportional to the candidate set: the collection size for a general filter or a custom-key `_id` range, the range size for a default-key `_id` range, and the operand's candidate set for `_id` `$in`.
- Callers who need a hard memory ceiling on a large collection should use `_id` equality or `$in`, use a bounded `_id` range under the default key definition, or partition the data across collections (each has its own datastore per ADR-012).
- The prerequisite for lifting this is a streaming read API in frostpillar-storage-engine. When one lands, `getRecordsByFilter` becomes the single place to adopt it: `scanRecords`, `collectFilteredDocuments`, and `countMatchedRecords` already consume candidates one record at a time.
