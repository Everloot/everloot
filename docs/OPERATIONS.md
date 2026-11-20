# Operations

The private dashboard, contributor attribution and restricted aggregate endpoint are documented in
[PRIVATE_OPERATIONS.md](PRIVATE_OPERATIONS.md).

How the live site is run. The launch on 2026-11-04 is the historical runbook in
[LAUNCH_DAY.md](LAUNCH_DAY.md). This page names settings and secrets and does not give their values,
and it does not describe dashboard steps.

Where data is stored is [DATA_PLACEMENT.md](DATA_PLACEMENT.md). How releases ship is
[RELEASING.md](RELEASING.md). Every workflow, including the ones not repeated here, is in
[WORKFLOWS.md](WORKFLOWS.md).

## The site is slow, or a check is red

Look at these, in this order.

1. An open issue labelled `site-down`. `.github/workflows/site-health.yml` opens one, or comments
   on the open one, and the comment names the check that failed.
2. `https://everloot.app/api/health`. What that answer means is below.
3. The latest run of `.github/workflows/deploy-worker.yml`. The warm step runs only after the
   deploy step, so a failed build or deploy has not been followed by the page check. A failed warm
   step means that deploy already finished. The step's log names the commit the home page did not
   show, or the page that did not answer 200.
   [WORKFLOWS.md](WORKFLOWS.md) records the same two cases: a failed build or deploy leaves the previous
   commit live; a failed warm step means the new version is live.

## A merge deploys

`.github/workflows/deploy-worker.yml` starts when the Release checks workflow completes on a push
to `main`. A manual run (`workflow_dispatch`) deploys the commit it is run on, without waiting for
checks. The job runs only while the repository variable `WORKER_DEPLOY` is `1`. On the automatic
path it also requires a successful Release checks run for a push to `main` in this repository.

The job reads the live commit from the home page's source link. It skips a commit the live one
already includes. It also skips a newer commit that changes nothing under `web/`, `kb/`,
`packages/protocol` or `.github/workflows/deploy-worker.yml`. When the live commit cannot be read,
or is not in the history, the commit is deployed.

Otherwise the job runs `npm run cf:deploy` from `web/` (`web/package.json`), which is
`node scripts/cf-deploy.mjs`. That step has `CLOUDFLARE_API_TOKEN` (secret) and
`CLOUDFLARE_ACCOUNT_ID` (repository variable). The public build-time values are the `NEXT_PUBLIC_*`
variables the same step lists.

The next step, "Warm and check the pages", runs from `web/`:

    node scripts/cf-warm.mjs https://everloot.app "$SHA"

`web/scripts/cf-warm.mjs` waits until the home page contains that commit, reads `/sitemap.xml`, and
requests pages from it. It asks for at most 80 pages and spends at most 120 seconds, including the
wait for the commit. Lore pages go first, one at a time; a lore page that answers 500 is asked once
more after 5 seconds. A 429, or a request that did not connect, is asked again twice. Every page it
did ask must answer 200, or the process exits 1. Pages it did not reach are printed and do not fail
the run.

The step sets `EVERLOOT_EDGE_CHECK`. The script sends that value as the `x-everloot-check` header.
Without the secret the header is left out (`web/scripts/cf-warm.mjs`).

## Rerun a failed warm step

The warm command does not deploy. From `web/`, with `EVERLOOT_EDGE_CHECK` set in the environment,
run it against the commit that was deployed:

    node scripts/cf-warm.mjs https://everloot.app <commit>

Use this when the warm step failed and you need to see whether those pages answer 200 now.
Re-running the whole workflow deploys again: a manual run deploys the commit it is run on.

## Roll back

Roll back when a second warm of that commit still fails because a page on the new version does not
answer 200. From `web/`:

    npx wrangler rollback

