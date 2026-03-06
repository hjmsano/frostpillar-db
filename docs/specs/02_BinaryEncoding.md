# Spec: Binary Encoding (TLV, v0.2 draft)

Status: Draft  
Version: 0.2  
Last Updated: 2026-03-06

This document defines the canonical TLV format for serializing
`PersistedTimeseriesRecord`.
It must stay aligned with `docs/specs/01_RecordFormat.md`.

## 1. Encoding Principles

- Compact representation over JSON text.
- Fast sequential parsing and field skipping.
- Deterministic bytes for equivalent logical input.
- Explicit, strict decoding failure behavior.

## 2. Primitive Rules (Normative)

### 2.1 Byte Order

- All multi-byte numeric fields MUST use little-endian encoding.

### 2.2 TLV Envelope

- Each field is encoded as:
  - `Type`: `Uint8` (1 byte)
  - `Length`: `Uint32` (4 bytes, little-endian)
  - `Value`: byte sequence of exactly `Length` bytes
- Although `Length` uses `Uint32`, payload key/value logical byte bounds are
  restricted by `docs/specs/01_RecordFormat.md` for lightweight resource safety.

### 2.3 Type IDs

| ID (Hex) | Symbol                | Value Encoding                                    |
| :------- | :-------------------- | :------------------------------------------------ |
| `0x00`   | `RESERVED`            | reserved sentinel; not a valid emitted TLV field  |
| `0x01`   | `TIMESTAMP_I64`       | signed `Int64` (8 bytes, Unix Epoch Milliseconds) |
| `0x02`   | `PAYLOAD_OBJECT`      | concatenated payload entry TLVs                   |
| `0x03`   | `INSERTION_ORDER_U64` | unsigned `Uint64` (8 bytes)                       |
| `0x10`   | `UTF8_STRING`         | UTF-8 bytes                                       |
| `0x11`   | `FLOAT64`             | IEEE754 float64 (8 bytes)                         |
| `0x12`   | `BOOLEAN`             | single byte: `0x00` or `0x01`                     |
| `0x13`   | `NULL`                | no value bytes (`Length = 0`)                     |
| `0x14`   | `OBJECT`              | concatenated key-value entry TLVs                 |

- `0x00` MUST NOT be emitted for valid v0.2 TLV fields.
- Decoder MUST treat encountered `Type = 0x00` as a typed format error in v0.2.

### 2.4 Timestamp Conversion Boundary (`number` <-> `Int64`)

- Canonical record timestamp type is defined in `docs/specs/01_RecordFormat.md` as JavaScript `number` with safe-integer constraint.
- On encode, implementation MUST verify `Number.isSafeInteger(record.timestamp)` before writing binary bytes.
- On encode, implementation MUST convert timestamp using `BigInt(record.timestamp)` and write one signed `Int64` value (little-endian).
- On decode, implementation MUST read `TIMESTAMP_I64` as `bigint`.
- On decode, if decoded timestamp is outside JavaScript safe integer range (`Number.MIN_SAFE_INTEGER` to `Number.MAX_SAFE_INTEGER`), decoder MUST fail with a typed format error.
- On decode, if value is inside safe integer range, implementation MUST convert to `number` via `Number(decodedTimestampBigInt)`.
- Implementations MUST NOT silently truncate, round, or clamp timestamp values during conversion.

### 2.5 Insertion-Order Conversion Boundary (`bigint` <-> `Uint64`)

- Canonical persisted insertion-order type is defined in `docs/specs/01_RecordFormat.md` as `bigint` in unsigned 64-bit range.
- On encode, implementation MUST verify `typeof record.insertionOrder === "bigint"`.
- On encode, implementation MUST verify
  `0n <= record.insertionOrder <= 18446744073709551615n`.
- On encode, implementation MUST write `INSERTION_ORDER_U64` using 8-byte little-endian `Uint64`.
- On decode, implementation MUST read `INSERTION_ORDER_U64` as `bigint`.
- On decode, values outside unsigned 64-bit range MUST fail with typed format error.
- Implementations MUST NOT synthesize insertion-order from physical slot/page position.

## 3. Record-Level Layout

A record MUST be encoded in this exact top-level order:

1. `TIMESTAMP_I64` TLV
2. `INSERTION_ORDER_U64` TLV
3. `PAYLOAD_OBJECT` TLV

Any other top-level order MUST be rejected during decode in v0.2.

### 3.1 Single-Record Contiguity and Page Boundary

- One persisted record MUST be represented as one contiguous TLV byte sequence.
- Encoder/decoder MUST NOT use continuation chunks in v0.2.
- v0.2 binary encoding does not define a fragmented multi-page record envelope.
- Encoder MUST fail if total encoded record bytes exceed target page payload capacity.
- For paged storage in v0.2, target page payload capacity is
  `maxSingleRecordBytes = pageSize - 32 - 4` (see `docs/specs/03_PageStructure.md`).
