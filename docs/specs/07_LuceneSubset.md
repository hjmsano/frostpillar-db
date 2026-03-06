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

### 2.2 Boolean Logic

- `AND`, `OR`, `NOT`
- parentheses grouping: `(A OR B) AND C`

### 2.3 Range Search

- inclusive: `field:[a TO b]`
- exclusive: `field:{a TO b}`

### 2.4 Wildcards

- multi-char wildcard: `*`
- single-char wildcard: `?`

### 2.5 Null/Missing Handling

- field exists: `field:*`
- field missing: `NOT field:*`

Mapping:

- `field:*` MUST map to native `exists` operator.
- `NOT field:*` MUST map to native `not_exists` operator.

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
- nested payload fields are addressed with dot path notation (for example `user.profile.country:JP`)
- dot characters within one key segment MUST be escaped as `\\.` in canonical field path
- backslash in one key segment MUST be escaped as `\\\\` in canonical field path

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
