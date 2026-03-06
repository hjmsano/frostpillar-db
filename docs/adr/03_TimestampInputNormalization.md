# ADR-03: Timestamp Input Normalization for User API

Status: Accepted  
Date: 2026-03-06

## Context

User-facing API should be convenient for application developers.
Using only epoch milliseconds (`number`) is precise but not ergonomic for manual queries and logs.
At the same time, Frostpillar requires deterministic behavior across environments.

## Decision

For user-facing API parameters that represent timestamps (`insert`, `select`):

- Accept `number | string | Date`.
- Keep canonical internal and returned record timestamp as epoch milliseconds (`number`).
- For `string`, accept only ISO 8601 date-time with timezone (`Z` or `+/-HH:MM`).
- Reject unsupported or ambiguous timestamp strings with `TimestampParseError`.
- Do not add external datetime dependencies (for example, moment.js) in v0.1.

## Consequences

Positive:

- Better DX for API consumers (ISO strings and `Date` are accepted).
- Deterministic storage/query semantics remain unchanged.
- Binary/page specs do not need changes.

Trade-off:

- API implementation must include strict normalization and validation logic.
- Additional test cases are required for accepted/rejected timestamp forms.
