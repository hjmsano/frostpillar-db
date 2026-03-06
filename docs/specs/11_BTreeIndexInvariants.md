# Spec: B+ Tree Index Invariants (v0.2 draft)

Status: Draft  
Version: 0.2  
Last Updated: 2026-03-06

This document defines normative B+ tree invariants for Frostpillar range queries.
It complements `docs/specs/03_PageStructure.md` and `docs/specs/01_RecordFormat.md`.

## 1. Scope

In scope:

- logical ordering key and duplicate timestamp handling
- tree balance and branch routing invariants
- node occupancy/split/merge invariants
- linked-leaf traversal invariants for range scan
- deterministic oldest-record lookup for turnover eviction

Out of scope:

- implementation-specific node capacity constants
- concurrency control for multi-writer environments

## 2. Tree Structure

- The tree consists of a single root node and zero or more child nodes.
- All leaf nodes (page type `0x01`) MUST be at the same depth (balanced).
- Branch nodes (page type `0x02`) act as navigational routers.

## 3. Logical Index Key

The B+ tree logical key MUST be a tuple:

```text
(timestamp_i64, insertion_order_u64)
```

Rules:

- `timestamp_i64` is signed and ordered ascending.
- `insertion_order_u64` is strictly increasing per inserted record and immutable.
- key comparison is lexicographic on tuple components.
- duplicate timestamps are allowed and ordered by `insertion_order_u64`.
- Every leaf record MUST persist both tuple components in encoded bytes
  (`TIMESTAMP_I64`, `INSERTION_ORDER_U64`) so key order can be reconstructed after restart/rewrite.

## 4. Node Types and Ordering

### 4.1 Intra-Node Ordering

- Keys within each node MUST be sorted by logical key order.

### 4.2 Branch Node Routing

- A branch node contains `N` routing cells and `N` child pointers via `(ChildPageID, SeparatorKey)`.
- Branch separator key for child `i` MUST equal the minimum key in child `i`.
- `SeparatorKey` MUST include both tuple components
  `(timestamp_i64, insertion_order_u64)` and MUST be encoded per
  `docs/specs/03_PageStructure.md` section 9.1.
- For each routing cell `(ChildPageID, SeparatorKey)`:
  - all keys in the subtree rooted at `ChildPageID` MUST be `>= SeparatorKey`
  - if there is a next routing cell with `NextSeparator`, subtree keys MUST be `< NextSeparator`

### 4.3 Leaf Node Linking

- Every leaf MUST maintain doubly linked neighbor pointers (`prev`, `next`).
- Leftmost leaf has no previous neighbor; rightmost leaf has no next neighbor.
- For any adjacent leaves `L` and `R` where `L.next = R`:
  - `maxKey(L) <= minKey(R)`
  - `R.prev = L`
- Linked-leaf chain MUST be acyclic.

## 5. Occupancy Invariants

Let `maxKeys` be implementation-defined for node type/page size.

- Non-root branch and leaf nodes MUST keep key count in `[ceil(maxKeys/2), maxKeys]`.
- Root node special cases:
  - if root is leaf: key count MAY be `0..maxKeys`
  - if root is branch: child count MUST be `>= 2` unless tree has one leaf total

## 6. Mutation Rules

### 6.1 Insertion

- New records are inserted into a leaf node selected by branch routing.
- If target leaf has space, insertion MUST preserve sorted logical key order.

### 6.2 Node Splitting (Overflow)

When a node (leaf or branch) cannot fit a new entry:

1. allocate a new sibling node
2. split entries between original and sibling (approximately balanced by count or size)
3. preserve sorted order in both nodes
4. promote/propagate separator for sibling using sibling minimum key

Additional requirements:

- for equal timestamps, split MUST preserve relative order by `insertion_order_u64`
- leaf `prev/next` pointers and parent routing update MUST preserve traversal correctness

### 6.3 Root Splitting

- If root overflows, a new branch root is allocated.
- Previous root and new sibling become children of new root.
- Tree height increases by 1.

### 6.4 Merge/Rebalance (Underflow)

On delete/eviction underflow:

- delete/eviction in this section refers to internal storage mutation paths
- v0.2 does not expose a public delete API even though internal eviction delete is required
- implementation MAY rebalance by borrow or merge
- post-rebalance tree MUST satisfy occupancy and linked-leaf invariants
- rebalance MUST NOT reorder logically surviving keys

## 7. Range Scan Contract

For `select({ start, end })`:

1. locate first key `>= (start, 0)`
2. iterate forward through leaf chain
3. stop after first key `> (end, +infinity)`

Returned rows MUST be ordered exactly by logical key order.

## 8. Turnover Oldest-Key Contract

For retention turnover (`policy: "turnover"`), oldest record selection MUST be deterministic:

- target key is always leftmost leaf first entry
- repeated eviction removes keys in ascending logical order

## 9. Consistency and Visibility

- In single-writer async execution, tree mutations MUST be atomic with respect to externally observable `await` boundaries.
- A `select` traversal MUST NOT observe partially applied split/merge states.
- During structural change, parent routing updates and leaf-link updates MUST result in a state that still satisfies section 4.3.

## 10. Corruption and Validation

Implementations MUST fail with typed storage/index error if invariants are violated at open-time validation or runtime integrity checks.

Required checks include:

- unbalanced leaf depth
- unsorted keys in node
- broken branch routing range contract
- broken `prev/next` leaf linkage
- impossible occupancy state outside root exceptions
