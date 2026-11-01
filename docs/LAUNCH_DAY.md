# Launch day: 2026-11-04

WoW: Forever launches globally on November 4, 2026, at 3:00 p.m. PST, which is 23:00 UTC (Blizzard's
sentence, kept in `web/src/data/wow-forever.ts` as `LAUNCH` and `LAUNCH_AT`; last read 2026-10-17). Times
below are relative to that hour, "L".

This page is the order of work, not the detail. Each step points at the document that holds the detail.
It was written on 2026-10-23 from what is in the repository and refreshed on 2026-10-31 (addon 0.3.14 Alpha, Desktop App 0.1.10, build 70707 and production receipts). A step marked **[unverified]** has no tested
procedure behind it yet; the list of those is at the end.

Two rules for this page and for anything done from it:

- No secret value goes in a pull request, a log or a chat message. Steps name the setting, never its value.
  Where a setting has a name in another document (`docs/ASSETS.md`, `docs/SEO.md`), this page says "the
  asset URL setting" or similar and does not repeat the name. The same rule is why
  `kb/src/build-watch/render.ts` says "the site's asset URL setting" in the pull request body.
- The build watch never merges. Maintainer-authorized changes still use protected pull requests and the checked deployment workflow. The Live switch stays draft until players can play; a scheduled preflight does not authorize an early switch.

Owners: **Carlos** supplies account sign-in and real game observations. **Agent** handles repository work, public checks and already-authorized account operations. Keep separately owned authentication activation out of the launch switch.

## What changes at launch

