# ADR-42: Datastore File-Backend Controller Extraction

Status: Accepted  
Date: 2026-03-07

## Context

`Datastore` currently coordinates both public API behavior and file-backend lifecycle details
(backend initialization, snapshot commit, scheduled auto-commit, and lock-release close flow).

Even when line-count policy is still satisfied, this mixed responsibility increases
maintenance risk:

1. public API orchestration and backend durability internals evolve together
2. file-backend lifecycle changes can enlarge `Datastore` faster than other domains
3. source-organization intent from ADR-41 becomes harder to sustain proactively

## Decision

Extract file-backend-specific lifecycle orchestration into a dedicated datastore internal module.

- Keep `Datastore` focused on public API contracts (`insert/select/query/commit/on/off/close`).
- Move file-backend open/load/commit/scheduler/close coordination into a dedicated controller.
- Keep behavior unchanged for:
  - immediate and scheduled auto-commit triggering
  - size-threshold trigger semantics
  - background auto-commit error-channel emission
  - file lock lifecycle and release behavior

## Consequences

Positive:

- clearer separation of concerns between API surface and backend lifecycle internals
- lower risk of accidental growth in `Datastore` as file durability work continues
- easier targeted tests for source-organization policy and internal controller behavior

Trade-off:

- one additional internal module and wiring layer to maintain
