# Frostpillar

**The ultra-lightweight, purely TypeScript timeseries database for ephemeral data.**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## 1. Introduction

**Frostpillar** is a specialized database engine designed for **ephemeral timeseries data**.

It bridges the gap between simple JSON file stores (like `lowdb`) and heavy database servers (like `PostgreSQL` or `InfluxDB`). It is built entirely in TypeScript, has zero runtime dependencies, and runs identically in **Node.js** and **Browsers**.

### Key Features

- **Zero Dependencies**: Pure TypeScript. No native bindings.
- **Binary Storage**: Uses a custom TLV (Type-Length-Value) binary format and Paged storage, avoiding the performance pitfalls of `JSON.stringify` on large datasets.
- **Async-Only**: Modern `Promise`-based API.
- **Type-Safe**: Strict schemas and typed errors.
- **Isomorphic**: Supports `fs` (Node.js), `OPFS`/`IndexedDB` (Browser), and In-Memory modes.

---

## 2. Why Frostpillar?

Why build another database?

### The Problem with JSON Stores

Simple libraries often read/write the entire dataset to a single JSON file. As your data grows to 100MB or 1GB, reading and writing becomes exponentially slower (O(N)).

### The Problem with Full DBs

Setting up a Docker container or a cloud instance for a simple CI/CD log collector or a browser-side telemetry buffer is overkill.

### The Frostpillar Solution

Frostpillar provides the **simplicity of a library** with the **internals of a real database**:

1.  **O(1) Appends**: Writes are appended to the end of a binary file/buffer.
2.  **O(log N) Reads**: Uses a B+ Tree index to find time ranges instantly.
3.  **Predictable Memory**: Uses fixed-size pages (e.g., 4KB) to manage memory usage, preventing crashes.
4.  **Ephemeral by Design**: Built-in support for retention policies (e.g., "Keep last 500MB" or "Keep last 24h") to handle data that "melts away."

---

## 3. Documentation Guide

We follow **Spec-Driven Development**. The documentation is the source of truth.

### 📚 For Users

- **Datastore API (EN)**: [`docs/usage/01_DatastoreAPI.md`](./docs/usage/01_DatastoreAPI.md)
- **Datastore API (JA)**: [`docs/usage/01_DatastoreAPI-JA.md`](./docs/usage/01_DatastoreAPI-JA.md)
- **Usage Index**: [`docs/usage/INDEX.md`](./docs/usage/INDEX.md)

### 🏗️ For Contributors & Architects

- **Architecture**: High-level vision and layered design.
  - Start with Fundamentals.
- **Specifications**: Detailed binary formats and protocols.
  - Record Format & Binary Encoding.
- **ADR (Decision Records)**: Why we made specific technical choices.

---

## 4. Origin of the Name

Why **"Frostpillar"**?

The name reflects the dual nature of the data this system is designed to handle:

- ❄️ **Frost (Ephemeral & Time)**:
  Like frost, the data is granular and often temporary. It captures a specific "frozen" moment in time (a timestamp). The database is optimized for data that might eventually "melt away" (retention policies) but needs to be crisp and clear while it exists.

- 🏛️ **Pillar (Structure & Support)**:
  Even though the individual moments are fleeting, we stack them into a solid, ordered structure—a pillar of history. This represents the reliability and structural integrity (B+ Trees, Binary Pages) that supports your application's data needs.

---

## Project Status

**Current Status**: 🚧 **Pre-Alpha (M0/M1)**

We are currently implementing the **Minimum Vertical Slice (M1)**.
See ADR-01: Development Plan for the roadmap.

### Runtime Requirements

- Node.js: `>=24.0.0 <25.0.0`
- pnpm: `>=10.0.0`

### Core Commands

```bash
# Install dependencies
pnpm install

# Run type checks, linting, and textlint
pnpm check

# Run tests
pnpm test
```
