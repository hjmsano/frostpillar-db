# Spec: Documentation Linting with textlint (v0.1)

Status: Draft  
Version: 0.2  
Last Updated: 2026-03-06

This document defines Markdown linting and auto-fix behavior for repository documentation.

## 1. Scope

- Target files are all `*.md` files under the repository root.
- Linting scope includes architecture docs, specs, ADRs, usage guides, and `README.md`.

## 2. Commands

- `pnpm textlint` MUST run Markdown linting in check mode (non-fix).
- `pnpm textlint:fix` MUST run Markdown linting with auto-fix enabled.
- `pnpm format:md` MUST be an alias of `pnpm textlint:fix`.

## 3. Rule Baseline

- textlint configuration MUST be stored in a repository-level config file.
- Rule set MUST prioritize technical writing consistency for bilingual docs (English/Japanese).
- Auto-fix capable rules SHOULD be enabled where safe and deterministic.
- Deprecated textlint plugins MUST NOT be used.
- Markdown linting MUST run without relying on deprecated `textlint-plugin-markdown`.

## 4. Ignore Policy

- A repository-level ignore file MUST exclude generated/dependency directories such as:
  - `node_modules/`
  - `dist/`
- Ignore policy MAY be extended when generated Markdown is introduced.

## 5. CI/Quality Gate Integration

- `pnpm check` SHOULD include `pnpm textlint` so Markdown quality is validated with type/lint checks.
