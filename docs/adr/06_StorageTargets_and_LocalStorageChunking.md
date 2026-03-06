# ADR-06: Durable Storage Targets and LocalStorage Chunking

Status: Accepted (Partially Superseded by ADR-10 for browser backend priority)  
Date: 2026-03-06

## Context

The datastore API previously defined durable config only as a single `filePath` string.
That was not enough to answer practical user questions such as:

- how to specify directory, file name, and prefix separately
- how browser `localStorage` keys should be named
- what happens when localStorage value size and quota limits are hit

Without explicit conventions, implementations could diverge and break portability.

## Decision

1. File backend target configuration

- Keep `filePath` as backward-compatible shorthand.
- Add explicit `target` union:
  - `kind: "path"` with `filePath`
  - `kind: "directory"` with `directory`, optional `fileName`, optional `filePrefix`
- Disallow using `filePath` and `target` together.

2. File physical structure

- Durable page data is written to one resolved `*.fpdb` data file.
- Metadata is written to sidecar file `${dataFile}.meta.json`.
- Sidecar is mandatory for format version and durable open/reopen checks.

3. Browser localStorage structure

- Add `location: "browser"` contract with `browserStorage: "localStorage"`.
- Add localStorage options: `keyPrefix`, `databaseKey`, `maxChunkChars`, `maxChunks`.
- Use deterministic key format:
  - manifest: `<keyPrefix>:<databaseKey>:manifest`
  - chunks: `<keyPrefix>:<databaseKey>:g:<generation>:chunk:<index>`

Note:

- ADR-10 supersedes backend selection priority and introduces async-native preference (`opfs`/`indexedDB` first).
- This section remains normative only for `browserStorage: "localStorage"` mode.

4. Chunking and quota policy

- One logical snapshot may span multiple localStorage keys.
- Snapshot string is chunked by `maxChunkChars`.
- Reject with `QuotaExceededError` when required chunk count exceeds `maxChunks` or browser quota rejects writes.
- Failed write for new generation must not invalidate previous committed generation.

## Consequences

Positive:

- Users can choose clear file layout strategy (path-based or directory-based).
- Browser key naming becomes explicit and deterministic.
- Quota behavior is predictable and testable.

Trade-off:

- Config validation rules are more complex.
- localStorage backend requires generation management and cleanup logic.
