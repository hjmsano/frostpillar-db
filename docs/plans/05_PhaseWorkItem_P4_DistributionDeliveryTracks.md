# Plan: Phase Work Item (P4 Distribution Delivery Tracks)

Status: Completed  
Version: 0.2 execution  
Last Updated: 2026-03-07

## 1. Purpose

This work item defines implementation planning for dual delivery tracks:

- NPM module distribution
- browser bundle profile distribution

The goal is to make Frostpillar shippable in package-manager and browser-first workflows without changing core runtime semantics.

## 2. Scope

In scope:

- package-level delivery hardening for NPM consumption
- browser bundle artifact generation for at least `core` profile
- profile documentation for optional browser adapter bundles
- smoke-test coverage for NPM install path and browser bundle load path
- EN/JA usage documentation updates for delivery options

Out of scope:

- implementing new datastore behavior unrelated to delivery
- changing existing capacity/query/durability semantics
- full browser backend implementation beyond already accepted runtime-slice scope

## 3. Execution Requirements

- Contributors MUST follow workflow order:
  intent alignment -> spec update -> failing tests -> implementation -> verification.
- Delivery behavior MUST align with:
  - `docs/specs/13_DistributionDeliveryTracks.md`
  - `docs/specs/04_DatastoreAPI.md`
- Architectural tradeoff changes MUST be captured in ADR updates.
- Implementation MUST avoid unrelated refactors.

## 4. Acceptance Criteria

- NPM package install and import flow is test-proven in a clean fixture.
- package artifacts include runtime JavaScript and matching declaration files.
- browser bundle artifacts are produced for `core` profile.
- each delivered bundle profile is explicitly identified in filename or manifest.
- if any browser backend is marked runtime-supported, bundle artifacts include corresponding profile or `full-browser` profile.
- profile support matrix is documented in EN/JA usage docs.

## 5. Phased Work Breakdown

### Phase A: Spec and Criteria Alignment

- [x] update distribution spec with explicit NPM export contract and profile-matrix manifest clauses
- [x] align EN/JA usage docs scope with current published/planned profile matrix
- [x] record architectural decision for release artifact contract

### Phase B: TDD Red (Failing Tests First)

- [x] add `tests/distribution/npm-install-smoke.test.mjs`
  - explicit package export contract check
  - fixture-based `npm pack` install/import smoke path
- [x] add `tests/distribution/browser-bundle-core-smoke.test.mjs`
  - core bundle load and minimal API execution path
  - profile-matrix metadata consistency checks
- [x] add `tests/specs/p4-distribution-delivery-docs.test.mjs` for docs/ADR/plan sync
- [x] confirm expected red failures before implementation

### Phase C: Implementation (Green)

- [x] implement package release contract (`exports`, artifact file scope)
- [x] implement bundle manifest profile matrix output
- [x] publish current profile matrix guidance in EN/JA usage docs
- [x] update P4 plans/checklist and add ADR-49

### Phase D: Verification and Closure

- [x] targeted distribution/spec tests pass
- [x] full suite passes (`pnpm test --run`)
- [x] quality gate passes (`pnpm check`)
- [x] status checklist updated to Phase 4 completed

## 6. Verification Gate

Work item completion requires:

- targeted distribution tests pass
- full suite passes (`pnpm test --run`)
- quality gate passes (`pnpm check`)
- docs remain aligned (`docs/specs`, `docs/plans`, `docs/usage` EN/JA, ADR)

## 7. Completion Notes (2026-03-07)

- Added distribution smoke and docs-sync regression tests:
  - `tests/distribution/npm-install-smoke.test.mjs`
  - `tests/distribution/browser-bundle-core-smoke.test.mjs`
  - `tests/specs/p4-distribution-delivery-docs.test.mjs`
- Package delivery contract now includes explicit top-level `exports` and restricted package file scope for release artifacts.
- Bundle build now emits deterministic `profileMatrix` metadata in `dist/bundles/manifest.json` with published/planned status.
- Verification commands:
  - `pnpm test --run tests/distribution/npm-install-smoke.test.mjs tests/distribution/browser-bundle-core-smoke.test.mjs tests/specs/p4-distribution-delivery-docs.test.mjs`
  - `pnpm test --run`
  - `pnpm check`
