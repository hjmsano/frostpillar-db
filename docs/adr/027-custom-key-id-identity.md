# ADR-027: `_id` Identity Under Custom Key Definitions

- **Status:** Accepted
- **Date:** 2026-07-12
- **Deciders:** Hajime Sano
- **Relates to:** [ADR-024](./024-collection-aware-driver-factory.md)

## Context

A collection may be created with a custom `key` definition (spec 01 §2.11), whose `normalize(value)` maps the `_id` the caller supplies onto the storage key the B+ tree indexes on. `normalize` is arbitrary user code and need not be injective: under the documented `normalize: (v) => Number(v)`, the `_id`s `"01"` and `"1"` collapse onto the same key `1`.

The query layer had two disagreeing notions of identity. The general path resolves a filter by loading candidate records and evaluating the filter against each **document**, so it compares `_id` by string equality. The `_id` fast paths instead trusted the **storage key** as the identity, and skipped the document check entirely. With only `_id: "01"` stored, that divergence was directly observable:

- `find({_id: "1"})` returned `[]` (document check) while `findOne({_id: "1"})` returned the `"01"` document (key lookup).
- `exists("1")` returned `true` — `datastore.has` answers about keys.
- `ids()` returned `[1]`, the normalized keys, violating its `Promise<string[]>` contract.
- `remove({_id: "1"})` deleted the `"01"` document via `datastore.delete(key)` and emitted a `remove` event carrying `"1"`, an `_id` that never existed.

The last one is data loss from a filter that matches nothing.

## Decision

`_id` is the document's string identity, always; the key definition governs storage layout and ordering only. Never the reverse: a key hit is a *candidate*, not a match.

Collections learn whether a custom key is configured (`CollectionContext.hasCustomKey`, set by `Database.collection()` from the resolved options), and each `_id` fast path is made key-definition-aware:

- **`findOne`** skips the `getFirst` shortcut and falls through to the general path, which still reaches the record through the key index but confirms `_id` per document.
- **`exists`** reads the record(s) at the key (`datastore.get`, which returns every record sharing it) and confirms the stored `_id`, instead of `datastore.has`.
- **`ids`** reads `_id` back off each payload instead of returning `datastore.keys()`.
- **`remove`** skips the delete-by-key fast path, so each candidate's `_id` is confirmed before `deleteById` and the emitted event carries the *stored* `_id`.
- **`_id` range filters** skip the `getRange` shortcut: the index walks in the key definition's order, which need not agree with the string order the filter is evaluated in (`"10"` lies inside the string range `"1".."3"` but outside the numeric one), so the shortcut can drop matches.

`_id` equality and `$in` candidate fetching keep using the key index even under a custom key: a queried `_id` normalizes to exactly the key its own record was stored under, so the index returns a superset, and the document check filters it.

Under the default (string) key definition none of this applies — key and `_id` are the same string — and every fast path stays exactly as it was.

## Alternatives Considered

1. **Make the fast paths compare normalized keys, so `find`/`findOne` both match `"01"` when asked for `"1"`.** Rejected — it makes `_id` equality depend on user code, so `_id` would no longer mean the same thing in a filter as in the document. `find({_id: "1"})` would return a document whose `_id` is `"01"`, and the `$in`/`$eq`/`$regex` operators would need to disagree with each other about `_id` while agreeing on every other field.
2. **Reject non-injective `normalize` at collection creation.** Rejected — injectivity is undecidable from a function reference, and probing it would mean calling user code on synthesized inputs.
3. **Forbid a custom `key` on collections at all.** Rejected — Date-ordered and composite keys are the feature's reason to exist (spec 01 §2.11).

## Consequences

### Positive

- One definition of `_id` identity across `find`, `findOne`, `exists`, `ids`, `remove`, and `update`; `ids()` honours its `Promise<string[]>` type.
- `remove` can no longer delete a document the filter does not match, and `watch()` never reports an `_id` that is not in storage.

### Negative

- On custom-key collections, `findOne` by `_id` costs a document decode on top of the index lookup, `exists` reads the payload instead of probing the key, `ids()` and `_id` range filters scan the collection, and `remove` by `_id` deletes per record rather than by key. Default-key collections — the overwhelmingly common case — are unaffected.

### Not covered

`duplicateKeys` continues to be enforced by the storage engine at the **key** level: `"01"` and `"1"` collide, so inserting both throws `DuplicateIdError` under `'reject'` and overwrites under `'replace'`. Keeping `normalize` injective over the stored `_id` strings avoids the question entirely; spec 01 §2.11 says so.
