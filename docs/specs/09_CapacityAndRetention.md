# Spec: Capacity and Retention Policy (v0.2 draft)

Status: Draft  
Version: 0.2  
Last Updated: 2026-03-06

This document defines bounded-size behavior for Frostpillar.
It complements `docs/specs/04_DatastoreAPI.md` and closes the gap between vision goals and API contract.

## 1. Scope

In scope:

- total data size limit (`maxSize`)
- deterministic policy behavior when inserting into a full datastore
- strict rejection and turnover (ring-buffer) behavior

Out of scope:

- compression ratio guarantees
- filesystem/browser quota detection internals (covered by adapter-specific errors)

## 2. Config Types (Normative)

```typescript
export type ByteSizeInput = number | `${number}B` | `${number}KB` | `${number}MB` | `${number}GB`;

export type CapacityPolicy = 'strict' | 'turnover';

export type CapacityConfig = {
  maxSize: ByteSizeInput;
  policy?: CapacityPolicy;
};
```

Normalization rules:

- `maxSize` MUST normalize to positive integer bytes.
- Numeric `maxSize` is interpreted as bytes.
- String units MUST use binary steps:
  - `1KB = 1024B`
  - `1MB = 1024KB`
  - `1GB = 1024MB`
- Fractional values and non-positive values MUST be rejected with `ConfigurationError`.
- Default policy is `"strict"` when omitted.

## 3. Capacity Accounting Model

- Capacity accounting unit is the deterministic encoded record byte length from TLV (`docs/specs/02_BinaryEncoding.md`).
- For one record, accounted bytes are measured on canonical encoded bytes before insertion is finalized.
- Accounting MUST be deterministic for equivalent logical records.

## 4. Boundary Enforcement Semantics

On each `insert(record)`:

1. normalize and validate record
2. compute encoded byte length for capacity accounting
3. evaluate capacity policy before finalizing mutation

If record encoded size alone is larger than `maxSize`:

- operation MUST fail with `QuotaExceededError`
- no eviction attempt is allowed

## 5. Policy A: Strict Capacity (`policy: "strict"`)

- If `currentSize + newRecordSize > maxSize`, `insert` MUST fail with `QuotaExceededError`.
- Failure MUST be atomic:
  - datastore visible state remains unchanged
  - no partial record write
  - no implicit eviction

## 6. Policy B: Turnover (`policy: "turnover"`)

- If `currentSize + newRecordSize > maxSize`, datastore MUST evict oldest records first.
- Eviction order MUST be deterministic oldest-first by logical ordering key:
  - primary: `timestamp` ascending
  - tie-breaker: insertion-order key ascending
- Turnover eviction MUST be executed via internal deletion of existing records.
- This internal deletion path MUST NOT be interpreted as public delete API support in v0.2.
- Eviction repeats until `currentSize + newRecordSize <= maxSize`.
- Then new record insertion proceeds.

If the datastore becomes empty and `newRecordSize > maxSize`:

- operation MUST fail with `QuotaExceededError`

## 7. Visibility and Durability

- For one `insert` under turnover policy, eviction(s) and new insert are one logical mutation.
- If the operation succeeds, subsequent `select` MUST observe the post-eviction + inserted state.
- For durable backends, durability boundary still follows successful `commit()` semantics from `docs/specs/10_FlushAndDurability.md`.

## 8. Error Contract

- Invalid capacity config: `ConfigurationError`
- Capacity overflow under strict policy: `QuotaExceededError`
- Capacity overflow where single record cannot fit: `QuotaExceededError`

## 9. Non-Goals

- This spec does not define user-level callbacks/metrics for each eviction.
- This spec does not define multi-tenant quotas.
- This spec does not define a public record delete API.
