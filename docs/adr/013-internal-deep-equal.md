# ADR-013: Internal `deepEqual` Utility to Replace `node:util.isDeepStrictEqual`

## Status

Accepted

## Context

Four internal source files (`updateApplier.ts`, `filterEvaluator.ts`, `arrayOperators.ts`, `aggregationUtils.ts`) import `isDeepStrictEqual` from `node:util`. While an esbuild `--alias` shim patches this for the IIFE browser bundle, the distributed ESM files (`dist/index.js`, `dist/core.js`) are emitted by `tsc` and retain the bare `node:util` import. This breaks browser ESM consumers.

## Decision

Introduce `src/internal/deepEqual.ts` — a pure TypeScript utility that implements the project's structural equality contract:

- Primitives (`===`), `null`, `undefined`
- Arrays (element-by-element recursion)
- `Date` objects (compared via `.getTime()`, to support filter operands)
- All other objects (own-enumerable-key-by-key recursion)

Object prototypes and internal slots do not participate. Thus class instances follow their own enumerable shape, while `Map`/`Set` entries and the pattern state of a `RegExp` are ignored by ordinary equality. Enumerable own properties added to those objects still participate. Pattern matching remains the separate responsibility of `$regex`.

No external dependencies. No Node.js-specific APIs.

All four call-sites are updated to import `{ deepEqual }` from `./deepEqual` instead of `node:util`.

The `--alias:node:util=./scripts/browser-shims/node-util.js` flag is removed from `scripts/build.mjs` since it is no longer needed.

## Consequences

- Eliminates the Node.js `node:util` import from all distributed bundles.
- ESM consumers (browsers, Deno, edge runtimes) work without polyfills.
- The browser-shim file `scripts/browser-shims/node-util.js` is kept but no longer referenced by the build; it can be removed in a follow-up.
- JSON values retain the same behavior, while comparison operands such as `Date` and class instances have explicit structural semantics shared by filters and update operators.
