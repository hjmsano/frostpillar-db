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

Returns the `p`-th percentile of the specified numeric field. `p` is a fraction in `[0, 1]` (`p = 0.95` means the 95th percentile) — not the 0–100 percent scale. Like the other numeric terminals, operates on the **filtered** set and is order-independent (skip/limit/projection not applied, §1.4), skips non-numeric and non-finite values via `extractNumericValues`, and returns `null` when no numeric values exist.

`p` must be a finite scalar number with `0 <= p <= 1`; arrays and all other values throw `ValidationError` **eagerly, before any document is fetched**. Multiple percentiles require separate terminal calls; like every terminal invocation, each call performs a fresh filtered-set execution.

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

#### `.median(field: string): Promise<number | null>`

Returns the median of the specified numeric field. Defined as exactly `percentile(field, 0.5)` — same value selection, same interpolation, same `null`-on-empty behavior.

```ts
const medianAge = await users.find({ status: 'active' }).median('age');
```

#### `.stdDevPop(field: string): Promise<number | null>` / `.stdDevSamp(field: string): Promise<number | null>` / `.variancePop(field: string): Promise<number | null>` / `.varianceSamp(field: string): Promise<number | null>`

Return the population/sample standard deviation and variance of the specified numeric field. Like the other numeric terminals, operate on the **filtered** set and are order-independent (skip/limit/projection not applied, §1.4), skip non-numeric and non-finite values via `extractNumericValues`.

