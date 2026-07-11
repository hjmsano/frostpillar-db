# Spec 03: Aggregation and ResultChain

- **Status:** Accepted
- **Date:** 2026-04-03

## Overview

This spec defines the `ResultChain` class (the fluent query builder returned by `collection.find()`) and the aggregation methods available on it.

## 1. ResultChain

`ResultChain` is a lazy query builder. It accumulates query parameters (filter, sort, skip, limit, projection) and executes the query only when a terminal method is called.

### 1.1 Construction

`ResultChain` is created by `Collection.find(filter?)`. It is not directly instantiated by users.

```ts
const chain = users.find({ age: { $gt: 25 } });
// No query executed yet
```

### 1.2 Chaining Methods

Each chaining method returns a new `ResultChain` (or the same instance — implementation detail), enabling fluent composition.

#### `.sort(spec: SortInput): ResultChain`

Defines the sort order. `spec` is either a `SortSpec` object or a `SortSpecEntries` array of `[field, direction]` tuples.

```ts
// Ascending by name
.sort({ name: 1 })

// Descending by age, then ascending by name
.sort({ age: -1, name: 1 })

// Array form — preserves exact precedence order
.sort([['age', -1], ['name', 1]])
```

`SortSpec` is an object where keys are field paths and values are `1` (ascending) or `-1` (descending). Field order in the object determines sort priority.

`SortSpecEntries` is an ordered array of `[field, direction]` tuples. Use this form when field names are non-negative integer strings (e.g. `'1'`, `'2'`). JavaScript reorders integer-like keys in object literals to ascending numeric order before any code runs, so `.sort({ '2': 1, '1': 1 })` arrives already reordered. The array form preserves the caller's intended order:

```ts
// Object form — JavaScript reorders integer-like keys: '1' becomes primary
.sort({ '2': 1, '1': 1 }) // actual order: '1' first, then '2'

// Array form — order is preserved: '2' is primary
.sort([['2', 1], ['1', 1]])
```

Dot notation is supported: `.sort({ 'address.city': 1 })` or `.sort([['address.city', 1]])`.

**Missing fields:** Documents where the sort field is absent are sorted **before** documents where the field exists in ascending order, and **after** in descending order. When both documents lack the field, their relative order is preserved.

**NaN values:** `NaN` is treated like a missing field for ordering purposes — it sorts **before** normal numbers in ascending order and **after** in descending order.

**String comparison:** Strings are compared by Unicode codepoint order (using `<` / `>` operators), not by locale-sensitive collation.

**Object/array values:** When two sort key values are both objects or arrays (same type rank), they are compared deterministically via `JSON.stringify`. This provides a stable but not semantically meaningful order. The JSON key for each value is computed once per value identity (memoized via a module-level `WeakMap`) so that repeated comparisons during sorting do not re-serialize the same object.

If `.sort()` is not called, documents are returned in storage order (by key ascending, then insertion order).

> **Sort stability:** When no `limit` is applied (or `limit` >= the matched set size), frostpillar-db uses `Array.prototype.sort()`, which is guaranteed stable in ECMAScript 2019+ (all supported runtimes). Documents with equal sort keys preserve their original storage order (by key ascending, then insertion order). This property is important for the `'allow'` duplicate key policy, where multiple documents may share the same `_id`.
>
> When `sort()` and `limit(n)` are combined and `n` is smaller than the matched set, an optimized heap-based selection (`topK`) is used instead. This path is also stable: it returns exactly the same first-n documents, in the same order, as calling `sort()` with no limit and then slicing to n. Equal-sort-key documents preserve their original storage order in both paths. This guarantee holds under the `'allow'` duplicate key policy, where multiple documents may share the same `_id`.

#### `.limit(n: number): ResultChain`

Limits the number of documents returned. `n` must be a positive integer.

```ts
.limit(10)
```

#### `.skip(n: number): ResultChain`

Skips the first `n` documents. `n` must be a non-negative integer.

```ts
.skip(20)
```

`.skip()` is applied **after** sorting and **before** `.limit()`.

#### `.project(spec: ProjectionSpec): ResultChain`

Selects which fields to include or exclude in the result.

```ts
// Include only name and age (plus _id)
.project({ name: 1, age: 1 })

// Exclude address
.project({ address: 0 })
```

**Rules:**

- `_id` is always included unless explicitly excluded: `.project({ _id: 0, name: 1 })`.
- Inclusion (`1`) and exclusion (`0`) cannot be mixed in the same projection (except `_id: 0`).
- Dot notation is supported: `.project({ 'address.city': 1 })`.
- Projection spec values must be `1` (include) or `0` (exclude).
- `.project({ _id: 1 })` is an inclusion projection. It returns only the `_id` field.

