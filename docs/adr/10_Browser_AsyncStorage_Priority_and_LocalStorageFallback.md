# ADR-10: Browser Async Storage Priority and localStorage Fallback

Status: Accepted  
Date: 2026-03-06

## Context

Frostpillar defines an async-only API surface as a non-negotiable architectural principle.
The previous browser storage decision focused on `localStorage` chunking and key layout (ADR-06), but `localStorage` is a synchronous API and can block the browser main thread.

To align browser persistence with async-only goals, the browser backend strategy must prioritize async-native APIs while preserving compatibility for older environments.

## Decision

1. Browser storage modes

- `browserStorage` supports `"auto" | "opfs" | "indexedDB" | "localStorage"`.
- default mode is `"auto"`.

2. Priority order in auto mode

- `"auto"` MUST resolve in this order:
  1. `opfs`
  2. `indexedDB`
  3. `localStorage`

3. Explicit mode behavior

- If a mode is explicitly selected and unavailable at runtime, datastore MUST reject with `UnsupportedBackendError`.
- No implicit override to another backend when explicit mode is requested.

4. localStorage role

- `localStorage` remains supported as a compatibility fallback backend.
- Existing chunking/key/quota rules from ADR-06 remain valid when `browserStorage === "localStorage"`.

## Consequences

Positive:

- Better alignment with async-only architecture in browser environments.
- Better main-thread safety by prioritizing async-native persistence.
- Cross-browser behavior remains predictable with explicit fallback order.

Trade-off:

- Runtime capability detection and backend selection logic become more complex.
- Browser-mode test matrix expands to include capability and fallback scenarios.

## Relationship to Previous ADRs

- This ADR supersedes ADR-06 only for browser backend selection priority.
- ADR-06 localStorage chunking/key/quota contract remains in effect for localStorage mode.
