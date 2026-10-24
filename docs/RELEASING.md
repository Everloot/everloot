# Releasing

Four things ship from this repository, each differently. The protocol package has its own section
below.

| What | How it ships | Version |
|---|---|---|
| The site (`web/`) | Every merge to `main` deploys production on Vercel | none |
| The addon, tagged (Alpha or stable) | A `addon-v*` tag runs `.github/workflows/release.yml` and creates a GitHub release | `0.3.x` |
| The addon, nightly | `.github/workflows/nightly.yml` makes a pre-release from `main` when it has changed | `0.3.x-nightly.<date>.<run>` |
| The desktop app | A `desktop-v*` tag runs `.github/workflows/desktop-release.yml`, which builds Windows, macOS and Linux installers and publishes a GitHub release with `SHA256SUMS` ([`desktop/README.md`](../desktop/README.md#release)) | `0.1.x` |

The site's download link (`web/public/downloads/`) points at the newest tagged-version zip committed to the
repository. It can be an explicitly labelled Alpha. A nightly never changes it.

## Pull request titles

Title every pull request `type(scope): plain sentence`. The title becomes a line in the release
notes. `.github/workflows/pr-title.yml` rejects a title that does not fit, and
[`scripts/check_pr_title.py`](../scripts/check_pr_title.py) holds the rules.

- Types: `feat`, `fix`, `perf`, `refactor`, `docs`, `chore`, `data`
- Scopes: `addon`, `web`, `kb`, `companion`, `desktop`, `protocol`, `mcp`, `game-data`, `infra`, `docs`
- Example: `feat(web): the raid builder shows which tree each buff needs`

Dependabot pull requests and the rolling `data/changes` pull request are exempt; both already use the
convention. GitHub groups the generated notes by the pull request's area label (`addon`, `web`, `kb`,
`mcp`, `game-data`, `security` and so on) as set in `.github/release.yml`, so label a pull request
with its area before it merges.

## Stable release

1. On a branch, bump the version in `addon/Everloot.toc` (`## Version:`) and `addon/core.lua`
   (`E.VERSION`). Both must carry the same number.
2. Run `python scripts/package-addon.py` and commit the new
   `web/public/downloads/Everloot-<version>.zip`. The download link and its label need no edit: the upload
   page resolves the newest zip in that folder, so the link cannot disagree with the file.
3. In `CHANGELOG.md`, move the entries from `[Unreleased]` to a new `## [<version>] - <date>`
   section. The release uses this section as the top of its notes, so write it for players.
4. Open a pull request titled `chore(addon): release <version>`, wait for checks, merge it.
   For an Alpha, put the exact line `Release channel: Alpha` in that version's changelog section.
   The publisher then marks the GitHub release as a pre-release. Keep live-client verification limits in the notes.
   Before a verified stable release, update the Alpha copy on the home, upload and download pages together.
5. Tag the merge commit and push the tag:

   ```bash
   git fetch origin && git checkout main && git pull
   git tag -a addon-v<version> -m "Everloot addon <version>"
   git push origin addon-v<version>
   ```

The workflow then:

1. checks that the tag matches the version in the TOC and that `CHANGELOG.md` has a section for it;
2. runs the addon tests;
3. rebuilds the zip with `scripts/package-addon.py` and fails if it differs from the committed one;
4. creates the GitHub release with the zip and a `SHA256SUMS` file attached. The notes are the
   changelog section followed by GitHub's generated list of pull requests since the previous
   `addon-v*` tag.

Only the last job holds `contents: write`; the build and test job is read only. If a run fails,
fix the cause, delete the tag (`git push --delete origin addon-v<version>` and `git tag -d`), and tag
again. Then upload the same zip to CurseForge by hand.

## Nightly

The nightly workflow runs daily at 06:17 UTC and on demand (Actions, Nightly, Run workflow; tick
"force" to build with no new commits).

- It skips the day when `main` has no commits since the last `nightly-*` tag.
- The version is the next patch version with a suffix, for example `0.3.1-nightly.20261018.57`. The
  tag is `nightly-20261018.57` and the release is named `Everloot Nightly <version> (<short sha>)`,
  marked pre-release.
- It runs the addon tests on `main` as committed, then stamps the version into the TOC and
  `core.lua` of the runner's copy only. Nothing is committed. `core.lua` gets the short form
  (`0.3.1-nightly`) because the upload intake accepts at most 20 characters in `addonVersion`.
- The build checks out trusted `main` directly and refuses to continue if it moved after planning.
  Re-run the workflow to plan a fresh revision; never publish an archive under a mismatched commit.
- Assets: the addon zip and `SHA256SUMS`. A knowledge-base release is not attached: building one
  needs the 600 MB wiki dump, which is not cheap in CI.
- The notes are GitHub's generated list since the previous nightly (or the last stable tag).
- It keeps the newest 14 nightly pre-releases and deletes older ones with their tags.

A nightly is untested in the live client. Treat it as a way to try what is merged, and report problems
with the version from `/everloot version`.

## Protocol (`@everloot/protocol`)

The package in `packages/protocol` is versioned on its own (semver: a new kind, field or tool is a
minor release; removing or renaming anything, making a field required or tightening a limit is a major
release). `scripts/check-semver.ts` holds every pull request to that rule by comparing the committed
`schema/` folder with the latest published tarball; until the first publish it only says so and passes.

To release:

1. Bump `version` in `packages/protocol/package.json`.
2. In `packages/protocol/CHANGELOG.md`, move the `[Unreleased]` entries under `## [<version>] - <date>`.
3. Merge. Then, on `main`:

   ```
   git tag -a protocol-v<version> -m "Everloot protocol <version>"
   git push origin protocol-v<version>
   ```

`protocol-publish.yml` checks that the tag, `package.json` and the changelog agree, runs the tests, the
build, the committed-files check and the semver check, publishes to npm with provenance (skipped when
that version is already there) and opens a GitHub release named after the tag.

The first version goes out by hand, because npm's trusted publishing is configured on an existing
package: on a clean checkout of `main`, `cd packages/protocol && npm ci && npm run build && git diff
--exit-code && npm publish --access public`. Then, on npmjs.com, set the package's trusted publisher to
GitHub Actions, organization `Everloot`, repository `everloot`, workflow `protocol-publish.yml`. From then
on a tag is enough.

## Knowledge release (lore archive)

Unchanged: a maintainer builds it with `npm run kb -- snapshot`, checks it with
`npm run kb -- audit-sources` and publishes it to the site's storage. See
[`kb/README.md`](../kb/README.md).

## Bulk export

The published data as files (ROADMAP: "an open data export"), built from the same loaders the JSON
API uses, so every row is one the API serves: the public corpus with per-install pseudonyms in place of install ids, drop rates and
measured zeros under the three-install rule, relations (observed and game-file, each labelled) and the
items of the build. One NDJSON file per dataset plus `index.json`, whose shape is `bulkIndex` in the
protocol (`/schema/api/bulkIndex.json`).

1. In `web/`, with the production R2 read variables in the environment (or `EVERLOOT_UPLOADS` for a
   local store): `npm run export-bulk -- ../bulk-out`. It prints each file's rows, bytes and data class.
   A file whose storage was unreachable is left out and `dataAsOf` is null; absent is not empty.
2. Upload it: `node scripts/upload-bulk.mjs ../bulk-out` with `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
   `R2_SECRET_ACCESS_KEY` and `BULK_BUCKET`. Every object is written create-only under a folder named
   by the export's `generatedAt`, data files first and the index last; then `latest.json` (the one
   object the script overwrites) points at that folder. A hash mismatch, or a file (or the index) that
   carries what looks like a local filesystem path, stops it before anything is sent.
3. Once (owner): a public R2 bucket of its own (for example `everloot-bulk`, never the uploads bucket)
   with a public address such as `data.everloot.app`, a write token scoped to that bucket, and
   `NEXT_PUBLIC_BULK_URL` set in Vercel. Until it is set, `/docs/api/data-files` says there is no bulk download yet.
   Add the bucket to the nightly backup mirror's read-only token.

## One-time repository settings

These are not in the repository:

- Upload a social preview image in Settings, General, Social preview. `web/` already generates a
  1200x630 card for the site itself; the repository card is separate.
- Make the `PR title` check a required status check on `main` if you want it to block merging.
