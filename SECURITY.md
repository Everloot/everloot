# Security

Please do not report security problems in public issues, discussions or Discord.

Report them privately through
[GitHub's private vulnerability reporting](https://github.com/Everloot/everloot/security/advisories/new),
or by email to hello@everloot.app with "Security" in the subject. Include what you found, how to
reproduce it, and what an attacker could do with it.

We will answer within a few days and keep you posted until it is fixed. Once a fix is live we are
happy to credit you, if you want.

In scope: everloot.app and its APIs, the MCP endpoints, the addon, the companion, the desktop
app and this repository. Please do not test against other players' data, run load tests against the site, or
use social engineering.

## Supported versions

| What | Supported |
|---|---|
| The site, everloot.app | What `main` serves; a merged fix is live a few minutes later |
| The addon | The newest `addon-v*` [release](https://github.com/Everloot/everloot/releases) |
| The desktop app | The newest `desktop-v*` [release](https://github.com/Everloot/everloot/releases) |

Older addon and desktop builds get the fix by updating. Nightly pre-releases are built from `main`
and are not supported on their own.

## What we run

- Every pull request and every push to `main` is scanned for leaked secrets (gitleaks, pinned and
  checksum-verified) and for private workspace paths, in the `Release checks` workflow
  ([`docs/WORKFLOWS.md`](docs/WORKFLOWS.md)).
- Dependabot opens weekly update pull requests for the npm packages in `web`, `kb`, `companion` and
  `packages/protocol` and for the GitHub Actions the workflows use (`.github/dependabot.yml`).
  Major versions are upgraded by hand. Dependabot security updates are enabled.
- CodeQL code scanning runs with GitHub's default setup on the Actions workflows, JavaScript and
  TypeScript, and Python, with the default query suite, on a weekly schedule.
- GitHub secret scanning with push protection is enabled on the repository.
