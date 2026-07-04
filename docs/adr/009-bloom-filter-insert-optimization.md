# ADR-009: Bloom Filter Insert Optimization

- **Status:** Superseded by [ADR-012](./012-per-collection-datastore-isolation.md)
- **Date:** 2026-04-03
- **Deciders:** Hajime Sano

## Context

When a collection uses the `'reject'` duplicate key policy, every `insert()` call performs a `datastore.has(key)` lookup to check whether the document ID already exists. This requires a B+ tree traversal for each insert, which becomes expensive at scale.

Most inserts use unique IDs (especially auto-generated UUIDs), so the vast majority of `has()` calls return `false`. A probabilistic filter can eliminate these unnecessary lookups.

## Decision

Add an in-memory Bloom filter that guards the `has()` call in the `'reject'` insert path. The Bloom filter is:

- **Created lazily** on the first `'reject'` insert, populated from existing collection keys.
- **Consulted before `has()`** -- if the filter says "definitely not present", the `has()` call is skipped entirely.
- **Updated on successful insert** -- newly inserted IDs are added to the filter.
- **Not updated on remove** -- standard Bloom filters do not support deletion. After removals, the filter may produce more false positives, but correctness is unaffected because the `has()` fallback always runs on "maybe present" responses.

### Hash strategy

Two independent hash functions (FNV-1a 32-bit and a Murmur-inspired variant) combined via double hashing: `h(i) = (h1 + i * h2) % m`.

### Sizing

- Default expected items: `max(existingCount * 2, 1000)`
- Default false positive rate: 1%
- Memory overhead: approximately 1.2 KB per 1,000 expected items at 1% FPR

## Rationale

- **No false negatives** -- The Bloom filter never incorrectly reports "not present" for an item that was added. This guarantees the `DuplicateIdError` is still thrown for actual duplicates.
- **Zero external dependencies** -- FNV-1a and double hashing are simple to implement from scratch.
- **Opt-in by policy** -- Only `'reject'` collections create a Bloom filter. `'allow'` and `'replace'` policies are unaffected.
- **Graceful degradation** -- Even if the filter becomes saturated (many removals, or more items than expected), correctness is preserved. Performance simply converges to the pre-optimization behavior.

## Consequences

### Positive

- Reduces B+ tree lookups for the common case of inserting unique IDs into `'reject'` collections.
- Negligible memory overhead for typical collection sizes.
- No behavioral change -- the optimization is transparent to callers.

### Negative

- Additional memory consumption proportional to expected collection size.
- First insert on a `'reject'` collection pays a one-time cost to scan existing keys and populate the filter.
- After many removals, false positive rate increases (more `has()` calls), but never exceeds pre-optimization performance.
