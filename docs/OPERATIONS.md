# Operations

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

`web/wrangler.jsonc` lists three cron triggers. `web/src/lib/cf-crons.ts` maps each one to routes.
`web/scripts/cf-entry.mjs` calls those routes with `Authorization: Bearer` plus `CRON_SECRET`
(`web/.env.example`). If `CRON_SECRET` is unset, the entry throws and nothing runs. Each route also
answers 503 in that case and does not write.

| Schedule | Route | What a run writes |
|---|---|---|
| `*/10 * * * *` | `/api/cron/snapshot` | The corpus snapshot, then the market, completion, census, coverage, settled-list, item-view and aggregate rollups, and the heartbeat object `cron/last-run.json`. A failed snapshot, market or completion step answers 500 and does not move that heartbeat, so the next run retries the same uploads (`web/src/app/api/cron/snapshot/route.ts`, `web/src/lib/upload-store.ts`). |
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

## What `/api/health` answers

`web/src/app/api/health/route.ts` answers JSON `{ ok, snapshot }` with `Cache-Control: no-store`.
`ok` is true and the status is 200 only when `snapshot.status` is `fresh`. Any other status is 503.
The route reads the snapshot at most once a minute.

`fresh` means the heartbeat object `cron/last-run.json` has a `generatedAt` within the last 30
minutes (`web/src/lib/upload-store.ts`). Older than that is `stale`. A missing object is `missing`.
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
| `.github/workflows/discord-bridge.yml` | Runs `python scripts/discord_bridge.py`. The scheduled and issue runs mirror `#bug-reports` with GitHub issues and keep the `#known-issues` list. A release, discussion, push to `main` or new pull request becomes a post in the matching channel. It needs `DISCORD_BOT_TOKEN`. |
| `.github/workflows/ecosystem.yml` | `kb/changes/ecosystem.json` on one rolling pull request from `data/ecosystem`. It never pushes to `main` and never merges. |
