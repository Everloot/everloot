# Build watch

When Blizzard ships a new WoW: Forever build, a GitHub Actions workflow
(`.github/workflows/build-watch.yml`) notices within about half an hour, regenerates the game data in
[`web/src/data/game-data/`](../web/src/data/game-data/changes/README.md) and opens a pull request titled `data(game-data): build <version>`.
A maintainer reviews it. Nothing merges itself.

## What it does

1. Asks Blizzard's public version service for the product in `kb/lists/build-watch.yaml` (one small
   request; the site reads one product, so the list has one entry). If the build's config hash matches the
   build in `web/src/data/game-data/talents/*.json` on `main`, it stops. Most runs end here.
2. Looks at existing pull requests on `game-build/<product>-<buildId>-<config>` branches. One open
   already: nothing to do. Merged: nothing. Closed without merging: it is not reopened (see `--redo`).
3. Otherwise reads the tables from Blizzard's CDN and regenerates **exactly the files the site reads**, with
   the same generators a maintainer runs by hand ([the folder's README](../web/src/data/game-data/README.md)):
   `talents/<class>.json` (`trim-talent-catalog.mjs`), `raid-<build>.json` and `addon/modules/raid_data.lua`
   (`build-raid-game-data.ts`), `map.json` (`client-map`), `spell-values.json` (the numbers of the spells
   talents show, which the trimmed talent files leave out) and `client-digests.json` (row counts and a content
   hash per client table read, the read set's comparison baseline). The old build's raid file is removed in the same
   pull request and the import in `web/src/data/game-data/raid.ts` is pointed at the new one. There is no
   second copy of the data: what is committed is what the pages read.
4. Compares the new files with the committed ones: talents added, removed, moved, rank changes, row-gate and
   prerequisite changes, talents swapped for another spell, spell number changes (effect values, duration,
   a hash of the tooltip), talent point levels, raid buff scope changes (per rank too), spell ids added or
   removed and talent tree changes, map zones and entrances that appeared, vanished or moved, and the client
   read set: tables added, removed or changed by name, row count and content-hash difference (never rows).
5. Writes a changelog entry (`web/src/data/game-data/changes/<product>-<buildId>.json`, shape in
   `kb/src/build-watch/changes.ts`; it carries the build, extraction source and encrypted block counts, so
   there is no separate manifest) and a pull request body. The workflow commits, pushes and opens or updates
   the pull request.
6. Adds recheck scopes to `kb/curated/recheck.json` for the zones and entrances the entry lists as moved or
   removed: a zone's pins and entrances, a moved entrance's own (coverage and plateau design, section 5). The
   coverage score then counts only reports made after the build was seen. A changed `QuestV2` or `UiMap` needs
   the row-level answer, which only the maintainer's two local snapshots give: `npm run kb -- client-diff <old>
   <new> --out diff.json`, then `npm run kb -- recheck-scopes diff.json --since <first seen> --source <build>`.

Every item from a product with `live: false` carries `spoiler: true` and the body says so. The body
also states the encrypted block count. No decryption keys are loaded; encrypted blocks are skipped.
Never auto-merge: the workflow has no merge step. Web tests that hard-code the build number in sample
raid codes may need a matching edit in the same pull request; CI shows it.

Upload before merging. The site reads item, quest, item set and spell names only from the asset folder of the
client layer's build (`loadItemNames` in `web/src/lib/game-assets.ts`), so merging a new build first leaves
production with "Item 25" instead of names and an empty item sitemap until the upload. Before merging, a
maintainer with the upload key runs `kb client-assets`, `item-names` and `game-names` for the new build,
uploads with `web/scripts/upload-game-assets.mjs` and `upload-item-names.mjs`, and points
`NEXT_PUBLIC_GAME_ASSETS_URL` at the new folder, so the merge's production build picks up both.

Hotfixes that change no build are not in the game files and never show up here. The blue tracker covers
them.

## Schedule

`7,37 * * * *`: twice an hour. Blizzard lists a build on its version service when it is ready to
download; a half-hour poll finds it within the hour even when GitHub delays a scheduled run by
10 to 15 minutes. Hourly would not guarantee that. The cost is tiny: the common run is one HTTP
request plus installing dependencies. The CDN is read only when a build is new, and the downloaded
index is kept in the Actions cache (about 300 MB; the only thing cached) so a second new build does not fetch it again.
GitHub switches off scheduled runs in a repository with no activity for 60 days, which would only
matter if the repository goes quiet.

## Tokens

The workflow has three jobs so that no secret shares a job with code that installs packages or parses
downloaded files. `watch` has a read-only token and no credentials left in the checkout. `publish` runs
no npm and no parser; it alone has write access, and `BUILD_WATCH_TOKEN` appears only in its push step,
passed to git for that call. `report` can only write issues. Branches are replaced with `--force-with-lease`.
Before committing, `publish` checks the plan's values, accepts only the files the generators write (the
talents, raid file, `raid.ts`, map, spell values, client digests, changelog entry and `raid_data.lua`), plus `kb/curated/recheck.json`, and requires that
`raid.ts` changes nothing but its import line.

## Repeated failure

A failed run is red and GitHub notifies the usual way. When two scheduled runs in a row fail, the
workflow opens one issue, "Game build watch is failing". While it is open no more are opened, and the
next successful scheduled run closes it.

## Setup a maintainer has to do once

- Settings, Actions, General: allow GitHub Actions to create pull requests.
- Optional but recommended: a repository secret `BUILD_WATCH_TOKEN` (a fine-grained token with
  contents and pull requests write on this repository). Pull requests opened with the built-in token
  do not start other workflows, so the release checks would not run on them.
- The first run opens a baseline pull request (no comparison). Merge game data only once PR #29 (which
  allows build changes, beta included, the talent catalog and the raid buff table in git) is merged.
- `kb/lists/build-watch.yaml` follows `wowf`, WoW Forever's own product, with `live: false`. Set `live: true`
  once players can play it, at launch ([LAUNCH_DAY](LAUNCH_DAY.md)).

## Running it locally

```
npm run kb -- build-watch --dry-run
```

Reads the current build from the CDN and writes the tree it would commit under
`kb/data/build-watch/out/dry-run/tree/`, plus `pr-body.md` and `plan.json`. It changes nothing else and
needs no GitHub access (it assumes no pull requests exist if `gh` is not signed in).

`--force` (dry run only) goes on even when the build is already committed and reads the table layouts at
the commit the committed files were made with. It then lists generated files that differ from the committed
ones, ignoring `extractedAt`: on the committed build the answer is none, which shows the watch reproduces
what the generators made.

Other flags: `--product <id>` (instead of the config), `--check` (only decide, read no game files),
`--redo` (refresh an open pull request, or reopen a declined one), `--root <dir>` (the repository whose
files are compared with; default `..`), `--out <dir>`.

## Politeness

One request to the version service per product per run. Game files only when a build is new, only the
tables listed in `kb/src/client-snapshot.ts`, cached between runs. No parallel downloads.
