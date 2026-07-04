# ADR-011: Lazy Field-Level Deserialization (Future Optimization)

- **Status:** Proposed
- **Date:** 2026-04-03
- **Deciders:** Hajime Sano

## Context

The current query execution pipeline deserializes all documents fetched from `getAll()` before filtering and projection. Specifically:

1. `getRange()` returns full payloads as already-parsed JavaScript objects.
2. Each payload is cloned via `structuredClone()`.
3. The filter evaluator runs against the cloned documents.
4. Projection selects only the requested fields, discarding the rest.

For queries with projection (e.g., selecting 2 fields from a 50-field document), the full document payload is cloned even though most fields are discarded. "Lazy deserialization" at the frostpillar-db level would mean lazy cloning or selective field extraction, because the storage engine already returns parsed objects rather than raw bytes.

True lazy deserialization (parsing only needed fields from raw bytes) would require changes in frostpillar-storage-engine to support returning raw byte buffers instead of parsed objects.

## Decision

Defer implementation. Document as a future optimization path.

## Approaches Considered

### 1. Storage engine raw mode

The storage engine returns raw byte buffers instead of parsed JavaScript objects. frostpillar-db parses only the needed fields using a streaming JSON parser.

- **Benefit:** Maximum. Avoids both parsing and cloning of unused fields.
- **Cost:** Requires storage engine API changes and a streaming parser dependency.

### 2. Selective cloning

Instead of `structuredClone(payload)`, extract only projected fields before cloning. Only the fields needed for filtering and projection are cloned.

- **Benefit:** Moderate. Reduces clone overhead proportional to the projection ratio.
- **Cost:** Low. No storage engine changes needed. Requires projection-aware clone logic in frostpillar-db.

### 3. Projection push-down

Move projection earlier in the pipeline (before filter evaluation) for fields that are not referenced by the filter predicate.

- **Benefit:** Minimal for most queries, since filter fields must still be available.
- **Cost:** Low. Requires dependency analysis between filter and projection fields.

## Rationale for Deferral

- **Target dataset size is small.** frostpillar-db targets thousands to tens of thousands of documents per collection (see ADR-005). At this scale, the optimization has low impact.
- **Typical documents are small.** `structuredClone` on documents under 1 KB is fast enough that the overhead is negligible.
- **Storage engine API stability.** Approach 1 would require significant changes to the frostpillar-storage-engine API, which is shared across multiple consumers.
- **Uncertain ROI for Approach 2.** Selective cloning is feasible at the frostpillar-db level, but the performance gain for typical workloads has not been measured.

## Future Trigger

Revisit this decision when any of the following conditions are met:

- Document sizes regularly exceed 10 KB.
- Projection-heavy workloads show measurable performance degradation in profiling.
- frostpillar-storage-engine adds a raw/lazy retrieval API that returns byte buffers.

## Consequences

### If implemented (Approach 2, most likely first step)

- Queries with narrow projection on wide documents would see reduced `structuredClone` overhead.
- Additional complexity in the query pipeline to coordinate filter field requirements with projection fields.
- No external API changes; the optimization would be transparent to callers.

### If not implemented (current state)

- No impact on correctness.
- Performance remains adequate for the target use cases documented in ADR-005.
- Simpler, more auditable query pipeline.
