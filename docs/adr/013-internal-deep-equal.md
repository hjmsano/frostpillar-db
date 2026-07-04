# ADR-013: Internal `deepEqual` Utility to Replace `node:util.isDeepStrictEqual`

## Status

Accepted

## Context

Four internal source files (`updateApplier.ts`, `filterEvaluator.ts`, `arrayOperators.ts`, `aggregationUtils.ts`) import `isDeepStrictEqual` from `node:util`. While an esbuild `--alias` shim patches this for the IIFE browser bundle, the distributed ESM files (`dist/index.js`, `dist/core.js`) are emitted by `tsc` and retain the bare `node:util` import. This breaks browser ESM consumers.

## Decision

Introduce `src/internal/deepEqual.ts` — a pure TypeScript utility that implements deep equality for the value types that can appear in this project:

- Primitives (`===`), `null`, `undefined`
- Arrays (element-by-element recursion)
- Plain objects (own-key-by-key recursion)
- `Date` objects (compared via `.getTime()`, to support filter operands)

No external dependencies. No Node.js-specific APIs.

All four call-sites are updated to import `{ deepEqual }` from `./deepEqual` instead of `node:util`.

The `--alias:node:util=./scripts/browser-shims/node-util.js` flag is removed from `scripts/build.mjs` since it is no longer needed.

## Consequences

- Eliminates the Node.js `node:util` import from all distributed bundles.
- ESM consumers (browsers, Deno, edge runtimes) work without polyfills.
- The browser-shim file `scripts/browser-shims/node-util.js` is kept but no longer referenced by the build; it can be removed in a follow-up.
- Runtime behaviour is unchanged for all values that can actually appear (JSON primitives, arrays, plain objects).
