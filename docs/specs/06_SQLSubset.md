# Spec: SQL Subset Query Engine (v0.2 draft)

Status: Draft  
Version: 0.2  
Last Updated: 2026-03-06

This document defines the supported SQL subset for Frostpillar optional SQL query-engine module.

## 1. Supported Statement Shape

Only one statement form is supported:

```sql
SELECT <select_list>
FROM records
[WHERE <predicate>]
[GROUP BY <field_list>]
[ORDER BY <order_list>]
[LIMIT <n>]
```

## 2. Supported Features

### 2.1 Filtering

- Field comparison: `=`, `!=`, `>`, `>=`, `<`, `<=`
- Boolean: `AND`, `OR`, `NOT`, parentheses
- Range: `BETWEEN ... AND ...`
- Null checks: `IS NULL`, `IS NOT NULL`
- Existence checks: `EXISTS(field_path)`, `NOT EXISTS(field_path)`
- Pattern matching: `LIKE` with `%` and `_`
- Regular expression matching: `REGEXP` with JavaScript-compatible regex pattern strings

Constraints:

- Predicate type semantics MUST follow `docs/specs/05_QueryEngineContract.md` section 7.
- `IS NULL` checks explicit `null` only (missing field is not `NULL`).
- Missing field checks MUST be expressed via `EXISTS(...)` / `NOT EXISTS(...)`.

### 2.2 Aggregation

- `COUNT(*)`, `COUNT(field)`
- `MIN(field)`, `MAX(field)`
- `SUM(field)`, `AVG(field)` for numeric fields
- `PERCENTILE_CONT(p) WITHIN GROUP (ORDER BY field)` for numeric fields
- `GROUP BY` on payload fields and timestamp

Constraints:

- `p` in `PERCENTILE_CONT(p)` MUST satisfy `0 <= p <= 1`.
- `PERCENTILE_CONT` is supported only as ordered-set aggregate syntax above.
- `PERCENTILE_CONT(...) OVER (...)` window syntax is not supported.

### 2.3 Output Control

- field projection (`SELECT a, b`)
- `AS` alias
- simple arithmetic expressions in `SELECT` list (`a + b`, `a - b`)
- `DISTINCT`
- `ORDER BY field [ASC|DESC]`
- `LIMIT n` (`n` positive integer)

## 3. Unsupported Features

- joins
- subqueries
- window functions
- CTE / recursive queries
- schema DDL / DML statements outside supported `SELECT`

## 4. Reserved Fields

- `_id`: internal record id
- `timestamp`: canonical epoch milliseconds
- top-level payload fields are addressed by key names
- nested payload fields are addressed with dot path notation (for example `user.profile.country`)
- dot characters within one key segment MUST be expressed as escaped dot in canonical field path (`\\.`)
- backslash in one key segment MUST be escaped as `\\\\` in canonical field path
- quoted identifiers MUST preserve literal segment content before canonical escaping
  (example: SQL field `\"service.name\"` maps to canonical `service\\.name`)

## 5. Error Mapping

- SQL syntax failure: `QueryParseError`
- supported syntax with unsupported feature: `UnsupportedQueryFeatureError`
- invalid type/field usage in subset rules: `QueryValidationError`

## 6. Query Option Interop

When SQL module receives `QueryExecutionOptions` in `toNativeQuery(queryText, options)`:

- if SQL text does not specify one control category, module MAY use `options` for that category
- if SQL text and `options` both specify the same control category with different values, module MUST fail with `QueryValidationError`
- resulting native request capability MUST remain parity-compatible with Lucene module
  (`docs/specs/05_QueryEngineContract.md`)
