# ADR-54: Core Browser Bundle Single-File Minified Global Contract

Status: Accepted  
Date: 2026-03-07

## Context

ADR-40 and ADR-49 established dual delivery tracks and baseline browser bundle artifacts.
The previous `core` bundle output used a multi-file module-copy style entry (`frostpillar-core.js`) rather than a single deployable browser artifact.

That shape was inconvenient for script/CDN use because users still had to move dependent files together.

## Decision

Adopt a single-file browser runtime artifact contract for the published `core` profile.

- `pnpm build:bundle` MUST emit:
  - `dist/bundles/core/frostpillar-core.min.js`
  - `dist/bundles/core/frostpillar-core.d.ts`
  - `dist/bundles/manifest.json`
- `frostpillar-core.min.js` MUST be browser-executable without additional runtime module fetches.
- Browser script usage contract MUST expose public API on `globalThis.Frostpillar`.
- Browser `core` profile keeps current backend coverage as `memory` only.
- Node/file backend internals are stubbed out in browser bundle generation and remain typed unsupported paths.

## Consequences

Positive:

- browser distribution is now a portable single file suitable for static hosting and CDN script tags
- manifest `entry` is deterministic for direct delivery automation
- bundle smoke tests can validate browser global API availability explicitly

Trade-off:

- bundle generation now depends on a bundler toolchain and profile-specific stubbing logic
- browser bundle build complexity increased compared with copy-only packaging
