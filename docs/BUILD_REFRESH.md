# Build refresh

What happens between "the build watch opened a pull request" and "the site shows the new build". The watch
([BUILD_WATCH.md](BUILD_WATCH.md)) regenerates the committed game data and opens the pull request; everything
after that is a hand step, and this page lists them in order. Each step says **scripted** (the command the
repository defines, run by a maintainer) or **by hand** (what to edit), and the steps that need the bucket
tokens are marked **owner**. No token value, bucket address or local path belongs on this page; the environment
variables are named so you know which to set, from the same place you set them last time.

Names used below: `<product>` is the Blizzard product id (`wowf` for WoW: Forever, `kb/lists/build-watch.yaml`),
`<build>` the build number, `<config>` the eight-character config hash in the watch's branch name
`game-build/<product>-<build>-<config>`, and `<version>` the full version string such as `1.60.1.70862`.
`<release>` is a knowledge release file under `kb/data/release/`.

## What the watch already did

The pull request titled `data(game-data): build <version>` (for example #871, build 70862; #751, build 70790)
changes these files and nothing else; the `publish` job refuses any other path:

- `web/src/data/game-data/talents/<class>.json`, nine files
- `web/src/data/game-data/raid-<version>.json` (the old build's raid file is removed) and the import line in
  `web/src/data/game-data/raid.ts`
- `addon/modules/raid_data.lua`
- `web/src/data/game-data/map.json`, `client-layer.json`, `races.json`, `spell-values.json`, `client-digests.json`
- `web/src/data/game-data/client-achievements.json`, `client-encounters.json`, `client-mounts.json`,
  `client-class-gear.json`, `client-class-spells.json`, `client-recipes.json`, `client-bags.json`, `client-factions.json`,
  `client-titles.json`, `client-quest-lines.json`
- `web/src/data/game-data/changes/<product>-<build>.json`, the changelog entry, and one import plus one name in
  `PUBLISHED_CHANGES` in `web/src/lib/talents/freshness-records.ts`
- `kb/curated/recheck.json`, when the entry lists moved or removed zones and entrances

The body lists what changed and, folded, the player questions the new build answers differently. Nothing
merges itself. The watch does **not** regenerate `legacy-perks.json`, does not extract art or names, and does
not touch tests, the starter builds, the asset URL or any bucket.

## The steps

1. **Read the pull request.** Scripted (the watch). Verify: the title names the build, the body's encrypted
   block count and the changelog entry look like the last build's, and the release checks ran on it. Checks
   that did not start mean the pull request was opened with the built-in token (`BUILD_WATCH_TOKEN` is not
   set, BUILD_WATCH.md "Setup"). Reopen a declined build or refresh an open one with the workflow's `redo` input.

2. **Take the snapshot.** Scripted, in `kb/`:

   ```
   npm run kb -- client-extract --product wowf --refresh
   ```

   `--refresh` adds the item, spell, atlas and map art tables the art and names steps read. It writes
   `kb/data/client/<product>-<build>-<config>.sqlite` (gitignored). Verify: the file's build and config match
   the pull request's branch name. Every later step takes this file.

3. **Fix the tests that pin data.** By hand, in the same pull request. `web/src/lib/game-version.test.ts`
   requires every committed layer (client layer, digests, spell values, talents, the raid file) to name one
   build, so a layer left behind fails there. Tests that hard-code sample share codes, race and class pairs or
   counts from the files need a matching edit; the 70790 bump (`git show 62e3c4ac --stat`) touched
   `web/src/lib/raid.test.ts`, `web/src/lib/race-traits.test.ts`, `web/src/lib/world-map.test.ts`,
   `web/src/app/classes/classes.test.tsx`, `web/src/app/classes/group/group.test.tsx`, the two profession page
   tests and `kb/test/class-races-tool.test.ts`. The pull request's `verify` check names the ones a build needs
   (#871 opened red on `kb/test/curated-builds.test.ts`, which is step 5). Verify: `npm test` in `web/` and
   `kb/` pass on the branch, and CI on the pull request is green.

4. **Regenerate the Legacy perks.** Scripted, in `kb/`, with the committed file in place as the previous catalog
   ([LEGACY_PERKS.md](LEGACY_PERKS.md) "Regenerate"):

   ```
   npx tsx src/legacy-perks/build-catalog.ts data/client/<product>-<build>-<config>.sqlite
   ```

   It writes `web/src/data/game-data/legacy-perks.json`; ids the new build lacks stay as withdrawn. An
   encrypted block in a table it reads refuses the build rather than leave a perk out. Verify: the file's
   `build` is the new version; commit it with the build in the message.

5. **Re-encode the starter builds.** By hand. Each entry in `kb/curated/builds.yaml` carries a `share_code` and a
   `build`, made in `/tools/talents` for that build; `kb/test/curated-builds.test.ts` requires every entry to
   decode and resolve whole on the current build, and the import refuses a code whose class or tree does not
   match. Open each build's `source_url` on a branch that serves the new catalog,
   place the points again, paste the new code into `share_code` and `source_url`, and set `data.build`. Verify:
   the kb tests pass and each code decodes on the new catalog with nothing in `unknown` or `rejected`.

6. **Recheck scopes for quests and zones.** Scripted, optional. The watch adds scopes for moved or removed
   zones and entrances. A changed `QuestV2` or `UiMap` needs the row-level answer, which only two local
   snapshots give (BUILD_WATCH.md, step 6), in `kb/`:

   ```
   npm run kb -- client-diff <old snapshot> <new snapshot> --out diff.json
   npm run kb -- recheck-scopes diff.json --since <first seen> --source <build>
   ```

   Verify: `kb/curated/recheck.json` gained only scopes the diff names; commit it in the pull request.

7. **Extract and upload the art.** Scripted, **owner** (needs `ASSETS_S3_ENDPOINT`, `ASSETS_BUCKET`,
   `ASSETS_PRIVATE_BUCKET`, `ASSETS_ACCESS_KEY_ID` and `ASSETS_SECRET_ACCESS_KEY` in the environment, never on
   the command line; [ASSETS.md](ASSETS.md) "Owner steps", steps 6 and 9). In `web/`:

   ```
   node scripts/upload-game-assets.mjs --snapshot ../kb/data/client/<product>-<build>-<config>.sqlite --dry-run
   node scripts/upload-game-assets.mjs --snapshot ../kb/data/client/<product>-<build>-<config>.sqlite
   ```

   `--snapshot` runs `client-assets` first and prints its counts. Verify, before the real run: compare the
   counts with the last build's; a jump in `iconsEncrypted`, `tooltipsUnresolved`, `mapsSkipped` or
   `loadingScreensSkipped`, or `logoExtracted` falling to 0, means Blizzard changed something. Both buckets get
   a new `<product>-<build>-<config>/` folder; the old folder stays, so the live site keeps working.

8. **Make and upload the names.** Scripted, **owner** (same variables as step 7), with a knowledge base or
   release that holds the wiki dump (ASSETS.md step 8). In `kb/`:

   ```
   npm run kb -- item-names data/client/<product>-<build>-<config>.sqlite --wiki data/release/<release>.sqlite
   npm run kb -- game-names data/client/<product>-<build>-<config>.sqlite --wiki data/release/<release>.sqlite
   ```

   They print the counts per tier and write `item-names.json`, `quest-names.json`, `item-set-names.json` and
   `spell-names.json` under `kb/data/assets/<product>-<build>-<config>-names/`. Then, in `web/`, each file, dry
   run first:

   ```
   node scripts/upload-item-names.mjs ../kb/data/assets/<product>-<build>-<config>-names/<file>.json --dry-run
   node scripts/upload-item-names.mjs ../kb/data/assets/<product>-<build>-<config>-names/<file>.json
   ```

   The files go to the private bucket's build folder with a five-minute cache, so a re-run replaces them. If the
   build folder is a re-extract under another name, add `--folder=<that folder>`; the script refuses another
   build's folder. Verify: the counts are near the last build's. To see what stays unnamed and why, run
   `name-gaps` with the same two files (ids only; keep its output local).

9. **Upload the coverage expected counts.** Scripted, **owner** (the step 7 variables; `--dry-run` needs none).
   In `kb/`, with the local database that holds the pfQuest import and the uploads reachable:

   ```
   npm run kb -- coverage-report --db <database> --client data/client/<product>-<build>-<config>.sqlite --out <folder outside the repository>
   ```

   It writes the report and the counts-only `coverage-expected.json`. Then, in `web/`:

   ```
   npx tsx scripts/upload-coverage-expected.ts <coverage-expected.json> --report <coverage-report.json> --snapshot ../kb/data/client/<product>-<build>-<config>.sqlite --folder <build folder> --dry-run
   npx tsx scripts/upload-coverage-expected.ts <coverage-expected.json> --report <coverage-report.json> --snapshot ../kb/data/client/<product>-<build>-<config>.sqlite --folder <build folder>
   ```

   The uploader checks that the report was connected, that the snapshot is the committed client layer's build and
   that the folder is that build's, then reads the file back and compares bytes. Never publish the report itself.
   Verify: the read-back matches; `/database/coverage` shows denominators once the site serves the build.

10. **Point the site at the new folder.** By hand, **owner**. Set the GitHub repository variable
    `NEXT_PUBLIC_GAME_ASSETS_URL` to the public address plus the new build folder, no trailing slash (ASSETS.md
    step 7). It is read at build time by `.github/workflows/deploy-worker.yml`, and the server reads the item
    facts, names and expected counts from the folder at its end. The site reads names only from the folder of
    the committed client layer's build, so do this before the merge: merging first leaves production with
    "Item 25" instead of names and an empty item sitemap until the upload and variable catch up
    (BUILD_WATCH.md "Upload before merging"). The Worker secrets (`GAME_DATA_*`) do not change per build.

11. **Merge.** By hand. A maintainer merges the data pull request; the deploy workflow builds production from
    `main` with the new variable. Verify: the deploy run for the merge commit is green.

12. **Cut the knowledge release.** Scripted, after the merge ([RELEASING.md](RELEASING.md) "Knowledge release",
    [`kb/README.md`](../kb/README.md)). In `kb/`: `npm run kb -- snapshot` writes the public release,
    `npm run kb -- audit-sources` lists its rows per source, `web/scripts/cf-release-d1.mjs` writes the SQL the
    Worker's D1 database imports, and `KNOWLEDGE_RELEASE_SHA256` in `web/wrangler.jsonc` pins which release that
    is. Verify: the release opens read-only against its own manifest (the MCP server refuses one that does not).

13. **Re-run the exports.** Scripted, **owner** (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and
    `BULK_BUCKET`). Both exports stamp the game build they were made from, so they are redone after the merge.
    In `web/` (RELEASING.md "Bulk export"):

    ```
    npm run export-bulk -- <outDir>
    node scripts/upload-bulk.mjs <outDir>
    ```

    In `kb/`, then `web/` ([OPEN_DATA.md](OPEN_DATA.md) "Publish one"):

    ```
    npm run kb -- open-data <folder>
    node scripts/upload-open-data.mjs <folder>
    ```

    Each upload is create-only under a folder named by the export's stamp, data files first, the index or
    manifest last, then the one `latest.json` pointer it overwrites; a hash mismatch or a file carrying a local
    path stops it before anything is sent. Verify: `export-bulk` prints the new build in its index line and
    `open-data` prints `game build <version>`; a file left out because its storage was unreachable is a reason to
    run it again, not to upload.

## Final checks

On production, after the deploy for the merge:

- `/changes`: the latest-build line reads "Latest build: WoW: Forever `<version>`", and the build's own entry is
  there. The header label beside the search reads the short build.
- `/tools/talents/<class>` for one class: icons sit inside the frames and the tooltip opens, so the manifest in
  the new folder is read (ASSETS.md "What to check on the site" has the full list).
- `/database/items/25` or another item players have not reported: a name, not "Item 25".
- `/database-sitemap.xml`: an index that lists item pages with names, not 503.
- `/database/coverage`: each type shows "of N expected", not "no expected count".
- `/database/download`: the open data export's date, counts and game build are the new ones, and
  `/docs/api/data-files` points at the new bulk export.
