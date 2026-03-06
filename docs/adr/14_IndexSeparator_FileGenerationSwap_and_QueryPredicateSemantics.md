# ADR-14: Clarify Index Separator Encoding, File Commit Activation, and Query Predicate Semantics

Status: Accepted  
Date: 2026-03-06

## Context

Spec review identified four ambiguity risks that could cause implementation divergence:

- branch routing keys did not define how duplicate timestamps are disambiguated at byte level
- file durable commit protocol could expose data/metadata mismatch during crash timing
- typed corruption errors were required by lower-level specs but not mapped in API taxonomy
- SQL/Lucene parity requirement lacked explicit type/null/missing predicate semantics

## Decision

Adopt the following normative clarifications across specs:

1. Branch separator key encoding

- Update `docs/specs/03_PageStructure.md` to define branch cell key as fixed tuple bytes:
  `(SeparatorTimestampI64, SeparatorInsertionOrderU64)`.
- Require lexicographic tuple comparison and prohibit reusing record-level TLV envelope for this internal key.
- Update `docs/specs/11_BTreeIndexInvariants.md` to require both tuple components in separator keys.

2. File durable commit activation

- Update `docs/specs/10_FlushAndDurability.md` to generation-swap flow:
  write generation file first, then atomically switch sidecar pointer last.
- Extend sidecar schema with `activeDataFile` and make sidecar the only activation source.
- Forbid auto-selecting orphan generations and require typed corruption error when sidecar points to invalid active generation.

3. API error taxonomy mapping

- Update `docs/specs/04_DatastoreAPI.md` with explicit typed corruption classes:
  `BinaryFormatError`, `PageCorruptionError`, `IndexCorruptionError`
  as storage-engine error subtypes.

4. Query predicate semantics parity

- Extend `NativeComparisonOperator` with `exists` and `not_exists`.
- Update `docs/specs/05_QueryEngineContract.md` with strict no-coercion comparison rules,
  and explicit null/missing/exists semantics.
- Align `docs/specs/06_SQLSubset.md` and `docs/specs/07_LuceneSubset.md` to those rules,
  including mapping `field:*` to `exists`.

## Consequences

Positive:

- removes critical ambiguity for duplicate-timestamp B+ tree routing
- closes file commit crash window by pointer-last activation
- unifies error reporting contract for corruption cases
- prevents SQL/Lucene behavioral drift in mixed-type and missing/null predicates

Trade-off:

- file durable backend now requires generation-file management and cleanup policy
- query module implementations must follow stricter predicate semantics and new operator mapping
