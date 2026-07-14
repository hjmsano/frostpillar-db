# ADR-025: Write-Path Input Isolation

- **Status:** Accepted
- **Date:** 2026-07-12
- **Deciders:** Hajime Sano
- **Relates to:** [ADR-012](./012-per-collection-datastore-isolation.md), [ADR-021](./021-first-last-accumulators.md)

## Context

`Database` constructs every per-collection `Datastore` with `skipPayloadValidation: true` so that validation runs once, at the collection level, instead of twice (see Spec 01 §1.1). That flag also disables the storage engine's defensive copy of the payload: the object frostpillar-db hands to `put` / `putMany` / `replaceById` **becomes** the stored record.

The collection write paths did not take a copy of their own:

- `toInsertPayload` shallow-spread the caller's document (`{ ...document, _id }`), so every nested object and array remained caller-owned.
- `$set` assigned its operand into the document by reference, and `$push` / `$addToSet` appended the operand by reference.

Stored records therefore aliased caller-owned object graphs. Consequences observed:

- Mutating an inserted object after `insert()` resolved silently rewrote the stored record — a write that never went through validation, TTL bookkeeping, or a change event.
- Injecting a cycle into such an object made subsequent `findOne()` throw a raw `RangeError` (stack overflow) from deep traversal, rather than the `ValidationError` the validator raises for cyclic input.

Validation of the input graph is not a defence here: the caller still holds the reference and can mutate it after validation has passed.

## Decision

Every user-facing write path **deep-copies** caller-supplied data into a graph the caller cannot reach:

- The whole document is deep-copied on `insert`, `insertMany`, and upsert.
- `$set` deep-copies each assigned value; `$push` and `$addToSet` deep-copy each value that enters the target array.
- `$unset`, `$inc`, and `$rename` place no caller-supplied object into the document. `$pull` also writes no operand, but its comparison value is detached so one update call evaluates one stable value across every matched document (ADR-030).

> **Superseded in part by [ADR-030](./030-read-once-input-snapshots.md).** This ADR took the copy **after** validation and argued that the validated graph and the copied graph were therefore the same one. That holds only for objects whose properties are plain data: an accessor property (or a `Proxy` `get` trap) answers each read differently, so validating the caller's object and then re-reading it to copy let the second read supply a value the first never saw. The copy now runs **first**, in the same pass that validates it (`materializePayload`, `materializeUpdateValue`), and every later stage reads only the copy. The isolation guarantee below is unchanged — it is the ordering that was wrong.

`cloneDocument` (`objectUtils.ts`) is reused rather than `structuredClone`: documents are validated as JSON-safe (no `Date`, `Map`, `Set`, class instances, or `bigint`), so the full structured-clone algorithm is unnecessary overhead. Its recursion is safe because validation caps nesting at `maxDepth` on every path, including `skipPayloadValidation` mode.

## Alternatives Considered

1. **Drop `skipPayloadValidation: true` and let the storage engine copy.** Rejected — it restores double validation on every write, including internal re-inserts under the `'replace'` duplicate-key policy, and makes correctness depend on an engine-internal detail rather than an explicit contract here.
2. **Freeze the input (`Object.freeze`) instead of copying.** Rejected — it mutates caller-owned objects (a visible side effect on data the library does not own) and only throws in strict mode; nested freezing costs a full traversal anyway.
3. **Document "do not mutate what you insert" and copy nothing.** Rejected — silent stored-data corruption and a `RangeError` on read are not acceptable outcomes of an ordinary caller mistake.
4. **Copy on read instead of on write.** Rejected — it does not stop the corruption (the stored record is already aliased) and taxes the read path, which is the hot one.

## Consequences

### Positive

- Stored records are unreachable from caller code once a write returns; post-write mutation of the input cannot corrupt the database.
- The library-level guarantee now matches what Spec 02 §1 already promised ("clone the document").
- A cycle injected after a write can no longer turn a later read into a `RangeError`.

### Negative

- Writes cost one deep copy of the payload (insert) or of the operand (`$set`/`$push`/`$addToSet`). For documents within the default `payloadLimits` (1 MB, depth 64) this is bounded and dominated by the storage write itself. Callers inserting many large documents pay for a copy they previously got for free — at the cost of aliasing.
- `update()` already deep-copied the target document before applying operators, so the operand copy is the only added work on that path.

### Also copied on read

Documents **returned** from reads are copies too, not references to the stored record: `find()`/`cursor()`/`toArray()` and `findOne()` deep-copy each document they yield, and `watch()` deep-copies the document once per event (all listeners of that event share that one copy). A caller may mutate what a read returns without touching stored data. Aggregation results are defensively copied as well — for the value accumulators by ADR-021/ADR-023, and for `distinct()` values and `groupBy()` `_key` values by [ADR-026](./026-aggregation-result-isolation.md).

An earlier revision of this ADR listed the read path as *not covered* and told callers to treat results as read-only references. That was never true of the shipped implementation, which has always cloned on read.
