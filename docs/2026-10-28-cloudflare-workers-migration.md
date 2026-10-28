# Moving the site from Vercel to Cloudflare Workers

Decided 2026-10-28: the site moves to Cloudflare Workers (Workers Paid, $5 a month per account), and
`everloot.app` switches after the 11/04 launch, once the Workers build serves everything the Vercel one does.
Until then production stays on Vercel and nothing here touches its DNS.

## Why

On the Vercel usage page, six days into the Oct 22 to Nov 22 cycle, the site had used $35.02: function CPU $10.86,
build CPU $9.49 (Elastic build machines), observability events $6.91, origin transfer $4.05, memory $1.91, invocations
$1.25. That is a ~$175 month. The same workload on Workers Paid is about $40: no charge for egress, memory or static
files, CPU at about half the rate, builds in GitHub Actions or Workers Builds (6,000 minutes included). About 40% of
function calls in a 12-hour sample were one crawler (`meta-externalagent`) re-reading the item lists; Cloudflare's
bot controls can stop it at the edge.

## Where it stands (spike, 2026-10-28)

- `web/wrangler.jsonc` and `web/open-next.config.ts`; `@opennextjs/cloudflare` 1.20.14 and `wrangler` 4.154.0.
- `npx opennextjs-cloudflare build` passes on Next.js 15.5.28. Upload is 30,539 KiB, **5,816 KiB gzip** (limit 10 MiB).
- Deployed as the Worker `everloot-web` at `everloot-web.<account>.workers.dev`, behind Cloudflare Access
  (Cloudflare account members only, all traffic). 🔴 **Before the domain moves, switch Access to "Previews only" or
  remove it**, or `everloot.app` itself asks for a sign-in.
- Works with no server secrets set: `/`, `/database`, item lists, zone pages, `/map`, `/changes`, `/lore` (index),
  `/search`, `/tools`, `/classes/choose`.
- Local loop: `npx opennextjs-cloudflare build`, then `npx wrangler dev --port 8787` (workerd, no Access, errors
  in the console).

## What has to change

### 1. Page cache (blocks pre-built and ISR pages)

`/tools/talents/[class]` and the other pages built at build time answer `NoFallbackError` until OpenNext has an
incremental cache. ISR pages (`revalidate`, the lore pages) need it too. Add an R2 bucket binding
`NEXT_INC_CACHE_R2_BUCKET` with `r2IncrementalCache`, the Durable Object queue for revalidation, and a tag cache:
`revalidateTag`/`revalidatePath` are called from `api/cron/blue`, `api/guilds/hide`, `api/players/opt-out` and
`players/page.tsx`.

### 2. Reading repository files at run time

A Worker has no file system of the repository. These read files when a request comes in and must read data bundled
at build time (a generated module, or a static asset fetched through the `ASSETS` binding):

- `web/src/lib/`: `news.ts` (`kb/news`), `guides.ts` and `guide-submissions.ts` (`kb/guides`), `wiki.ts`,
  `addon-release.ts`, `everloot-releases.ts`, `bulk-export.ts`, `settled-cache.ts`, `sharing-store.ts`,
  `upload-store.ts` (local directory mode only; production uses R2), `og-card.tsx`.
- `web/src/app/`: `classes/choose/page.tsx`, `docs/cookbook/drop-rates-spreadsheet/page.tsx`,
  `opengraph-image.tsx`, `schema/[...path]/route.ts`.
- `kb/src/` modules the site imports that read files: `blue-posts`, `guides/class-chooser`, `wiki/data`,
  `files-evidence`, `snapshot`, `public-snapshot`, `load-uploads`, `open-data/write`.

Seen failing: `/news` (`readdir '/kb/news'`), guides (`readdir '/kb/guides'`).

### 3. The knowledge release (SQLite) → D1

`/lore/[slug]`, `/lore/browse/[type]`, `/search`, `/api/tools`, `/mcp`, `/mcp/public` and the sitemaps read the
approved release (`web/.release/*.sqlite`, ~500 MB) in process through `better-sqlite3` (`kb/src/db.ts`). A Worker
cannot load a native module or ship that file. Import the release into a D1 database per release (D1 is SQLite:
same schema, same queries) and give the read layer an async D1 path. The `prebuild` download
(`scripts/fetch-release.mjs`) becomes a release step that imports into D1 and records its hash.

### 4. Secrets and settings

Server names the code reads (values never in git): `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
`R2_BUCKET`, `BLUE_BUCKET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `AUTH_DATABASE_URL`, `BETTER_AUTH_URL`,
`BNET_CLIENT_ID`, `BNET_CLIENT_SECRET`, `BNET_REDIRECT_URI`, `CRON_SECRET`, `EVERLOOT_API_KEY`,
`EVERLOOT_MCP_TOKEN`, `EVERLOOT_MCP_PUBLIC`, `EVERLOOT_PUBLIC_CORPUS_URL`, `EVERLOOT_AUTH_V2`,
`EVERLOOT_USAGE_METRICS`, `RATE_LIMIT_PER_MINUTE`, `MAX_REQUEST_BODY_BYTES`, `ALLOWED_ORIGINS`, `GSC_VERIFICATION`,
`BING_VERIFICATION`, the `GAME_DATA_*` read key, and the feature switches. `NEXT_PUBLIC_*` values are build-time.
Many R2 reads can become R2 bindings instead of S3 keys. Postgres (`pg`) goes through Hyperdrive or a direct
connection over `nodejs_compat` sockets.