```ts
// Returns only _id
.project({ _id: 1 })
// Returns _id and name
.project({ _id: 1, name: 1 })
```

### 1.3 Terminal Methods

Terminal methods execute the query and return results. Most return a `Promise`; `.cursor()` returns an `AsyncIterable` synchronously.

#### `.toArray(): Promise<Document[]>`

Executes the query and returns all matching documents.

```ts
const docs = await users
  .find({ age: { $gt: 25 } })
  .sort({ name: 1 })
  .limit(10)
  .toArray();
```

#### `.cursor(): AsyncGenerator<Document>`

Returns an async generator that yields documents one at a time after applying the full pipeline (filter → sort → skip → limit → projection). Like `.toArray()`, this is a non-aggregation terminal — it applies sort, skip, limit, and projection.

Like `.toArray()`, `.cursor()` internally buffers the full filtered result set before yielding; it has the same memory profile and is subject to the same `maxMatchedDocuments` cap. The difference is the iteration interface: `.cursor()` yields documents one at a time via `for await...of`, while `.toArray()` returns all results in an array. To bound memory, use `.limit(n)` (and `.skip()` for paging).

**Behavior:**

- Applies the full pipeline: filter → sort → skip → limit → projection (same as `.toArray()`)
- Yields documents one at a time via `for await...of`
- Each yielded document is a defensive clone (same as `.toArray()`)
- Can be consumed only once (standard async generator behavior)
- Throws `ClosedDatabaseError` if database is closed when iteration starts
- Returns the `AsyncGenerator` synchronously (not wrapped in a `Promise`)

```ts
for await (const doc of users
  .find({ active: true })
  .sort({ name: 1 })
  .limit(100)
  .cursor()) {
  process(doc);
}
```

#### `.count(): Promise<number>`

Returns the count of documents that would be returned by `.toArray()`. If `skip` or `limit` are applied, they are reflected in the count. Sort and projection do not affect the count.

```ts
const total = await users.find({ status: 'active' }).count(); // all active users
const page = await users.find({ status: 'active' }).skip(10).limit(5).count(); // at most 5
```

#### `.sum(field: string): Promise<number>`

Returns the sum of the specified numeric field across all matching documents. Non-numeric values are skipped. Returns `0` if no matching documents or no numeric values.

```ts
const totalSalary = await users.find({ dept: 'eng' }).sum('salary');
```

#### `.avg(field: string): Promise<number | null>`

Returns the average of the specified numeric field. Non-numeric values are skipped. Returns `null` if no numeric values are found.

```ts
const avgAge = await users.find({ status: 'active' }).avg('age');
```

#### `.min(field: string): Promise<number | null>`

Returns the minimum numeric value for the field. Returns `null` if no numeric values.

```ts
const youngest = await users.find({}).min('age');
```

#### `.max(field: string): Promise<number | null>`

Returns the maximum numeric value for the field. Returns `null` if no numeric values.

```ts
const oldest = await users.find({}).max('age');
```

#### `.percentile(field: string, p: number): Promise<number | null>`

#### `.percentile(field: string, p: number[]): Promise<(number | null)[]>`

Returns the `p`-th percentile of the specified numeric field. `p` is a fraction in `[0, 1]` (`p = 0.95` means the 95th percentile) — not the 0–100 percent scale. Like the other numeric terminals, operates on the **filtered** set (sort/skip/limit/projection not applied, §1.4), skips non-numeric and non-finite values via `extractNumericValues`, and returns `null` when no numeric values exist.

`p` must be a finite number with `0 <= p <= 1`; otherwise `ValidationError` is thrown **eagerly, before any document is fetched**.

**Computation — linear interpolation (`PERCENTILE_CONT`):** sort a copy of the extracted numeric values `v[0..n-1]` ascending, then:

```
rank = p * (n - 1)
lo = floor(rank), frac = rank - lo
result = v[lo] + frac * (v[lo + 1] - v[lo])   // v[lo] when frac == 0
```

Properties: `percentile(f, 0) === min(f)`; `percentile(f, 1) === max(f)`; a single value is returned unchanged for every `p`; the median of an even-count set is the average of the two middle values.

```ts
const p95 = await requests.find({ route: '/api' }).percentile('latencyMs', 0.95);
```

