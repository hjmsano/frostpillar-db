# ADR-25: Record-Size Boundary, RecordId Naming, and Lucene Timestamp/Null Rules

Status: Accepted  
Date: 2026-03-06

## Context

Review feedback identified four remaining ambiguity points across specs:

1. Record payload string limits were documented, but record acceptance still depends on
   configured page payload capacity because v0.2 does not support fragmented records.
2. Record identity naming differed between record-format examples (`id`) and query specs (`_id`).
3. Lucene docs defined exists/missing behavior, but did not provide a direct
   syntax form for explicit `null` value matching.
4. Users naturally express timestamp filters as ISO-8601 strings, while the engine
   executes comparisons on epoch milliseconds.

## Decision

1. Explicitly bind record acceptance to configured page payload capacity

- `docs/specs/01_RecordFormat.md` and `docs/specs/02_BinaryEncoding.md` now state that
  page-fit is mandatory for persistence in v0.2.
- Encoder/storage rules reference v0.2 page payload capacity:
  `maxSingleRecordBytes = pageSize - 32 - 4`.
- Encoder/storage MUST fail/reject records that exceed this limit.

2. Standardize system-generated record identity field as `_id`

- Record identity field exposed to query engines is standardized as `_id`.
- `docs/specs/01_RecordFormat.md` identified record interfaces now use `_id: RecordId`.
- Existing reserved-field semantics in Lucene/SQL stay aligned with `_id`.

3. Add explicit Lucene null syntax while preserving exists/missing semantics

- `field:null` is the canonical Lucene null predicate and maps to native `is_null`.
- `field:*` maps to `exists` and includes explicit `null` values.
- `NOT field:*` maps to `not_exists` and matches only missing fields.

4. Clarify Lucene timestamp string coercion

- Lucene `timestamp` query values may use ISO-8601 strings and must normalize to epoch milliseconds before execution.
- Invalid timestamp date strings MUST raise `QueryValidationError`.

## Consequences

Positive:

- Removes mismatch between record-validation limits and storage acceptance limits.
- Eliminates `_id` vs `id` confusion for record-level query usage.
- Makes null/missing intent explicit and predictable in Lucene filters.
- Improves query ergonomics by allowing timestamp strings with strict validation.

Trade-offs:

- Implementations must apply field-aware normalization for reserved `timestamp` queries.
- Existing clients using non-canonical `field:NULL` wording should migrate to `field:null`
  in user-facing docs/examples.