🔑 **Vercel never exports a variable marked Sensitive**: `vercel env pull` writes a placeholder for each (38 of
Everloot's 72 on 10/28). Values come from their source, not from Vercel. The `POSTGRES_*`, `SUPABASE_ANON_KEY`,
`SUPABASE_JWT_SECRET`, `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` variables are left by Vercel's
Supabase integration and no code reads them.

Set on the Worker (10/28): `R2_*` and `GAME_DATA_*` through two new bucket-scoped R2 tokens
(`everloot-web worker uploads (rw)`, `everloot-web worker game-data (read)`), `SUPABASE_URL` and the legacy
`service_role` key from the Supabase dashboard, `EVERLOOT_MCP_TOKEN`, `CRON_SECRET` (new), `BETTER_AUTH_URL`, and
`EVERLOOT_MCP_PUBLIC`, `EVERLOOT_PLAYER_PAGES`, `EVERLOOT_SAVED_BUILDS`, `EVERLOOT_DATA_GUARD` = `1`, as in
production. Plus the real `BNET_CLIENT_ID`, `BNET_REDIRECT_URI`, `EVERLOOT_CHAT_WORKSPACE`, `EVERLOOT_GUILDS`,
`EVERLOOT_PROFILES`.

Still needed, and each must equal production's value: **`EVERLOOT_CHARACTER_KEY`** (census keys; a different one
splits every character), **`BNET_CLIENT_SECRET`** (Battle.net sign-in), `BETTER_AUTH_SECRET` (only when
`EVERLOOT_AUTH_V2` turns on) and `INDEXNOW_KEY` (only for the IndexNow cron). They come from the owner, not from
Vercel.

The host-specific reads go through `web/src/lib/platform.ts`: the client address (`x-vercel-forwarded-for` on
Vercel, `cf-connecting-ip` on the Worker, never the other host's header), the environment for analytics
(`EVERLOOT_DEPLOY_ENV`, `preview` until the cutover) and the deployed commit (`EVERLOOT_COMMIT_SHA`, stamped by
`scripts/cf-deploy.mjs`).

🔴 **The Supabase project was created through the Vercel Marketplace** (organization `vercel_icfg_…`). Before
the Vercel project or team is retired, move the Supabase organization to direct Supabase billing, or the database
goes with the integration.

### 5. Crons

`vercel.json` runs `/api/cron/snapshot` and `/api/cron/blue` every 10 minutes and `/api/cron/indexnow` hourly.
They become Workers Cron Triggers calling the same handlers.

### 6. Builds and deploys

Build and deploy from GitHub Actions on merge to `main` (a scoped deploy token), or Workers Builds. Check that
`desktop`, `addon` and `kb` steps stay where they are.

## Coordination with the platform plan

The platform readiness plan (desktop terminal, `docs/superpowers/plans/2026-10-28-platform-readiness.md` on its
branch) leaves the Cloudflare runtime, resources and this branch to this migration. Its gates are acceptance criteria
here:

- **Private pages never reach a shared cache.** Only pre-built and ISR pages go through the OpenNext cache; no
  Cloudflare cache rule caches HTML wholesale. Two signed-in sessions never see each other's response.
- **Opt-outs clear cached copies.** `revalidateTag`/`revalidatePath` from `api/players/opt-out` and
  `api/guilds/hide` go through the D1 tag cache; prove it on a controlled custom hostname before the cutover.
- **One writer for the rollup.** Cron Triggers stay off on the Worker until Vercel's crons are switched off at the
  cutover, never both.
- **The rollup fits its CPU budget.** A schedule more frequent than hourly gets 30 seconds of CPU per run on Workers
  (Vercel gives the route 300 s of wall time). Measure `/api/cron/snapshot`; if it does not fit, process in
  resumable chunks with checkpoints.
- The platform plan produces the route matrix (status, cache policy, identity) for production and the Worker preview;
  this migration provides the preview and the CPU and D1 numbers.

## Order

1. Page cache (1) and bundled files (2): every page except lore, search and MCP renders on workers.dev.
2. Secrets and crons (4, 5): uploads, accounts, guilds and the cron snapshot run on Workers.
3. D1 (3): lore, search, sitemaps and MCP.
4. Side-by-side check of every route against production; load test.
5. After 11/04: Access to previews only, attach `everloot.app` to the Worker, keep Vercel for rollback a week, then
   retire the Vercel project.