That command is the rollback in `web/README.md` and [RELEASING.md](RELEASING.md). A bare
`npx wrangler rollback` goes to the Worker version just before the current one
([the go-live note](2026-11-02-showcase-go-live.md)). The other way back is to re-run
`.github/workflows/deploy-worker.yml` on an older commit ([RELEASING.md](RELEASING.md)).

The version just before may be unhealthy too. To land on a known-good one, list the versions with
`npx wrangler versions list` and pass the chosen id: `npx wrangler rollback <version-id>`. Then confirm
recovery before calling it done: warm the commit that version was built from with
`node scripts/cf-warm.mjs https://everloot.app <commit>`, and run the Site health workflow by hand
(`gh workflow run site-health.yml`). Recovery is a clean warm and a green health run.

There is nothing to roll back when the build or deploy step failed, because the warm step never ran.

## The three cron schedules

`web/wrangler.jsonc` lists three cron triggers, and `web/wrangler.cron.jsonc` the same three (the cron
Worker below). `web/src/lib/cf-crons.ts` maps each one to routes.
`web/scripts/cf-entry.mjs` calls those routes with `Authorization: Bearer` plus `CRON_SECRET`
(`web/.env.example`). If `CRON_SECRET` is unset, the entry throws and nothing runs. Each route also
answers 503 in that case and does not write.

| Schedule | Route | What a run writes |
|---|---|---|
| `*/10 * * * *` | `/api/cron/snapshot` | The corpus snapshot, then the market, completion and census rollups, then the heartbeat object `cron/last-run.json`. After the heartbeat come the settled list (stamped with the snapshot and the ISO week, so a new week rewrites it with no new upload), the stored views (item view, aggregates, search names, auction history, professions, map pins, database activity), the guild ladder, the Auction House boards, the coverage score and the auction reports. Each of those is rewritten whenever its stamp is not the snapshot's, so an idle run catches up on one a run could not write. A failed snapshot, market or completion step answers 500 and does not move that heartbeat, so the next run retries the same uploads (`web/src/app/api/cron/snapshot/route.ts`, `web/src/lib/upload-store.ts`). |
| `*/10 * * * *` | `/api/cron/blue` | The objects `changes/blue-posts.json` and `changes/blue-fetch-state.json` (`web/src/lib/blue-store.ts`). New posts revalidate the `blue` cache tag (`web/src/app/api/cron/blue/route.ts`). |
| `23 * * * *` | `/api/cron/indexnow` | Nothing in storage. When `/changes` has an entry from the last two hours, the run submits `/changes`, `/changes/feed.xml` and `/wow-forever` (`web/src/lib/indexnow.ts`). No `INDEXNOW_KEY` means nothing is sent. An empty list sends nothing (`web/src/app/api/cron/indexnow/route.ts`). |
| `7,37 * * * *` | `/api/cron/profiles` | The gear-board snapshot and each ranked character's tracking points (`web/src/lib/profile-pipeline.ts`). The route writes only when `leaderboardsOn()` is true: `EVERLOOT_LEADERBOARDS`, `EVERLOOT_CHARACTER_LINKS`, `EVERLOOT_SHOWCASE` and `EVERLOOT_PRIVATE_SYNC` each set to `1` (`web/src/lib/leaderboard-switch.ts`). Otherwise it writes nothing and answers `ok: true`, `skipped: "off"` (`web/src/app/api/cron/profiles/route.ts`). |

`?rebuild=1` on `/api/cron/snapshot` rebuilds the snapshot and the market rollup from empty, and the
same flag is passed to the census, coverage, settled-list, item-view and aggregate writes. The
completion rebuild is folded into a separate object over several runs and replaces the served rollup
only when it has caught up (`web/src/app/api/cron/snapshot/route.ts`). The same query on `/api/cron/profiles`
makes that run a full pass. `/api/cron/blue` and `/api/cron/indexnow` do not read it.

A cron route that answers outside 200 to 299 makes `web/scripts/cf-entry.mjs` throw, so the
trigger is recorded as failed.