- For paged storage, page-fit boundary and overflow behavior MUST follow
  `docs/specs/03_PageStructure.md` section 2.1.

### 3.2 Derived Record ID (No Stored ID Field)

- Binary record bytes in v0.2 MUST NOT include an explicit `RecordId` field.
- Canonical `RecordId` is derived after decode from tuple
  `(timestamp, insertionOrder)` per `docs/specs/01_RecordFormat.md`:
  `"<timestamp>:<insertionOrder>"`.
- Encoder/decoder MUST NOT generate `RecordId` from physical page/slot position.

## 4. Payload Object Encoding

The `PAYLOAD_OBJECT` value is a concatenation of key-value entry pairs:

1. key as `UTF8_STRING` TLV
2. value as one TLV of: `UTF8_STRING | FLOAT64 | BOOLEAN | NULL | OBJECT`

The `OBJECT` TLV value uses the same key-value entry format recursively.

### 4.1 Canonical Key Order

- Payload keys MUST be encoded in ascending lexicographic order of UTF-8 byte sequence.
- Payload key UTF-8 byte length MUST be `<= 1024`.
- Decoder MUST accept only valid key-value TLV pairs.

### 4.2 Value Constraints

- `FLOAT64` payload numbers MUST be finite on encode.
- Decoder MUST reject non-finite `FLOAT64` values (`NaN`, `+Infinity`, `-Infinity`).
- Payload numeric value encoding in v0.2 is `FLOAT64` only.
- Payload `Int64`/`Uint64` value TLV types are not defined in v0.2.
- Encoder MUST reject JavaScript `bigint` payload values.
- UTF8_STRING payload value byte length MUST be `<= 65535`.
- `BOOLEAN` length MUST be exactly `1`.
- `NULL` length MUST be `0`.
- `OBJECT` value MUST contain valid key-value pairs only (same structure as section 4).

### 4.3 Payload Object Depth Limit

- Payload object max nesting depth MUST be `64`, aligned with
  `docs/specs/01_RecordFormat.md`.
- Depth counting rule: `PAYLOAD_OBJECT` root is depth `0`; each nested `OBJECT`
  TLV increments depth by `1`.
- Encoder MUST reject payloads exceeding max depth before writing bytes.
- Decoder MUST reject payload object bytes exceeding max depth.
- Implementations SHOULD avoid unbounded recursion in object traversal to
  prevent stack overflow on malformed/deep inputs.

## 5. Decoding Failures

Decoder MUST fail with a typed format error if any condition is violated:

- unknown `Type` ID in v0.2
- declared length exceeds remaining bytes
- invalid primitive lengths for fixed-size types
- invalid `BOOLEAN` value byte (must be `0x00` or `0x01`)
- decoded `FLOAT64` is non-finite (`NaN`, `+Infinity`, `-Infinity`)
- missing required top-level fields
- duplicate required top-level fields
- invalid key-value pairing inside payload object
- payload key UTF-8 byte length exceeds `1024`
- UTF8_STRING payload value byte length exceeds `65535`
- non-object payload root
- cyclic object graph attempt during encode
- payload object nesting depth exceeds `64`
- decoded `TIMESTAMP_I64` not representable as JavaScript safe integer
- missing or duplicate `INSERTION_ORDER_U64`

## 6. Determinism Requirements

For two logically equivalent `PersistedTimeseriesRecord` values:

- output bytes MUST be identical
- payload key ordering MUST not depend on insertion order in source object
- v0.2 payload `FLOAT64` logical domain excludes `NaN`/infinities; therefore NaN canonical byte mapping is not defined in v0.2.

## 7. Conceptual Example

Logical record:

```json
{
  "timestamp": 1735689600000,
  "insertionOrder": "42n (internal bigint)",
  "payload": {
    "event": "login",
    "user": {
      "profile": {
        "country": "JP"
      }
    }
  }
}
```

Conceptual bytes:

```text
[TIMESTAMP_I64_T][00000008][8-byte Int64 LE]
[INSERTION_ORDER_U64_T][00000008][8-byte Uint64 LE]
[PAYLOAD_OBJECT_T][payload_len]
  [UTF8_STRING_T]["event"]
  [UTF8_STRING_T]["login"]
  [UTF8_STRING_T]["user"]
  [OBJECT_T][user_len]
    [UTF8_STRING_T]["profile"]
    [OBJECT_T][profile_len]
      [UTF8_STRING_T]["country"]
      [UTF8_STRING_T]["JP"]
```
