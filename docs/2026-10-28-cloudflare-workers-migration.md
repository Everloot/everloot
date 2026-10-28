# Moving the site from Vercel to Cloudflare Workers

Decided 2026-10-28: the site moves to Cloudflare Workers (Workers Paid, $5 a month per account), and
`everloot.app` switches before the 11/04 launch, as soon as the Workers build serves everything the Vercel one
does. Until the switch, production stays on Vercel and nothing here touches its DNS.

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
cannot load a native module or ship that file, so on the Worker the release is a D1 database, one per release
(D1 is SQLite: same schema, same queries, FTS5 included).

**How it reads.** Every release read goes through `ReleaseDb` (`kb/src/release-db.ts`: `all`/`get`, positional
parameters, promises), over `better-sqlite3` on Node and Vercel or over a D1 binding on the Worker. `getRelease()`
(`web/src/lib/release.ts`) uses D1 when the Worker has the binding `KNOWLEDGE_D1`, the file otherwise. On D1 it
serves only when the `release_meta` row exists, its manifest passes the same checks as a file's manifest, and its
sha256 is `KNOWLEDGE_RELEASE_SHA256` from `wrangler.jsonc`; anything else is "unavailable", as a bad file is today.

**Importing a release.** From `web/`, with the approved release and its manifest on disk:

