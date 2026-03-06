# Specifications Directory Index

This directory contains the detailed technical specifications for each feature and component of the Frostpillar database. These documents are the source of truth for implementation.

| File                                                           | Description                                                                                                 |
| :------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------- |
| [**01_RecordFormat.md**](./01_RecordFormat.md)                 | Defines the canonical in-memory data structure for a single timeseries record.                              |
| [**02_BinaryEncoding.md**](./02_BinaryEncoding.md)             | Specifies the Type-Length-Value (TLV) binary format for serializing records to storage.                     |
| [**03_PageStructure.md**](./03_PageStructure.md)               | Details the binary layout of a "Page," the fundamental fixed-size unit of storage.                          |
| [**04_DatastoreAPI.md**](./04_DatastoreAPI.md)                 | Outlines the public API contract for the `Datastore` class, the sole entry point for all user interactions. |
| [**05_QueryEngineContract.md**](./05_QueryEngineContract.md)   | Defines the contract between Frostpillar core and optional query-engine modules.                            |
| [**06_SQLSubset.md**](./06_SQLSubset.md)                       | Specifies the SQL subset language engine behavior and compatibility boundaries.                             |
| [**07_LuceneSubset.md**](./07_LuceneSubset.md)                 | Specifies the Lucene-style subset query language and supported semantics.                                   |
| [**08_DocumentationLinting.md**](./08_DocumentationLinting.md) | Defines documentation linting requirements and operational rules with textlint.                             |
| [**09_CapacityAndRetention.md**](./09_CapacityAndRetention.md) | Defines bounded-size behavior, strict limits, and turnover policies.                                        |
| [**10_FlushAndDurability.md**](./10_FlushAndDurability.md)     | Defines flush triggers, auto-commit scheduling, and crash-safe durability protocols.                        |
| [**11_BTreeIndexInvariants.md**](./11_BTreeIndexInvariants.md) | Defines structural invariants and split/merge rules for the B+ Tree index.                                  |
| [**12_DevelopmentWorkflow.md**](./12_DevelopmentWorkflow.md)   | Defines mandatory phase-gate collaboration workflow (intent, spec, tests, implementation, verification).   |