## The cron Worker

The site Worker `everloot-web` runs the jobs above in the same isolates that serve pages and
`/mcp/public`. A self-request through `WORKER_SELF_REFERENCE` lands in the same isolate, and the
128 MB memory limit is per isolate, so the snapshot job and page traffic can push each other past it
(`exceededMemory`). The run then dies before it writes `cron/last-run.json`, and `/api/health`
answers 503 `stale` (#1354, #1392).

`web/wrangler.cron.jsonc` deploys the same `.open-next` build a second time as the Worker
`everloot-cron`. It has the same triggers, vars and bindings as the site, except:

- no routes, no workers.dev host and no preview URLs, so no visitor request reaches it;
- `WORKER_SELF_REFERENCE` points at `everloot-cron`, so its jobs run in its own isolates;
- the revalidation queue binding names the site's Durable Object (`script_name: "everloot-web"`),
  so it declares no class and no migration;
- every invocation is logged, not one in ten.

`web/src/lib/cf-crons.test.ts` holds the two files equal apart from those lines. A change to the
site's vars, bindings, knowledge release or compatibility date goes into both files.

Which Worker runs which job is the var `EVERLOOT_CRON_WORKER` (`runCrons` in
`web/src/lib/cf-crons.ts`):

- unset, on the site before the switch: every job, as before;
- `"cron"`, on the cron Worker (set in `wrangler.cron.jsonc`): every job but `SITE_JOBS`;
- `"1"`, on the site after the switch: `SITE_JOBS` only.

`SITE_JOBS` is `/api/cron/ops`. It keys install pseudonyms with `EVERLOOT_OPS_HMAC_SECRET`, which
only the site holds; the cron Worker would need the same value, and another one would change every
pseudonym in the summary. The var is left out of the edge cache's versions
(`web/scripts/cache-versions.mjs`), so switching it does not empty the page cache.

The cron routes on the site stay where they are, behind `CRON_SECRET`, so a job can still be called
by hand on `https://everloot.app/api/cron/...`. Those calls run in the site's isolates.

### Both Workers running the jobs for a while

Between the cron Worker's first run and the switch, both Workers run every job but `/api/cron/ops`
at the same minute. That is safe:

- The corpus snapshot, market, completion and census writes are conditional on the ETag each run
  read at its start (`web/src/lib/upload-store.ts`). When both runs fold the same uploads, the later
  write is refused with 412. That run answers 500 before it writes any view or the heartbeat, and its
  trigger is recorded as failed. The other run's data stands; nothing is counted twice or lost.
- The views written after them (item view, aggregates, search names, auction history, professions,
  map pins, database activity, coverage, settled list, market boards, auction reports, guild
  ladder) are whole-file writes from the same snapshot. Whichever run writes last wins, with the
  same content. The heartbeat is the same.
- The prunes (intake quota, API keys, players, pull summaries) delete by age; a second pass deletes
  nothing more.
- `/api/cron/blue` reads the forum feeds twice in that slot and both runs write the same store.
  `/api/cron/indexnow` can submit the same URLs twice in the hour. `/api/cron/profiles` deletes a
  file that is already gone, which counts as success.

The cost is a red trigger now and then on whichever Worker lost a race, and twice the R2 and
Supabase reads. Keep the overlap short: switch after the first good run.

### Secrets

The cron Worker has its own secrets; it does not see the site's. Cloudflare does not show a
secret's value. The names are from `npx wrangler secret list --name everloot-web` and from what the
four cron routes it runs import.

| Name | Read by | Value |
|---|---|---|
| `CRON_SECRET` | the trigger and every cron route | its own; the site's routes keep the site's |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | every stored file: uploads, snapshot, rollups, views, heartbeat, blue posts | any key pair that can read, write and delete in `everloot-uploads` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | the upload index the snapshot reads, and the quota, API key, player and pull prunes | the project's service role key or a secret key |
| `EVERLOOT_TRUSTED_INSTALLS` | which installs publish market and census alone | the site's: a different list builds different data |
| `GAME_DATA_ACCESS_KEY_ID`, `GAME_DATA_SECRET_ACCESS_KEY`, `GAME_DATA_BUCKET`, `GAME_DATA_S3_ENDPOINT` | the private game-data store the auction reports, market boards and coverage read | a key that can read `everloot-game-data` |
| `INDEXNOW_KEY` | `/api/cron/indexnow` | the site's, which `https://everloot.app/indexnow.txt` shows |

`EVERLOOT_CHARACTER_KEY` and the `EVERLOOT_OPS_*` and `EVERLOOT_USAGE_METRICS` values are not
needed: no job the cron Worker runs calls `characterSecret()`, and `/api/cron/ops` stays on the site.

Not needed by any cron route: `AHLEDGER_API_KEY`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
`BNET_CLIENT_ID`, `BNET_CLIENT_SECRET`, `BNET_REDIRECT_URI`, `DISCORD_CLIENT_ID`,
`DISCORD_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_ID`,
`MICROSOFT_CLIENT_SECRET`, `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `EVERLOOT_MCP_TOKEN`,
`EVERLOOT_OPS_AGENT_TOKEN_HASHES`, `EVERLOOT_OPS_CONTRIBUTOR_USER_IDS`, `EVERLOOT_OPS_USER_IDS`.
A secret added to the site later and read by a cron route must be added to the cron Worker too.

### Switching over

Merging the change that added the cron Worker changes nothing in production: the deploy skips it
until `DEPLOY_CRON_WORKER` is set, and the site keeps running the jobs while `EVERLOOT_CRON_WORKER`
is unset.

1. **Deploy it.** Set the repository variable and deploy `main` by hand:

       gh variable set DEPLOY_CRON_WORKER --body true -R Everloot/everloot
       gh workflow run deploy-worker.yml -R Everloot/everloot --ref main

   The run deploys the site, then "Deploy the cron Worker from the same build" deploys
   `everloot-cron` from the same build with `npx wrangler deploy --config wrangler.cron.jsonc`. The
   deploy token needs to be allowed to create a Worker in the account, not only to edit
   `everloot-web`. Until the secrets are set, each of its triggers fails with "CRON_SECRET is not
   set; nothing ran" and runs nothing.

2. **Set its secrets.** Write the names in the table above and their values to a JSON file outside
   the repository (`{ "CRON_SECRET": "...", ... }`), then from `web/`:

       npx wrangler secret bulk <path-outside-the-repo>/everloot-cron-secrets.json --name everloot-cron
       npx wrangler secret list --name everloot-cron

   Delete the file. The list should show the names in the table. `secret bulk` deploys one new
   version with them, and later deploys keep them. One at a time works too:
   `npx wrangler secret put CRON_SECRET --name everloot-cron` asks for the value.

3. **See a good run.** Both Workers now run the jobs. From `web/`, across one ten-minute mark:

       npx wrangler tail everloot-cron --format pretty

   A good run shows the `*/10 * * * *` trigger `ok` and `GET /api/cron/snapshot` and
   `GET /api/cron/blue` answering 200. A 500 from the snapshot with "snapshot write failed (412)" in
   its log is the race above, not a fault; look at the next mark. Then check the heartbeat and
   health:

       npx wrangler r2 object get everloot-uploads/cron/last-run.json --remote --file last-run.json
       curl -s -A ops-check https://everloot.app/api/health

   `generatedAt` in `last-run.json` should be from that ten-minute mark, and `/api/health` should
   answer 200 with `"status":"fresh"`. The Workers dashboard's cron history for `everloot-cron`
   lists each trigger as succeeded or failed.

4. **Switch.** In a pull request, add `"EVERLOOT_CRON_WORKER": "1"` to the vars in
   `web/wrangler.jsonc` (the comment there marks the place) and nothing to
   `web/wrangler.cron.jsonc`. Merge it once step 3 has shown a good run. The deploy that follows
   stops the site running the jobs but `/api/cron/ops`. Afterwards `npx wrangler tail everloot-web`
   shows the triggers ending `ok` with no `/api/cron/*` request except `/api/cron/ops` at minute 23,
   and `/api/health` stays `fresh` for the next half hour.

A later change can remove the site's triggers; they cost one empty invocation per schedule until
then.

**Going back.** To run the jobs on the site again, revert the switch's pull request (or
`npx wrangler rollback --name everloot-web` to the version before it). To stop the cron Worker
without a deploy, `npx wrangler secret delete CRON_SECRET --name everloot-cron`: its triggers then
run nothing. Set `DEPLOY_CRON_WORKER` to anything but `true` to stop deploying it.

## What `/api/health` answers

`web/src/app/api/health/route.ts` answers JSON `{ ok, snapshot }` with `Cache-Control: no-store`.
`ok` is true and the status is 200 only when `snapshot.status` is `fresh`. Any other status is 503.
The route reads the snapshot at most once a minute.

`fresh` means the heartbeat object `cron/last-run.json` has a `generatedAt` within the last 30
minutes (`web/src/lib/upload-store.ts`): the corpus and the rollups are current. It
does not say every stored view finished; a view that failed has an older `x-amz-meta-data-as-of`
stamp than the snapshot's `generatedAt`. Older than that is `stale`. A missing object is `missing`.
A read that fails, a timestamp that does not parse, or one more than 30 seconds in the future, is
`unavailable`.

## What the site-health workflow does

`.github/workflows/site-health.yml` runs at `7,22,37,52 * * * *`, and by hand. It asks
`https://everloot.app/api/health`, then `https://everloot.app/database/items/25`, then
`POST https://everloot.app/mcp/public` with `tools/list`. It sends `EVERLOOT_EDGE_CHECK` as
`x-everloot-check` on the health and item requests only; the MCP request goes without it, because it
measures the public allowance. The requests name themselves `Everloot-SiteHealth` in the user agent.

A failure opens one issue labelled `site-down`, or comments on the open one, and the run exits 1.
The next clean check closes those issues. The comment records which of these it saw:

- `/api/health` answered something other than 200
- `/database/items/25` came back with `cf-mitigated` (the bot rules stopped the check), answered
  something other than 200, or had no title or a title starting with `Item 25`
- `/mcp/public` answered 429 (its hourly allowance is used up), or answered without a tool list

## Where the other scheduled workflows write

| Workflow | Where it writes |
|---|---|
| `.github/workflows/nightly.yml` | A GitHub pre-release tagged `nightly-<date>.<run>`, and it deletes all but the newest five. The site's download stays on the stable release. |
| `.github/workflows/build-watch.yml` | One pull request from a `game-build/<product>-<build>-<hash>` branch. It never merges. Two failed scheduled runs in a row open an issue titled "Game build watch is failing". |
| `.github/workflows/changes.yml` | `kb/changes/builds.json` on one rolling pull request from `data/changes`. It merges that pull request only when the diff stays inside `kb/changes/blue-posts.json` and `kb/changes/builds.json` and every check on the head has passed. |
| `.github/workflows/discord-bridge.yml` | Runs `python scripts/discord_bridge.py`. The scheduled and issue runs mirror `#help` posts tagged Bug and `#ideas` posts with GitHub issues, keep the known-issues list in the pinned Start here post in `#help` and greet new members in `#general`; the Monday run posts the week's changes in `#updates`. A release, discussion, push to `main` or new pull request becomes a post in the matching channel. It needs `DISCORD_BOT_TOKEN`. |
| `.github/workflows/ecosystem.yml` | `kb/changes/ecosystem.json` on one rolling pull request from `data/ecosystem`. It never pushes to `main` and never merges. |
