# Frostpillar

The ultra-lightweight, purely TypeScript timeseries database for ephemeral data.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Project Status (2026-03-07)

Current status: M5 release hardening for `v0.1`.

Core scope is stable for:

- `location: "memory"` runtime
- `location: "file"` durability slice

Roadmap and decisions are tracked in:

- `docs/adr/01_DevelopmentPlan.md`
- `docs/plans/01_DevelopmentStatusChecklist.md`

## Runtime Requirements

- Node.js: `>=24.0.0 <25.0.0`
- pnpm: `>=10.0.0`

## Quick Start

```bash
pnpm install
pnpm build
```

```typescript
import { Datastore } from 'frostpillar';

const db = new Datastore({ location: 'memory' });
await db.insert({
  timestamp: Date.now(),
  payload: { event: 'boot', value: 1 },
});

const rows = await db.select({
  start: Date.now() - 1000,
  end: Date.now() + 1000,
});

await db.close();
```

## Core Commands

```bash
# Full quality gate
pnpm check
pnpm test --run

# Build runtime artifacts
pnpm build
pnpm build:bundle

# Reproducible release baseline benchmark
pnpm benchmark:v0.1
```

## v0.1 Limitations and Non-Goals

This release intentionally constrains runtime and API scope.

- Supported now: location: "memory" and location: "file".
- `location: "browser" runtime backend is not implemented yet`.
- Browser profile entries in bundle metadata can stay `planned` until runtime support is complete.
- Public mutation APIs beyond current scope (`getById`, `updateById`, `deleteById`) are non-goals for `v0.1`.
- External publish automation (registry credentials/process) is non-goal for this phase.

Post-v0.1 direction is explicitly documented in ADR-51:

- post-v0.1 direction: browser runtime backend support first, then mutation API expansion

## Documentation Guide

User docs:

- Datastore API (EN): `docs/usage/01_DatastoreAPI.md`
- Datastore API (JA): `docs/usage/01_DatastoreAPI-JA.md`
- Release Hardening (EN): `docs/usage/06_ReleaseHardening-v0.1.md`
- Release Hardening (JA): `docs/usage/06_ReleaseHardening-v0.1-JA.md`

Contributor docs:

- Architecture overview: `docs/architecture/overview.md`
- Vision and principles: `docs/architecture/vision-and-principles.md`
- Specifications index: `docs/specs/INDEX.md`
- ADR index: `docs/adr/INDEX.md`
