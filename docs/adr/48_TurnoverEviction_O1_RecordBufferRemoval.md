# ADR-48: Turnover Eviction O(1) Record-Buffer Removal

Status: Accepted  
Date: 2026-03-07

## Context

M3 introduced index-backed oldest-record eviction through `TimeIndexBTree.popOldest()`.

However, eviction cleanup in `Datastore` still removed the same record from the retained
record buffer through `Array#indexOf` + `Array#splice`.

Under turnover pressure with repeated evictions, this adds linear buffer scans/removals
per evicted record and can degrade one insert from index-dominated behavior to
`O(E * N)` (`E`: evictions, `N`: retained records), increasing DoS risk surface.

## Decision

Adopt an internal record buffer keyed by `insertionOrder` and require expected `O(1)`
buffer removal for turnover eviction.

- Keep deterministic retention semantics unchanged (oldest-first by `(timestamp, insertionOrder)`).
- Keep public API unchanged.
- For one insert under turnover, complexity remains index-dominated (`O(E * log N)`),
  and MUST NOT rely on per-eviction linear retained-buffer scans.

## Alternatives Considered

1. Keep array buffer and accept linear `indexOf/splice` cleanup.
2. Introduce secondary array-index bookkeeping to simulate constant-time removal.
3. Use `Map<insertionOrder, PersistedTimeseriesRecord>` for retained-buffer ownership.

## Consequences

Positive:

- closes a high-impact algorithmic complexity risk in turnover path
- keeps retention behavior deterministic while reducing worst-case CPU amplification
- aligns runtime with M3 scalability expectations in capacity/retention specs

Trade-off:

- `Datastore` internal record ownership model changes from array to map
- read/query/commit paths require explicit array snapshot conversion where needed
