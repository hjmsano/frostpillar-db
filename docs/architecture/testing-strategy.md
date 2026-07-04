# Testing Strategy

## Overview

frostpillar-db follows a strict SDD/TDD workflow: specs are written first, then tests, then implementation. All tests use Node.js built-in `node:test` and `node:assert` — no external test frameworks.

## Test Categories

### Unit Tests

Test individual components in isolation with in-memory Datastore (no driver).

| Component          | Scope                                                                                                 |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| Filter Evaluator   | Each `$` operator, dot notation, edge cases (type mismatch, missing fields)                           |
| Filter Utils       | Equality field extraction, \_id equality detection                                                    |
| Update Applier     | Each update operator (`$set`, `$unset`, `$inc`, `$rename`, `$push`, `$pull`, `$addToSet`), validation |
| Document Path      | Dot-notation path traversal, reserved key rejection                                                   |
| Database Lifecycle | Collection options persistence, closed-state behavior, list/drop behavior                             |
| Security           | Prototype pollution prevention, error message information leakage                                     |

### Integration Tests

Test the `Database` → `Collection` → `Datastore` flow with in-memory storage.

| Scenario                  | Coverage                                                     |
| ------------------------- | ------------------------------------------------------------ |
| Collection lifecycle      | Create, use, drop                                            |
| CRUD round-trip           | Insert → find → update → find → remove → find                |
| ResultChain + aggregation | Sort, skip, limit, projection, count/`sum`/`avg`/`min`/`max` |
| Document ID               | Auto-generated, user-provided, duplicate rejection           |

### Edge Case Tests

| Scenario                                         | Expected Behavior                          |
| ------------------------------------------------ | ------------------------------------------ |
| Empty collection                                 | `find().toArray()` → `[]`, `count()` → `0` |
| Filter on missing field                          | Predicate evaluates to `false`             |
| `$gt` on string field with number operand        | No match (no type coercion)                |
| Nested dot notation with non-object intermediate | No match                                   |
| `$regex` with invalid pattern                    | `ValidationError`                          |
| Operations after `close()`                       | `ClosedDatabaseError`                      |
| Insert with duplicate `_id`                      | `DuplicateIdError`                         |
| Update `_id` via `$set`                          | `ValidationError`                          |

## Test Structure

```
tests/
├── unit/
│   ├── database.test.ts
│   ├── document-path.test.ts
│   ├── filter-evaluator.test.ts
│   ├── filter-utils.test.ts
│   ├── security.test.ts
│   └── update-applier.test.ts
└── integration/
    ├── aggregation.test.ts
    ├── collection-crud.test.ts
    ├── collection-ttl.test.ts
    ├── collection-upsert.test.ts
    ├── collection-watch.test.ts
    ├── cursor.test.ts
    ├── groupby.test.ts
    └── result-chain.test.ts
```

## Running Tests

```bash
pnpm test              # Run all tests
pnpm test:coverage     # Run with coverage
```

## Coverage Targets

- **Line coverage:** >= 90%
- **Branch coverage:** >= 85%
- **All `$` operators** must have dedicated test cases for both matching and non-matching scenarios.
- **All error types** must have test cases that verify the error class and message.