**Array form (`p: number[]`):** fetches and sorts the filtered set **once**, then computes each requested percentile positionally against that shared sorted set. The array must be non-empty; every element is validated by the same `[0, 1]` rule as the scalar form. Duplicates are allowed. The array is defensively copied synchronously before the fetch `await` (the same pattern used by `validateGroupByField`), so caller mutation during the await cannot change the computed set. When no numeric values exist, every position is `null`.

```ts
const [p50, p95, p99] = await requests
  .find({ route: '/api' })
  .percentile('latencyMs', [0.5, 0.95, 0.99]);
```

#### `.median(field: string): Promise<number | null>`

Returns the median of the specified numeric field. Defined as exactly `percentile(field, 0.5)` — same value selection, same interpolation, same `null`-on-empty behavior.

```ts
const medianAge = await users.find({ status: 'active' }).median('age');
```

#### `.distinct(field: string): Promise<unknown[]>`

Returns an array of unique values for the specified field across all matching documents. Supports dot notation for nested fields. Documents where the field is missing or `undefined` are skipped; `null` is a valid distinct value. Values are returned in order of first occurrence. Deep equality is used for objects/arrays; strict equality for primitives.

**Limit:** The result set is capped at `MAX_DISTINCT_COUNT` (100,000) unique values. Exceeding the cap throws `ValidationError`.

```ts
const cities = await users.find({ status: 'active' }).distinct('address.city');
// e.g. ['Tokyo', 'Osaka']
```

#### `.groupBy(field: string | string[], accumulators: GroupAccumulators): Promise<GroupResultEntry[]>`

Groups documents by the value of `field`, then applies accumulators to each group. `field` is either a single field path (string form) or an array of field paths (multi-dimension form) for grouping by a composite key.

**Types:**

```ts
interface GroupAccumulator {
  $count?: true;
  $sum?: string; // field path
  $avg?: string; // field path
  $min?: string; // field path
  $max?: string; // field path
  $median?: string; // field path
  $percentile?: { field: string; p: number }; // field path + fraction in [0, 1]
}

type GroupAccumulators = Record<string, GroupAccumulator>;

interface GroupResultEntry {
  _key: unknown; // the group key value (string form) or composite key object (array form)
  [outputField: string]: unknown; // accumulator results
}
```

Each `GroupAccumulator` entry must contain exactly one accumulator key.

**Behavior:**

- **String form (single field):** Groups by field value (supports dot notation via `getValueByPath`). `_key` is the raw group value. This form is unchanged from prior versions.
- **Array form (multi-dimension grouping):** Groups by the combination of all field values in `field`.
  - Each element of `field` must be a non-empty string and a valid field path — the same eager validation as the string form (reserved segments `__proto__`/`constructor`/`prototype` rejected, max depth, max length). Dot notation is supported per element.
  - `field` must be a non-empty array. Duplicate field paths within the array are rejected.
  - `_key` is an object with one property per requested field path: `{ [fieldPath]: value, ... }`. The property key is the literal path string (e.g. `'address.city'` is a single literal key, not nested under `address`). Property order follows the order of `field`, **except** that JavaScript enumerates integer-like path keys (e.g. `'0'`, `'2024'`) ahead of other keys regardless of insertion order — the same object-key reordering documented for `.sort()` in §1.2. Callers should access `_key` properties by name (e.g. `result._key['2024']`) rather than relying on `Object.keys(_key)` order.
  - A single-element array (e.g. `['dept']`) still produces an object `_key` (e.g. `{ dept: ... }`) — it is **not** collapsed to the scalar form used by the string form.
  - A document missing one of the requested fields contributes `null` for that dimension, consistent with the string form's "missing field → `_key: null`" rule.
