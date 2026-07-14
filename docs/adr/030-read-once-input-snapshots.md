# ADR-030: Read-Once Input Snapshots

## Status

Accepted

## Context

[ADR-025](./025-write-path-input-isolation.md) made the write path deep-copy caller input so that a stored record shares no reference with the caller's object graph. It copied **after** validating, and recorded that ordering as a feature: "the validated graph and the copied graph are the same one and cannot diverge (a TOCTOU-style bypass)".

That reasoning holds only for objects whose properties are plain data. It is false for any object that can *answer a read*:

- an accessor property (`{ get score() { … } }`) returns whatever it likes, on every read;
- a `Proxy` does the same through a `get` trap, and can also fake `getOwnPropertyDescriptor`, so screening for accessors does not help.

Several public inputs were read more than once, and each read went back to the caller's object:

| Input | First read | Later reads |
| --- | --- | --- |
| `DatabaseConfig` | Constructor validation | Lazy datastore creation and `hasCustomKey` selection |
| Insert payload | `validateInsertPayload` / `validatePayloadSecurity` | `cloneDocument` in `toInsertPayload` |
| Update operations and options | Entry-point checks | Normalization after an `await`, once per matched document and again for upsert |
| Filter | Root/structural validation | `matchesFilter`, once per candidate document |
| `_id: { $in: [...] }` operand | `extractIdInclusion` | `getMany`, then `deleteMany` — across an `await` |

So a later read could decide what was configured, stored, evaluated, or deleted even though an earlier read supplied the checked value. Demonstrated: an accessor-backed database `key` could configure the datastore with a custom normalizer but leave the collection on default-key fast paths; a payload getter stored a `bigint` no validator ever saw; update getters could change after the first `await` or between matched documents; an `$and` getter could validate as a narrow filter and evaluate as a match-anything one; and an `_id: { $in: [...] }` array mutated during `remove()`'s `await` deleted an extra document.

The array case shows this is not only about getters: any caller-owned object still reachable from the library across an `await` is mutable behind its back.

## Decision

**Configuration and per-operation data inputs are materialized at their owning public boundary. Each covered property is read once into an owned snapshot, and validation and use operate on that snapshot.** This contract covers `DatabaseConfig`, insert payloads, update operations/options, and filters; it is not a promise that user callbacks such as driver factories or key-definition functions are invoked only once.

The copy therefore moves *before* validation, inverting ADR-025's ordering — the copy is what makes the check meaningful, not the other way round.

- **Database configuration** — the constructor takes a shallow snapshot of the configuration's top-level own enumerable fields. An accessor or `Proxy` trap supplies one authoritative value for each captured field; later mutation of the caller's top-level config object does not alter the database. Nested configuration objects and callback functions remain shallow references. At collection creation, the effective key is resolved once (collection override when present, otherwise the captured database key), and that same value determines both the datastore configuration and whether custom-key identity safeguards are enabled.
- **Insert payloads** — `materializePayload` (`payloadValidator.ts`) returns a detached deep copy built with one `Object.entries` read per object and applies the always-on structural checks to that single read. `validateInsertPayload` then walks the copy. `toInsertPayload` is handed a graph the collection already owns.
- **Update operations and options** — `Collection.update()` captures `options.upsert` and normalizes the complete operation object before its first `await`. The resulting operator maps are the single operation set applied to every matched document and, when needed, to the upsert document. `$set`/`$push`/`$addToSet` values and `$pull` comparison operands are detached during normalization; per-document copies are still made for values written into more than one stored document.
- **Filters and comparison values** — `snapshotFilter` (`filterSnapshot.ts`) runs at every `Collection` entry point (`find`, `findOne`, `count`, `update`, `remove`) before validation, candidate lookup, or evaluation. The root must pass the plain-record requirement in the same materialization pass, so a `Proxy` cannot pass one root classification and later switch to another representation. Arrays are copied recursively; plain objects, class instances, and other object comparison values are represented by detached copies of their own enumerable shape; `Date` is copied by timestamp; and `RegExp` is copied from one read each of `source` and `flags` plus one recursive copy of each enumerable own property. Prototypes and object identity are not comparison semantics. Cycles and nesting past `maxDepth` throw `ValidationError`.
- **`_id` `$in` fast path** — `extractIdInclusion` returns the validated ids in a new array, so `getMany` and `deleteMany` cannot see a different operand.

Two supporting rules fall out of this:

- **Non-storable leaf types are rejected on every write path**, including under `skipPayloadValidation`: `bigint`, `function`, `symbol`, `undefined`. Functions are reference values that cannot be detached by `cloneDocument`; symbols are primitives, but neither functions nor symbols are supported document values. The reduced validator used to wave through every non-object leaf.
- **`"__proto__"` is copied as an own data property** (`defineOwnProperty` in `objectUtils.ts`). A plain assignment would set the copy's prototype instead of adding a key, silently swallowing the reserved-key `ValidationError` the caller is owed.

## Consequences

### Positive

- What was captured is what is configured, validated, stored, evaluated, and deleted. Covered input objects are not consulted again after their boundary snapshot.
- The write path costs no more than before: it always took one deep copy of the payload, and that copy is now the validator's input rather than its output.
- `skipPayloadValidation` remains a *size*-check escape hatch, not a memory-safety one: aliasing and non-JSON leaves are rejected there too.

### Negative

- Reading a filter and normalizing an update now costs one detached snapshot per call. The copy is taken once, not once per candidate or matched document.
- Identity-keyed `WeakMap` caches for array operands and `RegExp` operands no longer hit across separate calls, because each call owns new array and regular-expression objects. Within a scan, all candidate documents share the same snapshot, so inclusion sets and compiled regular expressions are still built once and reused for that scan. This intentionally partially supersedes [ADR-015](./015-weakmap-inclusion-set-cache.md).
- Database configuration is shallow-snapshotted. Mutating a nested configuration object that was captured by reference remains outside this decision.
- A filter whose operand nests deeper than `maxDepth` is now a `ValidationError` rather than a non-match.

### Rejected alternatives

1. **Reject accessor properties on caller input.** Rejected — a `Proxy` can present a data descriptor and still answer `get` differently, so the screen is not sound. It also breaks legitimate objects for no gain: a snapshot handles them correctly instead of refusing them.
2. **Freeze the caller's object.** Rejected — mutating the caller's argument is not the library's business, and `Object.freeze` neither stops a `Proxy` nor an accessor that returns a fresh value per call.
3. **Re-validate at the point of use.** Rejected — it doubles the validation cost on the hot path and still cannot make two reads agree; it narrows the window rather than closing it.
