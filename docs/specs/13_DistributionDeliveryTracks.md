# Spec: Distribution Delivery Tracks (v0.2 draft)

Status: Draft  
Version: 0.2  
Last Updated: 2026-03-08

This specification defines how Frostpillar is delivered to users as installable artifacts.
Runtime behavior semantics remain defined by feature specs (for example datastore API, durability, and capacity).

## 1. Scope

In scope:

- NPM module delivery contract
- browser bundle delivery contract
- bundle profile policy (`core` only vs. `core + browser adapter` variants)
- compatibility and failure expectations across delivery tracks
- CI/CD validation and build trigger contract for pull requests and default-branch merges

Out of scope:

- exact build tool selection
- release publishing/deployment to external destinations
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
- Package `package.json` MUST define an explicit top-level `exports` map for `"."` with both:
  - runtime entry (for example `default` to `./dist/core/index.js`)
  - type entry (for example `types` to `./dist/core/index.d.ts`)
- Package exports MUST use named exports only.
- Package behavior MUST match the runtime slice contract from `docs/specs/04_DatastoreAPI.md`.
- Unsupported runtime backends remain invalid configuration and MUST fail with typed errors (for example `UnsupportedBackendError`) exactly as specified.
- `npm pack` output MUST be installable from a clean fixture project, and `import { Datastore } from "frostpillar"` MUST load without additional build steps.

### 3.2 Browser Bundle Track

For every publishable Frostpillar release, the project MUST provide browser-consumable bundle artifacts.

- At least one `core` browser bundle profile MUST be published.
- `core` profile MUST contain browser-safe Frostpillar core API behavior that does not require Node-only APIs.
- `core` profile runtime artifact MUST be emitted as a single minified JavaScript file:
  - `dist/bundles/core/frostpillar-core.min.js`
- The `core` single-file bundle MUST be executable in browsers without additional module fetches.
- The `core` single-file bundle MUST expose Frostpillar public API through a deterministic global object contract (`globalThis.Frostpillar`).
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

### 3.4 Browser Bundle Manifest and Profile Matrix Contract

Browser bundle generation MUST emit deterministic profile metadata under `dist/bundles/manifest.json`.

- manifest MUST include `schemaVersion`, `generatedAt`, and `profiles`.
- each entry in `profiles` MUST include:
  - `name`
  - runtime entry path (`entry`)
  - declaration entry path (`types`)
  - included module groups (`includes`)
- for published `core`, `entry` MUST point to `dist/bundles/core/frostpillar-core.min.js`.
- manifest MUST include `profileMatrix` with one entry per profile policy name:
  - mandatory: `core`
  - optional: `core-indexeddb`, `core-opfs`, `core-localstorage`, `full-browser`
- each `profileMatrix` entry MUST declare:
  - `name`
  - `availability` (`published` or `planned`)
  - `backends` (declared backend coverage for that profile)
- profiles with `availability: "published"` MUST have a matching artifact in `profiles`.
- profiles with `availability: "planned"` MUST NOT claim backend runtime support beyond current runtime-slice support.

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
- package artifact/export shape is test-backed.
- bundle profile metadata matrix is test-backed and consistent with produced artifacts.
- EN/JA usage docs include install and profile-selection guidance.
- release artifact list and supported profile matrix are explicit in docs.

## 7. Build Command Contract

Repository tooling MUST provide a dedicated bundle build command:

- `pnpm build:bundle` MUST generate browser bundle artifacts and profile metadata.
- `pnpm build:bundle` MAY assume `pnpm build` has already produced TypeScript outputs under `dist/`.
- If required input files are missing, `pnpm build:bundle` MUST fail with actionable error text.
- Browser bundle build MUST swap Node-only datastore config entry to a browser profile module while keeping capacity/auto-commit parsing logic sourced from one shared module.

## 8. GitHub Actions CI/CD Contract

Repository CI/CD workflow definitions MUST satisfy the following trigger and command policy.

### 8.1 Pull Request Validation (CI)

On pull request create/update events, CI MUST run quality gates for code validation.

- Trigger scope MUST include pull request open/reopen/synchronize events.
- CI MUST execute lint and test validation through project commands:
  - `pnpm check`
  - `pnpm test --run`
- Pull request CI MUST NOT execute delivery artifact build commands by default.

### 8.2 Default-Branch Merge Validation + Build (CD Preparation)

When commits are merged into the repository default branch, CI/CD MUST run validation and build preparation.

- Trigger scope MUST include push events targeting the default branch.
- Pipeline MUST execute:
  - `pnpm check`
  - `pnpm test --run`
  - `pnpm build`
  - `pnpm build:bundle`
- Resulting NPM module and browser bundle artifacts MAY remain local workflow outputs with no publishing destination configured.

### 8.3 Behavior Consistency

The same Node.js and pnpm setup policy SHOULD be used across pull request and default-branch jobs to minimize drift between validation and build environments.
