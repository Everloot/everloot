# Workflows

Every file in `.github/workflows/`, what starts it, what it writes and what a red run means. The facts
come from the files themselves; when a file and this page disagree, the file is right and this page
needs a fix. Secrets and repository variables are named here, never their values.

Most scheduled workflows run only in `Everloot/everloot` (`if: github.repository == ...`), so a fork
does not post to Discord, open pull requests or hit the site from its own copy.

## The table

| File | Trigger | What it writes | Explained in |
|---|---|---|---|
| [`build-watch.yml`](../.github/workflows/build-watch.yml) | `7,37 * * * *`, manual | One pull request per new game build from a `game-build/*` branch; a failure issue after two red scheduled runs | [`BUILD_WATCH.md`](BUILD_WATCH.md) |
| [`changes.yml`](../.github/workflows/changes.yml) | `7,37 * * * *`, manual | A rolling pull request from `data/changes`, which it merges itself when every check passes | [`2026-10-20-blue-tracker-live.md`](design/specs/2026-10-20-blue-tracker-live.md) |
| [`checks.yml`](../.github/workflows/checks.yml) | Every pull request, push to `main`, manual | Nothing | [`../CONTRIBUTING.md`](../CONTRIBUTING.md) |
| [`deploy-worker.yml`](../.github/workflows/deploy-worker.yml) | `Release checks` completed on `main`, manual | The live site (Cloudflare Worker) | [`2026-10-28-cloudflare-workers-migration.md`](2026-10-28-cloudflare-workers-migration.md) |
| [`desktop-release.yml`](../.github/workflows/desktop-release.yml) | Tag `desktop-v*`, manual (dry run) | A GitHub release with the installers and `SHA256SUMS` | [`../desktop/README.md`](../desktop/README.md#release) |
| [`discord-bridge.yml`](../.github/workflows/discord-bridge.yml) | `*/10 * * * *`, issues, release, discussion, push to `main`, `pull_request_target`, manual | Discord posts; GitHub issues mirrored from `#bug-reports` | [`2026-10-28-maintainer-access-and-support.md`](design/specs/2026-10-28-maintainer-access-and-support.md) |
| [`ecosystem.yml`](../.github/workflows/ecosystem.yml) | `23 */6 * * *`, manual | A rolling pull request from `data/ecosystem`; never merges | [`2026-10-18-ecosystem-tracker.md`](design/specs/2026-10-18-ecosystem-tracker.md) |
| [`mcp-image.yml`](../.github/workflows/mcp-image.yml) | Manual | The `everloot-mcp` container image on GitHub Container Registry | [`2026-10-16-open-source-everloot.md`](design/plans/2026-10-16-open-source-everloot.md) |
| [`nightly.yml`](../.github/workflows/nightly.yml) | `17 6 * * *`, manual | A `nightly-*` pre-release of the addon; deletes all but the newest five | [`RELEASING.md`](RELEASING.md#nightly) |
| [`pr-title.yml`](../.github/workflows/pr-title.yml) | Pull request opened, edited, reopened, synchronized | Nothing | [`RELEASING.md`](RELEASING.md#pull-request-titles) |
| [`protocol-publish.yml`](../.github/workflows/protocol-publish.yml) | Tag `protocol-v*` | `@everloot/protocol` on npm and a GitHub release | [`RELEASING.md`](RELEASING.md#protocol-everlootprotocol) |
| [`release.yml`](../.github/workflows/release.yml) | Tag `addon-v*` | A GitHub release with the addon zip and `SHA256SUMS`; the CurseForge upload | [`RELEASING.md`](RELEASING.md#stable-release) |
| [`site-health.yml`](../.github/workflows/site-health.yml) | `7,22,37,52 * * * *`, manual | A `site-down` issue, or a comment on the open one | [`2026-10-28-cloudflare-workers-migration.md`](2026-10-28-cloudflare-workers-migration.md) |
| [`spot-check.yml`](../.github/workflows/spot-check.yml) | `41 3 * * 1` (Mondays), manual | A rolling pull request from `data/spot-check`; never merges | [`2026-10-21-coverage-plateau-design.md`](design/specs/2026-10-21-coverage-plateau-design.md) |

"Manual" is `workflow_dispatch`: Actions > the workflow > Run workflow, or `gh workflow run <file>`.
Cron times are UTC.

## Each workflow

### Game build watch (`build-watch.yml`)

- **Trigger.** `7,37 * * * *`, and by hand with two inputs: `product` (Blizzard product ids, empty for
  the list in `kb/lists/build-watch.yaml`) and `redo` (refresh the open pull request, or reopen a
  build whose pull request was closed without merging). One run at a time.
- **What it does.** Checks Blizzard's public CDN for a new WoW: Forever build. When there is one, it
  reads the build, regenerates the game data and opens or updates one pull request per build from a
  `game-build/<product>-<build>-<hash>` branch. It never merges. The pull request body lists which
  player questions the new build answers differently. With a model configured, a separate job scores
  written answers on the new files and comments the scores on the pull request. No job holds a write
  token and runs the parser or `npm ci` at the same time.
- **What it needs.** `BUILD_WATCH_TOKEN` (secret, optional): the push uses it so the checks run on
  the pull request; without it the built-in token opens the pull request and no checks start.
  `ANSWER_EVAL_MODEL` (variable, optional) turns the answer scoring on; it then uses
  `ANSWER_EVAL_KEY` (secret) and `ANSWER_EVAL_BASE_URL` (variable, optional).
- **A failure means.** The watch could not read the CDN or regenerate the data, or the publish job
  refused a plan it did not trust. Two red scheduled runs in a row open one issue titled "Game build
  watch is failing"; it closes itself on the next clean scheduled run. The answer scoring never fails
  the run.

### Refresh changes (`changes.yml`)

- **Trigger.** `7,37 * * * *`, and by hand. One run at a time.
- **What it does.** Asks Blizzard's public version service for builds and keeps the registry behind
  `/changes` in `kb/changes/builds.json`. A new or changed build goes to one rolling pull request from
  the `data/changes` branch, titled `data(kb): new game builds`. The workflow merges that pull request
  itself, but only when the head is the commit this run pushed, the diff touches nothing outside the
  two data files `kb/changes/blue-posts.json` and `kb/changes/builds.json`, and every check on the
  head has passed. Every merge deploys the site, so at most one deploy per half hour.
- **What it needs.** `BUILD_WATCH_TOKEN` (secret). Without it the pull request still opens, but no
  checks run on it and the merge step fails on purpose, leaving it for a maintainer.
- **A failure means.** Either the version service did not answer (the collect step's log says why and
  the run is marked red so it is seen), or the merge gate refused: no checks reported, a check failed
  or did not finish in 15 minutes, the head moved, or the diff left the allowlist. The pull request
  stays open in every case.

### Release checks (`checks.yml`)

- **Trigger.** Every pull request, every push to `main`, and by hand. A newer push to the same branch
  cancels the run in progress.
- **What it does.** Two jobs. `guards` scans the commits behind `HEAD` for secrets (gitleaks 8.30.1,
  checksum-verified), rejects private workspace paths, checks that relative Markdown links resolve,
  and runs the unit tests for the repository scripts (the data-file allowlist, the Discord bridge,
  the CurseForge upload, the launch smoke list). On a pull request it also requires the asset folder
  for a new game build and a DCO sign-off on every commit. `verify` installs and tests the protocol,
  `kb`, `web`, `companion` and `desktop` packages, runs the wiki, news and guide checks, runs the
  addon's Lua tests, and rebuilds the addon zip to prove it matches the source (or, for a released
  version, that the source still packages).
- **What it needs.** Nothing beyond the read-only built-in token.
- **A failure means.** The pull request is not ready to merge. On `main`, the site is not deployed
  for that commit: `deploy-worker.yml` only runs after this workflow succeeds.

### Deploy the site to Cloudflare Workers (`deploy-worker.yml`)

- **Trigger.** `workflow_run`: when `Release checks` completes on `main`. Also by hand, which deploys
  the commit it is run on without waiting for checks. One deploy at a time.
- **What it does.** Builds the site with OpenNext and deploys the Worker, stamped with the commit.
  It runs only while the repository variable `WORKER_DEPLOY` is `1`, and only for a push to `main`
  in this repository whose checks passed. A commit the live site already includes, or one that
  changes nothing under `web/`, `kb/` or `packages/protocol/`, is skipped. After the deploy it warms
  the edge cache and fails if any page in the sitemap does not answer 200.
- **What it needs.** `WORKER_DEPLOY` (variable) as the switch. `CLOUDFLARE_API_TOKEN` (secret) and
  `CLOUDFLARE_ACCOUNT_ID` (variable) for the deploy. The public build-time values are variables:
  `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_GAME_ASSETS_URL`, `NEXT_PUBLIC_BULK_URL`,
  `NEXT_PUBLIC_ADSENSE_CLIENT`, `NEXT_PUBLIC_GA_ID`, `NEXT_PUBLIC_METRICOOL_HASH`,
  `NEXT_PUBLIC_POSTHOG_HOST`, `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`. `EVERLOOT_EDGE_CHECK` (secret) lets the warm pass through the
  zone's challenge and rate-limit rules.
- **A failure means.** In the build or deploy step: the live site still serves the previous commit.
  In the warm step: the new version is live but at least one sitemap page did not answer 200; the
  step's log names the page.

### Desktop release (`desktop-release.yml`)

- **Trigger.** A pushed `desktop-v*` tag. By hand it is a dry run: the same builds, kept as workflow
  artifacts, nothing published.
- **What it does.** On Windows, macOS and Linux runners, checks the tag against the version in
  `desktop/package.json` and the matching `CHANGELOG.md` section, runs the desktop tests and builds
  the installers. On a tag, a second job collects them, writes `SHA256SUMS` and creates the GitHub
  release with the changelog section as notes.
- **What it needs.** Nothing beyond the built-in token.
- **A failure means.** A tag that does not match the version, a missing changelog section, a failing
  test or a build that produced no installer. No release is created until all three builds pass.

### Discord bridge (`discord-bridge.yml`)

- **Trigger.** `*/10 * * * *`; issues opened, edited, closed, reopened, labeled or unlabeled; a
  release published; a discussion created; a push to `main`; a pull request opened
  (`pull_request_target`); and by hand. Sync runs queue behind each other; posts never wait.
- **What it does.** Runs `scripts/discord_bridge.py` from the default branch. The scheduled and
  issue-driven runs mirror `#bug-reports` posts with GitHub issues and keep the `#known-issues`
  list. A release, discussion, commit to `main` or new pull request becomes a post in the matching
  channel. The `pull_request_target` run reads the event as text only; it never checks out or runs
  code from the pull request.
- **What it needs.** `DISCORD_BOT_TOKEN` (secret). The built-in token writes issues.
- **A failure means.** A post was not made or a sync did not finish; the next scheduled run tries
  the sync again. Nothing opens an issue about it, so the Actions tab is the place to look.

### Refresh ecosystem (`ecosystem.yml`)

- **Trigger.** `23 */6 * * *`, and by hand. One run at a time.
- **What it does.** Reads GitHub's public API for the projects listed in `kb/curated/ecosystem.json`
  (stars, releases, commits, issues, `.toc` interface numbers) into `kb/changes/ecosystem.json`,
  behind `/addons/ecosystem`. A changed fact goes to one rolling pull request from the
  `data/ecosystem` branch. It never pushes to `main` and never merges; a maintainer does, and every
  merge deploys the site.
- **What it needs.** `BUILD_WATCH_TOKEN` (secret, optional) so the checks run on the pull request.
- **A failure means.** GitHub's API did not answer or the rate limit held for too long. The next run
  starts from the open pull request's file, so nothing is lost.

### MCP release image (`mcp-image.yml`)

- **Trigger.** By hand only.
- **What it does.** Downloads the approved knowledge release `mcp-knowledge-2026-10-05` from this
  repository, verifies its SHA-256, builds `kb/Dockerfile` and pushes the image to GitHub Container
  Registry as `everloot-mcp:<commit>` and `everloot-mcp:beta`.
- **What it needs.** The built-in token with `packages: write`.
- **A failure means.** The release could not be fetched, the checksum did not match, or the image did
  not build or push. The previous image stays as it was.

### Nightly (`nightly.yml`)

- **Trigger.** `17 6 * * *`, and by hand with a `force` input to build even when `main` has not
  changed since the last nightly.
- **What it does.** When `main` has new commits since the last `nightly-*` tag, runs the addon tests,
  stamps a `<next version>-nightly.<date>.<run>` version on the runner's copy only, packages the zip
  and publishes a pre-release tagged `nightly-<date>.<run>` with generated notes. It then deletes all
  but the newest five nightly releases and their tags. The site's download stays on the stable
  release.
- **What it needs.** Nothing beyond the built-in token.
- **A failure means.** The addon tests failed on `main`, or the package or release step did. No
  nightly for that day; the last good one stays available.

### PR title (`pr-title.yml`)

- **Trigger.** A pull request opened, edited, reopened or synchronized. Dependabot and the
  `data/changes` branch are not held to it.
- **What it does.** Checks the title reads `type(scope) plain sentence` with
  `scripts/check_pr_title.py`.
- **What it needs.** Nothing.
- **A failure means.** The title does not fit the convention in `CONTRIBUTING.md`. Edit the title;
  the check runs again.

### Protocol release (`protocol-publish.yml`)

- **Trigger.** A pushed `protocol-v*` tag.
- **What it does.** Checks the tag against `packages/protocol/package.json` and its `CHANGELOG.md`,
  runs the tests, typecheck and build, checks the version follows the package's semver rule against
  what is published, then publishes `@everloot/protocol` to npm with provenance (skipped when that
  version is already on npm) and creates a GitHub release with generated notes.
- **What it needs.** npm trusted publishing set to this workflow, through the `id-token: write`
  permission; no npm secret is stored.
- **A failure means.** A version or changelog mismatch, a failing test, a semver rule broken, or npm
  refused the publish. Fix and push a new tag; a tag is never reused.

### Addon release (`release.yml`)

- **Trigger.** A pushed `addon-v*` tag.
- **What it does.** Checks the tag against `addon/Everloot.toc` and the `CHANGELOG.md` section, runs
  the addon tests, rebuilds the zip and requires it to match the committed one in
  `web/public/downloads/`, then creates the GitHub release with the zip, `SHA256SUMS` and the
  changelog section (a pre-release when the notes say `Release channel: Alpha`). A last job uploads
  the same archive to CurseForge.
- **What it needs.** `CF_API_KEY` (secret) for the CurseForge upload.
- **A failure means.** Before the release: a mismatch or failing test, and nothing is published. In
  the CurseForge job: the GitHub release exists but the upload did not land; rerun the job once the
  cause is fixed.

### Site health (`site-health.yml`)

- **Trigger.** `7,22,37,52 * * * *`, and by hand.
- **What it does.** Asks `https://everloot.app/api/health`, then checks that an item page shows its
  item's name and that the public MCP endpoint lists its tools. Any problem opens one issue labelled
  `site-down` or comments on the open one, and the run fails. The next clean check closes the issue.
  A Cloudflare challenge on the item page is reported as the bot rules stopping the check, not as
  the site being down.
- **What it needs.** Nothing beyond the built-in token.
- **A failure means.** Read the `site-down` issue: it names what failed (the health endpoint, a blank
  item name because a build's name file is not uploaded, the MCP hourly allowance used up, or a
  challenge page).

### Weekly spot check (`spot-check.yml`)

- **Trigger.** `41 3 * * 1` (Mondays), and by hand with a `week` input (`YYYY-Www`, empty for the
  current UTC week). One run at a time.
- **What it does.** Runs `npm run kb -- spot-check` over the public corpus. A fact the week's pick
  left out of the settled list and a later report contradicted becomes a recheck scope in
  `kb/curated/recheck.json`, sent to one rolling pull request from the `data/spot-check` branch. It
  never pushes to `main` and never merges; a maintainer does, and every merge deploys the site.
- **What it needs.** `BUILD_WATCH_TOKEN` (secret, optional) so the checks run on the pull request.
  The corpus is read at the public rate limit; no API key is stored.
- **A failure means.** The corpus feed did not answer or the check itself failed. The next Monday
  starts from the open pull request's file.
