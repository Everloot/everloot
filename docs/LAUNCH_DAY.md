# Launch day: 2026-11-04

WoW: Forever launches globally on November 4, 2026, at 3:00 p.m. PST, which is 23:00 UTC (Blizzard's
sentence, kept in `web/src/data/wow-forever.ts` as `LAUNCH` and `LAUNCH_AT`; last read 2026-10-17). Times
below are relative to that hour, "L".

This page is the order of work, not the detail. Each step points at the document that holds the detail.
It was written on 2026-10-23 from what is in the repository and refreshed on 2026-10-30 (addon 0.3.13, Desktop App 0.1.8, `/ask` and the question bank). A step marked **[unverified]** has no tested
procedure behind it yet; the list of those is at the end.

Two rules for this page and for anything done from it:

- No secret value goes in a pull request, a log or a chat message. Steps name the setting, never its value.
  Where a setting has a name in another document (`docs/ASSETS.md`, `docs/SEO.md`), this page says "the
  asset URL setting" or similar and does not repeat the name. The same rule is why
  `kb/src/build-watch/render.ts` says "the site's asset URL setting" in the pull request body.
- Nothing merges itself. The build watch never merges, and an agent does not merge, deploy or change
  Cloudflare, CurseForge or Wago access. Those are Carlos's.

Owners: **Carlos** needs an account, a key, a setting or the game login. **Agent** can do it from the
repository and the public site with no secret.

## What changes at launch

| What | Today | At launch | Where |
|---|---|---|---|
| Build the site shows | Beta, 1.60.1.70450 | Live, the launch build | the layers in `web/src/data/game-data/` |
| Unprefixed pages (`/`, `/database`, ...) | show Beta | show Live, same URLs | `served` in `web/src/data/build-versions.json` |
| `/beta/...` | the same pages as unprefixed | the notice "Build N, which Everloot holds no snapshot of" (noindex) | `web/next.config.js` rewrites |
| `/ptr/...` | the notice "None running" | unchanged | same |
| Live entry in the header | "Available at launch, 2026-11-04", not selectable | `product`, `build`, `available: true` | `web/src/lib/game-version.ts` |
| Spoiler flag on items from the product | `live: false`, everything is a spoiler | `live: true` | `kb/lists/build-watch.yaml` |

No URL in the sitemap changes: it lists only unprefixed URLs. The canonical of a `/beta/...` page is the
unprefixed page. Source: `docs/ASSETS.md` ("Adding a product or build", "Version addresses"),
`docs/2026-10-22-lane-version-routing-closeout.md`, PR #329.

The site holds one client snapshot. At launch it is replaced, not added to. `/beta` will not show Beta data
again; it will say so.

## T-7 days (2026-10-28)

| # | Owner | Step | Check and expected result | If it fails |
|---|---|---|---|---|
| 1 | Agent | Confirm `main` is green and production is on the latest `main` merge. | Release checks green on the latest `main` commit; the deploy-worker run for that SHA is green. | Fix or revert the failing merge before any launch work. |
| 2 | Agent | Run the production smoke list (below) and keep the output as the "before" record. | Every path in the list answers as stated. | Open an issue for each miss; do not start the switch on a red baseline. |
| 3 | Carlos | Check Blizzard's version service for `wowf`, WoW: Forever's own product, with `cd kb && npm run kb -- builds-check` (the default asks for `wowf`, `wow_classic_beta` and `wow_classic_era`). `kb/lists/build-watch.yaml` follows `wowf` with `live: false` until players can play (step 20). | The output shows `wowf` and its newest build (1.60.1.70630 on 2026-10-27; the launch build may be newer). | Check again each day; see T-1. |
| 4 | Carlos | Addon: confirm the CurseForge upload is done and the Wago upload is done or scheduled (target in the readiness notes was about 10/24 for CurseForge; 10/30 for both is the current target, **[unverified]** in the repository). The current zip is 0.3.13, an Alpha released 2026-10-30 (`addon/Everloot.toc`, `CHANGELOG.md`); upload that one. | The listing is public and its version matches the zip on `/upload`. | A zip can always be downloaded from `/upload` and the GitHub release; the listing is not on the critical path for the site. |
| 5 | Carlos | Weapon damage check: the six-weapon card in the owner notes (also steps 18 to 23 of `docs/2026-10-21-addon-0.3.10-launch-checklist.md`). The result becomes entries in `CHECKED_WEAPONS` in `kb/src/assets/weapon-damage.ts`. | Until it is filled, item pages print `[?] - [?]` and say why. This is allowed at launch. | Leave the array empty. No range is printed. |
| 6 | Carlos | Upload the counts-only expected-counts file the owner notes call `coverage-expected.json`, so `/database/coverage` has a denominator. The upload procedure is **[unverified]** here. | `/database/coverage` shows an expected count instead of "No expected count". | The page keeps saying it has none. Not a launch blocker. |
| 7 | Carlos | Confirm the Desktop App finds the launch client's folder. The app lists any `_<product>_` folder under the install root (`desktop/src/main/game-folder.ts`); the launch folder name is **[unverified]**. | The app lists the launch folder on a machine with the launch client. | |

