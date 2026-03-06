# Frostpillar Architecture Overview

Status: Draft  
Last Updated: 2026-03-06

## 1. Purpose

This document defines the executable architecture for Frostpillar and complements:

- `docs/architecture/vision-and-principles.md` (product vision and core concepts)
- `docs/adr/01_DevelopmentPlan.md` (milestone execution plan)

The goal is to keep a clear boundary between:

- what must remain stable (core invariants)
- what can evolve quickly (internal implementation details)

## 2. System Scope

Frostpillar is a TypeScript-native timeseries datastore for ephemeral data.

In scope:

- append-oriented writes
- timestamp range reads
- TypeScript-native query operations from the core API
- optional external query language engines (SQL subset, Lucene subset)
- bounded storage behavior
- async-first API
- memory and file backends first

Out of scope for early releases:

- distributed consensus
- multi-node clustering

## 3. Architectural Layers

Frostpillar uses layered architecture to reduce coupling and make testing deterministic.

1. API Layer (`src/core`)

- Public datastore interface (`insert`, `select`, `commit`, lifecycle methods)
- Datastore error channel for asynchronous background failures (`on/off` for `"error"`)
- Configuration validation and error mapping
- No backend-specific logic in public API surface

2. Storage Engine Layer (`src/storageEngine`)

- Page read/write abstraction
- Backend adapters (memory, file, later browser/custom)
- Flush policy orchestration and durability boundaries

3. Query/Index Layer (`src/queryEngine`)

- B+ tree operations
- Range traversal and ordering guarantees
- Query execution rules independent of backend
- External query-language parsing and translation to native query requests

4. Binary Format Layer (`src/core` or shared internal modules)

- TLV encode/decode
- page header and slotted-page layout
- format versioning and compatibility checks

## 4. Core Data Flow (Write/Read)

Write path:

1. Validate record schema and timestamp semantics.
2. Encode payload to TLV.
3. Insert encoded record into page structure.
4. Update index (B+ tree).
5. Apply flush policy (immediate, interval, size-based, manual).

Read path:

1. Validate query range.
2. Locate start position via B+ tree.
3. Traverse leaf sequence for range.
4. Decode TLV to typed records.
5. Return deterministic ordered results.

External query language path:

1. Parse SQL/Lucene subset text in optional query engine module.
2. Translate parsed expression into Frostpillar native query request.
3. Execute native query request through query/index layer.
4. Return deterministic ordered results.

## 5. Non-Negotiable Invariants

- API is async-only (no sync variant).
- Public exports are named exports only.
- No `any` type in code.
- Binary format has explicit version metadata.
- Range query result ordering is deterministic.
- Capacity policy behavior is deterministic at boundary conditions.

## 6. TypeScript Engineering Principles

- Strong typing over implicit behavior:
  - use discriminated unions for config modes and policy types
  - use `unknown` at trust boundaries, then narrow explicitly
- Explicit error taxonomy:
  - domain errors (invalid range, quota exceeded, format mismatch)
  - infrastructure errors (I/O and environment)
- Small, composable modules:
  - pure functions for encoding/index math
  - side effects isolated in adapter layer
- Backward-compatible public API evolution:
  - avoid silent semantic changes
  - use versioned migration policy for format-level changes

## 7. Reusable Database Engine Best Practices

Frostpillar is unique, but the following practices are mandatory because they are proven in storage systems:

1. Format Versioning

- Keep a file/page header with magic bytes + format version.
- Reject unknown versions explicitly.

2. Deterministic Serialization

- TLV encoding must be stable and reproducible for the same logical input.

3. Crash-Safe Boundaries

- Define when data is considered durable (`commit`/flush completion).
- Never imply durability before adapter write completion.

4. Invariant-Driven Index Maintenance

- B+ tree invariants (sorted keys, node occupancy, linked leaves) must be validated in tests.
- Deterministic tie-break ordering for equal timestamps must remain stable across compaction and
  split/merge/rebalance operations.

5. Bounded Resource Strategy

- Size tracking and retention policy must be enforced before accepting unbounded growth.

6. Measured Performance Claims

- Performance statements must include reproducible benchmark method and environment metadata.

## 8. Reliability and Failure Model

Early releases should explicitly model these failure classes:

- corrupted header/version mismatch
- incomplete writes
- invalid user record shape
- out-of-capacity on strict policy
- background auto-commit/storage failures with no direct caller Promise

Behavior should favor explicit errors over silent fallback, including emission through datastore error channel for asynchronous failures.

## 9. API Evolution Policy

- Keep minimal surface area until v0.1 stability.
- Add features by extending configuration unions, not by introducing unrelated APIs.
- Each API behavior change requires:
  - spec update (`docs/specs`)
  - tests first
  - ADR update if architectural consequences exist

## 10. Implementation Order

Follow the ADR milestone order:

- M0: baseline and missing docs
- M1: memory vertical slice
- M2: file durability
- M3: index hardening
- M4: flush and retention policies
- M5: release hardening

Do not start browser/custom backend work before memory + file behavior is stable and test-proven.
