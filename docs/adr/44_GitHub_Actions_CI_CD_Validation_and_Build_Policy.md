# ADR-42: GitHub Actions CI/CD Validation and Build Policy

Status: Accepted  
Date: 2026-03-07

## Context

Frostpillar requires a deterministic CI/CD gate for contributor pull requests and
default-branch integration. Current contributor workflow already mandates
`spec -> test -> implementation -> verification`, but repository automation policy
for PR and merge events was not yet fixed as a concrete architectural rule.

We need a policy that:

1. runs lint and test checks whenever a pull request is created or updated
2. runs the same checks plus delivery builds after changes are merged into the
   default branch
3. avoids accidental artifact publishing because release destinations are not yet in scope

## Decision

Adopt a single GitHub Actions workflow with event-aware gating.

- On `pull_request` (`opened`, `reopened`, `synchronize`, `ready_for_review`):
  run `pnpm check` and `pnpm test --run`.
- On `push` to the repository default branch:
  run `pnpm check`, `pnpm test --run`, `pnpm build`, and `pnpm build:bundle`.
- Determine the default branch dynamically through
  `github.event.repository.default_branch` so branch-renaming does not require
  workflow logic changes.
- Keep build outputs as workflow-local artifacts only; no external publish/deploy step
  is included in this policy.

Normative details are defined in
`docs/specs/13_DistributionDeliveryTracks.md` section 8.

## Consequences

Positive:

- pull requests receive fast quality feedback without unnecessary build cost
- default-branch merges validate both runtime quality and delivery artifact generation
- default-branch detection remains resilient to repository naming changes

Trade-off:

- pushes to non-default branches still trigger workflow runs with skipped jobs, which
  is acceptable for simpler and branch-name-agnostic policy management
