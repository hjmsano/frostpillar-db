# ADR-04: Native Query Core and Optional Language Engines

Status: Accepted  
Date: 2026-03-06

## Context

Frostpillar aims to stay lightweight and TypeScript-native while supporting familiar query experiences.
The project needs:

- native API operations for direct programmatic use
- SQL subset and Lucene subset support for text-based query users
- deterministic behavior without adding heavy relational execution layers

## Decision

Adopt a split architecture:

1. Core query execution remains TypeScript-native.

- Core owns native query request schema and execution.
- Core adds record-level identity requirements for precise update/delete targeting.

2. SQL and Lucene support is delivered as optional query-engine modules.

- Query-engine modules parse language text and map to native query requests.
- Users import the engine modules in application code as needed.
- Datastore initialization does not include query-language selection.

3. Keep the supported language scope intentionally small.

- Focus on common filtering, grouping, counting, min/max, sorting, distinct, and limit.
- Do not add enterprise-scale relational execution layers.

## Consequences

Positive:

- Core remains small and maintainable.
- Multiple query languages can evolve independently.
- Feature additions are testable via shared native-query semantics.

Trade-off:

- Query-engine packages need strict compatibility management with native query request changes.
- Some advanced SQL/Lucene features remain intentionally unsupported.
