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
| SEC-2026-01 | Directory access (`location: "file"`) | High | Closed (2026-03-07) |
| SEC-2026-02 | OOM via unbounded in-memory records and query materialization | Medium | Closed (2026-03-07) |
| SEC-2026-03 | OOM via unbounded payload object width/total bytes | Medium | Closed (2026-03-07) |
| SEC-2026-04 | Null-pointer style runtime crash risk in query recursion input validation | Low | Closed (2026-03-07) |

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

### Implemented remediation (2026-03-07)

1. Canonicalized both base and target paths with `realpathSync`-based containment checks.
2. Enforced canonical containment for `filePath`, `target.kind === "path"`, and `target.kind === "directory"`.
3. Added immediate pre-lock canonical containment re-check in file backend open path.
4. Added regression tests with symlinked directory fixture and rejection assertions.

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

### Implemented remediation (2026-03-07)

1. Added query execution guardrails:
   - scanned-row limit (`10000`)
   - output-row limit (`5000`)
2. Refactored query projection/distinct flow to avoid duplicate full-size intermediate arrays.
3. Added regression tests that assert deterministic `QueryValidationError` on guardrail overflow.

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

### Implemented remediation (2026-03-07)

1. Added payload guardrails:
   - per-object key limit (`256`)
   - total key limit (`4096`)
   - aggregate validation byte budget (`1048576`)
2. Added aggregate counters in payload validation traversal.
3. Added explicit `ValidationError` failure paths for each guardrail.
4. Added regression tests for over-limit payload width/key-count/byte-budget cases.

---

## SEC-2026-04 (Low): Query expression recursion lacks explicit max depth guard

### Evidence

Query filter evaluation recursively processes nested `and/or/not` expression trees.
There is no explicit expression-depth limit before recursion.

### Why this matters

A deeply nested generated query may trigger stack overflow (`RangeError`) in JS engines.
This is equivalent to a null-pointer-class runtime crash risk (unexpected process error)
rather than data corruption.

### Implemented remediation (2026-03-07)

1. Added native filter-expression depth validation with max depth `64`.
2. Too-deep expressions now fail with `QueryValidationError` before scan.
3. Added regression tests covering overflow boundary.

---

## Positive Controls Already Present

- Regex safety checks reject several dangerous regexp constructs and cap pattern length.
- File path resolution already blocks direct `..` and separator injection in file naming fragments.
- Payload validation already rejects circular references and unsupported value types.

These controls reduce risk, but the above open items remain.

## Closure Notes

This review's four tracked findings are closed by implementation and tests on 2026-03-07.
Policy and rationale are recorded in:

- `docs/adr/53_SecurityHardening_Execution_for_SymlinkPayload_and_QueryGuards.md`
