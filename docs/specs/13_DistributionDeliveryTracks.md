# Spec: Distribution Delivery Tracks (v0.2 draft)

Status: Draft  
Version: 0.2  
Last Updated: 2026-03-07

This specification defines how Frostpillar is delivered to users as installable artifacts.
Runtime behavior semantics remain defined by feature specs (for example datastore API, durability, and capacity).

## 1. Scope

In scope:

- NPM module delivery contract
- browser bundle delivery contract
- bundle profile policy (`core` only vs. `core + browser adapter` variants)
- compatibility and failure expectations across delivery tracks

Out of scope:

- exact build tool selection
- CI release automation internals
- npm registry operational credentials/process

## 2. Terms

- `Delivery Track`: one artifact family users consume directly (NPM module track or browser bundle track).
- `Bundle Profile`: one browser bundle variant describing which Frostpillar capabilities are included.
- `Runtime Slice`: currently supported runtime behavior as defined in `docs/specs/04_DatastoreAPI.md`.

## 3. Normative Delivery Requirements

### 3.1 NPM Module Track

For every publishable Frostpillar release, the project MUST provide an installable NPM package.

- Package name MUST be `frostpillar`.
- Package artifacts MUST include JavaScript runtime files and matching `.d.ts` files for each public entry.
- Package exports MUST use named exports only.
- Package behavior MUST match the runtime slice contract from `docs/specs/04_DatastoreAPI.md`.
- Unsupported runtime backends remain invalid configuration and MUST fail with typed errors (for example `UnsupportedBackendError`) exactly as specified.

### 3.2 Browser Bundle Track

For every publishable Frostpillar release, the project MUST provide browser-consumable bundle artifacts in one or more files.

- At least one `core` browser bundle profile MUST be published.
- `core` profile MUST contain browser-safe Frostpillar core API behavior that does not require Node-only APIs.
- Bundle filenames or release manifest metadata MUST identify profile names deterministically.
- A bundle profile MUST NOT claim support for a backend that is outside current runtime slice support.
- If a backend is selected at runtime but excluded from the bundle profile, behavior MUST fail with the same typed error class used by unsupported backend selection.

### 3.3 Browser Bundle Profile Policy

Default profile policy:

- Mandatory profile: `core`
- Optional profiles: `core-indexeddb`, `core-opfs`, `core-localstorage`, `full-browser`

For optional profiles, this rule applies:

- If a browser backend becomes supported in runtime slice specs, release artifacts MUST include either:
  - a dedicated profile for that backend, or
  - a `full-browser` profile that includes it.

## 4. Delivery Compatibility Contract

Delivery track changes MUST NOT redefine Frostpillar feature semantics.

- Query behavior, capacity policy behavior, and durability semantics MUST remain governed by feature specs.
- Delivery format differences (NPM vs. bundle) MUST NOT alter typed error taxonomy.
- Release notes and usage docs MUST declare which bundle profiles are available and which backends each profile includes.

## 5. Documentation Obligations

When delivery track behavior changes, contributors MUST update:

- this spec (`docs/specs/13_DistributionDeliveryTracks.md`)
- user-facing usage docs in English and Japanese
- ADR when delivery policy or long-term packaging boundaries change
- active planning docs in `docs/plans/`

## 6. Acceptance Criteria Baseline (for Implementation Work Items)

A delivery implementation work item is complete only when all are true:

- NPM install/use smoke path is test-backed.
- Browser bundle `core` profile load/use smoke path is test-backed.
- EN/JA usage docs include install and profile-selection guidance.
- release artifact list and supported profile matrix are explicit in docs.

## 7. Build Command Contract

Repository tooling MUST provide a dedicated bundle build command:

- `pnpm build:bundle` MUST generate browser bundle artifacts and profile metadata.
- `pnpm build:bundle` MAY assume `pnpm build` has already produced TypeScript outputs under `dist/`.
- If required input files are missing, `pnpm build:bundle` MUST fail with actionable error text.