| What | Today | At launch | Where |
|---|---|---|---|
| Build the site shows | Beta: the `wowf` build the layers hold (1.60.1.70707 on 2026-10-31) | Live, the launch build: the same product, read from the same layers | the layers in `web/src/data/game-data/` |
| Unprefixed pages (`/`, `/database`, ...) | show Beta | show Live, same URLs | `served` in `web/src/data/build-versions.json` |
| `/beta/...` | the same pages as unprefixed | the notice "Beta: None running since launch, 2026-11-04" (noindex) | `web/next.config.js` rewrites |
| `/ptr/...` | the notice "None running" | unchanged | same |
| Live entry in the header | "Available at launch, 2026-11-04", not selectable | read from the layers, `available: true`; Beta has no build | `web/src/lib/game-version.ts` |
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
| 3 | Carlos | Check Blizzard's version service for `wowf`, WoW: Forever's own product, with `cd kb && npm run kb -- builds-check` (the default asks for `wowf`, `wow_classic_beta` and `wow_classic_era`). `kb/lists/build-watch.yaml` follows `wowf` with `live: false` until players can play (step 20). | The output shows `wowf` and its newest build (1.60.1.70707 on 2026-10-31; the launch build may be newer). | Check again each day; see T-1. |
| 4 | Agent / Carlos | Addon 0.3.14 Alpha is released on GitHub and [publicly available on CurseForge](https://www.curseforge.com/wow/addons/everloot/files/9380990), with Download and Install Via App controls verified 2026-10-31. Tagged releases upload the tested archive automatically (`docs/RELEASING.md`). Wago release parity remains unverified. | The listing version matches `/upload`; actual addon installation is checked separately. | Do not duplicate an existing upload. GitHub and `/upload` remain the download fallback. |
| 5 | Carlos | Run the six-weapon section of [the acceptance card](2026-10-31-launch-acceptance.md) on the current build. Record item IDs, item levels, quality, speed and exact damage lines; the original comparison values came from an older build. | Only observed current-build results may populate `CHECKED_WEAPONS` in `kb/src/assets/weapon-damage.ts`. | Keep the gate empty and the `[?]` damage label until the formula is verified. This is allowed at launch. |
| 6 | Agent | Done for 70707: uploaded counts-only `coverage-expected.json` for 50 zones and read it back byte for byte. Repeat for a newer launch build using `web/scripts/upload-coverage-expected.ts` and that build's snapshot/report; never publish the report itself. | `/database/coverage` reads the build's expected counts; upload validates snapshot, build and folder. | Keep the missing-denominator state explicit for any build without verified expected counts. |
| 7 | Carlos | Run [the native and upload acceptance card](2026-10-31-launch-acceptance.md) with Desktop App 0.1.10 and addon 0.3.14. The app lists `_<product>_` folders; actual launch-folder detection remains unverified. | Record install/update, settings retention, tray/reopen and the exact detected folder. | Preserve existing settings and game files; record the actual failure. |

## T-1 day (2026-11-03)

| # | Owner | Step | Check and expected result | If it fails |
|---|---|---|---|---|
| 8 | Agent | Done 2026-10-30: draft PR #584, "at launch the site serves Live". The beta was WoW: Forever's own product, `wowf`, the one Live is, so Live reads its product and build from the layers as Beta did, and Beta gets no build ("None running since launch"). `served: "live"`. No placeholder: the launch build's data PR sets the build. The tests that named `/beta` as the served prefix now read it from the routing table (#583, merged before launch). | With #583 underneath, the web tests pass on the draft branch. | Keep the branch as a draft. |
| 9 | Agent | Draft exists: `kb/news/everloot-on-wow-forever-launch-day.md` remains a draft (#592 merged). Review facts against the launch build and prepare release-day changelog lines. | Nothing is published until the launch switch is deployed and its checks pass. | Keep the post in draft. |
| 10 | Agent / Carlos | Check storage access and token expiry for the launch build. The 70707 upload succeeded; its short-lived upload token expires before launch and must not be assumed reusable. A `--dry-run` validates local files, not authentication. Confirm current token expiry and permissions or create a fresh short-lived object read/write token scoped to the two asset buckets when needed; check the Worker's existing private bucket/cron settings and the repository asset URL setting. | Authenticated access succeeds without logging credentials; the settings and build folder agree. | Recreate the scoped upload key per `docs/ASSETS.md`; do not change unrelated bindings or authentication flags. |
| 11 | Carlos | Confirm the IndexNow key setting and `/indexnow.txt` (`docs/SEO.md`, "IndexNow"). | `https://everloot.app/indexnow.txt` shows the key. | Without it nothing is pinged; the sitemaps still work. |
| 12 | Agent | Verified 2026-10-31 in Search Console and Bing: all three root sitemaps (`/sitemap.xml`, `/database-sitemap.xml`, `/auctions-sitemap.xml`) plus `/database-sitemap/0.xml` show Success. Bing reports zero errors/warnings. Recheck at launch. | Each engine has read the submitted sitemaps. Discovered URL counts are not indexed-page counts. | Inspect the failing sitemap before resubmitting; do not submit duplicates when already successful. |
| 13 | Agent | On 2026-11-03, run `python scripts/launch_smoke.py`, save the dated output and check the deployed commit/build against current main. The 2026-10-31 baseline passed all 16 checks. | All checks pass before changing the served version. | Investigate failures before the launch switch. |
| 13a | Agent | Desktop App 0.1.10 is published for Windows setup/portable, macOS arm64 and Linux, with `SHA256SUMS`; the three-platform publishing workflow passed. Addon 0.3.14 and Desktop 0.1.10 together include `/ask` retry recovery. | Release artifacts exist; native/live-game acceptance is recorded separately on [the acceptance card](2026-10-31-launch-acceptance.md). | A successful package build does not count as an observed install or in-game test. |

## Launch hour (L = 23:00 UTC; the build may appear earlier or later)

The build can be listed on Blizzard's version service before L and the game may not be playable until L.
Everything read from the product is a spoiler until it is live (`docs/DATA_POLICY.md`); the `live: true`
flag is the change that ends that. Do not set it before players can play.

| # | Owner | Step | Check and expected result | If it fails |
|---|---|---|---|---|
| 14 | Carlos | Confirm the build watch sees the launch build. `wowf` is already followed: `kb/lists/build-watch.yaml` (`live: false` until L, then `true`, step 20), the `builds-check` default that fills `kb/changes/builds.json`, and `FOREVER_PRODUCTS` in `kb/src/ecosystem.ts` (`docs/ASSETS.md` step 1). If the launch build is on another product id, change those in a pull request; an agent can write it, Carlos reviews and merges. | `npm run kb -- build-watch --dry-run` (needs no GitHub access) writes `kb/data/build-watch/out/dry-run/` with `plan.json` and `pr-body.md` for the launch build. | `--check` decides without reading game files. If the product id is wrong, `builds-check` shows the real one. |
| 15 | Agent | Watch for the pull request `data(game-data): build <version>`. The workflow polls at minutes 7 and 37 of each hour, so expect it within the hour. `gh pr list --search "game-build in:head"` (branches are `game-build/<product>-<buildId>-<config>`). Read the body: talents, raid buffs, map, spells, client read set, spoiler flags, and the folded "Answers this build changes" list (the question bank's answer key on the old and new files): those answers are what to recheck in game. When the written-answer scores are set up (`docs/BUILD_WATCH.md`, step 8), the PR also gets a comment with them. | A PR exists with a changelog entry in `web/src/data/game-data/changes/`. | `npm run kb -- build-watch --redo` refreshes an open PR. A closed PR is not reopened by the watch. Two failed runs in a row open the issue "Game build watch is failing". |
| 16 | Carlos | Make the client snapshot for the build, on a machine that can read the CDN: `cd kb && npm run kb -- client-extract --product <product> --refresh`, then `npm run kb -- client-assets data/client/<product>-<build>-<config>.sqlite`. Detail: `docs/ASSETS.md`, "What the extractor makes". | The counts printed (icons, tooltips resolved and unresolved, items, maps, skipped maps, missing frame pieces) are read, not skipped. | The extractor never decrypts; encrypted blocks are skipped and counted. |
| 17 | Agent / Carlos | **Upload before merging.** Extract and upload the new build with `web/scripts/upload-game-assets.mjs`, then upload each names file using `web/scripts/upload-item-names.mjs <names-folder>/<file>.json --folder=<build-folder>` for `item-names`, `quest-names`, `item-set-names` and `spell-names`. Upload that build's expected counts with the coverage uploader. Point the repository asset URL setting at the new folder only after verification. The public and private buckets both use the build prefix; `-private` is the local extraction directory suffix. | For 70707 these steps succeeded, including private coverage byte-for-byte readback. For the launch build, verify manifest, names and a named item page after deploy. | Preserve old folders. Do not merge data whose matching asset folder is unavailable. |
|
|
| 20 | Carlos | Set `live: true` for the product in `kb/lists/build-watch.yaml` once players can play (this ends the spoiler flag for items read from it). | The next build-watch run's PR body no longer says the build is a spoiler. | Revert the one line. |
| 21 | Agent | Smoke the site after the deploy (list below), plus the switch checks: `/` shows the Live label in the header; `/beta` shows the notice "Beta: None running since launch" and `noindex, follow`; `/ptr` shows "None running"; `/game-version/beta` still answers 308 to `/beta`; a known item page shows a name, not "Item N". | Each as stated. | Rollback. |

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
| 25 | Carlos | When the client is playable, use [the acceptance card](2026-10-31-launch-acceptance.md): addon status/selftest, `/ask` questions, follow-up and Spanish questions, then current-build weapon tooltips. The broader event/API and combat-log probes remain in `docs/2026-10-28-live-client-capability-checklist.md`. Record exact game/addon/Desktop versions. | Record each observed pass/failure; never count source tests as live-game acceptance. | Keep raw captures local and record only the needed redacted result. |
| 26 | Carlos | Run the acceptance card's website and Desktop upload checks with a launch character. | Both show accepted rows with no invalid rows; recorded data appears after the snapshot refresh. | Record HTTP status, accepted/invalid counts and time; preserve the original save file. |
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
IndexNow key. First run: 2026-10-30, all 16 checks passed before the switch. On 2026-11-01 the `/addon` and
`/upload` download checks were added (18 checks); `/addon` failed then, showing its "not available" fallback.
Later that day the talent build and raid plan link preview cards were added (20 checks); both answered 500 then.

| Path | Expected |
|---|---|
| `/`, `/database`, `/database/coverage`, `/database/download` | 200 |
| `/beta`, `/beta/database/items/2589` | 200 before the switch (the same page as the unprefixed one, canonical unprefixed); after it, the notice |
| `/ptr` | 200, "PTR: None running", `noindex, follow` |
| `/game-version/beta`, `/game-version/ptr` | 308 to `/beta`, `/ptr` |
| `/sitemap.xml`, `/database-sitemap.xml` | 200 |
| `/api/health` | 200, fresh within 30 minutes; 503 when stale or storage cannot be read |
| `/addon`, `/upload` | 200, a link to the served addon zip; `/addon` also links a Desktop App installer; neither shows the "not available" or "could not be loaded" fallback |
| `/indexnow.txt` | 200 with the key, if the IndexNow setting exists |
| `/tools/talents/mage/card?a=<code>&b=-`, `/tools/raid/card?c=<code>` | 200, `image/png`: the link previews of a shared build and a raid plan, drawn on each request |
| MCP: POST `tools/list` to `https://everloot.app/mcp/public` | 32 tools (counted 2026-10-30), no key (`docs/SEO.md` names that endpoint; the endpoint answers 404 unless the public MCP switch is set in Production) |
| MCP: `tools/call` `answer_sources` with "which bosses are in Deadmines" | The first piece is the game files' fact, labelled *found in game files, unconfirmed* with the build, naming the bosses once each |

## Checks to run before opening any launch PR

The same ones CI runs (`.github/workflows/checks.yml`): `python scripts/check_md_links.py`,
`python scripts/check_internal_paths.py`, `python scripts/check_dco.py origin/main HEAD`,
`python scripts/check_no_ai_credit.py origin/main HEAD`, and `PR_TITLE="..." python scripts/check_pr_title.py`.
For code: `cd kb && npm test -- --maxWorkers=2 && npm run typecheck`; `cd web && npm test && npm run typecheck
&& npm run lint && npm run build`; the addon tests listed in `docs/2026-10-08-release-checklist.md`.

## Verified release state (2026-10-31)

- Build 70707 assets, names and expected coverage are live; the form quota scope is isolated from uploads.
- The HTTP 5xx/429 monitor is enabled. The latest production smoke passed all 16 checks.
- Addon 0.3.14 Alpha is released and uploaded to CurseForge; Desktop App 0.1.10 installers are published.
- Build-watch test generation (#586) removed the manual build-pinned test edits. The 70707 update (#582)
  merged after retaining those generated-build tests.
- Search Console and Bing report Success for all submitted sitemaps. This proves receipt, not indexing.

## Remaining observations and launch gates

- **Playable game:** keep #584 draft and `live: false` until players can log in. A listed build or the
  scheduled launch time alone is insufficient. Refresh the draft against current main and the actual launch build.
- **Native and live-client acceptance:** use [the acceptance card](2026-10-31-launch-acceptance.md).
  Install/update/recovery, actual folder detection, uploads, `/ask` recovery and the six weapon readings
  still need observations. The broader capability checklist keeps its own unverified event/API cases.
- **Wago parity:** the current Wago release remains unverified; the CurseForge 0.3.14 page is public.
- **New launch build:** 70707 upload proof does not cover a later build; repeat extraction, uploads and checks.
- **Intake:** no build/realm allowlist is kept, but a real launch upload must still be observed. Record actual
  accepted/invalid counts and subsequent snapshot freshness rather than assuming compatibility.
- **Weapon damage:** `CHECKED_WEAPONS` remains empty; no inferred range is published before client validation.
- **Settled tallies:** retain their separate migration and data-policy gates; verify their current state before any change.
- **Asset rollback:** old folders are retained; changing the asset URL back remains an unrehearsed recovery step.
- **Authentication rollout:** database connectivity, provider acceptance and feature activation have a separate
  owner and their own gates. They are not prerequisites to silently change during the Live switch.