- **Population** (`stdDevPop`, `variancePop`) divides the sum of squared deviations from the mean by `n`. Use when the matched set *is* the whole population.
- **Sample** (`stdDevSamp`, `varianceSamp`) divides by `n - 1` (Bessel's correction), the unbiased estimator of a larger population's variance from a sample.

**Computation — Welford's single-pass algorithm:** rather than the naive `Σx² - (Σx)²/n` formula (numerically unstable for large-magnitude, low-variance data), variance is computed with Welford's online recurrence, which accumulates `count`, running `mean`, and `m2` (sum of squared deviations from the running mean) in one pass:

```
for each value x:
  count += 1
  delta = x - mean
  mean += delta / count
  m2 += delta * (x - mean)

variancePop  = m2 / count        // n
varianceSamp = m2 / (count - 1)  // n - 1
stdDevPop    = sqrt(variancePop)
stdDevSamp   = sqrt(varianceSamp)
```

After division, clamp a negative computed variance to `0`. This defensive
normalization prevents floating-point roundoff in the accumulated `m2` from
causing `sqrt(variance)` to return `NaN`; positive variances are unchanged.

**Edge semantics (MongoDB-aligned):**

| `n` (numeric values) | `variancePop` / `stdDevPop` | `varianceSamp` / `stdDevSamp` |
| --------------------- | ---------------------------- | ------------------------------ |
| `0`                    | `null`                        | `null`                          |
| `1`                    | `0`                           | `null`                          |
| `>= 2`                 | computed                      | computed                        |

`n = 0` → `null` for all four, consistent with `avg`/`min`/`max`/`median`. `n = 1` → population variance/stddev is `0` (a single point has zero dispersion from itself); sample variance/stddev is `null` because `n - 1 = 0` makes the sample estimator undefined.

```ts
const jitterPop = await requests.find({ route: '/api' }).stdDevPop('latencyMs');
const jitterSamp = await requests.find({ route: '/api' }).stdDevSamp('latencyMs');
const varPop = await requests.find({ route: '/api' }).variancePop('latencyMs');
const varSamp = await requests.find({ route: '/api' }).varianceSamp('latencyMs');
```

#### `.distinct(field: string): Promise<unknown[]>`

Returns an array of unique values for the specified field across all matching documents. Supports dot notation for nested fields. Documents where the field is missing or `undefined` are skipped; `null` is a valid distinct value. Values are returned in order of first occurrence **within the aggregation input order** (§1.4): storage order, or `.sort()` order if a sort is specified on the chain. Deep equality is used for objects/arrays; strict equality for primitives.

**Isolation ([ADR-026](../adr/026-aggregation-result-isolation.md)):** object/array values are defensively cloned via `cloneAccumulatorValue` before entering the result array, since the scanned documents are references to stored documents; primitives and `null` pass through unchanged. Mutating a returned value never touches stored data. Dedup still compares the *original* values, so equality semantics are unaffected.

**Limit:** The result set is capped at `MAX_DISTINCT_COUNT` (100,000) unique values. Exceeding the cap throws `ValidationError`.

```ts
const cities = await users.find({ status: 'active' }).distinct('address.city');
// e.g. ['Tokyo', 'Osaka']
```

#### `.countDistinct(field: string): Promise<number>`

Returns the count of unique values for the specified field across all matching documents — exactly the cardinality of the array `.distinct(field)` would return, without materializing that array. The equivalence holds for any field on any filtered set:

```
countDistinct(f) === (await distinct(f)).length
```

Semantics are identical to `.distinct()`: missing/`undefined` values are skipped; `null` counts as one distinct value; objects/arrays are deduped by deep equality; primitives by strict equality. Unlike `.distinct()`, `.countDistinct()` returns **`0`** (not `[]`/`null`) when there are no matching documents or no present values — it is a *count*, following `.count()`/`.sum()`'s "`0` on empty" convention rather than `.avg()`/`.min()`/`.max()`/`.median()`'s `null`-on-empty convention, because a cardinality of zero is a well-defined count.

`.countDistinct()` is **order-insensitive**: a cardinality does not depend on input order, so it is unaffected by the ADR-020 chain-sort rule for aggregation input. It is defined *as if* computed over the aggregation input order (§1.4), but the implementation skips the sort as a pure optimization — results are byte-identical whether or not a `.sort()` precedes it on the chain.

**Limit:** The same `MAX_DISTINCT_COUNT` (100,000) cap as `.distinct()` applies, since the implementation must remember every distinct value seen (even though it discards the values themselves) to detect duplicates. Exceeding the cap throws `ValidationError` at the identical boundary as `.distinct()` and identifies the failing operation as the `countDistinct()` result.

```ts
const uniqueCities = await users.find({ status: 'active' }).countDistinct('address.city');
// e.g. 2
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
  $stdDevPop?: string; // field path
  $stdDevSamp?: string; // field path
  $variancePop?: string; // field path
  $varianceSamp?: string; // field path
  $first?: string; // field path
  $last?: string; // field path
  $countDistinct?: string; // field path
  $push?: string; // field path
  $addToSet?: string; // field path
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
- **Key isolation ([ADR-026](../adr/026-aggregation-result-isolation.md)):** an object/array group key value is defensively cloned via `cloneAccumulatorValue` before it is placed in `_key` — in the string form, and per dimension in the composite `_key` object of the array form. Group key values are resolved from stored documents, so without the clone a caller could mutate stored data through `_key`. Primitives and `null` pass through unchanged. The clone is taken once per group (on first occurrence), never per document, and *after* the key is serialized, so grouping semantics are unaffected.
- Each accumulator operates on the group's documents (unchanged for both forms):
  - `$count: true` — count of documents in the group. The operand must be exactly the boolean `true`; every other operand (`false`, `0`, `1`, `'true'`, `null`, an object, …) throws `ValidationError`. The `GroupAccumulator` type already narrows `$count` to `true`, so this only affects accumulators built at runtime (e.g. parsed from JSON), where `{ $count: false }` would otherwise have been silently treated as `{ $count: true }`.
  - `$sum: 'fieldPath'` — sum of numeric values (skip non-numeric, `0` if none).
  - `$avg: 'fieldPath'` — average of numeric values (`null` if none).
  - `$min: 'fieldPath'` — minimum numeric value (`null` if none).
  - `$max: 'fieldPath'` — maximum numeric value (`null` if none).
  - `$median: 'fieldPath'` — median of numeric values, i.e. the 50th percentile (`null` if none).
  - `$percentile: { field: 'fieldPath', p: 0.95 }` — the `p`-th percentile of numeric values, same interpolation as `.percentile()` (`null` if none). `p` is **scalar-only** inside `groupBy`; multiple percentiles of the same group are expressed as multiple output fields (see example below).
  - `$stdDevPop: 'fieldPath'` / `$stdDevSamp: 'fieldPath'` / `$variancePop: 'fieldPath'` / `$varianceSamp: 'fieldPath'` — population/sample standard deviation and variance of numeric values, computed via `computeWelford`, same `n = 0` → `null` / `n = 1` → pop `0`, samp `null` edge rules as the terminals (§1.3 above).
  - `$first: 'fieldPath'` / `$last: 'fieldPath'` ([ADR-021](../adr/021-first-last-accumulators.md)) — the value of `fieldPath` on the first (resp. last) document of the group, in **aggregation input order** (§1.4): the chain's `.sort()` order when present, otherwise storage order. This is **positional-then-read**: the first/last document of the group is selected first, and only then is `fieldPath` read from it — it is not "the first/last document that has the field". If the selected document does not have `fieldPath`, the result is `null`. Unlike every other accumulator, `$first`/`$last` return the value **of any type** (string, number, boolean, `null`, object, or array) — the first non-numeric accumulators; they do not use `extractNumericValues`. Object/array values are defensively cloned via `cloneAccumulatorValue` (an exported alias of `cloneDocument`, `src/internal/objectUtils.ts`) before being placed in the result, since group documents are references to stored documents; primitives and `null` pass through unchanged. A group always has at least one document, so a selected document always exists.
  - `$countDistinct: 'fieldPath'` ([ADR-022](../adr/022-count-distinct.md)) — the count of unique values of `fieldPath` within the group, per the exact `.countDistinct()` semantics above (`=== distinct(fieldPath).length`, evaluated within the group): missing/`undefined` skipped, `null` counted, deep equality for objects/arrays, strict equality for primitives. Returns `0` for a group with no present values (never `null`) — consistent with `$count`/`$sum`. The `MAX_DISTINCT_COUNT` cap applies **per group**: if a single group's unique-value count would exceed the cap, the resulting `ValidationError` identifies the failing operation as the `$countDistinct` accumulator rather than the `countDistinct()` terminal. With the current equal 100,000 limits, however, each document contributes at most one distinct field value, so `MAX_GROUP_DOCUMENTS` is reached before `$countDistinct` can exceed `MAX_DISTINCT_COUNT`; the group document-cap error therefore takes precedence.
  - `$push: 'fieldPath'` / `$addToSet: 'fieldPath'` ([ADR-023](../adr/023-push-addtoset-accumulators.md)) — the array-valued **collector** accumulators, the final pair in the aggregation suite. Both consume the group's documents in **aggregation input order** (§1.4: the chain's `.sort()` order when present, otherwise storage order) — no re-sorting happens inside the accumulator, since ADR-020 already establishes that order before `groupBy` runs.
    - `$push: 'fieldPath'` — an array of the resolved value of `fieldPath` for **every document in the group**, in aggregation input order. Missing/`undefined` values are **skipped**; `null` is **included**; duplicates are **preserved**. An empty group field set (no present values) yields `[]`.
    - `$addToSet: 'fieldPath'` — an array of the **distinct** resolved values of `fieldPath`, in first-occurrence order within the aggregation input order, using **exactly `.distinct()`'s equality semantics** (missing/`undefined` skipped, `null` a valid member, deep equality for objects/arrays, strict equality for primitives). An empty group field set yields `[]`.
    - Like `$first`/`$last`, `$push`/`$addToSet` return values of **any type**; object/array values are defensively cloned via `cloneAccumulatorValue` before entering the result array, since group documents are references to stored documents — primitives and `null` pass through unchanged. This applies to every element `$push` collects and every distinct value `$addToSet` collects, not just a single positional value.
    - **Limits:** `$push` needs no dedicated limit — a group holds at most `MAX_GROUP_DOCUMENTS` (100,000) documents and `$push` emits at most one value per document, so its output is already bounded. `$addToSet` reuses the **same per-group `MAX_DISTINCT_COUNT` (100,000) cap** as `$countDistinct` (built on the identical shared distinct-value scan core): if a single group's unique-value count would exceed the cap, `ValidationError` is thrown, identifying the failing operation as the `$addToSet` accumulator. As with `$countDistinct`, the equal 100,000 limits mean `MAX_GROUP_DOCUMENTS` is reached before `$addToSet` can exceed `MAX_DISTINCT_COUNT` in practice, so the group document-cap error takes precedence.
    - **Name reuse note:** `$push`/`$addToSet` are also `UpdateOperations` operator names (the update DSL). The two contexts are structurally distinct — an update spec's `$push`/`$addToSet` operand is an update instruction (`Record<string, unknown>`), while a `groupBy` accumulator's operand is a field-path string — and never coexist on the same interface, so there is no ambiguity in practice (ADR-023 §3).
- **`$percentile` operand validation:** the operand must be a plain object with **exactly** the keys `field` (a valid field path, same eager validation as the other accumulators' field-path operands) and `p` (the same `[0, 1]` finite-number rule as the `.percentile()` terminal). Extra or missing keys throw `ValidationError`. The existing "exactly one accumulator key per entry" rule is unchanged — `$percentile` still occupies exactly one key of its `GroupAccumulator` entry.
- Groups are returned in order of first occurrence of each key value, evaluated over the **aggregation input order** (§1.4): storage order, or `.sort()` order when a sort is specified on the chain (unchanged behavior when no sort is specified; unchanged for both single-field and multi-dimension forms).
- Each group's internal document order (as consumed by order-sensitive accumulators) likewise follows the aggregation input order.
- Like other aggregation terminals, operates on the filtered set; `skip`/`limit`/`projection` are not applied (§1.4).
- Throws `ValidationError` if `field` is an empty string (string form), `accumulators` is empty object, or any accumulator entry does not contain exactly one key.
- Throws `ValidationError` if `field` is an empty array, an array element is not a non-empty string or fails field-path validation, or the array contains duplicate field paths.
- Throws `ValidationError` if the number of distinct groups would exceed `MAX_GROUP_COUNT` (100,000).
- Throws `ValidationError` if any single group would exceed `MAX_GROUP_DOCUMENTS` (100,000) documents. (Reachable only when `maxMatchedDocuments` is configured above 100,000, since the scan cap would otherwise be hit first.)
- Throws `ValidationError` if a `$countDistinct` accumulator's unique-value count within any single group would exceed `MAX_DISTINCT_COUNT` (100,000). At the current equal limits, `MAX_GROUP_DOCUMENTS` is reached first and its error takes precedence.
- Throws `ValidationError` if an `$addToSet` accumulator's unique-value count within any single group would exceed `MAX_DISTINCT_COUNT` (100,000), identically to `$countDistinct` above (and subject to the same `MAX_GROUP_DOCUMENTS`-reached-first precedence at the current equal limits).
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

**Example (`$first` / `$last`, latest status per user):**

```ts
const result = await events.find({}).sort({ updatedAt: -1 }).groupBy('userId', {
  latestStatus: { $first: 'status' },
});
// → [
//   { _key: 'u1', latestStatus: 'shipped' },
// ]
```

**Example (`$push` / `$addToSet`, all tags and the set of cities per author):**

```ts
const result = await posts.find({}).groupBy('author', {
  allTags: { $push: 'tag' },
  cities: { $addToSet: 'city' },
});
// → [
//   { _key: 'alice', allTags: ['ts', 'db', 'ts'], cities: ['Tokyo', 'Osaka'] },
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

### 1.4 Aggregation Terminal Methods — Scope and Input Ordering

Aggregation methods (`sum`, `avg`, `min`, `max`, `percentile`, `median`, `stdDevPop`, `stdDevSamp`, `variancePop`, `varianceSamp`, `distinct`, `countDistinct`, `groupBy`) operate on the **filtered** result set (after applying the filter from `find()`). `skip`, `limit`, and `projection` are **not applied** to aggregation input — they only affect `.toArray()`, `.cursor()`, and `.count()`.

**Aggregation input order:** storage order, or `.sort()` order if a sort is specified on the chain. This composes with aggregation the way MongoDB's `$sort → $group` pipeline does — a `.sort()` preceding an aggregation terminal is honored by that terminal (see ADR-020).

- **Order-sensitive terminals** — `distinct` and `groupBy` — are observably affected: `distinct`'s first-occurrence order, `groupBy`'s group order (first occurrence of each key), and each group's internal document order all follow the aggregation input order above. Sort semantics (missing-field placement, `NaN` handling, type ranks, string comparison, stability) are exactly §1.2.
- **Order-insensitive terminals** — `sum`, `avg`, `min`, `max`, `count`, `percentile`, `median`, `stdDevPop`, `stdDevSamp`, `variancePop`, `varianceSamp`, `countDistinct` — are mathematically order-independent. Their results are defined *as if* computed over the aggregation input order above, but the implementation **skips the sort** for these terminals as a pure optimization: results are byte-identical whether or not a `.sort()` precedes them. `countDistinct` is a count of a set, and a set's cardinality does not depend on the order in which its members were observed ([ADR-022](../adr/022-count-distinct.md) §4).

`.count()` is an exception among terminal methods: it applies `skip` and `limit` so that it returns the same number of documents that `.toArray()` would return. This makes `.count()` useful for pagination scenarios. Sort and projection do not affect `.count()`.

This design ensures numeric aggregation reflects the full matching set (regardless of sort), `distinct`/`groupBy` honor a preceding `.sort()` when the caller wants ordered results, and `.count()` stays consistent with the result set the user would actually receive.

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
3. Aggregate: If terminal is sum/avg/min/max/percentile/median/stdDevPop/stdDevSamp/variancePop/varianceSamp/distinct/countDistinct/groupBy → compute and return. For `distinct`/`groupBy`, sort logically precedes this step: when `state.sort` is defined, the filtered set is first ordered via the same stable sort as step 5 (§1.4) before `distinct`/`groupBy` computes its result. The order-insensitive terminals (`sum`/`avg`/`min`/`max`/`percentile`/`median`/`stdDevPop`/`stdDevSamp`/`variancePop`/`varianceSamp`/`countDistinct`) skip this ordering step as an optimization — their result is unaffected by input order.
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

| Scenario                  | `.toArray()` | `.cursor()` | `.count()` | `.sum(f)` | `.avg(f)` | `.min(f)` | `.max(f)` | `.percentile(f,p)` | `.median(f)` | `.stdDevPop(f)` / `.variancePop(f)` | `.stdDevSamp(f)` / `.varianceSamp(f)` | `.distinct(f)` | `.countDistinct(f)` | `.groupBy(f, acc)` |
| ------------------------- | ------------ | ----------- | ---------- | --------- | --------- | --------- | --------- | ------------------- | ------------ | ------------------------------------- | ---------------------------------------- | -------------- | -------------------- | ------------------ |
| No matching documents     | `[]`         | (no yields) | `0`        | `0`       | `null`    | `null`    | `null`    | `null`              | `null`       | `null`                                 | `null`                                    | `[]`           | `0`                  | `[]`               |
| Matches but field missing | `[...]`      | (yields)    | count      | `0`       | `null`    | `null`    | `null`    | `null`              | `null`       | `null`                                 | `null`                                    | `[]`           | `0`                  | (grouped)          |
| Matches with non-numeric  | `[...]`      | (yields)    | count      | `0`       | `null`    | `null`    | `null`    | `null`              | `null`       | `null`                                 | `null`                                    | (values)       | (count)              | (grouped)          |

**`countDistinct` contrast with `distinct`:** `.countDistinct(f)` returns `0` for every empty-result scenario above, never `[]` or `null` — it is a count, like `.count()`/`.sum()`, not a value collection like `.distinct()` (which returns `[]`) or a value like `.avg()`/`.min()`/`.max()`/`.median()` (which return `null`). See §1.3.

**`n = 1` numeric value nuance:** when the numeric set has exactly one value (`n = 1`), `stdDevPop`/`variancePop` return `0` (a single point has zero dispersion from itself), while `stdDevSamp`/`varianceSamp` return `null` (the `n - 1 = 0` divisor makes the sample estimator undefined). This differs from the `n = 0` row above, where all four return `null`. See §1.3 for the full `n` → result table.

**`$first` / `$last` nuance:** these accumulators are not numeric, so they are not represented as a column above. A group always has at least one document (there is no "no matching documents" case for an individual group — the row above already covers `groupBy` returning `[]` when nothing matches at all). Within a non-empty group, `$first`/`$last` return `null` only when the selected (first or last) document lacks the requested field path — not when the group as a whole lacks numeric values. See §1.3.

**`$push` / `$addToSet` nuance:** also not numeric, not represented as a column above. Within a non-empty group, both return **`[]`** (not `null`) when the group has no present values for the field — a collector's empty result is an empty array, consistent with `.distinct()`'s `[]`-on-empty (not `.avg()`/`.min()`/`.max()`/`.median()`'s `null`-on-empty). See §1.3.

## 5. Error Handling

| Error                 | Condition                                                                                                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ValidationError`     | Invalid sort spec: value not `1` or `-1`, array entry not a 2-element tuple, duplicate field name, or spec is not an object or array                                                                               |
| `ValidationError`     | Invalid limit (not a positive integer)                                                                                                                                                                             |
| `ValidationError`     | Invalid skip (not a non-negative integer)                                                                                                                                                                          |
| `ValidationError`     | Invalid projection spec value (not `0` or `1`)                                                                                                                                                                     |
| `ValidationError`     | Mixed inclusion/exclusion in projection                                                                                                                                                                            |
| `ValidationError`     | Aggregation field path is not a non-empty string, contains reserved segments (`__proto__`, `constructor`, `prototype`), exceeds max depth, or exceeds max length — validated eagerly regardless of result set size |
| `ValidationError`     | `stdDevPop` / `stdDevSamp` / `variancePop` / `varianceSamp` field path fails the same eager validation as above, before any document is fetched                                                                    |
| `ValidationError`     | `distinct` field path fails the same eager validation as above                                                                                                                                                     |
| `ValidationError`     | `distinct` result would exceed `MAX_DISTINCT_COUNT` (100,000) unique values                                                                                                                                        |
| `ValidationError`     | `countDistinct` field path fails the same eager validation as above                                                                                                                                                |
| `ValidationError`     | `countDistinct` unique-value count would exceed `MAX_DISTINCT_COUNT` (100,000) — the identical cap and boundary as `distinct`                                                                                     |
| `ValidationError`     | `groupBy` field fails the same eager validation as above (string form), or, for the array form, `field` is an empty array, an array element is not a non-empty string or fails the same eager field-path validation, or the array contains duplicate field paths                                                                          |
| `ValidationError`     | `groupBy` accumulator field paths (`$sum`, `$avg`, `$min`, `$max`, `$stdDevPop`, `$stdDevSamp`, `$variancePop`, `$varianceSamp`, `$first`, `$last`, `$countDistinct`, `$push`, `$addToSet` operands) fail the same eager validation                          |
| `ValidationError`     | `groupBy` `$countDistinct` accumulator's per-group unique-value count would exceed `MAX_DISTINCT_COUNT` (100,000)                                                                                                 |
| `ValidationError`     | `groupBy` `$addToSet` accumulator's per-group unique-value count would exceed `MAX_DISTINCT_COUNT` (100,000) — the identical per-group cap and boundary as `$countDistinct`                                      |
| `ValidationError`     | `groupBy` accumulators is empty object                                                                                                                                                                             |
| `ValidationError`     | `groupBy` accumulator entry does not contain exactly one key                                                                                                                                                       |
| `ValidationError`     | `percentile` / `$percentile` `p` is not a finite scalar number, or is outside `[0, 1]` — validated eagerly, before any document is fetched                                                                        |
| `ValidationError`     | `groupBy` `$percentile` operand is not a plain object, or does not contain exactly the keys `field` and `p`                                                                                                       |
| `ClosedDatabaseError` | Terminal method called on a closed database (for `.cursor()`, thrown when iteration starts)                                                                                                                        |
