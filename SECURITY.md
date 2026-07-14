# Security Policy

## Supported Versions

Frostpillar DB is in the 1.x release line. Security fixes are released only
against the latest published version. Pin your dependency and review the
[Releases](https://github.com/hjmsano/frostpillar-db/releases) page before
upgrading.

| Version        | Supported |
| -------------- | --------- |
| Latest `1.x`   | ✅        |
| Older releases | ❌        |

## Reporting a Vulnerability

**Please do not open a public issue for security vulnerabilities.**

Report privately through GitHub's
[private vulnerability reporting](https://github.com/hjmsano/frostpillar-db/security/advisories/new):

1. Open the **Security** tab of the repository.
2. Click **Report a vulnerability**.
3. Describe the issue, the affected versions, and a minimal reproduction.

If private reporting is unavailable, contact the maintainer listed on the
repository profile instead.

We aim to acknowledge reports within **5 business days** and to share a
remediation timeline after triage. Please allow a reasonable disclosure window
before publishing details.

## Scope

Frostpillar DB processes application-controlled documents and queries. The
following classes of issue are in scope:

- Prototype-pollution through document keys, filters, or update operators.
- Denial-of-service through payloads that bypass the configured payload limits
  (depth, size, or key counts).
- Data-integrity defects that corrupt stored documents or indexes.

The following are out of scope:

- Behavior when `skipPayloadValidation` is explicitly enabled. This opt-out
  trades validation for throughput and assumes trusted input.
- Resource exhaustion caused by payload limits the application deliberately
  raised above the safe defaults.
- Vulnerabilities in the underlying `@frostpillar/frostpillar-storage-engine` or
  `@frostpillar/frostpillar-btree` packages. Report those to their respective
  repositories.
