# Usage: Markdown Linting with textlint

Status: Draft  
Last Updated: 2026-03-06

This guide explains how to run Markdown lint and auto-fix in Frostpillar.

## 1. Check Markdown Files

```bash
pnpm textlint
```

This command scans all `*.md` files in the repository and reports rule violations.

## 2. Auto-Fix Markdown Files

```bash
pnpm textlint:fix
```

For convenience, you can use:

```bash
pnpm format:md
```

Both commands apply textlint auto-fix where rules support safe fixes.

## 3. Quality Gate

`pnpm check` includes Markdown lint verification through `pnpm textlint`.

