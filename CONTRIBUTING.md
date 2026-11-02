# Contributing to Everloot

Everloot is built from what players see, so you can help without touching any code.

## Ways to help

- **Play with the addon and upload.** Every upload adds to the data, and the site states a fact
  once three installs have reported it, so your upload can be the one that confirms it. Install the addon from
  [everloot.app/upload](https://everloot.app/upload), play, log out, upload your
  `SavedVariables/Everloot.lua`. You preview everything before it is sent.
- **Upload your Polestar Recorder file.** If you record with the
  [Polestar Recorder](https://github.com/fitzforge/polestar), upload `SavedVariables/Polestar_Recorder.lua`
  on the same page: its NPC positions, quests, dungeon entrances, bosses and treasures count toward the same three-install rule, and its loot windows are counted until they can join the drop rates.
- **Report wrong data.** A drop that never drops, a vendor price that is off, a recipe colour that
  does not match your window: open an issue with the **Wrong data** form. Say what the page shows,
  what you saw in the game, and where (zone and coordinates if you have them).
- **Report a bug.** Use the **Bug report** form. For addon problems, paste the output of
  `/everloot status`.
- **Fix the lore archive.** The lore pages come from the 2023 Warcraft Wiki dump. If the importer
  turns a page into nonsense (broken templates, missing text), an issue with the page link helps us
  fix the importer for every page like it.
- **Write code.** See below.

Questions and ideas go in [Discussions](https://github.com/Everloot/everloot/discussions).

## Good first issues

New here? Open the issues labelled
[`good first issue`](https://github.com/Everloot/everloot/labels/good%20first%20issue). Each is small,
says what done looks like, and names the files to start in. Comment on one to say you are taking it,
and ask in [Discussions](https://github.com/Everloot/everloot/discussions) if anything is unclear.
[`help wanted`](https://github.com/Everloot/everloot/labels/help%20wanted) marks larger work that is
open to anyone. Area labels (`addon`, `web`, `kb`, `companion`, `desktop`, `mcp`, `tools`, `lore`, `game-data`)
tell you which part an issue touches.

## Data rules

Read [`docs/DATA_POLICY.md`](docs/DATA_POLICY.md) before adding any data. In short: no scraping, no
reading the game client's memory or files beyond the addon's own save file, no spoilers. A new source goes in
[`docs/sources/LEDGER.md`](docs/sources/LEDGER.md) in the same pull request, and only sources
whose licence allows republishing under CC BY-SA 4.0 can reach a release.

## Code

### Set up

You need Node 22, Python 3.12 and Git. Each part's README says how to run and test it:

- [`addon/`](addon/README.md): Lua 5.1, tested through `lupa`
- [`web/`](web/README.md): Next.js; `npm run sample-release` gives you local lore pages
- [`kb/`](kb/README.md): the knowledge base and MCP server
- [`companion/`](companion/README.md): needs `web` installed
- [`desktop/`](desktop/README.md): Electron; needs `web` and `companion` installed
- [`packages/protocol/`](packages/protocol/README.md): the contract. After a change there, run
  `npm run build` in `packages/protocol`, then in each of `web`, `kb` and `companion` delete
  `node_modules/@everloot/protocol` and run `npm install`: they install a packed copy, and npm keeps the
  old one while the version number is unchanged. Commit the regenerated `dist/` and `schema/`.

To catch lint and type errors before CI does, turn on the pre-push check once per clone:
`git config core.hooksPath .githooks`. It lints and typechecks only the packages your push changes.

### Sign your commits (DCO)

Every commit needs a `Signed-off-by:` line. It certifies that you wrote the change, or have the right
to submit it, under the project's licence ([Developer Certificate of Origin](https://developercertificate.org/)).
Add it with `-s`:

    git commit -s -m "Fix the vendor price rounding"

If CI says a commit is not signed off, fix the last commit with `git commit --amend -s --no-edit`,
or several with `git rebase --signoff main`, then force-push your branch. Commits from GitHub's own
bots, such as Dependabot, are exempt: a bot cannot certify anything.

### Pull request titles

Title a pull request `type(scope): plain sentence`. The title becomes the line in the release notes,
so write it for someone reading them.

- Types: `feat`, `fix`, `perf`, `refactor`, `docs`, `chore`, `data`
- Scopes: `addon`, `web`, `kb`, `companion`, `desktop`, `protocol`, `mcp`, `game-data`, `infra`, `docs`
- Example: `feat(web): the raid builder shows which tree each buff needs`

A check on every pull request rejects a title that does not fit. No full stop at the end, 100
characters at most.

### Before you open a pull request

- The tests for the parts you touched pass (see `.github/workflows/checks.yml` for the exact commands
  CI runs).
- An addon change to a version that is not released yet rebuilds the zip with
  `python scripts/package-addon.py` and commits it; CI fails if the zip does not match the source. Once
  the version is tagged, its zip stays as published: CI only checks that the source still packages, and
  the next release builds the new zip.
- Data changes follow the data rules above.
- Keep a pull request to one change. Say what changed and how you tested it.

CI also scans every pull request for leaked secrets and for private file paths.

## How releases work

- **The site** deploys from `main`: a merged pull request is live a few minutes later.
- **The addon** gets a new version number in `addon/Everloot.toc` and `addon/core.lua`, a rebuilt zip
  in `web/public/downloads/`, a tagged GitHub release and an upload to CurseForge by a maintainer.
  A nightly pre-release is built from `main` when it has changed. [`docs/RELEASING.md`](docs/RELEASING.md)
  has the steps.
- **The desktop app** gets a new version in `desktop/package.json`, a `desktop-vX.Y.Z` section in
  `CHANGELOG.md` and a `desktop-vX.Y.Z` tag; the release workflow builds the installers and publishes
  them with `SHA256SUMS`. [`desktop/README.md`](desktop/README.md#release) has the steps.
- **The knowledge release** (the lore archive) is rebuilt by a maintainer from the wiki dump with
  `npm run kb -- snapshot`, checked with `npm run kb -- audit-sources`, and published to the site's
  storage. The site refuses a release that does not match its manifest.

## Licence

By contributing you agree that your code is licensed under the [AGPL-3.0-only](LICENSE) and any data
under CC BY-SA 4.0, like the rest of the project. Everyone here follows the
[code of conduct](CODE_OF_CONDUCT.md).
