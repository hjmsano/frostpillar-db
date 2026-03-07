# 09 Security Review: OOM, Null-Handling, and Directory Access Risks

## Scope

This review focuses on local/runtime abuse scenarios for:

- Out-of-memory (OOM) pressure and memory amplification.
- Null/undefined handling paths that can lead to runtime crashes.
- Directory access/path containment risks for file-backed persistence.

This project is not exposed as an internet API, so findings are ranked for local misuse,
unsafe integration patterns, and accidental misconfiguration.

## Findings Summary

| ID | Area | Severity | Status |
| :-- | :--- | :------- | :----- |
| SEC-2026-01 | Directory access (`location: "file"`) | High | Open |
| SEC-2026-02 | OOM via unbounded in-memory records and query materialization | Medium | Open |
| SEC-2026-03 | OOM via unbounded payload object width/total bytes | Medium | Open |
| SEC-2026-04 | Null-pointer style runtime crash risk in query recursion input validation | Low | Open |

---

## SEC-2026-01 (High): Path containment can be bypassed via symlinked directories

### Evidence

- `resolveFileDataPath` checks lexical containment with `path.relative` + `isAbsolute`,
  and enforces paths under `process.cwd()`. It does not canonicalize symlinks with
  `realpath` before containment checks.
- `createFileBackend` then performs file operations directly against the resolved path.

### Why this matters

If a caller supplies a directory inside `process.cwd()` that is itself a symlink to an
external directory, the lexical checks pass while actual writes can escape the repository
working directory policy.

### Recommended remediation

1. Resolve canonical paths for both base and target directories via `fs.realpathSync`.
2. Enforce containment on canonical paths.
3. Re-check canonical parent directory immediately before lock/data file creation.
4. Add tests that construct a symlinked directory fixture and assert rejection.

---

## SEC-2026-02 (Medium): Query path materializes multiple full-size arrays

### Evidence

`executeNativeQuery` currently allocates full intermediate collections:

- `records.filter(...)` -> `filtered`
- `filtered.sort(...)` -> `sorted`
- `sorted.map(...)` -> `rows`
- optional `distinctRows(rows)` -> `output` + `Set<string>`

Combined with default memory backend behavior (no required capacity limit), this can
amplify memory use during wide scans and high-cardinality distinct queries.

### Why this matters

Even without internet exposure, an internal script or accidental batch run can trigger
heap pressure and process OOM termination.

### Recommended remediation

1. Add optional hard cap for total in-memory records (or require `capacity` for memory mode
   in hardened profile).
2. Add query execution guardrails (max scanned rows / max output rows / max distinct set size).
3. Introduce streaming or iterator-based query pipeline for non-sort paths.
4. Add stress tests that assert deterministic rejection before heap growth becomes critical.

---

## SEC-2026-03 (Medium): Payload validation bounds depth and per-string key size, but not object breadth or aggregate payload bytes

### Evidence

Payload validation currently enforces:

- Maximum nesting depth.
- Maximum key UTF-8 byte length.
- Maximum string UTF-8 byte length.
- Type restrictions and circular-reference rejection.

However, it does **not** enforce:

- Max number of keys per object.
- Max total keys in full payload tree.
- Max aggregate UTF-8 bytes per payload.

### Why this matters

Attackers are not required here; an internal producer can accidentally emit huge,
shallow objects that pass current checks and still consume excessive heap/marshal costs.

### Recommended remediation

1. Add `MAX_PAYLOAD_KEYS_TOTAL` and `MAX_PAYLOAD_TOTAL_BYTES` limits.
2. Track aggregate counters during validation traversal.
3. Surface explicit validation errors when either bound is exceeded.
4. Add regression tests for near-limit and over-limit payloads.

---

## SEC-2026-04 (Low): Query expression recursion lacks explicit max depth guard

### Evidence

Query filter evaluation recursively processes nested `and/or/not` expression trees.
There is no explicit expression-depth limit before recursion.

### Why this matters

A deeply nested generated query may trigger stack overflow (`RangeError`) in JS engines.
This is equivalent to a null-pointer-class runtime crash risk (unexpected process error)
rather than data corruption.

### Recommended remediation

1. Add validation pass for expression depth with a strict max (for example 64).
2. Reject too-deep expressions with `QueryValidationError`.
3. Add tests covering valid boundary and overflow boundary.

---

## Positive Controls Already Present

- Regex safety checks reject several dangerous regexp constructs and cap pattern length.
- File path resolution already blocks direct `..` and separator injection in file naming fragments.
- Payload validation already rejects circular references and unsupported value types.

These controls reduce risk, but the above open items remain.

## Next Actions

1. Implement symlink-aware path containment hardening first (SEC-2026-01).
2. Add payload aggregate/breadth guardrails (SEC-2026-03).
3. Add query-depth and query-result guardrails (SEC-2026-04 and part of SEC-2026-02).
4. Implement query pipeline optimizations (remaining part of SEC-2026-02).
5. Record implementation decisions in ADR and update specs/tests with each change.
