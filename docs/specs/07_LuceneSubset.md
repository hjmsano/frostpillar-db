# Spec: Lucene Subset Query Engine (v0.2 draft)

Status: Draft  
Version: 0.2  
Last Updated: 2026-03-06

This document defines the supported Lucene query subset for Frostpillar optional Lucene query-engine module.

## 1. Supported Query Form

Lucene subset module accepts query text and translates it into Frostpillar native query requests.
To follow SQL subset requirements, Lucene subset MUST cover equivalent operation categories.

## 2. Supported Features

### 2.1 Field Matching

- `field:value`
- quoted term: `field:"exact phrase"`

### 2.1.1 Nested Fields

- Dot notation MUST be used for nested object path traversal: `user.profile.country:JP`

### 2.1.2 Quoted Value Escaping

- Quoted value text uses double quotes: `field:"exact phrase"`.
- Inside quoted value text, backslash escaping MUST support:
  - `\"` for literal double quote.
  - `\\` for literal backslash.
- Unterminated quoted strings, trailing escape, or unsupported escape sequences MUST raise `QueryParseError`.
- Example: `msg:"Error: \\\"Timeout\\\""` represents value `Error: "Timeout"`.

### 2.2 Boolean Logic

- `AND`, `OR`, `NOT`
- parentheses grouping: `(A OR B) AND C`

### 2.3 Range Search

- inclusive: `field:[a TO b]`
- exclusive: `field:{a TO b}`
- Unquoted numeric literals in range bounds MUST be parsed as `number`.
- Quoted range bounds MUST remain `string` literals at parse stage.
- Unquoted non-numeric range bounds MUST remain `string` literals at parse stage.
- For reserved field `timestamp`, accepted timestamp-string bounds (quoted or unquoted)
  MUST be normalized to Unix epoch milliseconds before native query execution.
- Timestamp range normalization MUST apply to both inclusive (`[]`) and exclusive (`{}`)
  range forms.
- Invalid timestamp bounds for `timestamp` range queries MUST raise `QueryValidationError`.

### 2.4 Wildcards

- multi-char wildcard: `*`
- single-char wildcard: `?`

### 2.5 Null/Missing Handling

- explicit null: `field:null`
- field exists: `field:*`
- field missing: `NOT field:*`

Mapping:

- `field:null` MUST match records where the field exists and value is explicit `null`.
- `field:*` MUST map to native `exists` and MUST include explicit `null` values.
- `NOT field:*` MUST map to native `not_exists` and MUST match only missing fields.

### 2.6 Regular Expression

- regex term query: `field:/pattern/`
- regex matching semantics MUST be equivalent to SQL `REGEXP` support in
  `docs/specs/06_SQLSubset.md`.

### 2.7 Aggregation, Grouping, and Output Control

Lucene syntax focuses on filtering terms. Aggregation and output control are provided
through request options carried alongside Lucene filter text.

- Aggregations: `COUNT`, `MIN`, `MAX`, `SUM`, `AVG`, `PERCENTILE_CONT` equivalent
- Grouping: equivalent to SQL `GROUP BY`
- Output controls: sorting, distinct, limit, projection aliases

Constraints:

- `PERCENTILE_CONT` equivalent MUST enforce `0 <= p <= 1`.
- percentile evaluation MUST target numeric fields only.

## 3. Unsupported Features

- fuzzy search (`~`)
- boosting (`^`)
- proximity operators
- full-text relevance scoring model customization

## 4. Reserved Fields

- `_id`: internal record id
- `timestamp`: canonical epoch milliseconds
  - Query values for `timestamp` MAY be ISO-8601 date-time strings with timezone
    (for example `2026-01-01T09:00:00+09:00`).
  - Date-only literals `YYYY-MM-DD` are also allowed and MUST be interpreted as `YYYY-MM-DDT00:00:00.000Z`.
  - Query engine MUST normalize accepted timestamp strings into Unix epoch milliseconds before execution.
  - This normalization rule applies to both term comparisons and range-query bounds.
  - Invalid `timestamp` date strings MUST raise `QueryValidationError`.
- nested payload fields are addressed with dot path notation (for example `user.profile.country:JP`)
- canonical payload path escaping MUST follow `docs/specs/05_QueryEngineContract.md` section 6
  (single source of truth across query engines)

## 5. Integration Rules

- Lucene subset text primarily describes filter expression.
- Aggregation/grouping/output options are supplied through `QueryExecutionOptions` argument in
  `toNativeQuery(queryText, options)`.
- Combined behavior MUST be equivalent to SQL subset capability coverage.
- Module MUST map unsupported feature usage to `UnsupportedQueryFeatureError`.

Additional normative rules:

- Lucene module MUST NOT invent aggregation/grouping/output controls from query text unless explicitly defined by this spec.
- When `options` are present, module MUST map them directly into `NativeQueryRequest` fields.
- Invalid option values (for example negative limit, non-numeric percentile) MUST raise `QueryValidationError`.
- Predicate type/null/missing semantics MUST follow `docs/specs/05_QueryEngineContract.md` section 7.
