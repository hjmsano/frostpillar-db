# ADR-40: Dual Delivery Tracks (NPM and Browser Bundle Profiles)

Status: Accepted  
Date: 2026-03-07

## Context

Frostpillar needs a concrete shipping contract for end users.
Current specs define runtime behavior, but delivery mode obligations were not explicitly captured.

A user-facing requirement now exists:

1. installable NPM module for application developers
2. browser-oriented bundle artifacts (single file or profile-based few files)

At the same time, runtime scope remains phased (`location: "browser"` support is not fully implemented yet).
Without an explicit policy, delivery docs can drift into contradictory claims.

## Decision

Adopt two mandatory delivery tracks for publishable Frostpillar releases:

- `Track A`: NPM module distribution (`frostpillar`)
- `Track B`: browser bundle distribution with explicit profile labeling

Define profile policy:

- mandatory baseline profile: `core`
- optional profiles: `core-indexeddb`, `core-opfs`, `core-localstorage`, `full-browser`
- profile support claims must remain aligned with runtime-slice support in datastore specs

Codify this policy in:

- `docs/specs/13_DistributionDeliveryTracks.md`
- usage docs (EN/JA) for delivery guidance
- planning work items for implementation sequencing

## Consequences

Positive:

- clear product requirement for shipping to both package-manager and browser-first users
- explicit separation between delivery packaging and runtime behavior semantics
- lower risk of over-claiming browser backend support before implementation is complete

Trade-off:

- release pipeline and test matrix become broader (NPM smoke + bundle smoke + profile documentation)
- artifact naming and profile documentation must be maintained with each release
