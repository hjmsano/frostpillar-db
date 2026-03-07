# Spec: Query Engine Contract (v0.2 draft)

Status: Draft  
Version: 0.2  
Last Updated: 2026-03-07

This document defines the contract between Frostpillar core and optional query-engine modules.

## 1. Purpose

- Keep Frostpillar core TypeScript-native and lightweight.
- Support multiple query languages without adding language parsers into core.
- Standardize how SQL/Lucene subsets execute through one native query request.
- Keep SQL and Lucene subset capability coverage aligned for core operations.

## 2. Scope

In scope:

- external query-engine modules for SQL subset and Lucene subset
- translation from query text to native query request
- execution through `Datastore.queryNative(...)`
- datastore-integrated language query flow through `Datastore.query(...)`

Out of scope:

- full relational execution layers for complex enterprise analytics
- direct storage access from query-engine modules

## 3. Responsibility Split

Core (`src/core`, `src/queryEngine`):

- defines `NativeQueryRequest` and execution semantics
- validates request and returns typed errors
- executes against Frostpillar storage/index internals

Optional query-engine module:

- parses language text
- validates subset constraints
- translates parsed result to `NativeQueryRequest`
- delegates execution to core API

Parity rule:

- SQL subset and Lucene subset MUST support equivalent core operation categories:
  filtering, aggregation, grouping, sorting, distinct, and limit.
- Syntax differs by language, but translated `NativeQueryRequest` capabilities MUST be equivalent.

## 4. Contract Types (Normative)

```typescript
import type {
  Datastore,
  NativeAggregateExpression,
  NativeOrderBy,
  NativeQueryRequest,
  NativeQueryResultRow,
} from './04_DatastoreAPI';

export type QueryLanguage = 'sql' | 'lucene';

export type QueryExecutionOptions = {
  select?: string[];
  aggregates?: NativeAggregateExpression[];
  groupBy?: string[];
  orderBy?: NativeOrderBy[];
  limit?: number;
  distinct?: boolean;
};

export interface QueryEngineModule {
  readonly language: QueryLanguage;
  toNativeQuery(
    queryText: string,
    options?: QueryExecutionOptions,
  ): NativeQueryRequest;
}

export interface DatastoreQueryIntegration {
  registerQueryEngine(engine: QueryEngineModule): void;
  unregisterQueryEngine(language: QueryLanguage): void;
  query(
    language: QueryLanguage,
    queryText: string,
    options?: QueryExecutionOptions,
  ): Promise<NativeQueryResultRow[]>;
}

export async function runQueryWithEngine(
  db: Datastore,
  engine: QueryEngineModule,
  queryText: string,
  options?: QueryExecutionOptions,
): Promise<NativeQueryResultRow[]>;
```

Normative behavior:

- `toNativeQuery` MUST throw `QueryParseError` for syntax failures.
- `toNativeQuery` MUST throw `UnsupportedQueryFeatureError` when query uses language features outside supported subset.
- When `options` is provided, resulting `NativeQueryRequest` MUST include equivalent request fields.
- `options` precedence MUST be explicit:
  - SQL module: conflicting controls between SQL text and `options` MUST fail with `QueryValidationError`.
  - Lucene module: `options` is the normative source for aggregation/grouping/output controls.
- `runQueryWithEngine` MUST execute only through `db.queryNative(...)`.
- `runQueryWithEngine` MUST call `engine.toNativeQuery(queryText, options)` and pass the result to `db.queryNative(...)` without mutation.
- Datastore integrated query path MUST call `engine.toNativeQuery(queryText, options)` and execute via `db.queryNative(...)` only.
- `Datastore.query(...)` and `runQueryWithEngine(...)` MUST be behaviorally equivalent
  for the same `engine`, `queryText`, and `options`.
- `Datastore.query(...)` MUST resolve engine registry mapping once per invocation before translation.
- registry changes after resolution (`registerQueryEngine` / `unregisterQueryEngine`) MUST NOT
  change engine instance used by that in-flight `Datastore.query(...)` call.
- if no engine is registered at resolution time, `Datastore.query(...)` MUST fail with `QueryEngineNotRegisteredError`.
- after datastore close state, `Datastore.query(...)` MUST fail with `ClosedDatastoreError`.
- after datastore close state, `registerQueryEngine(...)` and `unregisterQueryEngine(...)`
  MUST fail with `ClosedDatastoreError`.