## T-1 day (2026-11-03)

| # | Owner | Step | Check and expected result | If it fails |
|---|---|---|---|---|
| 8 | Agent | Prepare, but do not merge, the switch branch: edit `web/src/lib/game-version.ts` (fill `product` and `build` for Live, `available: true`; give Beta its own fixed build, because Beta reads the layer's build today and would show Live's), edit `web/src/data/build-versions.json` (`served: "live"`), and regenerate the layers from the Live snapshot. The layers cannot be regenerated until the launch build exists, so before L this branch holds only the two edits with the build left as a placeholder. | `cd web && npm test` fails on `game-version.test.ts` and `build-versions.test.ts` until the build, the layers and `served` all agree. A branch where they agree and tests pass is the goal. | Keep the branch as a draft. |
| 9 | Agent | Draft the launch-day `CHANGELOG.md` lines and any pinned post. Copy is for review; nothing is published. | Draft exists in the pull request. | n/a |
| 10 | Carlos | Check the asset storage and token state before the launch build exists: the upload key still works (a `--dry-run` of the upload script is enough, see step 17 for the command); the Worker has the private bucket settings and the cron secret among its secrets (`npx wrangler secret list` from `web/`) and the asset URL setting is a GitHub repository variable (the names are in `docs/ASSETS.md` and `docs/SEO.md`; do not paste values anywhere). | The dry run lists what it would upload and fails nothing. The settings are present. | Rotate or recreate the key per `docs/ASSETS.md`, "Owner steps for the buckets". |
| 11 | Carlos | Confirm the IndexNow key setting and `/indexnow.txt` (`docs/SEO.md`, "IndexNow"). | `https://everloot.app/indexnow.txt` shows the key. | Without it nothing is pinged; the sitemaps still work. |
| 12 | Carlos | Confirm Search Console and Bing Webmaster Tools have the three sitemaps submitted (`/sitemap.xml`, `/database-sitemap.xml`, `/auctions-sitemap.xml`). | Each shows as read. | Resubmit. |
| 13 | Agent | Re-run the smoke list. | Same as the T-7 record. | As step 2. |
| 13a | Agent | Confirm the Desktop App 0.1.8 release is published. In-game `/ask` answers from `answer_sources`, its follow-ups and the asking character's class, level and zone need addon 0.3.13 and Desktop App 0.1.8 (or the companion from `main`). | The `desktop-v0.1.8` GitHub release exists with its installers and `SHA256SUMS`. | Players on 0.1.7 still get answers, without the new ones. |

## Launch hour (L = 23:00 UTC; the build may appear earlier or later)

The build can be listed on Blizzard's version service before L and the game may not be playable until L.
Everything read from the product is a spoiler until it is live (`docs/DATA_POLICY.md`); the `live: true`
flag is the change that ends that. Do not set it before players can play.

