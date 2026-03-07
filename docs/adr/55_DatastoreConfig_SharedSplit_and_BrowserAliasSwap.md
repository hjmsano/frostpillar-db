# ADR-55: Datastore Config Shared Split and Browser Alias Swap

Status: Accepted  
Date: 2026-03-08

## Context

The browser bundle pipeline previously embedded an inline config stub source in `scripts/build-bundles.mjs`.
That stub duplicated parsing logic from datastore config runtime code:

- `normalizeByteSizeInput`
- `parseCapacityConfig`
- `parseFileAutoCommitConfig`

This duplication created synchronization risk whenever capacity or auto-commit validation rules changed.

## Decision

Split datastore config into shared and runtime-specific modules, then use browser-module alias swap in bundle build.

- `config.shared.ts` keeps browser-safe shared parsing logic.
- `config.node.ts` keeps Node.js-specific path/canonicalization/file-target logic and re-exports shared parsing logic.
- `config.browser.ts` provides browser stubs for Node-only config operations and re-exports shared parsing logic.
- `config.ts` becomes the Node runtime entry (`export * from './config.node.js'`).
- Browser bundle build resolves datastore `./config.js` imports to `dist/core/datastore/config.browser.js` via bundler resolve hook.

## Consequences

Positive:

- shared parsing rules live in one place and avoid manual copy maintenance
- browser bundle build stays deterministic while reducing embedded script complexity
- future validation-rule changes propagate to both Node and browser bundle paths automatically

Trade-off:

- source module count increases and requires explicit split governance
- bundle build now depends on alias correctness for runtime-specific module selection
