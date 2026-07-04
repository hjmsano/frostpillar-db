# Contributing to Frostpillar DB

Thanks for your interest in contributing. This guide covers project setup, the
development workflow, and the conventions we follow.

By participating, you agree to abide by our
[Code of Conduct](./CODE_OF_CONDUCT.md).

## Prerequisites

- **Node.js** `>= 24.0.0`
- **pnpm** `>= 10.0.0` (enable with `corepack enable`)

## Getting Started

```bash
git clone https://github.com/hjmsano/frostpillar-db.git
cd frostpillar-db
pnpm install
pnpm check   # typecheck + lint + tests + Markdown lint
```

## Development Commands

| Command              | Description                                          |
| -------------------- | --------------------------------------------------- |
| `pnpm check`         | Type check, lint, tests, and textlint (run pre-PR)  |
| `pnpm test`          | Run the test suite                                  |
| `pnpm test:coverage` | Run tests with coverage                             |
| `pnpm typecheck`     | Type-check only                                     |
| `pnpm lint`          | Run ESLint                                          |
| `pnpm format`        | Format sources with Prettier                        |
| `pnpm textlint`      | Lint Markdown documents                             |
| `pnpm build`         | Build ESM + CJS + type declarations                 |
| `pnpm build:all`     | Build everything, including the browser bundles     |
| `pnpm bench`         | Run benchmarks                                       |

## Development Workflow (SDD/TDD)

This project follows a spec-driven, test-driven workflow:

1. **Spec** — add or update a spec in [`docs/specs/`](./docs/specs/) before
   implementing user-facing behavior.
2. **Test** — write or update tests in [`tests/`](./tests/) before the
   implementation.
3. **Code** — implement the minimal logic needed to make the tests pass.
4. **Verify** — run `pnpm check` and confirm everything is green.

Record architectural decisions as ADRs in [`docs/adr/`](./docs/adr/).

## Coding Standards

- **TypeScript strict mode.** Annotate every function signature. Never use
  `any` — `@typescript-eslint/no-explicit-any` is an error.
- **Named exports only.** No `default` exports.
- **Minimal runtime dependencies.** Only the Frostpillar package family is
  permitted as a runtime dependency; everything else belongs in
  `devDependencies`.
- **Keep both READMEs in sync.** User-facing changes must update
  [`README.md`](./README.md) (English) and [`README-JA.md`](./README-JA.md)
  (Japanese).
- Keep units small. ESLint warns past 50 lines per function and 300 lines per
  file (test files are exempt).

## Commit Messages — Conventional Commits

Releases are automated with
[release-please](https://github.com/googleapis/release-please), which derives
versions and the changelog from commit history. **Commits on `main` must follow
[Conventional Commits](https://www.conventionalcommits.org/):**

```
<type>[optional scope]: <description>
```

Common types:

| Type                                                        | Release effect | Use for                    |
| ----------------------------------------------------------- | -------------- | -------------------------- |
| `feat`                                                      | minor bump     | New user-facing capability |
| `fix`                                                       | patch bump     | Bug fix                    |
| `docs`, `refactor`, `perf`, `test`, `build`, `ci`, `chore` | no version bump | Supporting changes         |

While the package is pre-1.0, breaking changes bump the **minor** version. Mark
them with `!` (for example `feat!: ...`) or a `BREAKING CHANGE:` footer.

Examples:

```
feat(collection): add range query support
fix(filter): correct $in evaluation for nested arrays
docs: clarify TTL behavior in the README
```

## Pull Requests

1. Branch from `main`.
2. Make sure `pnpm check` passes locally.
3. Add or update tests and documentation for your change.
4. Fill out the pull-request template, including breaking-change notes and any
   linked issues.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](./LICENSE).
