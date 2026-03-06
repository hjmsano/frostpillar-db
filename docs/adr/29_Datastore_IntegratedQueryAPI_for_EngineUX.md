# ADR-29: Datastore Integrated Query API for Query-Engine UX

Status: Accepted  
Date: 2026-03-06

## Context

Specification review identified a UX gap in query-engine usage:

1. Existing flow required users to manually run `engine.toNativeQuery(...)` and then
   call `db.queryNative(...)`.
2. This exposed `NativeQueryRequest` in common paths even when users only needed
   SQL/Lucene text execution.
3. Frostpillar architecture requires query languages to stay optional/external, and
   datastore initialization must remain language-agnostic.

The manual-only flow is flexible but verbose for normal usage.

## Decision

1. Expose datastore-integrated query API with language-based engine registry

- `docs/specs/04_DatastoreAPI.md` now defines:
  `registerQueryEngine(engine)`, `unregisterQueryEngine(language)`, and
  `query(language, queryText, options?)`.
- Registry model keeps datastore initialization config unchanged while enabling concise
  runtime query execution by language key.

2. Preserve native execution boundary

- `query(...)` MUST resolve engine by language and delegate strictly through:
  `engine.toNativeQuery(queryText, options)` -> `queryNative(request)`.
- If no engine is registered for a requested language, datastore MUST fail with
  `QueryEngineNotRegisteredError`.

3. Keep advanced manual flow available

- manual `toNativeQuery` + `queryNative` flow remains supported for advanced control,
  debugging, and custom request mutation before execution.

4. Align contract and usage docs

- `docs/specs/05_QueryEngineContract.md` now states datastore-integrated query path
  semantics and equivalence with `runQueryWithEngine(...)`.
- `docs/usage/01_DatastoreAPI.md` and `docs/usage/01_DatastoreAPI-JA.md` now show
  integrated `db.query(...)` as primary usage and manual native flow as advanced option.

## Consequences

Positive:

- Reduces boilerplate for common SQL/Lucene query execution.
- Keeps core query execution model unchanged and typed (`queryNative` remains source of truth).
- Preserves optional-engine architecture and language-agnostic datastore initialization.

Trade-off:

- Datastore now has engine-registry lifecycle concerns (registration/unregistration timing).
