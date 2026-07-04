# ADR-007: Single-Threaded Concurrency Model

- **Status:** Accepted
- **Date:** 2026-04-03
- **Deciders:** Hajime Sano

## Context

frostpillar-db is an embedded document database targeting Browser and Node.js environments. Both runtimes execute JavaScript on a single-threaded event loop. We need to decide how the library handles concurrent access to documents.

Two categories of concern exist:

1. **True parallelism** — multiple threads or processes writing to the same store simultaneously.
2. **Async interleaving** — multiple async operations within the same event loop interleaving at `await` boundaries.

Although JavaScript is single-threaded, compound async operations such as `update()` (read-modify-write) are not atomic. Two concurrent `update()` calls on the same document can interleave as follows:

```
update1: read doc (version A) → ... await ... → write doc (version A')
update2: read doc (version A) → ... await ... → write doc (version A'')  // A' is lost
```

This is the classic lost-update problem.

## Decision

Rely on **JavaScript's single-threaded event loop** as the sole concurrency model. No mutexes, locks, semaphores, or other concurrency primitives are introduced. No optimistic concurrency control (version fields, ETags) or retry logic is provided.

### Atomicity Guarantees

| Operation scope            | Atomic? | Examples                                                        |
| -------------------------- | ------- | --------------------------------------------------------------- |
| Single storage engine call | Yes     | `put`, `get`, `delete`                                          |
| Compound operation         | No      | `update` (get + filter + put), `remove` (get + filter + delete) |

### Auto-Commit and Durability

The storage engine's auto-commit runs on a timer. Writes between two commit points are durable only if `commit()` is called explicitly or the auto-commit timer fires. A crash between a write and the next commit loses uncommitted data.

## Rationale

- **Target use case** — frostpillar-db targets small, single-user applications (browser extensions, local tools, lightweight Node.js services). These scenarios rarely involve concurrent writers.
- **Complexity avoidance** — optimistic locking (version fields, conflict detection, retry loops) or pessimistic locking (mutexes, queues) would add significant internal complexity, increase the API surface, and introduce failure modes that are disproportionate to the target audience.
- **User-level serialization** — callers who need safe concurrent access can serialize their own operations (e.g., awaiting one update before starting the next, or using an external queue).
- **Single-threaded guarantee** — JavaScript's event loop ensures that synchronous code segments between `await` boundaries execute without interruption. Individual storage engine calls are safe.

## Consequences

### Positive

- Zero overhead from locks, version checks, or retry logic.
- Simpler internal code with fewer failure modes.
- Predictable performance characteristics.

### Negative

- Concurrent `update()` calls on the same document can cause lost updates.
- Concurrent `remove()` and `update()` on overlapping document sets can produce inconsistent results.
- No built-in protection against stale reads in read-modify-write sequences.
- Uncommitted writes are lost on crash if neither explicit `commit()` nor auto-commit has fired.

### Scan-Based `remove()` and Change-Event Attribution

The scan-based `remove()` path (used for non-`_id` filters and for collections with `duplicateKeys: 'allow'`) deletes each matched record individually via `Datastore.deleteById(entryId)` rather than in a single batch. This is intentional: `deleteById` returns a boolean indicating whether that specific record was removed, so a `remove` change event is emitted only for records that were actually deleted. Under concurrent deletion (another actor removed some records between the scan and the delete), the per-id approach keeps event attribution correct — a batch count (`deleteByIds`) only tells how many were removed in total, not which ones. The cost is reduced batch throughput on the scan-based path, which is accepted because change-event correctness is required by the watch contract.

### Future Considerations

- Optional optimistic locking (a `_version` field with conflict detection) could be added as a separate feature without changing the core API.
- A document-level operation queue could be introduced to serialize writes per document ID, if demand arises.
