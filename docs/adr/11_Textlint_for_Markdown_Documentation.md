# ADR-11: Adopt textlint for Markdown Documentation

Status: Accepted  
Date: 2026-03-06

## Context

Frostpillar development is spec-driven and documentation-heavy.
The repository maintains architecture docs, specs, ADRs, and bilingual usage guides.
Prettier handles layout formatting, but prose-level consistency checks and fix support were not standardized.

## Decision

1. Introduce textlint for Markdown documents

- Use textlint as the repository standard for Markdown prose linting.
- Add scripts for check mode and fix mode.

2. Provide explicit Markdown formatting command

- Define `format:md` as an alias to textlint auto-fix command.

3. Integrate into quality gate

- Include Markdown lint check in `pnpm check`.

4. Avoid deprecated plugin dependencies

- Do not keep deprecated `textlint-plugin-markdown` in devDependencies.
- Keep Markdown linting configuration on the maintained textlint rule preset path.

## Consequences

Positive:

- Consistent prose quality across specs, ADRs, and usage docs.
- Deterministic auto-fix flow for supported rule set.
- Lower review overhead for documentation style issues.

Trade-off:

- Additional dev dependency maintenance.
- Occasional rule tuning required as document set grows.