1. `node scripts/cf-release-d1.mjs <release>.sqlite` checks the manifest hash against the file and writes
   `.release/d1/<release>/0001.sql` … in 50 MB parts (`--part-mb` to change): the tables, the rows as INSERTs
   under D1's 100 KB statement limit (a longer body is inserted in part and the rest appended; the 2026-10-24
   release has 58 such bodies, the longest 486 KB, under D1's 2 MB row limit), the indexes, the FTS5 table filled
   from `entities` in id ranges of about 4 MB of text (one `'rebuild'` would be a single statement over 330 MB, at
   the mercy of D1's per-statement time limit), the triggers, and last the `release_meta` row. That row's `CHECK`
   fails, and the import stops with an error, unless the rows per source, the total body length and the FTS index
   all match the release. The files hold no `BEGIN`/`COMMIT`, which D1 refuses.
2. `npx wrangler d1 create everloot-knowledge-<date>`; put its id in the `KNOWLEDGE_D1` entry of `wrangler.jsonc`
   and the release's manifest sha256 in `KNOWLEDGE_RELEASE_SHA256` (the script prints it).
3. Each part in order: `npx wrangler d1 execute KNOWLEDGE_D1 --remote --file .release/d1/<release>/0001.sql`, and so
   on. Stop at the first error and start again with a new, empty database.
4. Check: `npx wrangler d1 execute KNOWLEDGE_D1 --remote --command "SELECT sha256 FROM release_meta"` names the release.
5. Deploy. A new release is a new database, id and sha256 in one deploy; delete the old database after.

Local (`wrangler dev`) is the same with `--local`. The 2026-10-24 release (516 MB file, 260,600 rows) gives
330 MB of SQL in 7 parts, written in 5 s. The local import (`--local`, 2026-10-28, Windows) took 198 s, 19 to 28 s
per part and 58 s for the last; the slowest single statements were an FTS range (3.0 s) and the `release_meta`
checks, which read every body once (7.3 s). With that local D1, `npm run cf:build` then `wrangler dev` served
`/lore/481380-alliance`, `/search?q=thrall`, `/lore/zones`, `/api/tools/search_knowledge` and the `/mcp` tools from
D1; with another `KNOWLEDGE_RELEASE_SHA256` they answered "unavailable". `/mcp/public` needs the per-IP quota
storage (Supabase) before it reaches the release, so locally it answers 503 without it.

**Still open.** The remote import time and the database size on D1 are not measured yet. `indexableCount`
(the coverage page) reads every body once per isolate, about 260,600 rows read each time on D1. D1 binds at most
100 parameters per statement; `loreUrls` binds one per lore hit (at most 25 from a search, a handful from
`get_by_name` on the current release). The `prebuild` download (`scripts/fetch-release.mjs`) is still the Vercel
path; on the Worker the import above replaces it.

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

Also set: `EVERLOOT_CHARACTER_KEY` (a new key, set on Vercel production and the Worker together on 10/28 while
the character tables were empty; the owner keeps a recovery copy), `BNET_CLIENT_SECRET` (read, not regenerated,
from the Battle.net developer portal) and `INDEXNOW_KEY` (public by design, served at `/indexnow.txt`). Not set:
`BETTER_AUTH_SECRET`, needed only when `EVERLOOT_AUTH_V2` turns on.

The host-specific reads go through `web/src/lib/platform.ts`: the client address (`x-vercel-forwarded-for` on
Vercel, `cf-connecting-ip` on the Worker, never the other host's header), the environment for analytics
(`EVERLOOT_DEPLOY_ENV`, `preview` until the cutover) and the deployed commit (`EVERLOOT_COMMIT_SHA`, stamped by
`scripts/cf-deploy.mjs`).

🔴 **The Supabase project was created through the Vercel Marketplace** (organization `vercel_icfg_…`). Supabase
removes such an organization "only when you delete all their projects and then uninstall the Vercel Marketplace
integration", and its owners come from the Vercel **team** roles. Retiring the `everloot-web` Vercel project is
therefore safe; keep the R21 Vercel team and its Supabase integration installed (it stays for the other client
sites), or move the organization to direct Supabase billing first (no self-serve path in the docs: ask Supabase
support).

🔑 **Feature switches are plain `vars`, not secrets**, and `scripts/cf-deploy.mjs` passes every var except the
in-Worker `*_DIR` paths to the build: pages built ahead of time read the switches during the build, so as secrets
they rendered with every switch off (seen on `/docs/api/keys`).

### 5. Crons

`vercel.json` runs `/api/cron/snapshot` and `/api/cron/blue` every 10 minutes and `/api/cron/indexnow` hourly.
They become Workers Cron Triggers calling the same handlers: `web/src/lib/cf-crons.ts` lists them (a test keeps
it equal to `vercel.json`) and `web/scripts/cf-entry.mjs` (the Worker's `main`) adds a `scheduled` handler that
calls each route with `Authorization: Bearer $CRON_SECRET`. Checked locally with `wrangler dev --test-scheduled`:
the 10-minute trigger reaches both routes and passes their auth. `wrangler.jsonc` has **no `triggers.crons`
until the cutover** (one writer); at the cutover, add
`"triggers": { "crons": ["*/10 * * * *", "23 * * * *"] }` in the same step that removes Vercel's crons.

CPU budget: Vercel's Cron Jobs view (10/28, last day, P75 wall time) shows snapshot 2.67 s, blue 49 s (mostly
waiting on Blizzard's forums; waiting is not CPU on Workers), indexnow 0.46 s, all inside the 30 s CPU a sub-hourly
trigger gets. Measure CPU on the Worker after the cutover; if the snapshot grows past ~15 s with launch traffic,
split it into resumable chunks.

## Route check (10/28)

99 routes (every static page and one real sample per dynamic page, scripted outside the repository)
requested from production and from the Worker: 90 identical in status, title and size; median 266 ms on the
Worker vs 288 ms on Vercel. Differences: the lore routes and the lore part of `sitemap.xml` (D1, section 3),
`/schema/*` (fixed after the run, matches), `/docs/api/keys` (switches at build time; fixed, 134 KB vs 139 KB, and the footer reads the deployed commit), and two redirects the
browser reports as status 0 (not a difference).

### 6. Builds and deploys

Build and deploy from GitHub Actions on merge to `main` (a scoped deploy token), or Workers Builds. Check that
`desktop`, `addon` and `kb` steps stay where they are.

### 7. Edge cache, static headers and monitoring (switch audit, 10/28)

- **Edge cache.** Vercel's CDN keeps `/database*`, `/map*`, `/changes`, `/search` and `/sitemap.xml` for the
  `CDN-Cache-Control` lifetime `next.config.js` sets; a Worker's own responses skip Cloudflare's cache. The Worker
  entry (`web/scripts/cf-entry.mjs`) keeps exactly those responses in the Cache API (`web/src/lib/cf-edge-cache.ts`):
  GET without credentials, 200, no `Set-Cookie`, `CDN-Cache-Control: max-age`. Browsers get the page's own
  `Cache-Control`; the key carries `EVERLOOT_COMMIT_SHA`, so a deploy starts with an empty cache. The Cache API
  works on the zone's routes, not on workers.dev.
- **Static files.** The static-assets binding serves `public/` without running Next, so `next.config.js` headers
  never reach those files. `scripts/cf-bundle-files.mjs` writes an assets `_headers` file (security headers,
  `/tooltips.js` CORS and lifetime, `/_next/static/*` immutable) and copies `public/.well-known`, which the asset
  copy skips.
- **Monitoring.** A failed cron throws, so the Worker's cron history shows it; `.github/workflows/site-health.yml`
  asks `/api/health` every 15 minutes and opens one `site-down` issue on failure, closing it when healthy.
  Logs stay sampled at 10%.

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
5. The switch, **before the 11/04 launch once D1 passes the route check** (Carlos, 10/28): the runbook below. Keep
   Vercel deployed for rollback a week, then retire the Vercel project (not the team, see section 4).

## Switch runbook (in the dashboards)

DNS today (zone `everloot.app`, this account, Free plan): apex `A 76.76.21.21` and `www CNAME cname.vercel-dns.com`
(Vercel, DNS only); `assets` and `data` (R2 custom domains), three Email Routing MX records, SPF, DKIM, and the
Google, Bing and Pinterest verification records. Only the apex A and the `www` CNAME change. The site uses no
`next/image`, so nothing depends on Vercel's image optimizer.

No record is deleted (switch audit, 10/28): deleting first leaves a window in which resolvers can cache "no such
record" for the zone's negative TTL, 1800 s. Instead the Worker gets routes on the zone, and the two existing
records turn proxied. Resolvers that still hold the old answer reach Vercel for up to the record TTL (300 s), and
Vercel keeps serving until then; no CAA record limits Cloudflare's certificate. `www` → apex is already a 301 in
`next.config.js`, so no redirect rule is needed.

The switch commit (on #546, deployed in step 3): `wrangler.jsonc` gets `"routes"` for `everloot.app/*` and
`www.everloot.app/*` (zone `everloot.app`), `"triggers": { "crons": ["*/10 * * * *", "23 * * * *"] }`,
`"workers_dev": false` (the workers.dev host would otherwise serve production publicly once Access is relaxed), and
`EVERLOOT_DEPLOY_ENV` = `production`.

1. Worker → Access: scope to **Previews only**, so `everloot.app` does not ask for a sign-in.
2. Vercel project → Settings → Cron Jobs: **disable**.
3. Deploy the switch commit (`npm run cf:deploy`): the Worker's crons start, the routes attach. Only one writer
   runs the crons at any moment.
4. DNS: edit the apex `A 76.76.21.21` and `www CNAME cname.vercel-dns.com` to **Proxied**, content unchanged.
   Requests reach the Worker through the routes within the record TTL.
5. SSL/TLS → Edge Certificates → **Always Use HTTPS**: on (Vercel answers `http://` with a 308 today).
6. Check: the route check against `https://everloot.app`, headers included (security headers, `tooltips.js` CORS);
   `/.well-known/*` and `/indexnow.txt` 200; `/api/health` fresh; an MCP call on `/mcp/public`; one upload from
   the addon or desktop app; Battle.net sign-in end to end; the footer shows the switch commit; the next cron run
   in the Worker's cron history.
7. Vercel project → Settings → Git: disconnect, so merges stop building there. Then GitHub → repository variable
   `WORKER_DEPLOY` = `1` and merge #546: from then on every merge to `main` deploys the Worker
   (`deploy-worker.yml`), and `site-health.yml` checks `/api/health` every 15 minutes.
8. Bots: Security → bots / AI crawl control, decide on `meta-externalagent` (40% of function calls on 10/28,
   ignores robots.txt). Carlos's call.

Rollback, in this order (no gap, one cron writer):

1. Worker → Settings → Trigger events: delete the cron triggers.
2. Vercel → Cron Jobs: enable; Settings → Git: reconnect.
3. DNS: the apex A and the `www` CNAME back to **DNS only**. Vercel serves again as resolvers expire the record
   (300 s); the Worker's routes answer whatever still arrives until then.
4. After 5 minutes, Worker → Domains & Routes: remove the two routes.
5. GitHub: unset `WORKER_DEPLOY`, and revert the switch commit on `main`, or the next deploy brings the routes and
   crons back. Vercel's last deployment predates later merges: check the Supabase migrations made since.
