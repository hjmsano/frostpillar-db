# ADR-23: Binary and Query Spec Ambiguity Resolutions

Status: Accepted  
Date: 2026-03-06

## Context

Specification review identified four ambiguity points affecting interoperability and deterministic behavior:

1. `FLOAT64` determinism wording could be interpreted as allowing multiple NaN bit patterns.
2. Binary decoding rules did not explicitly list invalid `BOOLEAN` value bytes as mandatory failure.
3. Lucene subset described field-path escaping but did not define escaping inside quoted value strings.
4. Regex behavior needed explicit alignment between SQL and Lucene modules under TypeScript runtime semantics.

## Decision

1. Keep payload numeric domain finite-only in v0.2

- `FLOAT64` payload values remain finite-only.
- Decoder must reject non-finite `FLOAT64` bytes (`NaN`, `+Infinity`, `-Infinity`).
- NaN canonical byte mapping is out of scope for v0.2 because NaN is not in the valid payload domain.

2. Tighten boolean decoding

- `BOOLEAN` value byte must be exactly `0x00` or `0x01`.
- Any other byte value is a mandatory typed format failure.

3. Define Lucene quoted value escaping

- Quoted values use `"` delimiters.
- Supported escapes inside quotes are `\"` and `\\`.
- Unterminated quotes, trailing escape, or unsupported escape sequences fail with `QueryParseError`.

4. Standardize regex semantics for SQL/Lucene parity

- SQL `REGEXP` semantics are defined as ECMAScript `RegExp` behavior in TypeScript runtime.
- Matching behavior is equivalent to `RegExp.test(...)` (partial match unless explicitly anchored by pattern).
- Lucene regex query semantics continue to reference SQL `REGEXP` semantics for parity.

## Consequences

Positive:

- Reduces cross-runtime ambiguity in binary decode and query parsing.
- Improves deterministic behavior by removing undefined non-finite numeric cases.
- Strengthens SQL/Lucene behavioral parity for regex predicates.

Trade-offs:

- Non-finite numeric payload values are uniformly invalid in v0.2.
- Lucene quoted-string grammar is stricter, so previously tolerated loose escapes must now fail.
