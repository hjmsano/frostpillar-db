# ADR-014: Strict Collection Option Re-Access

- **Status:** Accepted
- **Date:** 2026-04-09
- **Deciders:** Hajime Sano

## Context

`Database.collection(name, options?)` is the sole entry point for both creating and looking up collections. The original implementation (pre-ADR-014) treated bare lookup as lenient:

```ts
// Original behavior
db.collection('users', { duplicateKeys: 'allow' });
const users = db.collection('users'); // returned the 'allow' collection silently
```

The guard at `src/database.ts` only enforced option equality when the caller explicitly passed `options`:

```ts
if (
  options !== undefined &&
  existingOptions !== undefined &&
  !isSameCollectionOptions(existingOptions, resolvedOptions)
) {
  throw new ConfigurationError(...);
}
```

This created a silent-mismatch footgun: a lookup-style caller doing `db.collection('users')` with no options would receive whatever configuration the first caller had established — even when that configuration diverged from the defaults the lookup caller implicitly expected (`{ duplicateKeys: 'reject' }`, no `ttl`, no `capacity`, and so on). Bugs surfaced far from the cause: duplicate `_id` inserts would either fail or succeed depending on which codepath happened to initialize the collection first, and no error was raised at the lookup site.

A secondary problem: the `existingOptions !== undefined` guard was dead code. The create path at the same method always calls `this.collectionOptions.set(name, resolvedOptions)` atomically with `this.collections.set(name, collection)`, so whenever `this.collections.get(name)` returns a value, `this.collectionOptions.get(name)` is guaranteed to return one too. The guard obscured this invariant.

## Decision

Re-access enforces strict equality between every call's **resolved** options and the stored options. `resolved` means the output of `resolveCollectionOptions()`, which fills in defaults. There is no short-circuit for the `options === undefined` case.

```ts
const resolvedOptions = resolveCollectionOptions(options);
const existing = this.collections.get(name);
if (existing !== undefined) {
  const existingOptions = this.collectionOptions.get(name);
  if (
    existingOptions === undefined ||
    !isSameCollectionOptions(existingOptions, resolvedOptions)
  ) {
    throw new ConfigurationError(
      `Collection "${name}" was already created with different options.`,
    );
  }
  return existing as Collection<TDocument>;
}
```

### Behavioral consequences

| Call sequence                                                                                  | Before ADR-014             | After ADR-014                          |
| ---------------------------------------------------------------------------------------------- | -------------------------- | -------------------------------------- |
| `collection('x')` → `collection('x')`                                                          | same instance              | same instance                          |
| `collection('x', { duplicateKeys: 'reject' })` → `collection('x')`                             | same instance              | same instance (stored equals defaults) |
| `collection('x', { duplicateKeys: 'allow' })` → `collection('x')`                              | **same instance (silent)** | **`ConfigurationError`**               |
| `collection('x', { duplicateKeys: 'allow' })` → `collection('x', { duplicateKeys: 'allow' })`  | same instance              | same instance                          |
| `collection('x', { duplicateKeys: 'allow' })` → `collection('x', { duplicateKeys: 'reject' })` | `ConfigurationError`       | `ConfigurationError`                   |

Only the third row changes. `dropCollection(name)` still clears the stored options, so a subsequent `collection(name, ...)` can start fresh with any configuration.

## Rationale

- **Fail-fast over silent mismatch.** Lookup callers that pass no options are implicitly asserting "I expect a default-configured collection." If another call has pinned non-default options, that assertion is wrong and the caller should know immediately — at the lookup site, not at some later insert that behaves unexpectedly.
- **One rule, uniformly applied.** The lenient variant encoded two contracts in one API: "create" (enforce options) and "look up" (trust stored options). Users had to know which call was which. The strict rule collapses this to a single invariant: "the configuration you ask for must match what exists."
- **Aligns with the rest of the mismatch contract.** Every other option field (`ttl`, `capacity`, `index`, `autoCommit`, `key`) was already compared strictly when explicitly passed. `duplicateKeys` and friends are now compared consistently regardless of whether the second call omits the options bag.
- **`payloadLimits` is intentionally out of scope.** `payloadLimits` is a database-wide setting on `DatabaseConfig`, not a per-collection option. It is not part of `CollectionOptions` or `ResolvedCollectionOptions`, so it is never compared during collection re-access.
- **Matches the spec's intent.** `docs/specs/01-database-and-collection.md` §2.1 already documented "Calling it with different options throws `ConfigurationError`" — the old code under-enforced that contract by exempting the bare-lookup case. The spec text is updated in lockstep with this ADR.

## Consequences

### Positive

- Silent option-mismatch bugs are eliminated at the API boundary.
- The `collection()` method's re-access guard is simpler (one condition, one error path).
- Test coverage is now per-field (`ttl`, `capacity.maxSize`, `capacity.policy`, `index.maxLeafEntries`, deep-equal reference independence) which exercises the `isSame*` helpers directly.
- The dead `existingOptions !== undefined` guard is gone, making the create-path invariant explicit.

### Negative

- **Breaking API change.** User code that relied on bare-lookup semantics after configuring a non-default collection will throw `ConfigurationError`. Affected patterns:
  ```ts
  // Before: worked
  db.collection('logs', { duplicateKeys: 'allow' });
  // ...later, in unrelated code:
  const logs = db.collection('logs'); // now throws
  ```
- Callers must either (a) pass the same options on every access, (b) cache the `Collection` instance from the first call and reuse the reference, or (c) restrict bare lookup to collections whose stored options match defaults.

### Mitigation

- The error message (`Collection "<name>" was already created with different options.`) is the same one that already fired for explicit mismatches, so existing error-handling catches continue to work unchanged.
- The four lenient tests in `tests/unit/index-config.test.ts`, `tests/unit/custom-key.test.ts`, `tests/integration/collection-autocommit.test.ts`, and `tests/integration/collection-capacity.test.ts` have been inverted to assert the new throw behavior, serving as worked examples of the breaking change.
- Recommended migration pattern: store the `Collection` reference at creation time rather than re-looking it up. This is also slightly more efficient (no repeated map lookup + equality check).

## References

- `src/database.ts` — re-access guard in `Database.collection()`.
- `docs/specs/01-database-and-collection.md` §2.1 — updated wording.
- `tests/unit/database.test.ts` — per-field re-access coverage.
