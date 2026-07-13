# ADR-030: Read-Once Input Snapshots

## Status

Accepted

## Context

[ADR-025](./025-write-path-input-isolation.md) made the write path deep-copy caller input so that a stored record shares no reference with the caller's object graph. It copied **after** validating, and recorded that ordering as a feature: "the validated graph and the copied graph are the same one and cannot diverge (a TOCTOU-style bypass)".

That reasoning holds only for objects whose properties are plain data. It is false for any object that can *answer a read*:

- an accessor property (`{ get score() { … } }`) returns whatever it likes, on every read;
- a `Proxy` does the same through a `get` trap, and can also fake `getOwnPropertyDescriptor`, so screening for accessors does not help.

Every input the library takes was read more than once, and each read went back to the caller's object:

| Input | First read | Later reads |
| --- | --- | --- |
| Insert payload | `validateInsertPayload` / `validatePayloadSecurity` | `cloneDocument` in `toInsertPayload` |
| `$set` / `$push` / `$addToSet` value | `validateUpdateValue` | `cloneDocument` in `applySet` / `applyPush` |
| `$rename` / `$inc` / `$unset` entry | `normalizeUpdateOperations` | `applyRename` / `applyInc` / `applyUnset` |
| Filter | `validateFilter` | `matchesFilter`, once per candidate document |
| `_id: { $in: [...] }` operand | `extractIdInclusion` | `getMany`, then `deleteMany` — across an `await` |

So the second read decided what was stored, evaluated, or deleted, while the first read was the only one that was checked. Demonstrated: a payload getter stored a `bigint` no validator ever saw; a `$rename` destination getter re-read as `_createdAt` and defeated the `immutableCreatedAt` guard; an `$and` getter validated as a narrow filter and evaluated as a match-anything one, removing documents the validated filter never matched; and an `_id: { $in: [...] }` array mutated during `remove()`'s `await` deleted an extra document — past the validated size cap and with no `watch()` event, because it was absent from the candidate read.

The array case shows this is not only about getters: any caller-owned object still reachable from the library across an `await` is mutable behind its back.

## Decision

**Every caller-supplied input is read exactly once, into a snapshot the collection owns. Validation and use both operate on that snapshot; the caller's object is never read again.**

The copy therefore moves *before* validation, inverting ADR-025's ordering — the copy is what makes the check meaningful, not the other way round.

- **Insert payloads** — `materializePayload` (`payloadValidator.ts`) returns a detached deep copy built with one `Object.entries` read per object, and applies the security rules (reserved keys, cycles, `maxDepth`, plain-object, leaf types) to that single read. `validateInsertPayload` then walks the copy. `toInsertPayload` no longer copies: it is handed a graph the collection already owns.
- **Update operands** — `normalizeUpdateOperations` returns fresh operator maps holding one read per entry, with `$set`/`$push`/`$addToSet` values deep-copied by `materializeUpdateValue` in the same pass that validates them. A `$pull` operand is only ever compared, never written, so it is carried by reference (which also keeps a `RegExp` operand intact for `deepEqual`).
- **Filters** — `snapshotFilter` (`filterSnapshot.ts`) is applied at every `Collection` entry point (`find`, `findOne`, `count`, `update`, `remove`) before anything else touches the filter. `RegExp` operands are carried by reference (they are compiled once into a private copy by `getCachedRegex`); other non-plain objects are leaf comparison values that are never stored, so they too are carried by reference. Cycles and nesting past `maxDepth` throw `ValidationError` — a filter's operand values carry arbitrary caller structure, unlike the `$and`/`$or` nesting that `MAX_FILTER_NESTING_DEPTH` already caps.
- **`_id` `$in` fast path** — `extractIdInclusion` returns the validated ids in a new array, so `getMany` and `deleteMany` cannot see a different operand.

Two supporting rules fall out of this:

- **Non-storable leaf types are rejected on every path**, including under `skipPayloadValidation`: `bigint`, `function`, `symbol`, `undefined`. `function` and `symbol` are *reference* types that `cloneDocument` copies by reference, so accepting one stored an object the caller still owned — mutating it afterwards changed what later `find()` and `distinct()` calls returned. The reduced validator used to wave through every non-object leaf.
- **`"__proto__"` is copied as an own data property** (`defineOwnProperty` in `objectUtils.ts`). A plain assignment would set the copy's prototype instead of adding a key, silently swallowing the reserved-key `ValidationError` the caller is owed.

## Consequences

### Positive

- What was validated is what is stored, evaluated, and deleted. There is no second read for a getter or a `Proxy` to answer differently, and no caller-owned object left reachable across an `await`.
- The write path costs no more than before: it always took one deep copy of the payload, and that copy is now the validator's input rather than its output.
- `skipPayloadValidation` remains a *size*-check escape hatch, not a memory-safety one: aliasing and non-JSON leaves are rejected there too.

### Negative

- Reading a filter now costs one copy per query. Filters are small relative to the documents they are matched against, and the copy is taken once per call, not once per candidate document.
- The `WeakMap` caches keyed on operand array identity (`inclusionSetCache`, `operandAllPrimitiveCache`; [ADR-015](./015-weakmap-inclusion-set-cache.md)) no longer hit across calls, because each call snapshots its own operand array. Within one call the operand is stable, so the `Set` is still built once per scan and reused across every candidate document — which is where the benefit was. `RegExp` operands are carried by reference and so keep their cross-call cache.
- A filter whose operand nests deeper than `maxDepth` is now a `ValidationError` rather than a non-match.

### Rejected alternatives

1. **Reject accessor properties on caller input.** Rejected — a `Proxy` can present a data descriptor and still answer `get` differently, so the screen is not sound. It also breaks legitimate objects for no gain: a snapshot handles them correctly instead of refusing them.
2. **Freeze the caller's object.** Rejected — mutating the caller's argument is not the library's business, and `Object.freeze` neither stops a `Proxy` nor an accessor that returns a fresh value per call.
3. **Re-validate at the point of use.** Rejected — it doubles the validation cost on the hot path and still cannot make two reads agree; it narrows the window rather than closing it.
