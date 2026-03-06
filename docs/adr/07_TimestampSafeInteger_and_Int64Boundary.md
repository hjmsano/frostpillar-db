# ADR-07: Timestamp Safe-Integer Canonical Type and Int64 Boundary Conversion

Status: Accepted  
Date: 2026-03-06

## Context

`TimeseriesRecord` defines canonical timestamp as JavaScript `number` with safe-integer constraint.
Binary encoding stores timestamp as signed `Int64` for fixed-width storage and cross-runtime compatibility.

Without explicit boundary rules, implementations may silently lose precision when converting between `number` and `Int64` (`bigint` in JavaScript).
That would violate deterministic and correctness goals in `docs/architecture/vision-and-principles.md`.

## Decision

1. Canonical API type remains `number`

- Keep `timestamp: number` with `Number.isSafeInteger` as the canonical in-memory and API-visible contract.
- Do not expose `bigint` in current public record shape.

2. Encode boundary is strict

- Before binary write, timestamp MUST satisfy `Number.isSafeInteger`.
- Encoder MUST convert via `BigInt(timestamp)` and write signed `Int64` little-endian.

3. Decode boundary is strict

- Decoder MUST read `TIMESTAMP_I64` as `bigint`.
- If value is outside JavaScript safe integer range, decoding MUST fail with typed format error.
- Implementations MUST NOT round, clamp, or truncate.
- If value is in range, decoder converts to `number` and returns canonical record.

4. Test obligations

- Add boundary tests for `MIN_SAFE_INTEGER` and `MAX_SAFE_INTEGER`.
- Add rejection tests for out-of-safe-range `Int64` values on decode.

## Consequences

Positive:

- Prevents silent timestamp corruption.
- Keeps API ergonomic while preserving binary correctness.
- Makes malformed/corrupt durable data fail fast and explicitly.

Trade-off:

- Decode path requires explicit range checks and typed failure handling.
- Some otherwise valid `Int64` values are intentionally rejected because canonical API type is bounded to safe integers.
