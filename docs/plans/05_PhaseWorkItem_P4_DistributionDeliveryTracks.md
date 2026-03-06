# Plan: Phase Work Item (P4 Distribution Delivery Tracks)

Status: Draft  
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

## 5. Failing Tests (TDD Red)

Before implementation, add failing tests that codify delivery obligations:

- `tests/distribution/npm-install-smoke.test.mjs`
  - install/import smoke verification for published artifact shape (fixture-based)
- `tests/distribution/browser-bundle-core-smoke.test.mjs`
  - browser-compatible bundle load and minimal API path verification
- profile support metadata tests:
  - ensure declared profile matrix matches produced artifact list

Each test MUST fail first for expected reasons before implementation starts.

## 6. Verification Gate

Work item completion requires:

- targeted distribution tests pass
- full suite passes (`pnpm test --run`)
- quality gate passes (`pnpm check`)
- docs remain aligned (`docs/specs`, `docs/plans`, `docs/usage` EN/JA, ADR)
