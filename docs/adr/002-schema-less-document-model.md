# ADR-002: Schema-less Document Model

- **Status:** Accepted
- **Date:** 2026-04-03
- **Deciders:** Hajime Sano

## Context

We need to decide whether frostpillar-db enforces a schema per collection or allows arbitrary JSON documents.

Options considered:

1. **Schema-enforced** — define fields and types upfront; reject non-conforming documents.
2. **Schema-less** — accept any JSON-compatible payload; no upfront definition required.
3. **Optional schema** — schema-less by default with opt-in validation.

## Decision

Adopt a **schema-less** document model. Collections accept any valid JSON-compatible object as a document. Nested objects are fully supported, inheriting the storage engine's payload structure.

## Rationale

- **Simplicity** — no schema definition, migration, or versioning complexity.
- **Flexibility** — documents in the same collection can have different shapes; ideal for rapid prototyping, semi-structured data, and evolving data models.
- **Alignment with storage engine** — frostpillar-storage-engine already accepts arbitrary `RecordPayload` objects; adding a schema layer would be an additional abstraction with limited value at this stage.
- **Future extensibility** — a schema validation layer can be added as an optional plugin or a separate package without breaking the core API.

## Consequences

### Positive

- Minimal configuration to start using a collection.
- No breaking changes when document shapes evolve.
- Query operators work uniformly on any field regardless of type.

### Negative

- No compile-time or insertion-time type safety (users must validate their own data or use TypeScript generics).
- Query operators on mismatched types (e.g., `$gt` on a string field) silently skip non-matching documents rather than throwing errors.
- Aggregation functions (`sum`, `avg`) skip non-numeric values, which may produce unexpected results on untyped data.
