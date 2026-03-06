# ADR-19: Single-Page Record Fit and No Overflow Chunks in v0.2

Status: Accepted  
Date: 2026-03-06

## Context

Spec review identified a gap between fixed-size page architecture and record encoding:

1. `docs/architecture/vision-and-principles.md` and `docs/specs/03_PageStructure.md`
   define fixed-size slotted pages.
2. `docs/specs/02_BinaryEncoding.md` defines one record as a contiguous TLV byte stream.
3. Prior specs did not explicitly define behavior when one encoded record exceeds
   a single page fit boundary.

Without explicit rules, implementations could diverge between rejecting large records
or inventing incompatible overflow-chunk formats.

## Decision

1. v0.2 keeps one-record-one-cell contiguous encoding

- A persisted record is one contiguous TLV byte sequence.
- Continuation/overflow chunk envelopes are not defined in v0.2.
- Single record bytes MUST NOT span multiple pages.

2. Define explicit page-fit boundary formula

- `maxSingleRecordBytes = pageSize - 32 - 4`
- `32` is page header bytes; `4` is one slot entry bytes.
- If encoded record bytes exceed this boundary, insert fails with page-capacity rejection.

3. Normalize user-visible error behavior

- Datastore API rejects page-fit overflow with `QuotaExceededError`.
- This check runs before strict/turnover capacity policy evaluation.
- Turnover eviction is not attempted for page-fit overflow.

## Consequences

Positive:

- Removes ambiguity for large-record handling across storage backends.
- Preserves deterministic, simple v0.2 page and TLV model.
- Avoids introducing overflow-page complexity into current milestone.

Trade-offs:

- Maximum size of one record is bounded by configured page size.
- Some large payload use cases require either larger page size or future overflow design.
- Future overflow-page support must be introduced as an explicit compatible spec revision.
