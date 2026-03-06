# ADR-27: File Backend Exclusive Open Lock for Multi-Process Safety

Status: Accepted  
Date: 2026-03-06

## Context

The file backend stores mutable shared state in generation files and metadata sidecar:

- B+ tree pages and linked structures are updated by commit flows.
- Node.js file APIs do not provide implicit cross-process datastore-level locking.
- Without explicit lock ownership, two processes can open the same datastore path and
  concurrently write incompatible structures.

This is a direct data-corruption risk and violates deterministic durability expectations.

## Decision

1. Require single-writer lock on file backend open

- `docs/specs/04_DatastoreAPI.md` now requires exclusive lock acquisition before any
  read/write operation for `location: "file"`.
- Lock path is standardized as `${resolvedDataFilePath}.lock`.

2. Standardize failure mode when lock is already owned

- If lock acquisition fails because another live process owns the datastore lock, open
  MUST fail fast.
- Error type is `DatabaseLockedError` as a subtype of `StorageEngineError`.
- Implementation MUST NOT silently continue in read-only/best-effort mode.

3. Define lock lifecycle baseline

- On successful `close()`, implementation MUST release lock ownership.
- Default open flow MUST NOT auto-steal an existing lock.
- Optional stale-lock recovery may exist only as explicit operator-controlled behavior.

4. Align user and test documentation

- `docs/usage/01_DatastoreAPI.md` and `docs/usage/01_DatastoreAPI-JA.md` now describe
  lock file naming and lock-conflict behavior.
- `docs/testing/strategy.md` now requires lock acquisition/conflict/release tests for
  file backend.

## Consequences

Positive:

- Prevents silent multi-process write corruption for one datastore path.
- Gives callers a deterministic and typed lock-conflict failure.
- Keeps file backend behavior explicit and testable.

Trade-off:

- File backend is single-writer by default; additional operational handling is needed when
  stale lock artifacts are encountered.