- Documents where the group field is missing are grouped under `_key: null` (string form) or `null` for that dimension (array form).
- Group key serialization is type-aware, per dimension: values of different types (e.g., the string `"123"` and the number `123`, or the string `"null"` and `null`) are always treated as distinct groups, and this holds independently for each field in the array form — there is no cross-dimension collision between, say, the first field's `"123"` and the second field's `123`.
- **Object/array key ordering:** When a group key value (or a dimension's value, in the array form) is an object or array, it is serialized via `JSON.stringify`. This means objects with the same properties in different insertion order (e.g. `{a:1, b:2}` vs `{b:2, a:1}`) are treated as **different** group keys. To ensure consistent grouping, callers should normalize key property order before insertion.
- Each accumulator operates on the group's documents (unchanged for both forms):
  - `$count: true` — count of documents in the group.
  - `$sum: 'fieldPath'` — sum of numeric values (skip non-numeric, `0` if none).
  - `$avg: 'fieldPath'` — average of numeric values (`null` if none).
  - `$min: 'fieldPath'` — minimum numeric value (`null` if none).
  - `$max: 'fieldPath'` — maximum numeric value (`null` if none).
  - `$median: 'fieldPath'` — median of numeric values, i.e. the 50th percentile (`null` if none).
  - `$percentile: { field: 'fieldPath', p: 0.95 }` — the `p`-th percentile of numeric values, same interpolation as `.percentile()` (`null` if none). `p` is **scalar-only** inside `groupBy`; multiple percentiles of the same group are expressed as multiple output fields (see example below).
- **`$percentile` operand validation:** the operand must be a plain object with **exactly** the keys `field` (a valid field path, same eager validation as the other accumulators' field-path operands) and `p` (the same `[0, 1]` finite-number rule as the `.percentile()` terminal). Extra or missing keys throw `ValidationError`. The existing "exactly one accumulator key per entry" rule is unchanged — `$percentile` still occupies exactly one key of its `GroupAccumulator` entry.
- Groups are returned in order of first occurrence of each key value (unchanged for both forms).
- Like other aggregation terminals, operates on filtered set (sort/skip/limit not applied).
- Throws `ValidationError` if `field` is an empty string (string form), `accumulators` is empty object, or any accumulator entry does not contain exactly one key.
- Throws `ValidationError` if `field` is an empty array, an array element is not a non-empty string or fails field-path validation, or the array contains duplicate field paths.
- Throws `ValidationError` if the number of distinct groups would exceed `MAX_GROUP_COUNT` (100,000).
- Throws `ValidationError` if any single group would exceed `MAX_GROUP_DOCUMENTS` (100,000) documents. (Reachable only when `maxMatchedDocuments` is configured above 100,000, since the scan cap would otherwise be hit first.)
- Returns `[]` if no matching documents.

**Example (single field):**

```ts
const result = await users.find({}).groupBy('department', {
  count: { $count: true },
  avgSalary: { $avg: 'salary' },
  maxAge: { $max: 'age' },
});
// → [
//   { _key: 'eng', count: 12, avgSalary: 85000, maxAge: 45 },
//   { _key: 'sales', count: 8, avgSalary: 72000, maxAge: 52 },
// ]
```

**Example (`$median` / `$percentile`, multiple output fields):**

```ts
const result = await requests.find({}).groupBy('route', {
  p50: { $percentile: { field: 'latencyMs', p: 0.5 } },
  p95: { $percentile: { field: 'latencyMs', p: 0.95 } },
  p99: { $percentile: { field: 'latencyMs', p: 0.99 } },
  medianLatency: { $median: 'latencyMs' },
});
// → [
//   { _key: '/api', p50: 12, p95: 48, p99: 90, medianLatency: 12 },
// ]
```

**Example (multi-dimension):**

```ts
const result = await users.find({}).groupBy(['department', 'address.city'], {
  count: { $count: true },
  avgSalary: { $avg: 'salary' },
});
// → [
//   { _key: { department: 'eng', 'address.city': 'Tokyo' }, count: 7, avgSalary: 88000 },
//   { _key: { department: 'eng', 'address.city': 'Osaka' }, count: 5, avgSalary: 81000 },
//   { _key: { department: 'sales', 'address.city': 'Tokyo' }, count: 8, avgSalary: 72000 },
// ]
```

### 1.4 Aggregation Terminal Methods — Scope

Aggregation methods (`sum`, `avg`, `min`, `max`, `percentile`, `median`, `distinct`, `groupBy`) operate on the **filtered** result set (after applying the filter from `find()`). Sort, skip, limit, and projection are **not applied** to the dataset before aggregation — they only affect `.toArray()`, `.cursor()`, and `.count()`.

`.count()` is an exception among terminal methods: it applies `skip` and `limit` so that it returns the same number of documents that `.toArray()` would return. This makes `.count()` useful for pagination scenarios. Sort and projection do not affect `.count()`.

This design ensures numeric aggregation reflects the full matching set while `.count()` stays consistent with the result set the user would actually receive.

## 2. Execution Pipeline

When a terminal method is called, the `ResultChain` executes the following pipeline:

```
1. Fetch: getRecordsByFilter — selects the narrowest datastore call based on
   filter shape. For `_id` equality uses Datastore.getFirst / Datastore.get,
   for `_id` $in uses Datastore.getMany, for `_id` range (both bounds same
   type) uses Datastore.getRange, otherwise falls back to Datastore.getAll().
   See Spec 02 §2 (Find) for the full fast-path rules including
   Range Query Optimization.
2. Filter: Apply filter predicates (Spec 02 §8)
3. Aggregate: If terminal is sum/avg/min/max/percentile/median/distinct/groupBy → compute and return
4. Count: If terminal is count → apply skip/limit to filtered count and return
5. Sort: Apply sort specification
6. Skip: Discard first N documents
7. Limit: Take first N documents
8. Project: Select/exclude fields
9. Return: Resolve the Promise with results
```

Steps 5-8 are executed for `.toArray()` and `.cursor()`. The difference is that `.toArray()` collects all results into an array, while `.cursor()` yields them one at a time via an async generator.

## 3. ResultChain Reuse

A `ResultChain` instance can be reused. Calling a terminal method does not mutate or invalidate the chain:

```ts
const activeUsers = users.find({ status: 'active' }).sort({ name: 1 });

const page1 = await activeUsers.skip(0).limit(10).toArray();
const page2 = await activeUsers.skip(10).limit(10).toArray();
const total = await activeUsers.count();

// cursor also works with the same chain
for await (const doc of activeUsers.limit(5).cursor()) {
  console.log(doc.name);
}
```

Each terminal call triggers a fresh execution of the pipeline.

## 4. Empty Results

| Scenario                  | `.toArray()` | `.cursor()` | `.count()` | `.sum(f)` | `.avg(f)` | `.min(f)` | `.max(f)` | `.percentile(f,p)` | `.percentile(f,p[])` | `.median(f)` | `.distinct(f)` | `.groupBy(f, acc)` |
| ------------------------- | ------------ | ----------- | ---------- | --------- | --------- | --------- | --------- | ------------------- | --------------------- | ------------ | -------------- | ------------------ |
| No matching documents     | `[]`         | (no yields) | `0`        | `0`       | `null`    | `null`    | `null`    | `null`               | all-`null` array       | `null`       | `[]`           | `[]`               |
| Matches but field missing | `[...]`      | (yields)    | count      | `0`       | `null`    | `null`    | `null`    | `null`               | all-`null` array       | `null`       | `[]`           | (grouped)          |
| Matches with non-numeric  | `[...]`      | (yields)    | count      | `0`       | `null`    | `null`    | `null`    | `null`               | all-`null` array       | `null`       | (values)       | (grouped)          |

## 5. Error Handling

| Error                 | Condition                                                                                                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ValidationError`     | Invalid sort spec: value not `1` or `-1`, array entry not a 2-element tuple, duplicate field name, or spec is not an object or array                                                                               |
| `ValidationError`     | Invalid limit (not a positive integer)                                                                                                                                                                             |
| `ValidationError`     | Invalid skip (not a non-negative integer)                                                                                                                                                                          |
| `ValidationError`     | Invalid projection spec value (not `0` or `1`)                                                                                                                                                                     |
| `ValidationError`     | Mixed inclusion/exclusion in projection                                                                                                                                                                            |
| `ValidationError`     | Aggregation field path is not a non-empty string, contains reserved segments (`__proto__`, `constructor`, `prototype`), exceeds max depth, or exceeds max length — validated eagerly regardless of result set size |
| `ValidationError`     | `distinct` field path fails the same eager validation as above                                                                                                                                                     |
| `ValidationError`     | `groupBy` field fails the same eager validation as above (string form), or, for the array form, `field` is an empty array, an array element is not a non-empty string or fails the same eager field-path validation, or the array contains duplicate field paths                                                                          |
| `ValidationError`     | `groupBy` accumulator field paths (`$sum`, `$avg`, `$min`, `$max` operands) fail the same eager validation                                                                                                         |
| `ValidationError`     | `groupBy` accumulators is empty object                                                                                                                                                                             |
| `ValidationError`     | `groupBy` accumulator entry does not contain exactly one key                                                                                                                                                       |
| `ValidationError`     | `percentile` / `$percentile` `p` is not a finite number, or is outside `[0, 1]` — validated eagerly, before any document is fetched                                                                               |
| `ValidationError`     | `percentile` array-form `p` is an empty array                                                                                                                                                                      |
| `ValidationError`     | `groupBy` `$percentile` operand is not a plain object, or does not contain exactly the keys `field` and `p`                                                                                                       |
| `ClosedDatabaseError` | Terminal method called on a closed database (for `.cursor()`, thrown when iteration starts)                                                                                                                        |
