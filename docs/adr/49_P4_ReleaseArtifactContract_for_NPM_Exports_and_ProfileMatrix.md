# ADR-49: P4 Release Artifact Contract for NPM Exports and Profile Matrix

Status: Accepted  
Date: 2026-03-07

## Context

Phase 4 requires release-ready dual delivery:

1. installable NPM package
2. browser bundle artifacts with explicit profile policy

Before this decision, the repository had working build scripts but lacked a strict release-artifact contract for:

- top-level NPM export shape validation
- deterministic bundle profile matrix metadata that includes planned optional profiles
- fixture-based smoke verification for clean install/import and browser bundle load paths

Without explicit contracts, release packaging could drift from specs and usage docs.

## Decision

Adopt the following release artifact contract for P4:

- NPM package must expose top-level `exports["."]` with runtime and type entries.
- Package artifact scope is constrained to release essentials (`dist`, `README.md`, `LICENSE`).
- Browser bundle generation (`pnpm build:bundle`) must emit:
  - `dist/bundles/core/frostpillar-core.js`
  - `dist/bundles/core/frostpillar-core.d.ts`
  - `dist/bundles/manifest.json`
- Manifest must include:
  - published `profiles` artifact list
  - full `profileMatrix` covering mandatory and optional profile names
  - per-profile availability (`published` or `planned`) and current backend coverage
- Optional profiles remain `planned` with no unsupported runtime claim until runtime-slice support is accepted.

Verification policy:

- add fixture-based `npm pack` install/import smoke test
- add browser `core` bundle load/use smoke test
- add docs/ADR/plan synchronization tests for Phase 4 closure

## Consequences

Positive:

- package consumers get deterministic import and type resolution from explicit exports
- bundle consumers get machine-readable profile availability metadata
- release notes and usage docs can mirror manifest profile matrix without ambiguity

Trade-off:

- bundle manifest schema maintenance is now part of compatibility obligations
- release verification includes heavier artifact-level smoke tests in addition to unit/spec checks