- query-engine modules MUST NOT mutate datastore state except via explicit mutation requests supported by native API.

## 5. Determinism Rules

- Equivalent query text forms that represent the same logical constraints SHOULD map to equivalent native query requests.
- Result ordering MUST be deterministic based on native query execution rules.

## 6. Payload Field Path Rule

- Query-engine modules MUST map nested payload field access to a canonical dot path string.
- Example canonical field: `user.profile.country`.
- SQL and Lucene modules MUST use the same canonical path to preserve parity.
- Canonical field path escaping rules:
  - `.` inside one key segment MUST be escaped as `\\.`.
  - `\\` inside one key segment MUST be escaped as `\\\\`.
  - Path split is performed on unescaped dots only.
- Example key conversions:
  - payload key `service.name` -> canonical segment `service\\.name`
  - payload path `meta -> region\\zone` -> canonical field `meta.region\\\\zone`

## 7. Predicate Type and Null/Missing Semantics (Normative)

- SQL and Lucene modules MUST preserve literal value types in translated `NativeQueryRequest`.
- For Lucene range bounds, modules MUST preserve literal typing at parse stage:
  - unquoted numeric literal -> `number`
  - quoted literal -> `string`
  - unquoted non-numeric literal -> `string`
- For reserved field `timestamp`, modules MUST normalize accepted timestamp-string range
  bounds to epoch-millisecond `number` values before execution/native comparison.
- Invalid timestamp-string bounds for `timestamp` range queries MUST raise `QueryValidationError`.
- Native execution MUST NOT apply implicit cross-type coercion
  (for example string `"10"` to number `10`).
- For operators other than `exists` / `not_exists`, missing field path evaluates `false`.
- `=` and `!=` compare with strict type semantics:
  - different primitive runtime types are not equal
  - `!=` is the logical negation of `=` only when field path exists
- Ordered comparisons (`>`, `>=`, `<`, `<=`) and `between` require comparable values:
  - comparable primitive types are `number` and `string`
  - when either side is non-comparable or type-incompatible, predicate evaluates `false`
- `like` and `regexp` are string predicates:
  - non-string field values evaluate `false`
  - `like` MUST use bounded wildcard matching semantics (`%` and `_`) without compiling
    user-provided pattern text into dynamic regular expressions
  - `like` pattern length MUST be bounded (max 256 UTF-16 code units)
  - `like` matching implementation MUST keep additional working memory proportional to
    pattern length (O(pattern length)); it MUST NOT allocate a full
    `(text length + 1) * (pattern length + 1)` table
  - `regexp` pattern syntax errors MUST raise `QueryValidationError`
  - `regexp` pattern length MUST be bounded (max 256 UTF-16 code units)
  - `regexp` patterns using backreferences, look-around assertions, or nested quantifier
    group forms (for example `(a+)+`) MUST be rejected with `QueryValidationError`
  - for one native query execution, each validated `regexp` predicate pattern MUST be
    compiled once and reused across candidate-record evaluation
- Native filter expression nesting depth (combined `and` / `or` / `not`) MUST be `<= 64`.
  - deeper expressions MUST fail with `QueryValidationError` before record scan.
- Native query execution MUST enforce row-budget guardrails:
  - max scanned candidate rows per query: `10000`
  - max output rows per query (after filter/order/select/distinct/limit): `5000`
  - exceeding either budget MUST fail with `QueryValidationError`
- Native query implementation SHOULD avoid duplicate full-size intermediate arrays and
  SHOULD stream row projection/distinct after sort where possible.
- Missing field vs explicit `null` are distinct states.
- `exists` is true iff field path exists (including explicit `null` value).
- `not_exists` is true iff field path does not exist.
- `is_null` is true iff field path exists and value is explicit `null`.
- `is_not_null` is true iff field path exists and value is not `null`.
- Lucene subset mapping MUST align with these operators:
  - `field:*` -> `exists`
  - `NOT field:*` -> `not_exists`
  - `field:null` -> `is_null` (unquoted keyword, case-insensitive)

## 8. Versioning and Compatibility

- Query-engine modules MUST declare supported Frostpillar API major version.
- Breaking changes to `NativeQueryRequest` require spec updates and ADR record.
