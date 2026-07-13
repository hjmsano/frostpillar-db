# Spec 02: CRUD and Query Operations

- **Status:** Accepted
- **Date:** 2026-04-03

## Overview

This spec details the CRUD operations on a `Collection` and the filter/update operator system.

## 1. Insert

### `collection.insert(doc: object): Promise<string>`

Inserts a single document into the collection.

**Common behavior (all policies):**

1. If `doc._id` is provided, use it as the document ID. Otherwise, generate one via `crypto.randomUUID()`.
2. Validate that `_id` is a non-empty string of at most 1024 characters with no control characters (codepoints `< 0x20` other than tab/newline/carriage-return, or `0x7f`). Otherwise throw `ValidationError`.
3. Construct the storage key: `{_id}`. (Each collection has its own dedicated `Datastore` per [ADR-012](../adr/012-per-collection-datastore-isolation.md), so a collection name prefix is not needed.)
4. **Deep-copy** the document and ensure `_id` is included in the payload (see §12).

**Policy-specific behavior:**

| Policy      | Step 5                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `'reject'`  | Call `Datastore.put({ key, payload })`. The storage engine (configured with `duplicateKeys: 'reject'`) throws on duplicate keys, which frostpillar-db catches and re-throws as `DuplicateIdError`. Internally, the storage engine uses a bloom filter as a fast-path negative check before falling back to `has()` for confirmation; this is an internal optimization with no user-facing configuration. The `tests/integration/collection-bloom-filter.test.ts` suite exercises this path, including correct behavior after removals when the bloom filter may still report "maybe present". |
| `'replace'` | Call `Datastore.put({ key, payload })`. The storage engine (configured with `duplicateKeys: 'replace'`) silently overwrites the existing record.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `'allow'`   | Call `Datastore.put({ key, payload })` directly. The storage engine (configured with `duplicateKeys: 'allow'`) accepts duplicate keys.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

6. Return the `_id`.

### `collection.insertMany(docs: object[]): Promise<string[]>`

Inserts multiple documents. Each document follows the same policy-specific behavior as `insert()`. All records are prepared and inserted via `Datastore.putMany()` in a single batch call.

Returns an array of `_id` values in the same order as the input.