| # | Owner | Step | Check and expected result | If it fails |
|---|---|---|---|---|
| 14 | Carlos | Confirm the build watch sees the launch build. `wowf` is already followed: `kb/lists/build-watch.yaml` (`live: false` until L, then `true`, step 20), the `builds-check` default that fills `kb/changes/builds.json`, and `FOREVER_PRODUCTS` in `kb/src/ecosystem.ts` (`docs/ASSETS.md` step 1). If the launch build is on another product id, change those in a pull request; an agent can write it, Carlos reviews and merges. | `npm run kb -- build-watch --dry-run` (needs no GitHub access) writes `kb/data/build-watch/out/dry-run/` with `plan.json` and `pr-body.md` for the launch build. | `--check` decides without reading game files. If the product id is wrong, `builds-check` shows the real one. |
| 15 | Agent | Watch for the pull request `data(game-data): build <version>`. The workflow polls at minutes 7 and 37 of each hour, so expect it within the hour. `gh pr list --search "game-build in:head"` (branches are `game-build/<product>-<buildId>-<config>`). Read the body: talents, raid buffs, map, spells, client read set, spoiler flags, and the folded "Answers this build changes" list (the question bank's answer key on the old and new files): those answers are what to recheck in game. When the written-answer scores are set up (`docs/BUILD_WATCH.md`, step 8), the PR also gets a comment with them. | A PR exists with a changelog entry in `web/src/data/game-data/changes/`. | `npm run kb -- build-watch --redo` refreshes an open PR. A closed PR is not reopened by the watch. Two failed runs in a row open the issue "Game build watch is failing". |
| 16 | Carlos | Make the client snapshot for the build, on a machine that can read the CDN: `cd kb && npm run kb -- client-extract --product <product> --refresh`, then `npm run kb -- client-assets data/client/<product>-<build>-<config>.sqlite`. Detail: `docs/ASSETS.md`, "What the extractor makes". | The counts printed (icons, tooltips resolved and unresolved, items, maps, skipped maps, missing frame pieces) are read, not skipped. | The extractor never decrypts; encrypted blocks are skipped and counted. |
| 17 | Carlos | **Upload before merging.** From `web/`, with the upload key in the environment: `node scripts/upload-game-assets.mjs --snapshot ../kb/data/client/<product>-<build>-<config>.sqlite --dry-run`, then without `--dry-run`; then the names: `npm run kb -- item-names` and `game-names` for the build (usage in `kb/src/cli.ts`) and `web/scripts/upload-item-names.mjs` (`docs/BUILD_WATCH.md`, "Upload before merging"; the exact arguments of the names upload are **[unverified]** here, read the script's header first). Then point the site's asset URL setting (a GitHub repository variable, read at build time) at the new folder. The folder is `<product>-<build>-<config>/` in the public bucket and `<product>-<build>-<config>-private/` in the private one. | The old build's folders are untouched, so the live site keeps working until the merge. | If a merge happens first, production shows "Item 25" for names and the item sitemap is empty until the upload and setting land (this happened with 70532, PR #369 records it). Upload, set the URL, redeploy. |
| 18 | Agent | Complete the switch branch from step 8 with the real build: the Live `product` and `build`, Beta's fixed build, `served: "live"`, regenerated layers (the same generators the build watch uses, `web/src/data/game-data/README.md`). If the build-watch PR already holds the regenerated layers, rebase on it instead of regenerating. | In `web/`: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` pass. `game-version.test.ts` and `build-versions.test.ts` pass, which proves the layers, the Live entry and `served` agree. | Do not merge with a failing agreement test. |
| 19 | Carlos | Merge in this order: the build-watch data PR, then the switch PR (or one combined PR). Each merge deploys production through the deploy-worker workflow (`.github/workflows/deploy-worker.yml`) once the Release checks pass on `main`, about ten minutes after the merge; when the second merge lands before the first one's checks finish, only the second deploys, with both. | The workflow run for the latest merge SHA is green, including the step that warms and checks every sitemap page. | Rollback: see the next section. |
| 20 | Carlos | Set `live: true` for the product in `kb/lists/build-watch.yaml` once players can play (this ends the spoiler flag for items read from it). | The next build-watch run's PR body no longer says the build is a spoiler. | Revert the one line. |
| 21 | Agent | Smoke the site after the deploy (list below), plus the switch checks: `/` shows the Live label in the header; `/beta` shows the notice with Beta's build and `noindex, follow`; `/ptr` shows "None running"; `/game-version/beta` still answers 308 to `/beta`; a known item page shows a name, not "Item N". | Each as stated. | Rollback. |

### Rolling back the switch

The switch is a code change. Rolling back is reverting the switch PR (and the data PR if the data is the
problem) and letting the deploy-worker workflow deploy `main` after its checks pass (about ten minutes), or
`npx wrangler rollback` from `web/` to the previous Worker version (Carlos), which is immediate. The old build's asset folders are never deleted by the upload, so the asset URL setting can be
pointed back at them. The release database and the layers are committed files, so a revert restores them.
No migration is part of the switch.

## T+1 hour

| # | Owner | Step | Check and expected result | If it fails |
|---|---|---|---|---|
| 22 | Agent | Full smoke list (below). | All as stated; `/api/health` says fresh; MCP `tools/list` returns 32 tools with no key. | Triage by path; see "Smoke list". |
| 23 | Agent | Confirm `/sitemap.xml` and `/database-sitemap.xml` answer 200 and list item pages with names. | `/database-sitemap.xml` is an index, not empty, not 503. | A 503 means upload storage could not be read; check the private bucket settings (Carlos). |
| 24 | Carlos | Ping the engines: the hourly cron pings IndexNow only when `/changes` has a new entry. For a launch announcement, `docs/SEO.md` gives the manual POST to `https://api.indexnow.org/indexnow`, or add the page to `changeUrlsToPing`. | Accepted by the endpoint. | The sitemaps are the fallback. |
| 25 | Carlos | Game login: install the addon from CurseForge or `/upload`, `/reload`, `/everloot status`, and run the in-client checks in `docs/2026-10-21-addon-0.3.10-launch-checklist.md`. Then `/ask` with the Desktop App running: `/ask where is the flight master here`, `/ask price 2589`, `/ask which bosses are in Deadmines` then `/ask what does he drop`, and one in Spanish (`/ask dónde queda Deadmines`). Then the combat log probes, section 9 of `docs/2026-10-28-live-client-capability-checklist.md` (can the game's logging be turned on, where the file is, what it holds; never paste it). Record the build and addon version. | Checks pass or the exceptions are written down. | Unchecked event names and API assumptions are listed in that document. |
| 26 | Carlos | Upload from the website and from the Desktop App with a launch character. | Both accept the rows (no invalid count). Rows show in `/database`. | See the 503 diagnosis in PR #332 (a rejected row is an install id that is not valid text). |
| 27 | Agent | Check that the intake accepts the launch realms and build: after step 26, `/api/corpus/public` is reachable and `/database` shows data as of a recent time. | Fresh "Data as of" line. | Open an issue; do not edit intake rules on launch day without review. |

## T+24 hours

| # | Owner | Step | Check and expected result | If it fails |
|---|---|---|---|---|
| 28 | Agent | Smoke list again; compare with the T-7 record. | Same results. | As above. |
| 29 | Agent | Confirm the build watch's next scheduled runs end quietly: the Actions runs are green and no "Game build watch is failing" issue is open. | Green runs, no issue. | `docs/BUILD_WATCH.md`, "Repeated failure". |
| 30 | Agent | Read `/database/coverage` and the MCP `coverage` tool; note what is below plateau. | Numbers are from uploads, not invented. | n/a |
| 30a | Agent | Re-run the question eval and the written-answer eval on the launch build's files, English and Spanish (`npm run kb -- question-bank --db <release> --spanish`, then `question-eval` and `question-answer-eval`), and read the question ledger's misses (`docs/DATA_POLICY.md`, "The question ledger"). Compare with `docs/evals/question-eval-2026-10-29-boss-names.md` and `answer-eval-2026-10-29-gemma3-4b-rules.md`. | A dated report in `docs/evals`; the misses are the next gap list. | n/a |
| 31 | Carlos | Decide what waits for Live data: the six-weapon check result into `CHECKED_WEAPONS`; the recheck scopes in `kb/curated/recheck.json` that the build watch added for moved zones; directory listings that still carry the old MCP tool count. | A list with owners. | n/a |
| 32 | Agent | Write the closeout: what ran, what was observed, what was skipped. No numbers that were not measured. | In the repository's closeout convention (`docs/2026-10-2x-lane-...-closeout.md`). | n/a |

## Smoke list

Run `python scripts/launch_smoke.py` from the repository root (add `--after-switch` once the switch is
deployed, steps 21 and later). It asks every path below, judges each answer as the table says, prints a
Markdown table to keep as the step's record and exits 1 when a check fails. It also checks that
`/database/items/25` shows a name. It needs only Python's standard library, and it never prints the
IndexNow key. First run: 2026-10-30, all 16 checks passed before the switch.

| Path | Expected |
|---|---|
| `/`, `/database`, `/database/coverage`, `/database/download` | 200 |
| `/beta`, `/beta/database/items/2589` | 200 before the switch (the same page as the unprefixed one, canonical unprefixed); after it, the notice |
| `/ptr` | 200, "PTR: None running", `noindex, follow` |
| `/game-version/beta`, `/game-version/ptr` | 308 to `/beta`, `/ptr` |
| `/sitemap.xml`, `/database-sitemap.xml` | 200 |
| `/api/health` | 200, fresh within 30 minutes; 503 when stale or storage cannot be read |
| `/indexnow.txt` | 200 with the key, if the IndexNow setting exists |
| MCP: POST `tools/list` to `https://everloot.app/mcp/public` | 32 tools (counted 2026-10-30), no key (`docs/SEO.md` names that endpoint; the endpoint answers 404 unless the public MCP switch is set in Production) |
| MCP: `tools/call` `answer_sources` with "which bosses are in Deadmines" | The first piece is the game files' fact, labelled *found in game files, unconfirmed* with the build, naming the bosses once each |

## Checks to run before opening any launch PR

The same ones CI runs (`.github/workflows/checks.yml`): `python scripts/check_md_links.py`,
`python scripts/check_internal_paths.py`, `python scripts/check_dco.py origin/main HEAD`,
`python scripts/check_no_ai_credit.py origin/main HEAD`, and `PR_TITLE="..." python scripts/check_pr_title.py`.
For code: `cd kb && npm test -- --maxWorkers=2 && npm run typecheck`; `cd web && npm test && npm run typecheck
&& npm run lint && npm run build`; the addon tests listed in `docs/2026-10-08-release-checklist.md`.

## Gaps: steps with no tested procedure

- **The build watch on `wowf`.** The live product id is `wowf`. `kb/lists/build-watch.yaml` follows it in
  place of the beta, still one product (`docs/BUILD_WATCH.md` says "the site reads one product, so the list
  has one entry"), with `live: false`. It has run on `wowf` twice: build 70685 (PR #548, merged 10/29) and
  70707 (PR #582, 10/30). Both PRs needed hand fixes to the build-pinned tests; until the build watch writes
  those itself, expect the same on the launch build.
- **Regenerating the layers for the Live build.** The generators exist and the build watch runs them, but
  the one-snapshot switch (replace Beta's layers with Live's, give Beta a fixed build) has been tested only
  with the test suite and a preview, never with a second real build.
- **The asset upload for a new build.** `docs/ASSETS.md` has the commands. The owner notes mention a card
  for build 70532; it was not found, so the steps above come from the repository docs only.
- **CurseForge and Wago upload.** Only the readiness notes mention it. No repository doc covers the listing.
- **Desktop App on the launch client.** The app detects any `_<product>_` folder, so no code change is
  expected, but nobody has seen it pick up the launch folder, and that folder's name is not known.
- **Launch realms and build in the intake.** Read from the code, not run against a launch build: the intake
  keeps no list of builds or realms. A build is any dotted number up to 32 characters (`CLIENT_BUILD` in
  `packages/protocol/src/records.ts`) and a realm any name of 2 to 60 characters, so a new build's rows are
  accepted. Tooltip numbers are agreed per build (`kb/src/item-facts.ts`): the launch build's reports count
  on their own, and a line already agreed on an earlier build keeps its decision. The settled tally skips a build the cron has not listed yet (`web/src/app/api/intake/route.ts`).
  Treat step 27 as an observation, not a test.
- **Weapon damage gate, expected counts file, settled-tally migration.** Owned by Carlos; not blockers.
- **Rollback of the asset URL setting.** Written from how the folders are laid out, not rehearsed.
