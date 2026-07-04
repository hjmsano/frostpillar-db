# CI/CD Strategy

## Overview

frostpillar-db uses GitHub Actions for continuous integration and release automation. All workflows run on `ubuntu-latest` with Node.js 24.x and pnpm.

## Workflows

### CI (`ci.yml`)

Runs on every push except version tags (`v*`).

| Step           | Command                                           |
| -------------- | ------------------------------------------------- |
| Install        | `pnpm install --frozen-lockfile`                  |
| Quality checks | `pnpm check` (typecheck + lint + test + textlint) |

The CI workflow is the quality gate — every branch must pass before merging.

### Release (`ci-release.yml`)

Runs on pushes to `main`. Uses [Release Please](https://github.com/googleapis/release-please) for automated versioning and changelog generation.

**Release Please phase:**

1. On each push to `main`, Release Please creates or updates a release PR with version bumps and changelog entries.
2. When the release PR is merged, Release Please creates a GitHub release with a version tag.

**Publish phase** (runs only when a release is created):

| Step                  | Details                                                         |
| --------------------- | --------------------------------------------------------------- |
| Quality checks        | `pnpm check`                                                    |
| Build                 | `pnpm build:all` (ESM + CJS + browser bundles)                  |
| GitHub release assets | Upload `frostpillar-db.min.js` and `frostpillar-db-core.min.js` |
| Publish to npm        | `pnpm publish --no-git-checks` via `NPM_TOKEN` secret           |

### Configuration Files

| File                            | Purpose                                                |
| ------------------------------- | ------------------------------------------------------ |
| `release-please-config.json`    | Release Please settings (release type, changelog path) |
| `.release-please-manifest.json` | Current version tracker                                |

## Branch Strategy

| Branch           | Purpose                                                                     |
| ---------------- | --------------------------------------------------------------------------- |
| `main`           | Stable branch. Release Please targets this branch.                          |
| `prep-*`         | Preparation branches for grouping related changes before merging to `main`. |
| Feature branches | Short-lived branches for individual features or fixes.                      |

## Package Registry

frostpillar-db and its dependencies are published to **npm** under the `@frostpillar` scope.

| Package                                   | Registry | Scope          |
| ----------------------------------------- | -------- | -------------- |
| `frostpillar-db`                          | npm      | — (unscoped)   |
| `@frostpillar/frostpillar-storage-engine` | npm      | `@frostpillar` |

## Required Secrets

| Secret         | Used by          | Purpose                                  |
| -------------- | ---------------- | ---------------------------------------- |
| `NPM_TOKEN`    | `ci-release.yml` | npm publish authentication               |
| `GITHUB_TOKEN` | Both workflows   | Checkout, release creation, asset upload |