**Duplicate `_id` pre-check (`'reject'` collections):** before any record is written, the batch is checked for duplicate `_id`s — both within the batch and against the stored documents (one `Datastore.getMany()` over the batch's keys). A duplicate throws `DuplicateIdError` with **nothing written**. `putMany()` writes records in order and throws on the offending one, so without this pre-check a duplicate in the middle of a batch persisted the records before it — and, because the events are emitted only after `putMany()` resolves, emitted no `'insert'` event for any of them: storage and the `watch()` stream disagreed. The pre-check does not apply to `'replace'` / `'allow'` collections, where a duplicate key is not an error.

The pre-check compares `_id` strings. Under a custom `key` definition whose `normalize` maps two distinct `_id`s onto one storage key ([ADR-027](../adr/027-custom-key-id-identity.md)), a collision _between two records of the same batch_ is not caught by it and still surfaces from the storage engine at write time.

**Error semantics:** If any insertion fails (e.g., `ValidationError`, `QuotaExceededError`, or a `DuplicateIdError` the pre-check could not anticipate), the error propagates to the caller immediately. Remaining documents are not processed. Documents that were already inserted before the failure are **not** rolled back (no transaction support; see ADR-007). The caller receives the thrown error, not a partial result. The IDs of previously inserted documents are not accessible from the error object.

**Watch events on failure:** on a `'reject'` collection, an `'insert'` event is emitted for each record that was actually persisted before the failure, so the `watch()` stream never silently omits a stored document. Those records are identified by re-reading the batch's keys: the pre-check established that none of them existed, so any that exist now were written by this call. On a `'replace'` / `'allow'` collection this reconciliation is not possible — a key that exists afterwards may be a pre-existing record — so a partially-applied failed batch emits no events there, and callers should treat a failed `insertMany()` as "state unknown" and re-read.

## 2. Find

### `collection.find(filter?: Filter): ResultChain`

Returns a `ResultChain` for lazy query composition. The query is **not executed** until a terminal method is called (`.toArray()`, `.count()`, etc.).

If `filter` is omitted or `{}`, all documents in the collection are matched.

**Filter shape validation:** When `filter` is provided, it must be a plain object (`Record<string, unknown>`) — an object whose prototype is `Object.prototype` or `null`. Passing `null`, arrays, primitives, class instances (including `Date`, `Map`, `Set`), or objects created with `Object.create(proto)` throws `ValidationError` synchronously at the entry point. This applies to all query methods (`find`, `findOne`, `count`, `update`, `remove`).

The prototype rule matters because filter conditions are read from **own** enumerable keys only: an object such as `Object.create({ _id: 'missing' })` has no own keys, so accepting it would make it indistinguishable from `{}` and turn a targeted `update`/`remove` into a match-all. The same rule is enforced on every nested sub-filter (`$and` / `$or` array elements, `$elemMatch` and `$not` operands), so a non-plain sub-filter throws instead of silently matching every document.

### `collection.findOne(filter?: Filter): Promise<Document | null>`

Equivalent to `find(filter).limit(1).toArray()`, returning the first match or `null`.

When the filter is a simple `_id` equality, `findOne` uses `Datastore.getFirst(key)` for a direct O(1) lookup, bypassing the full scan pipeline. **Exception:** When the collection has both `duplicateKeys: 'allow'` and a TTL configured, the `getFirst` fast path is disabled and `findOne` falls through to the scan pipeline. This is because `getFirst` returns only the first record for a given key; if that record is expired, other non-expired duplicates would be missed.

#### Single-key Optimization in Internal Record Retrieval

When the collection's `duplicateKeys` policy is not `'allow'` (i.e., `'reject'` or `'replace'`), an `_id` equality filter in the internal `getRecordsByFilter` path uses `Datastore.getFirst(key)` instead of `Datastore.get(key)`. Since at most one record can exist for a given key under these policies, `getFirst` avoids array allocation and exits early. When `duplicateKeys` is `'allow'`, `Datastore.get(key)` is used to retrieve all matching records.

#### Range Query Optimization

When the filter contains range operators (`$gt`, `$gte`, `$lt`, `$lte`) on the `_id` field with both a lower and upper bound, the query engine delegates to `Datastore.getRange(start, end)` instead of scanning all records via `getAll()`. This performs an efficient B+Tree leaf-level range scan.

- Both bounds must be present (lower and upper) for the optimization to apply.
- Both bounds must be the same primitive type (both `string` or both `number`). If the types differ, `extractIdRange` throws `ValidationError` immediately — mixed-type bounds (e.g. `{ _id: { $gte: '10', $lte: 20 } }`) almost certainly represent a caller bug. The error message names the field and both types.
- If the start bound is greater than the end bound, the range is considered empty and an empty result is returned without scanning.
- `getRange` returns records inclusively on both ends. For exclusive bounds (`$gt`, `$lt`), the in-memory `matchesFilter` step correctly excludes boundary values. This enforcement is shared by all query paths — `find`, `update`, and `remove` — since each applies `matchesFilter` after retrieving records via `getRecordsByFilter`.
- Additional non-`_id` filter conditions may coexist; the range optimization narrows the storage scan while the remaining conditions are evaluated in-memory.

## 3. Update

### `collection.update(filter: Filter, operations: UpdateOperations, options?: UpdateOptions): Promise<UpdateResult>`

Updates all documents matching `filter` using the specified update operators.

A filter argument is always required. Passing `undefined`, `null`, or any non-plain-object value throws `ValidationError` — `update` must never silently match all documents. To update every document, pass `{}` explicitly.

**Types:**

```ts
interface UpdateOptions {
  upsert?: boolean; // default: false
}

interface UpdateResult {
  modifiedCount: number;
  upsertedId: string | null;
}
```

**Behavior:**

1. Resolve matching documents via `getRecordsByFilter` — this uses the same `_id` fast paths (`getFirst`, `getMany`, `getRange`) documented in §2, falling back to `getAll()` for non-`_id` filters.
2. For each matching document, apply the update operations to produce a new payload. Values written by `$set`, `$push`, and `$addToSet` are **deep-copied** before they enter the payload (see §12).
3. **Payload validation:** Validate the resulting document against the same payload limits enforced on `insert` (see Spec 01 §1.2). If the document exceeds any limit (e.g., `maxTotalBytes`, `maxDepth`, `maxStringBytes`), throw `ValidationError` immediately. When `skipPayloadValidation` is `true`, only security checks (reserved keys, circular references) are applied.
4. **No-op detection:** If the resulting payload is identical to the original document (deep equality on every touched field), the document is considered unmodified — `replaceById` is **not** called, no `'update'` change event is emitted, and `modifiedCount` is **not** incremented. Examples: `$set` to the same value, `$inc` by `0` on an existing field, `$addToSet` of an already-present value.
5. Persist each **actually modified** document atomically via `Datastore.replaceById(entryId, updatedPayload)`. The storage engine replaces the payload in-place, preserving the key and entry ID.
6. Return `{ modifiedCount: <actually modified count>, upsertedId: null }`.
7. If no documents matched and `upsert` is `true`, perform the upsert (see below).
8. If no documents matched and `upsert` is `false` (default), return `{ modifiedCount: 0, upsertedId: null }`.

**Upsert behavior** (when `upsert: true` and no documents match the filter):

1. Create a new document from equality conditions in the filter (implicit `$eq` and explicit `$eq` only — skip `$gt`, `$or`, and all other non-equality operators). Dot-notation keys (e.g. `'address.city'`) are expanded into nested objects (e.g. `{ address: { city: … } }`) rather than stored as literal top-level keys. An equality condition whose value is an object or an array (e.g. `{ profile: { tier: 'pro' } }`, `{ tags: ['a'] }`) is an equality condition like any other — the filter matches it by deep equality (§8.1) — so it is carried into the upserted document, deep-cloned so the caller's filter object is not aliased by stored data. A field condition that mixes operator keys with regular keys is rejected by filter validation and never reaches this step; a pure operator expression (every key `$`-prefixed) is skipped unless it is exactly `{ $eq: … }`.
2. Apply all update operators from the update spec to the new document.
3. Generate `_id` via `crypto.randomUUID()` if not derived from filter.
4. Insert the document into the collection.
5. Return `{ modifiedCount: 0, upsertedId: '<generated-id>' }`.

**Note:** The `_id` immutability constraint (§3 Constraints) applies to all update paths, including upsert. `$set` cannot include `_id` even when creating a new document via upsert. The upsert `_id` is derived from filter equality fields or generated via `crypto.randomUUID()`.

**Error semantics:** If an update operator throws `ValidationError` during processing (e.g., `$inc` on a non-numeric field), the operation aborts immediately. Documents already updated within the same `update()` call are NOT rolled back. The thrown error propagates to the caller. This is consistent with `insertMany` behavior (no transaction support; see ADR-007).

**Constraints:**

- `_id` cannot be modified. If `$set` includes `_id`, throw `ValidationError`.
- `$unset` on `_id` throws `ValidationError`.
- `$rename` targeting `_id` (as source or destination) throws `ValidationError`.

## 4. Remove

### `collection.remove(filter: Filter): Promise<number>`

Removes all documents matching `filter`. Returns the number removed.

**Behavior:**

1. Default path: resolve matching documents via scan and collect their entry IDs. The filter-shape fast paths in the Batch Delete Optimizations table below take precedence when applicable (single-key `_id` equality and `_id` `$in` inclusion).
2. Collect the entry IDs of all matching documents.
3. Delete each matched record individually via `Datastore.deleteById(entryId)`, emitting a `remove` change event only for records that were actually deleted.
4. Return the count of deleted documents.

#### Batch Delete Optimizations (WI-6)

When no TTL is configured on the collection, `remove` applies fast-path optimizations based on the filter shape:

| Filter shape                          | Datastore call                                           | Description                                                                 |
| ------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------- |
| `{ _id: '<key>' }` (equality)         | `Datastore.delete(key)`                                  | Single-key delete, bypasses scan-and-match loop                             |
| `{ _id: { $in: [...] } }` (inclusion) | `Datastore.getMany(keys)` + `Datastore.deleteMany(keys)` | Resolves which keys exist, then batch-deletes in a single mutex acquisition |
| Any other filter                      | Scan + `Datastore.deleteById(entryId)` per record        | Scan-based path, per-id deletion for exact change-event attribution         |

**Operand validation:** The `$in` fast path applies the `MAX_OPERAND_ARRAY_SIZE` limit (§8.3) and the `_id` string rules before calling `getMany` / `deleteMany`. An oversized or malformed operand therefore throws `ValidationError` and deletes nothing, exactly as it would on the scan-based path.

**Exception:** When the collection's `duplicateKeys` policy is `'allow'`, the no-TTL fast paths (equality and `$in`) are disabled and `remove` always falls through to the scan-based path. This is because `Datastore.delete(key)` and `Datastore.deleteMany(keys)` can remove multiple records per key under the `'allow'` policy, but the fast paths would emit only one `'remove'` change event per key — under-reporting to watch listeners. The scan-based path iterates individual records and emits one event per deletion, maintaining the watch event contract.

The fast-path batch deletes (`deleteMany`) use a single storage-engine call rather than issuing individual `delete(key)` calls in a loop. The scan-based path issues one `deleteById` call per matched record to keep change-event attribution accurate; this trades batch throughput for event correctness on that path.

#### Change Events for the `$in` Fast-Path (WI-3)

When using the `$in` fast-path, `remove()` emits a `remove` change event **only for keys that actually existed** in the collection at the time of the call. Keys that were not present in the collection produce no event. The set of existing keys is determined by calling `Datastore.getMany(keys)` before the delete, and events are emitted using the `key` field of each returned record.

#### Change Events for the Scan-Based Path

The scan-based path deletes each matched record individually via `Datastore.deleteById(entryId)`, which returns a boolean indicating whether that specific record was removed. A `remove` change event is emitted only for records that were actually deleted, using the correct document `_id`. This keeps event attribution accurate even under concurrent deletion (where another actor may have removed some records between the scan and the delete), and under the `duplicateKeys: 'allow'` policy (where multiple records share a document `_id` but have distinct storage entry IDs).

The TTL cleanup method `purgeExpired()` uses `Datastore.deleteByIds(expiredIds)` for batch deletion.

If `filter` is `{}`, **all** documents in the collection are removed. A filter argument is always required; omitting it throws `ValidationError`.

## 5. Count

### `collection.count(filter?: Filter): Promise<number>`

Returns the number of documents matching `filter`. Shorthand for `find(filter).count()`.

> **`duplicateKeys: 'allow'` note:** On collections with `duplicateKeys: 'allow'`, `count()` always uses the scan-based path to count each matched record individually — duplicates with the same `_id` are each counted as separate documents. The `Datastore.count()` fast path is not used for `'allow'` collections to ensure consistency between filtered and unfiltered counts.

## 6. Exists

### `collection.exists(id: string): Promise<boolean>`

Returns `true` if a document with the given `_id` exists **and has not expired**, `false` otherwise.

**Behavior:**

- If the collection has no TTL configured, uses `Datastore.has(key)` for an O(1) lookup without loading the document payload (fast path).
- If the collection has a TTL configured and `duplicateKeys` is not `'allow'`, loads the document via `Datastore.getFirst(id)` and evaluates `isDocumentExpired`. Returns `false` for expired documents, consistent with `findOne({ _id: id })` returning `null`.
- If the collection has a TTL configured and `duplicateKeys` is `'allow'`, loads all records for the key via `Datastore.get(id)` and returns `true` if **any** record is non-expired. This avoids falsely returning `false` when only the first record is expired but other live duplicates exist.

## 7. IDs

### `collection.ids(): Promise<string[]>`

Returns an array of all **non-expired** document IDs in the collection.

The result has **one entry per document**, not per storage key: under `duplicateKeys: 'allow'`, a collection holding three documents with `_id: 'a'` returns `'a'` three times, so `ids().length === count()` and the result stays consistent with `find()`.

**Behavior:**

- If the collection has no TTL configured, no custom key definition, and `duplicateKeys` is not `'allow'`, uses `Datastore.keys()` for a direct key scan without loading document payloads (fast path). The returned order is determined by the storage engine's key ordering.
- Otherwise (TTL configured, a custom key definition, or `duplicateKeys: 'allow'`), loads all records via `Datastore.getAll()`, filters out expired documents using `isDocumentExpired`, and returns the `_id` field of each non-expired document. This ensures consistency with `find()`, `findOne()`, and `count()`.
- The `Datastore.keys()` fast path is disabled under `duplicateKeys: 'allow'` because it yields each storage key once, however many documents share it — the same reason it is disabled under a custom key definition (which reports normalized keys rather than stored `_id` strings; see Spec 01 §5).

## 8. Filter Operators

Filters are plain objects where each key represents a field path and each value is either a direct value (implicit `$eq`) or an operator expression.

**Reserved keys:** The keys `__proto__`, `constructor`, `prototype`, `__defineGetter__`, `__defineSetter__`, `__lookupGetter__`, and `__lookupSetter__` are rejected with `ValidationError` both as top-level filter keys and as segments inside any dot-notation path (including sort specs, projection specs, and update operators). This is a prototype-pollution defence shared with the payload validator (see Spec 01 §1.2 Reserved Keys).

### 8.1 Implicit Equality

```ts
{
  name: 'Alice';
}
// Equivalent to:
{
  name: {
    $eq: 'Alice';
  }
}
```

### 8.2 Comparison Operators

| Operator | Description           | Example                           |
| -------- | --------------------- | --------------------------------- |
| `$eq`    | Equal to              | `{ age: { $eq: 30 } }`            |
| `$ne`    | Not equal to          | `{ status: { $ne: 'inactive' } }` |
| `$gt`    | Greater than          | `{ age: { $gt: 25 } }`            |
| `$gte`   | Greater than or equal | `{ age: { $gte: 25 } }`           |
| `$lt`    | Less than             | `{ age: { $lt: 50 } }`            |
| `$lte`   | Less than or equal    | `{ age: { $lte: 50 } }`           |

Comparison operators work on `number`, `string`, and `boolean` values. Type coercion is **not** performed; if the field value type does not match the operand type, the predicate evaluates to `false`.

> **Cross-type comparisons return no matches.** If the document field type differs from the operand type, the comparison evaluates to `false` and the document is excluded from results. For example, `{ age: { $gt: '30' } }` against documents where `age` is a `number` yields zero results — the string operand `'30'` never matches a numeric field. This mirrors MongoDB semantics. If a range query returns unexpectedly empty results, verify that the operand type matches the stored field type.

### 8.3 Inclusion Operators

| Operator | Description           | Example                                      |
| -------- | --------------------- | -------------------------------------------- |
| `$in`    | Value is in array     | `{ status: { $in: ['active', 'pending'] } }` |
| `$nin`   | Value is not in array | `{ role: { $nin: ['admin'] } }`              |

**Operand size limit:** The operand array for `$in`, `$nin`, and `$all` must contain at most `MAX_OPERAND_ARRAY_SIZE` (10,000) elements. Exceeding this limit throws `ValidationError`.

The limit also applies to the `_id` `$in` fast paths used by `find`, `findOne`, `count`, `update`, and `remove` (§2, §5, §6). The operand is checked while the fast path is being recognised, i.e. **before** any storage call (`getMany` / `deleteMany`) is issued, so an oversized operand can neither read nor delete records.

**Operand immutability:** Treat `$in`, `$nin`, and `$all` operand arrays as immutable. The inclusion-set cache rebuilds when the operand length changes, so pushing or popping elements between queries is safe. However, a same-length in-place change on a reused operand array (e.g. replacing an element at an existing index) is not detected and yields undefined results. Pass a fresh array when the contents change.

**Array field matching:** When the document field contains an array, `$in` matches if **any element** of the document's array is present in the operand array. Conversely, `$nin` matches only if **no element** of the document's array is present in the operand array.

```ts
// Document: { tags: ['a', 'b', 'c'] }
{
  tags: {
    $in: ['a', 'x'];
  }
} // true — 'a' is in the document array
{
  tags: {
    $nin: ['x', 'y'];
  }
} // true — neither 'x' nor 'y' is in the document array
{
  tags: {
    $nin: ['a', 'x'];
  }
} // false — 'a' is in the document array
```

**Deep equality scope:** Membership tests for `$in` and `$nin` (and all operators that use deep equality: `$eq`, `$ne`, `$all`, `$pull`, `$addToSet`) rely on the internal `deepEqual` utility (see [ADR-013](../adr/013-internal-deep-equal.md)). It supports:

- Primitives (`number`, `string`, `boolean`, `null`, `undefined`, `NaN`)
- `Date` (compared by `.getTime()`)
- Plain arrays (element-by-element recursion)
- Plain objects (own enumerable key-by-key recursion)

The following types are **not** supported and will not compare correctly:

- `Map` and `Set`
- `RegExp`
- Typed arrays (`Uint8Array`, `Float32Array`, etc.)
- Any other exotic or host objects

Passing unsupported types as filter operands produces unspecified results (typically `false` for equality tests). Only primitives, plain objects, arrays, and `Date` should be used as filter or update operand values.

### 8.4 Logical Operators

| Operator | Description          | Example                                                  |
| -------- | -------------------- | -------------------------------------------------------- |
| `$and`   | All conditions match | `{ $and: [{ age: { $gt: 20 } }, { age: { $lt: 40 } }] }` |
| `$or`    | At least one matches | `{ $or: [{ status: 'active' }, { role: 'admin' }] }`     |
| `$not`   | Negates a condition  | `{ age: { $not: { $gt: 50 } } }`                         |

**Implicit `$and`:** Multiple keys at the top level are combined with `$and`:

```ts
{ age: { $gt: 20 }, status: 'active' }
// Equivalent to:
{ $and: [{ age: { $gt: 20 } }, { status: 'active' }] }
```

**Operational limits:** Logical nesting is capped at `MAX_FILTER_NESTING_DEPTH` (32) levels for `$and`, `$or`, and nested `$not` expressions. A single `$and` or `$or` operand array may contain at most `MAX_LOGICAL_OPERAND_COUNT` (1,000) elements. Field paths inside filters are capped at `MAX_FIELD_PATH_LENGTH` (512) characters and `MAX_FIELD_PATH_DEPTH` (32) segments. Exceeding any of these throws `ValidationError`.

### 8.5 String Operators

| Operator | Description              | Example                         |
| -------- | ------------------------ | ------------------------------- |
| `$regex` | Regular expression match | `{ name: { $regex: /^Ali/i } }` |

`$regex` accepts a `RegExp` object or a string pattern. If a string is provided, it is compiled to a `RegExp` without flags.
If string compilation fails, the operation throws `ValidationError`.
For `RegExp` operands, the `g` and `y` flags are stripped to ensure stateless evaluation; all other flags are preserved.

**Pattern limits:** String patterns must be at most `MAX_REGEX_PATTERN_LENGTH` (1,024) characters. Patterns are additionally screened for catastrophic-backtracking shapes and rejected with `ValidationError` before compilation, via three mechanisms:

- **A general, structural nested-quantifier check** (`hasNestedQuantifier`): rejects any parenthesized group that is _repeated_ — quantified by `+`, `*`, or a `{n,m}` whose maximum is 2 or more (including unbounded `{n,}`) — whose own content contains another quantifier, anywhere within it, at any nesting depth, regardless of which quantifier syntax is used on either side. This is not an enumerated list of shapes; it catches `(a+)+`, `(.*)*`, `([a-z]+)+`, `(\d+)+`, `(a{1,2})+`, `(a+){2,}`, `(a?)+`, and any other nested-quantifier combination — including `(a{1,10}){1,10}` (bounded quantifier nested inside another bounded quantifier), which a prior enumerated-pattern approach missed because no entry had been written for that specific combination. A group whose outer quantifier is `?` or a max-≤1 bound (`{0,1}`, `{1}`) matches at most once and therefore cannot backtrack exponentially, so benign patterns such as `(\d+)?`, `(https?)?`, or `^(v\d+)?$` are accepted; the inner quantifier is still recorded, so a _repeating_ quantifier wrapped around such a group (`((a+)?)+`) is still rejected. **Group-syntax prefixes are not quantifier tokens:** a `?` that appears immediately after an unescaped `(` — as in `(?:`, `(?=`, `(?!`, `(?<=`, `(?<!`, or `(?<name>` — is part of JS group syntax, not a quantifier, and is therefore not counted. Patterns that use non-capturing groups, lookahead, lookbehind, or named groups are accepted as long as their _content_ does not introduce a nested quantifier: `(?:a+)+` is rejected (inner `+` is real content), but `(?:abc)+`, `(?<name>abc)+`, `(?:abc)*`, `(?:abc){2,5}`, `(?=x)y+`, and `a(?:b)?` are accepted.
- **A structural quantified-alternation-group check** (`hasQuantifiedAlternationGroup`): rejects any _repeating_ quantifier — `+`, `*`, unbounded `{n,}`, `{n}` with n ≥ 2, or `{n,m}` with m ≥ 2 — applied to a group that contains an unescaped `|` **at any nesting depth**. As each group closes, a pipe it carries is propagated to the enclosing group, because a repeat on the outer group repeats everything nested inside it — so a redundant wrapping group cannot hide the alternation from the outer repeat. Examples rejected: `(a|a)+`, `(a|ab)*`, `(aa|a){2,}`, `(aa|a){2}`, `(a|b){2,5}`, `(?:aa|a){2,50}`, `(?:a|b)+`, and the wrapped forms `((a|aa))+`, `(?:(?:a|ab))+`, `((a|aa)){2,}`. This screen is deliberately conservative: no ambiguity analysis is attempted, so even an unambiguous alternation such as `(a|b)+` is rejected, and no attempt is made to prove that an inner alternation is delimited from ambiguity by surrounding literals — a repeated group carrying a pipe anywhere within it, such as `(x(a|b)y)+`, is rejected. A _non-repeating_ quantifier (`?`, `{0,1}`, `{1}`) matches the group at most once and is accepted (`(a|b)?`, `(a|b){0,1}`, `(a|b){1}`), as are bare alternation groups with no quantifier at all (`(a|b)`, `(?:a|b)`), subject to the alternation-group count limit below. Group-syntax `?` is handled as above: the `?` in `(?:`/`(?=`/`(?<name>` is not a quantifier token, but the group's alternation content still counts, so `(?:a|b)+` is rejected while `(?:a|b)` bare is accepted. (This depth-aware propagation is specific to this catastrophic-backtracking screen; the alternation-group **count** limit below attributes each `|` to its innermost group only.)
- **Hand-written detectors** for catastrophic shapes not covered by the structural checks:
  - Overlapping wildcards inside groups (`(.*a.*)`)
  - Adjacent quantifiers
  - Backreference with quantifier (`(a+)\1+`)
  - Adjacent/chained quantifiers on overlapping atoms (`\d+\d+`, `.+.+`, `[a-z]+[a-z]+`, `a+a+`)

Patterns may contain at most `MAX_REGEX_QUANTIFIERS` (20) quantifiers; exceeding this limit throws `ValidationError`. **Group-syntax `?` is excluded:** a `?` immediately following an unescaped `(` is part of JS group syntax (`(?:`, `(?=`, `(?!`, `(?<=`, `(?<!`, `(?<name>`) and is not counted as a quantifier token, so `(?:a)` counts zero quantifiers and `(?:a?)` counts one.

**Optional quantifier limit:** Patterns may contain at most `MAX_REGEX_OPTIONAL_QUANTIFIERS` (8) _optional_ quantifiers (`countOptionalQuantifiers`) — quantifier tokens whose minimum repetition count is zero: `?`, `*`, and any `{0}` / `{0,}` / `{0,m}` bound. Exceeding this limit throws `ValidationError`.

An optional quantifier makes its atom independently skippable, so _k_ of them give a backtracking engine up to 2^_k_ ways to distribute a failing match across the pattern. `^.?.?….?aaa…a$` (20 `.?` atoms followed by 20 literal `a`s) passes every screen above — no quantifier repeats an atom, no group is nested or alternated, and no two adjacent atoms match a hand-written detector — yet it explodes to ~2^20 backtracking paths, ≈1.5 ms per _failing_ evaluation, which extrapolates to ≈15 s for a zero-match scan of 10,000 documents. `maxMatchedDocuments` cannot cut such a scan short, because a pattern that matches nothing never increments the match count. Capping optional quantifiers at 8 bounds this shape at ~2^8 = 256 paths (~0.01 ms per failing evaluation).

The cap is a **total count over the whole pattern**, not the length of an adjacent run: mandatory atoms interleaved between the optional ones (`.?\w.?\w…`) still match unconditionally, so they do not prune any branch and the path count stays exponential in the total. The count is deliberately conservative in two ways — a lazy marker (`*?`, `+?`, `{n,m}?`) is itself a `?` token and counts, and `{0}` (which can never match) counts as well. Group-syntax `?` is excluded exactly as it is for `MAX_REGEX_QUANTIFIERS`, so `(?:a)` counts zero and `(?:a)?` counts one.

**Alternation group limit:** Patterns may contain at most `MAX_REGEX_ALTERNATION_GROUPS` (4) alternation groups — parenthesized groups whose own top-level content has an unescaped `|` (e.g. `(a|b)`, `(?:a|b)`; a `|` inside a nested sub-group does not count toward its enclosing group). This closes a gap the quantifier-based checks above cannot see: repeating an ambiguous alternation group with no quantifier at all (e.g. `(a|aa)(a|aa)(a|aa)...`) produces the same exponential backtracking blowup as a quantified alternation, but carries zero quantifier tokens, so `MAX_REGEX_QUANTIFIERS` and the quantifier-keyed patterns above never see it. Exceeding this limit throws `ValidationError`.

**Field value length limit:** The field value tested against `$regex` must be at most `MAX_REGEX_TEST_LENGTH` (8,192) characters. This bounds worst-case regex execution time even if a pattern with quadratic cost slips past the heuristic detector. Values exceeding this limit cause `ValidationError`.

> **Note:** The structural checks (nested quantifier, quantified alternation group) and the hand-written detectors are heuristic, defense-in-depth screens against known catastrophic-backtracking shapes — not a formal proof that every `$regex` pattern executes in linear time. They narrow the risk significantly but do not eliminate the category. Applications that expose user-controlled regex patterns should apply additional validation at the application layer.

### 8.6 Existence Operator

| Operator  | Description           | Example                        |
| --------- | --------------------- | ------------------------------ |
| `$exists` | Field existence check | `{ email: { $exists: true } }` |

`$exists: true` matches documents where the field is present (including `null` values).
`$exists: false` matches documents where the field is absent.

### 8.7 Dot Notation for Nested Fields

Filter keys support dot notation to query nested objects:

```ts
{ 'address.city': 'Tokyo' }
{ 'metadata.tags.primary': { $eq: 'featured' } }
```

If any intermediate key in the path is not an object, the predicate evaluates to `false`.

### 8.8 Array Operators

| Operator     | Description                          | Example                                            |
| ------------ | ------------------------------------ | -------------------------------------------------- |
| `$elemMatch` | Array element matches all conditions | `{ scores: { $elemMatch: { $gt: 80, $lt: 90 } } }` |
| `$all`       | Array contains all specified values  | `{ tags: { $all: ['featured', 'new'] } }`          |
| `$size`      | Array has the specified length       | `{ tags: { $size: 3 } }`                           |

#### `$elemMatch`

Matches documents where an array field contains at least one element that satisfies **all** specified conditions.

```ts
// Primitive array: operator expression applied to each element
{ scores: { $elemMatch: { $gt: 80, $lt: 90 } } }

// Object array: sub-document filter applied to each element
{ items: { $elemMatch: { name: 'widget', qty: { $gt: 10 } } } }
```

- If the field value is not an array, the predicate evaluates to `false`.
- The operand is either an operator expression (for primitive arrays) or a sub-document filter (for object arrays).
- Returns `true` if **any** element in the array matches **all** conditions in the operand.

#### `$all`

Matches documents where an array field contains **all** of the specified values.

```ts
{
  tags: {
    $all: ['featured', 'new'];
  }
}
```

- If the field value is not an array, the predicate evaluates to `false`.
- The operand must be an array; otherwise `ValidationError` is thrown.
- An empty operand (`$all: []`) evaluates to `false` (matches no documents), consistent with MongoDB.
- Uses deep equality for value comparison.

#### `$size`

Matches documents where an array field has exactly the specified number of elements.

```ts
{
  tags: {
    $size: 3;
  }
}
```

- If the field value is not an array, the predicate evaluates to `false`.
- The operand must be a non-negative integer; otherwise `ValidationError` is thrown.
- Matches when `array.length === operand`.

## 9. Update Operators

### 9.1 `$set`

Sets field values. Creates fields if they do not exist.

```ts
{ $set: { name: 'Bob', 'address.city': 'Osaka' } }
```

Dot notation creates nested structures if intermediate objects do not exist.

### 9.2 `$unset`

Removes fields from the document.

```ts
{ $unset: { temporaryFlag: true, 'metadata.deprecated': true } }
```

The value in the `$unset` object is ignored (convention: use `true`).

### 9.3 `$inc`

Increments numeric fields. If the field does not exist, it is created with the increment value. If the field is not a number, throws `ValidationError` immediately.

```ts
{ $inc: { viewCount: 1, 'stats.visits': -1 } }
```

> **Note:** When `$inc` is applied via `update()` across multiple matching documents, a `ValidationError` (e.g., from a non-numeric field value) aborts the operation immediately. Documents already updated within the same `update()` call are **not** rolled back (consistent with the no-transaction semantics described in §3).

### 9.4 `$rename`

Renames field keys. The value is the new field name.

```ts
{
  $rename: {
    oldName: 'newName';
  }
}
```

- If the source field does not exist, the operation is a no-op for that field.
- If the destination field already exists on the document (the key is present, regardless of whether its value is `null` or any other value), throws `ValidationError` immediately. The caller must `$unset` the destination field first if overwriting is intended.
- Supports dot notation for both source and destination paths (e.g., `{ 'a.b': 'c.d' }`). Existence of a nested destination key is checked using the same path-lookup semantics as `getValueByPath` — a key is considered present if the full path resolves to an existing property at each segment.
- If the source path is a prefix of the destination path or vice versa (e.g., `{ 'a.b': 'a.b.c' }` or `{ 'a.b.c': 'a.b' }`), throws `ValidationError`. Overlapping paths would silently wrap or unwrap values inside object literals.
- Cannot use `_id` as source or destination (throws `ValidationError`).

> **Rationale:** Silent overwrites are a class of hard-to-debug data-loss bugs. Frostpillar follows a fail-loud policy (consistent with `$inc` throwing on type mismatch and `$push`/`$pull` throwing on non-array targets). If the intent is to overwrite, the caller should issue `{ $unset: { dest: true }, $rename: { src: 'dest' } }` in separate update calls (or use `$set` directly).

### 9.5 `$push`

Appends a value to an array field. If the field does not exist, creates it as a single-element array.

```ts
{
  $push: {
    tags: 'featured';
  }
}
// tags: ['a', 'b'] → tags: ['a', 'b', 'featured']
// tags: (missing) → tags: ['featured']
```

- The operand is a `Record<string, unknown>` mapping field paths to values to push.
- If the target field exists but is not an array, throws `ValidationError`.
- If the resulting array length would exceed `MAX_ARRAY_LENGTH` (100,000), throws `ValidationError`.
- Supports dot notation for nested paths.
- Cannot target `_id`.

### 9.6 `$pull`

Removes all occurrences of a value from an array field using deep equality.

```ts
{
  $pull: {
    tags: 'deprecated';
  }
}
// tags: ['a', 'deprecated', 'b', 'deprecated'] → tags: ['a', 'b']
```

- If the target field does not exist, the operation is a no-op for that field.
- If the target field exists but is not an array, throws `ValidationError`.
- Removes **all** matching elements (compared via deep equality).
- Supports dot notation for nested paths.
- Cannot target `_id`.

### 9.7 `$addToSet`

Adds a value to an array field only if it does not already exist (using deep equality).

```ts
{
  $addToSet: {
    tags: 'featured';
  }
}
// tags: ['a', 'featured'] → tags: ['a', 'featured'] (no change)
// tags: ['a', 'b'] → tags: ['a', 'b', 'featured']
// tags: (missing) → tags: ['featured']
```

- If the target field exists but is not an array, throws `ValidationError`.
- If the value already exists in the array (deep equality), the operation is a no-op for that field.
- If the target field does not exist, creates it as a single-element array.
- If the resulting array length would exceed `MAX_ARRAY_LENGTH` (100,000), throws `ValidationError`. (No-op additions on full arrays are allowed.)
- Supports dot notation for nested paths.
- Cannot target `_id`.

## 10. Operator Validation

- Unknown operators (keys starting with `$` that are not recognized) throw `ValidationError`.
- Empty filter objects (`{}`) match all documents.
- Empty update objects (`{}`) are no-ops and return `{ modifiedCount: 0, upsertedId: null }`.
- Combining `$set` and `$unset` on the same field in one operation throws `ValidationError`.

### 10.0 Structural Filter Validation

Every query path (`find`, `findOne`, `count`, `update`, `remove`) validates the **whole filter tree** before evaluating it against any document. Validation is performed by a dedicated walk (`internal/filterValidator.ts`), not by evaluating the filter against an empty document: `matchesFilter` short-circuits on the first false predicate, so an evaluation-based check stops at `a` in `{ a: 1, b: { $nope: 2 } }` and never inspects `b`. Such a filter was consequently accepted on an empty collection — and with `upsert: true` inserted a document — while throwing on a populated one.

The validator visits every branch regardless of match outcome and throws `ValidationError` for:

- Reserved keys (§8) at any level, including inside `$and` / `$or` branches.
- Invalid field paths (empty, over-long, too many segments, restricted segments).
- Unknown operators, at the top level and inside any field condition, `$not`, or `$elemMatch` sub-condition.
- Field conditions that mix operator keys with regular keys (e.g. `{ a: { $eq: 1, b: 2 } }`).
- Malformed operands: non-array or over-sized `$in` / `$nin` / `$all`, non-boolean `$exists`, non-integer or negative `$size`, non-string/RegExp or unsafe `$regex` pattern (§8.5).
- Non-plain-object `$and` / `$or` elements, non-array `$and` / `$or` operands, and operand arrays over `MAX_LOGICAL_OPERAND_COUNT`.
- Nesting beyond `MAX_FILTER_NESTING_DEPTH`.

Comparison operands (`$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`) accept any value: a type mismatch against the stored value is a non-match, not an error (§8.2). Operand-shape rules are enforced by assertions shared with the evaluator, so validation and evaluation raise identical errors.

### 9.8 Operator Application Order

When multiple update operators target the same field in a single operation, they are applied in a fixed, deterministic order:

**`$set` → `$unset` → `$inc` → `$rename` → `$push` → `$pull` → `$addToSet`**

Cross-operator combinations other than `$set` + `$unset` (which is always rejected at validation time) are permitted. The deterministic ordering produces predictable results, though callers should be aware of the implicit sequencing. This matches MongoDB's ordered semantics.

#### Cross-Operator Conflict Matrix

The table below documents the behavior when two operators target the **same field path** in a single update. "First" is the operator applied earlier per the fixed order; "Second" is applied later.

| First    | Second      | Behavior                                                                      | Example                                                                                     |
| -------- | ----------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `$set`   | `$unset`    | **Rejected** — `ValidationError` at validation time                           | `{ $set: { x: 5 }, $unset: { x: true } }`                                                   |
| `$set`   | `$inc`      | Set value, then increment                                                     | `{ $set: { x: 5 }, $inc: { x: 1 } }` → `x: 6`                                               |
| `$set`   | `$rename`   | Set value on source, then rename to destination                               | `{ $set: { old: 99 }, $rename: { old: 'new' } }` → `new: 99`                                |
| `$set`   | `$push`     | Set value, then push to it — **runtime error** if set value is not an array   | `{ $set: { arr: [1] }, $push: { arr: 2 } }` → `arr: [1, 2]`                                 |
| `$set`   | `$pull`     | Set value, then pull from it — **runtime error** if set value is not an array | `{ $set: { arr: [1, 2, 1] }, $pull: { arr: 1 } }` → `arr: [2]`                              |
| `$set`   | `$addToSet` | Set value, then add-to-set — **runtime error** if set value is not an array   | `{ $set: { arr: [1] }, $addToSet: { arr: 2 } }` → `arr: [1, 2]`                             |
| `$unset` | `$inc`      | Remove field, then `$inc` re-creates it with the increment value              | `{ $unset: { x: true }, $inc: { x: 5 } }` → `x: 5`                                          |
| `$unset` | `$rename`   | Remove source, then rename is no-op (source already gone)                     | `{ $unset: { a: true }, $rename: { a: 'b' } }` → field removed, no `b`                      |
| `$unset` | `$push`     | Remove field, then `$push` re-creates it as single-element array              | `{ $unset: { arr: true }, $push: { arr: 'x' } }` → `arr: ['x']`                             |
| `$unset` | `$pull`     | Remove field, then `$pull` is no-op (field missing)                           | `{ $unset: { arr: true }, $pull: { arr: 'x' } }` → field removed                            |
| `$unset` | `$addToSet` | Remove field, then `$addToSet` re-creates it as single-element array          | `{ $unset: { arr: true }, $addToSet: { arr: 'x' } }` → `arr: ['x']`                         |
| `$inc`   | `$rename`   | Increment field, then rename to destination                                   | `{ $inc: { counter: 5 }, $rename: { counter: 'total' } }` → `total: 15` (if counter was 10) |
| `$inc`   | `$push`     | Increment field (numeric), then push — **runtime error** (not an array)       | Always fails unless field was somehow an array                                              |
| `$inc`   | `$pull`     | Increment field (numeric), then pull — **runtime error** (not an array)       | Always fails unless field was somehow an array                                              |
| `$inc`   | `$addToSet` | Increment field (numeric), then addToSet — **runtime error** (not an array)   | Always fails unless field was somehow an array                                              |
| `$push`  | `$pull`     | Push value, then pull matching values                                         | `{ $push: { arr: 'x' }, $pull: { arr: 'x' } }` → removes all `'x'` including the pushed one |
| `$push`  | `$addToSet` | Push value, then addToSet (no-op if same value was just pushed)               | `{ $push: { arr: 'x' }, $addToSet: { arr: 'x' } }` → one `'x'` added (addToSet is no-op)    |
| `$pull`  | `$addToSet` | Pull matching values, then addToSet appends                                   | `{ $pull: { arr: 'x' }, $addToSet: { arr: 'x' } }` → pulls all `'x'`, then re-adds one      |

> **Design note:** These combinations are permitted because the deterministic order guarantees predictable outcomes. Rejecting all same-field conflicts would disallow valid patterns (e.g., `$set` + `$inc` for "reset then bump") and diverge from MongoDB semantics. Callers who find cross-operator ordering surprising should split operations into separate `update()` calls for clarity.

### 10.1 Update Value Validation

Values written by `$set`, `$push`, and `$addToSet` are validated against the same structural rules as insert payloads to prevent update operators from introducing values that would be rejected on insert:

- **Numbers** must be finite (`Infinity`, `-Infinity`, `NaN` are rejected).
- **BigInt** values are not supported.
- **Objects** must be plain objects (no `Date`, `Map`, `Set`, or class instances).
- **Reserved keys** (`__proto__`, `constructor`, `prototype`) are not allowed in nested objects within update values.
- **Circular references** are not supported.
- Only `string | number | boolean | null`, arrays, or plain nested objects are accepted.
- **Nesting depth** of the value itself is capped at the same `maxDepth` used for insert payloads (`payloadLimits.maxDepth`, default `DEFAULT_MAX_DEPTH` = 64). This check runs during validation, before the value is merged into the document, so a pathologically deep `$set`/`$push`/`$addToSet` value throws `ValidationError` instead of overflowing the call stack.

For `$inc` specifically:

- The increment operand must be a finite number (rejects `Infinity`, `-Infinity`, `NaN`).
- The computed result (`existing + increment`) must also be finite; otherwise `ValidationError` is thrown. This prevents silent production of `NaN` or `Infinity` from overflow-like scenarios (e.g., `Number.MAX_VALUE + Number.MAX_VALUE`).

**Document-level validation:** In addition to per-value validation above, `update()` validates the **complete resulting document** against the database's `payloadLimits` configuration (see Spec 01 §1.2) after all operators have been applied. This ensures that an update cannot produce a document exceeding `maxTotalBytes`, `maxDepth`, `maxStringBytes`, `maxKeyBytes`, `maxKeysPerObject`, or `maxTotalKeys` — the same limits enforced on `insert`. When `skipPayloadValidation` is `true`, only security checks (reserved keys, circular references) are applied.

## 11. Result Set Size Limit

### `maxMatchedDocuments` Guard

`find().toArray()`, `update()`, and `remove()` all buffer matched documents in memory before returning. Without a cap this can OOM the host process on large collections.

**Scope — the cap bounds the matched set, not the scan ([ADR-028](../adr/028-candidate-set-materialization.md)):** a scan first asks the datastore for its candidate records, and the storage engine's read API returns arrays (`getAll()`, `getRange()`, `getMany()`). The candidate array is therefore fully materialized before frostpillar-db can evaluate the filter against a single record or honour a single `.limit(n)` — so `.limit(10)` on a 10-million-document collection still allocates ten million records and keeps ten. `maxMatchedDocuments` and `.limit(n)` bound how many documents are _retained_, and the `_id` fast paths (equality, `$in`, bounded range) narrow the candidates through the index before any array is built; a filter with no `_id` predicate cannot. Lifting this requires a streaming read API in frostpillar-storage-engine, which the current version does not expose.

**Configuration:**

```ts
const db = new Database({ maxMatchedDocuments: 10_000 });
```

- `maxMatchedDocuments` must be a positive safe integer. Passing `0`, a negative number, or a non-integer throws `ConfigurationError`.
- If omitted, defaults to `DEFAULT_MAX_MATCHED_DOCUMENTS` (100,000).

**Behaviour during a scan (`find`, `update`, `remove`):**

- Each matched document (after TTL and filter evaluation) is counted against the cap.
- If the matched count exceeds `maxMatchedDocuments`, a `ValidationError` is thrown immediately with a message directing the caller to use `limit()`.
- For `find()` queries: when a `limit(n)` is specified without a `sort`, the effective cap is `max(n, maxMatchedDocuments)`. Because an explicit limit already bounds how many documents are buffered, a limit larger than the cap returns normally instead of throwing. The scanner still stops collecting after `n` documents. The strict `maxMatchedDocuments` cap applies to unbounded scans and to queries with a `sort` (a sort must collect all matching documents before ordering, so the limit hint is not applied at scan time).
- `count()` is **not** affected by this cap because it does not buffer documents (it uses `Datastore.count()` or iterates without materialising the result set).

## 12. Write-Path Input Isolation

Documents and update operands supplied by the caller are **deep-copied** on every write path. Once a write returns, the caller's object graph and the stored record share no references, so subsequent mutation of the caller's objects cannot alter stored data.

**Where copying happens:**

| Path                                  | Copied value                                                |
| ------------------------------------- | ----------------------------------------------------------- |
| `insert()` / `insertMany()` / upsert  | The whole document, including all nested objects and arrays |
| `update()` with `$set`                | Each assigned value                                         |
| `update()` with `$push` / `$addToSet` | Each value appended to the target array                     |

`$unset`, `$inc`, `$rename`, and `$pull` never place a caller-supplied object into the document — their operands are read-only (a field path, a finite number, or a deep-equality comparison value) — so no copy is made.

**Why this is required:** frostpillar-db always constructs the underlying `Datastore` with `skipPayloadValidation: true` (see [Spec 01 §1.1](./01-database-and-collection.md)), which also disables the storage engine's defensive copy of the payload. The object handed to the datastore therefore _becomes_ the stored record. Without isolation at the collection level, a caller mutating an inserted object after the fact would silently rewrite stored data, and injecting a cycle into it would make later reads throw `RangeError` from stack overflow instead of a clean error. See [ADR-025](../adr/025-write-path-input-isolation.md).

**Order:** the copy is taken **after** validation, so the validated graph and the copied graph are the same one and cannot diverge (a TOCTOU-style bypass). Because validation caps nesting at `maxDepth` on every path — including `skipPayloadValidation` mode — the recursive copy is bounded and cannot overflow the stack.

**Not covered:** documents _returned_ from reads (`find()`, `findOne()`, `watch()` events) are not copied; treat them as read-only snapshots.
