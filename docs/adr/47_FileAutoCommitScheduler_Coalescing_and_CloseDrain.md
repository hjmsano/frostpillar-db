# ADR-47: File Auto-Commit Scheduler Coalescing and Close Drain

Status: Accepted  
Date: 2026-03-07

## Context

Phase 3 still had one open obligation:

- add regression coverage and implementation hardening for scheduler coalescing and
  datastore error-channel propagation

Existing implementation used straightforward periodic `commitNow()` calls but did not
explicitly model coalescing under in-flight commit overlap or close-path wait semantics
as dedicated, test-proven behavior.

## Decision

Adopt single in-flight commit orchestration in file backend controller.

- keep at most one active commit execution at any time
- if trigger arrives during active commit, coalesce request and run at most one follow-up
  commit after settle when pending changes remain
- on background commit failure, emit exactly one datastore `"error"` event per failed attempt
  and keep pending dirty state for later retry trigger
- `close()` stops scheduling and waits active commit settlement before lock/resource release

## Alternatives Considered

1. keep current periodic direct commit calls with no explicit coalescing state
2. queue every trigger as independent commit task
3. maintain one in-flight execution with coalesced follow-up semantics

## Consequences

Positive:

- aligns runtime behavior with flush/durability spec semantics
- avoids overlapping commit execution under timer pressure
- makes background failure propagation deterministic and regression-testable

Trade-off:

- controller implementation becomes more stateful
- tests require deterministic commit-hook control for overlap/failure simulation
