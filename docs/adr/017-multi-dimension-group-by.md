# ADR-017: Multi-Dimension `groupBy`

- **Status:** Accepted
- **Date:** 2026-07-11
- **Deciders:** Hajime Sano

## Context

`ResultChain.groupBy(field: string, accumulators: GroupAccumulators)` groups documents by a single field path. Callers needing a composite grouping (e.g. count by `department` **and** `address.city`) have no direct way to express it — they must either call `.groupBy()` once per dimension and cross-join the results themselves, or fold the dimensions into one derived field before grouping. Both workarounds sit outside the query API and lose the single-scan, in-memory aggregation model the rest of `ResultChain` relies on.

The existing implementation (`src/internal/aggregationUtils.ts`) already provides the two building blocks a composite key needs:

- `validateFieldPath` — eager field-path validation (non-empty string, no `__proto__`/`constructor`/`prototype` segments, max depth, max length), already applied to the single `field` argument.
- `serializeGroupKey` — a type-aware serializer that maps a resolved value to a string key, keeping `"123"` (string) and `123` (number) in distinct groups, and treating `null`/missing fields uniformly.

Per ADR-005, all aggregation, including `groupBy`, runs as a single in-memory scan over the filtered document set — there is no storage or index layer involved. A composite-key extension is therefore a change to the in-memory grouping logic only.

## Decision

Generalize the `field` parameter to `string | string[]`:

```ts
groupBy(field: string | string[], accumulators: GroupAccumulators): Promise<GroupResultEntry[]>
```

- **String form is unchanged.** Existing behavior, including `_key` being the raw scalar group value, is preserved exactly for backward compatibility.
- **Array form** groups by the combination of all listed field paths:
  - Each element undergoes the same eager `validateFieldPath` check already used for the string form.
  - The array must be non-empty; duplicate field paths in the array are rejected as a `ValidationError`.
  - `_key` becomes an object `{ [fieldPath]: value, ... }`, one property per requested path, keyed by the **literal path string** (e.g. `'address.city'` is one property, not a nested `address: { city }` structure) and ordered per the caller's array order — except that JavaScript enumerates integer-like path keys (e.g. `'0'`, `'2024'`) ahead of other keys regardless of insertion order, so callers should access `_key` properties by name rather than relying on enumeration order.
  - A document missing one of the fields contributes `null` for that dimension only, consistent with the existing single-field "missing field → `null`" rule.
  - A single-element array (`['dept']`) still yields an object `_key` (`{ dept: ... }`); it is not collapsed to the scalar form. Callers who want a scalar `_key` continue to use the string form.
- **Per-dimension type-aware serialization.** Each dimension's resolved value is passed through the existing `serializeGroupKey` independently, then the per-dimension serialized parts are combined into one collision-free composite key via `JSON.stringify` of the ordered array of parts. This is an implementation detail; the observable guarantee the spec commits to is: type-aware equality per dimension, and no cross-dimension collisions (a value in dimension 1 can never be confused with a value in dimension 2 that happens to serialize the same way).
- The existing `MAX_GROUP_COUNT` (100,000 distinct groups) and `MAX_GROUP_DOCUMENTS` (100,000 docs/group) limits apply unchanged to the composite-key case.
- No new exported types. `GroupResultEntry._key` is already typed `unknown`, so no type change is needed to carry either a scalar or a composite-key object. `GroupAccumulators` is unchanged — accumulators apply to the group's documents exactly as before, independent of how many dimensions produced the group.

### Rejected alternatives

- **Separate `groupByMany(fields: string[], ...)` method.** Rejected: it forks the API surface for what is a single conceptual operation (grouping), forces callers to choose a method based on arity, and doubles the surface area to document, test, and maintain. Overloading `field` on the existing method keeps one call site and is a strict superset of the old signature.
- **Nested `_key` objects for dot-path elements** (e.g. `groupBy(['address.city'], ...)` producing `_key: { address: { city: ... } }`). Rejected: it re-parses the dot notation into a structure the caller didn't ask for, is inconsistent with how every other dot-path field in this codebase is treated as an opaque path string (not a navigation instruction) once resolved, and would make `_key` shape depend on how many segments a path has rather than how many fields were requested. Keying by the literal path string is simpler and matches `distinct()`'s and `sort()`'s treatment of dotted paths as flat identifiers.
- **Collapsing single-element arrays to the scalar form.** Rejected: it makes the shape of `_key` depend on the *length* of the array at call time rather than on which overload (string vs. array) the caller chose, which is a surprising, silently-branching return type. Keeping the array form always object-shaped means `_key`'s shape is fully determined by the static type of the `field` argument.

## Consequences

### Positive

- Backward compatible: every existing call to `.groupBy(field: string, ...)` is unaffected; no behavior, type, or error-handling change for the string form.
- No storage or index changes — consistent with [ADR-005](./005-scan-based-query-execution.md); the composite key is computed entirely within the existing single-scan aggregation step.
- Reuses existing validation (`validateFieldPath`) and serialization (`serializeGroupKey`) building blocks rather than introducing parallel logic.
- Closes a real gap (composite grouping) without adding a new method or new exported types.

### Negative

- `groupBy`'s `field` parameter and `_key` result shape are now polymorphic (`string | string[]` in, scalar-or-object out), which callers must branch on if they call `.groupBy()` generically across both forms.
- Slightly more validation surface: empty array, invalid element, and duplicate-path checks are new `ValidationError` conditions callers must be aware of.

### Future Considerations

- If a future need arises for mixed scalar/object `_key` shapes to be distinguishable at the type level (e.g. via a generic overload signature), that can be layered on without changing runtime behavior described here.
