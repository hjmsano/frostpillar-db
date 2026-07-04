# Vision and Principles

## Vision

frostpillar-db is a lightweight, zero-dependency database for JavaScript that runs identically in Node.js and browsers. It provides a familiar query API for structured data without the overhead of a full database server.

## Core Principles

### 1. Lightweight by Design

Every dependency, abstraction, and feature must justify its weight. We prefer small bundle sizes and fast startup over feature completeness. Features that serve niche use cases belong in separate packages.

### 2. Zero External Dependencies

The only runtime dependencies are packages from the Frostpillar family. No third-party libraries. This guarantees supply chain security, minimal audit surface, and predictable behavior.

### 3. Trust the Storage Engine

frostpillar-storage-engine handles persistence, drivers, capacity, indexing, and auto-commit. We do not duplicate or second-guess its functionality. If a storage concern arises, the fix belongs in the storage engine — not in a workaround here.

### 4. Familiar API

Developers should feel productive immediately. The query API uses `$`-prefixed operators and method chaining — patterns that JavaScript developers already know. We align with SQL semantics in naming and behavior so that a future SQL translation layer can target our API without impedance mismatch.

### 5. Predictable Performance

Most queries follow a simple execution path: full scan, filter, sort, paginate. `_id`-shaped filters (equality, `$in`, range) dispatch to storage fast paths that avoid a full scan. No query planner, no optimizer, no surprising performance cliffs. Developers can reason about performance easily.

### 6. Multi-Runtime Parity

The same code runs in Node.js (ESM and CJS), modern browsers (IIFE bundle), and browser extensions. Runtime-specific behavior (e.g., storage drivers) is handled by the storage engine layer, not by frostpillar-db.

## Non-Goals

- **SQL parser** — a separate package (`frostpillar-query-interface`) will handle SQL parsing and translation.
- **Cross-collection joins** — each collection is queried independently.
- **Transactions** — no multi-operation atomicity guarantees.
- **Secondary indexes** — scan-based execution is sufficient for the target dataset sizes.
- **Schema enforcement** — the document model is schema-less; validation is the user's responsibility.
- **Replication or clustering** — frostpillar-db is a single-process embedded database.
