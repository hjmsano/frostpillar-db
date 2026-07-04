# ADR-003: Fluent Query API with Dollar-Sign Operators

- **Status:** Accepted
- **Date:** 2026-04-03
- **Deciders:** Hajime Sano

## Context

frostpillar-db needs a native JavaScript query API. The design must:

1. Be intuitive for JavaScript developers.
2. Align with SQL-like semantics so a future SQL translation layer can target it.
3. Support filtering, sorting, projection, pagination, and aggregation.

We evaluated two dominant patterns in the embedded database ecosystem:

**Pattern A — Object-based filter with `$` operators + method chaining:**

```ts
collection
  .find({ age: { $gt: 30 } })
  .sort({ name: 1 })
  .limit(10)
  .toArray();
```

**Pattern B — Pure object configuration:**

```ts
collection.find({ where: { age: gt(30) }, orderBy: 'name', limit: 10 });
```

## Decision

Adopt **Pattern A**: `$`-prefixed filter operators combined with a fluent method chain (ResultChain).

### Filter Operators

| Category   | Operators                                  |
| ---------- | ------------------------------------------ |
| Comparison | `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte` |
| Inclusion  | `$in`, `$nin`                              |
| Logical    | `$and`, `$or`, `$not`                      |
| String     | `$regex`                                   |
| Existence  | `$exists`                                  |
| Array      | `$elemMatch`, `$all`, `$size`              |

### Update Operators

| Operator    | Description               |
| ----------- | ------------------------- |
| `$set`      | Set field values          |
| `$unset`    | Remove fields             |
| `$inc`      | Increment numeric         |
| `$rename`   | Rename field keys         |
| `$push`     | Append value to array     |
| `$pull`     | Remove values from array  |
| `$addToSet` | Add unique value to array |

### Method Chain (ResultChain)

```
find(filter?) → ResultChain
  .sort(spec)    → ResultChain
  .limit(n)      → ResultChain
  .skip(n)       → ResultChain
  .project(spec) → ResultChain
  .toArray()     → Promise<Document[]>
  .cursor()      → AsyncGenerator<Document>
  .count()       → Promise<number>
  .sum(field)    → Promise<number>
  .avg(field)    → Promise<number>
  .min(field)    → Promise<number | null>
  .max(field)    → Promise<number | null>
  .distinct(field) → Promise<unknown[]>
  .groupBy(field, accumulators) → Promise<GroupResultEntry[]>
```

## Rationale

- **Ecosystem familiarity** — the `$` operator pattern is widely recognized in the JS ecosystem. Developers familiar with similar embedded databases can onboard quickly.
- **Composability** — method chaining allows incremental query construction; each step returns the same type, enabling conditional composition.
- **SQL alignment** — each chain method maps directly to an SQL clause: `find` → `WHERE`, `sort` → `ORDER BY`, `limit`/`skip` → `LIMIT`/`OFFSET`, `project` → `SELECT`, aggregation methods → `SUM()`, `AVG()`, etc.
- **Type safety** — TypeScript generics can flow through the chain, providing autocomplete and type checking.

## Consequences

### Positive

- Familiar API reduces learning curve.
- Future SQL parser can translate `SELECT ... WHERE ... ORDER BY ...` directly into chain calls.
- Each chain method is independently testable.

### Negative

- `$` operators require careful input validation to prevent injection of unexpected operators.
- Method chain must be lazy (deferred execution) to allow composition before terminal methods — adds internal complexity.
