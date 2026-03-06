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

## 3. Browser Bundle Track

Use this track when you need direct browser loading (for example script/CDN or static hosting scenarios).

### Build command

```bash
pnpm build
pnpm build:bundle
```

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

## 5. Profile Matrix Template

Use and publish a matrix like this in release notes:

| Profile | Includes | Target |
| :------ | :------- | :----- |
| `core` | core API without browser-specific persistent adapters | browser baseline |
| `core-indexeddb` | core + IndexedDB adapter | browser persistence (IndexedDB) |
| `core-opfs` | core + OPFS adapter | browser persistence (OPFS) |
| `core-localstorage` | core + localStorage adapter | compatibility fallback |
| `full-browser` | core + all browser adapters supported in current runtime slice | convenience all-in-one |
