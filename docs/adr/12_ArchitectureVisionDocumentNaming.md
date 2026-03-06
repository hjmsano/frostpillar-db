# ADR-12: Rename Architecture Vision Document for Clarity

Status: Accepted  
Date: 2026-03-06

## Context

The architecture directory had two primary documents with different roles:

- `docs/architecture/00_Fundamentals.md`: project vision, goals, and non-negotiable direction
- `docs/architecture/overview.md`: executable layered architecture and implementation boundaries

The `00_Fundamentals.md` filename looked isolated and unclear for contributors.
However, the document itself remains important because it captures stable product intent that should not be mixed with fast-changing implementation details.

## Decision

1. Keep the vision document as a separate architecture document.

- Do not merge it into `overview.md`.
- Preserve the boundary: vision/principles vs executable architecture details.

2. Rename the file to a role-based name.

- Old: `docs/architecture/00_Fundamentals.md`
- New: `docs/architecture/vision-and-principles.md`

3. Update repository references to the new path.

- Update references in architecture/testing docs, ADR docs, and contributor guidance.

## Consequences

Positive:

- Document purpose is clearer at first glance.
- Removes "orphaned/legacy-looking" naming while preserving architecture intent separation.
- Reduces confusion for future contributors following repository guidance.

Trade-off:

- Existing external bookmarks to the old path must be updated.
