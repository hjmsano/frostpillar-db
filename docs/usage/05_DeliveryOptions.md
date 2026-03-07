# Usage: Delivery Options (NPM and Browser Bundles)

Status: Draft  
Last Updated: 2026-03-07

This guide explains Frostpillar delivery styles and how to choose them.

## 1. Delivery Styles

Frostpillar defines two delivery tracks:

1. NPM module track
2. Browser bundle track

The normative delivery policy is defined in `docs/specs/13_DistributionDeliveryTracks.md`.

## 2. NPM Module Track

Use this track when your application uses package-manager based dependency control.

### Install

```bash
npm install frostpillar
```

### Basic usage

```typescript
import { Datastore } from 'frostpillar';

const db = new Datastore({ location: 'memory' });
await db.insert({ timestamp: Date.now(), payload: { temp: 25.3 } });
```

### Package contract checkpoints

- `package.json` uses named-export-only top-level `exports["."]` for runtime and type entries.
- `npm pack` artifact includes `dist/core` and `dist/queryEngine` runtime and `.d.ts` files.
- clean fixture install/import smoke path is validated by tests.

## 3. Browser Bundle Track

Use this track when you need direct browser loading (for example script/CDN or static hosting scenarios).

### Build command

```bash
pnpm build
pnpm build:bundle
```

### Generated artifacts

- `dist/bundles/core/frostpillar-core.min.js`
- `dist/bundles/core/frostpillar-core.d.ts`
- `dist/bundles/manifest.json`

### Browser script contract

- `frostpillar-core.min.js` is a single-file browser runtime artifact.
- it can be loaded via `<script src=".../frostpillar-core.min.js"></script>`.
- public API is exposed on `globalThis.Frostpillar` (for example `Frostpillar.Datastore`).

### Bundle profile policy

- mandatory: `core`
- optional: `core-indexeddb`, `core-opfs`, `core-localstorage`, `full-browser`

### Selection rule

- choose the smallest profile that contains required backends
- if a selected backend is not in the loaded bundle profile, initialization must fail with typed unsupported-backend error semantics

## 4. Current Scope Note (2026-03-07)

- Delivery tracks are required product scope.
- Runtime backend support still follows datastore runtime-slice specs.
- Browser backend support is phased; only declared runtime-supported backends can be claimed by bundle profiles.

## 5. Current Profile Matrix (2026-03-07)

The profile matrix is published in `dist/bundles/manifest.json` (`profileMatrix` field).

| Profile | Availability | Current backends | Notes |
| :------ | :----------- | :--------------- | :---- |
| `core` | `published` | `memory` | current release artifact is `dist/bundles/core/frostpillar-core.min.js` |
| `core-indexeddb` | `planned` | none yet | enabled only after runtime-slice IndexedDB support is accepted |
| `core-opfs` | `planned` | none yet | enabled only after runtime-slice OPFS support is accepted |
| `core-localstorage` | `planned` | none yet | enabled only after runtime-slice localStorage support is accepted |
| `full-browser` | `planned` | none yet | enabled only after browser adapter runtime support is expanded |

## 6. Next Direction (2026-03-07)

Next Direction (after v0.1 release hardening): browser backend runtime support first.

- start with runtime-slice browser backends (`indexedDB`, `opfs`, `localStorage`)
- move optional profile entries from `planned` to `published` only after tests/specs are green
- schedule native mutation API expansion after browser runtime baseline is complete
