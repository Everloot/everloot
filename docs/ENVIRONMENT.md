# Every variable and secret the project reads

Names only. This file holds no value, no example value and no account, host or path: it is the
checklist a maintainer uses to rebuild the Worker's settings, the Actions secrets or a local
`.env.local`, and the one place every name is written down. The values live where each table's
heading says, and nowhere in the repository.

`python scripts/check_env_names.py` fails when a name read in code, named in a workflow, set in
`web/wrangler.jsonc` or listed in `web/.env.example` is missing from this file, and when a name
here is read nowhere. Run it after adding a variable or a secret.

Column meanings. **Read in**: the file that reads it (one when several do, and the rest in words).
**Set by**: the surface a maintainer sets it on. **Required**: whether the surface works without it.
A switch is on when set to `1` and off otherwise, unless a row says more.

## Worker `vars` (`web/wrangler.jsonc`)

Plain settings deployed with the Worker. Pages built ahead of time read them during the build too,
so `web/scripts/cf-deploy.mjs` passes every var except the `*_DIR` paths to the build.

| Name | Read in | What it is for | Required |
|---|---|---|---|
| `NODE_ENV` | `web/src/lib/upload-store.ts` and the other stores, the auth routes | Production paths: secure cookies, "storage unavailable" instead of a local fallback | Yes |
| `EVERLOOT_PLATFORM` | `web/src/lib/platform.ts`, `web/src/lib/auth/db.ts` | Names the host so the code trusts the edge's client address and uses the Hyperdrive binding | Yes |
| `EVERLOOT_DEPLOY_ENV` | `web/src/lib/platform.ts`, `web/src/lib/analytics/config.ts` | Names the environment for analytics; product analytics load only in production | Yes |
| `EVERLOOT_DATA_GUARD` | `web/src/lib/data-guard.ts` | Bulk-read limits and free API keys (DATA_POLICY.md) | Switch |
| `EVERLOOT_MCP_QUOTA_SCOPE` | `web/src/lib/intake-quota.ts` | The public MCP counts against its own hourly bucket | Switch |
| `EVERLOOT_FORM_QUOTA_SCOPE` | `web/src/lib/intake-quota.ts` | Forms count against their own hourly bucket | Switch |
| `EVERLOOT_MARKET_QUOTA_SCOPE` | `web/src/lib/intake-quota.ts` | Market price polls count against their own hourly bucket | Switch |
| `EVERLOOT_MCP_PUBLIC` | `web/src/app/mcp/public/route.ts` | The public MCP endpoint answers | Switch |
| `EVERLOOT_PLAYER_PAGES` | `web/src/lib/player-pages.ts` | Character pages | Switch |
| `EVERLOOT_SAVED_BUILDS` | `web/src/lib/saved-builds.ts` | Saved talent builds | Switch |
| `EVERLOOT_GUILDS` | `web/src/lib/guild-switch.ts` | Guild pages | Switch |
| `EVERLOOT_CHARACTER_GUILD_FACTS` | `web/src/app/characters/[ruleset]/[realm]/[name]/character-guild.ts` | A character's page shows its guild rank, loot and attendance | Switch |
| `EVERLOOT_PROFILES` | `web/src/lib/profiles.ts` | Account profiles | Switch |
| `EVERLOOT_CHAT_WORKSPACE` | `web/src/lib/chat/workspace.ts` | The signed-in chat workspace | Switch |
| `EVERLOOT_CHARACTER_LINKS` | `web/src/lib/character-links.ts` | Linking an in-game character to an account | Switch |
| `EVERLOOT_SHOWCASE` | `web/src/lib/character-showcase.ts` | The character showcase pages and share cards | Switch |
| `EVERLOOT_PRIVATE_SYNC` | `web/src/lib/private-sync.ts` | Private sync of a linked character's data | Switch |
| `EVERLOOT_LEADERBOARDS` | `web/src/lib/leaderboard-switch.ts` | The item level and gear score rankings | Switch |
| `NEWS_DIR` | `web/src/lib/news.ts` | Where the bundled news posts are inside the Worker | Yes |
| `GUIDES_DIR` | `web/src/lib/guides.ts` | Where the bundled guides are inside the Worker | Yes |
| `WIKI_DIR` | `web/src/lib/wiki.ts` | Where the bundled wiki pages are inside the Worker | Yes |
| `PROTOCOL_SCHEMA_DIR` | `web/src/app/schema/[...path]/route.ts` | Where the bundled protocol schemas are inside the Worker | Yes |
| `KNOWLEDGE_RELEASE_SHA256` | `web/src/lib/release.ts` | The knowledge release the `KNOWLEDGE_D1` database must match before it is served | Yes |

Bindings declared next to the vars and read like them: `KNOWLEDGE_D1` (the knowledge release
database, `web/src/lib/release.ts`) and `AUTH_DB_HYPERDRIVE` (the accounts database,
`web/src/lib/auth/db.ts`). Both are required on the Worker.

## Worker secrets (`wrangler secret put`)

Read by the Worker at run time and absent from `wrangler.jsonc`. Whether production sets an optional
one is not recorded here.

| Name | Read in | What it is for | Required |
|---|---|---|---|
| `EVERLOOT_OPS_USER_IDS` | `web/src/lib/ops/access.ts` | Explicit website-account dashboard grants | Optional |
| `EVERLOOT_OPS_CONTRIBUTOR_USER_IDS` | `web/src/lib/ops/access.ts` | Separate website-account named-contributor grants | Optional |
| `EVERLOOT_OPS_AGENT_TOKEN_HASHES` | `web/src/lib/ops/access.ts` | Revocable aggregate-reader token digests | Optional |
| `EVERLOOT_OPS_ACCESS_ISSUER` | `web/src/lib/ops/access.ts` | Trusted operations identity issuer | Optional |
| `EVERLOOT_OPS_ACCESS_AUDIENCE` | `web/src/lib/ops/access.ts` | Operations application audience | Optional |
| `EVERLOOT_OPS_ACCESS_HUMAN_SUBJECTS` | `web/src/lib/ops/access.ts` | Explicit signed human subject grants | Optional |
| `EVERLOOT_OPS_ACCESS_HUMAN_EMAILS` | `web/src/lib/ops/access.ts` | Explicit issuer-attested human email grants | Optional |
| `EVERLOOT_OPS_ACCESS_CONTRIBUTOR_SUBJECTS` | `web/src/lib/ops/access.ts` | Separate signed subject grants for named contributors | Optional |
| `EVERLOOT_OPS_ACCESS_CONTRIBUTOR_EMAILS` | `web/src/lib/ops/access.ts` | Separate issuer-attested email grants for named contributors | Optional |
| `EVERLOOT_OPS_ACCESS_SERVICE_SUBJECTS` | `web/src/lib/ops/access.ts` | Explicit aggregate-only service identity grants | Optional |
| `EVERLOOT_OPS_HMAC_SECRET` | `web/src/lib/ops/metrics.ts` | Stable private installation pseudonym namespace | For operations metrics |
| `EVERLOOT_OPS_EXCLUDED_INSTALLS` | `web/src/lib/ops/metrics.ts` | Private owner and test installation exclusions | Optional |
| `EVERLOOT_OPS_METRICS` | `web/src/lib/ops/telemetry.ts` | Best-effort successful receipt and outcome instrumentation | Switch |
| `EVERLOOT_OPS_CF_ANALYTICS_TOKEN` | `web/src/lib/ops/collector.ts` | Scoped Worker analytics reader | For CPU estimates |
| `EVERLOOT_OPS_WORKER_NAME` | `web/src/lib/ops/collector.ts` | Target of Worker CPU estimates | For CPU estimates |
| `SUPABASE_URL` | `web/src/lib/supabase/server.ts` and every store | The storage project every storage-backed page uses | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | `web/src/lib/supabase/server.ts` and every store | Server-side access to that project | Yes |
| `R2_ACCOUNT_ID` | `web/src/lib/upload-store.ts` and the other bucket stores | The object storage account for uploads | Yes |
| `R2_ACCESS_KEY_ID` | `web/src/lib/upload-store.ts` and the other bucket stores | Credential for that storage | Yes |
| `R2_SECRET_ACCESS_KEY` | `web/src/lib/upload-store.ts` and the other bucket stores | Credential for that storage | Yes |
| `R2_BUCKET` | `web/src/lib/upload-store.ts` and the other bucket stores | The uploads bucket | Yes |
| `BLUE_BUCKET` | `web/src/lib/blue-store.ts` | A separate bucket for the blue-post archive; falls back to `R2_BUCKET` | No |
| `CRON_SECRET` | `web/src/app/api/cron/*/route.ts`, `web/scripts/cf-entry.mjs` | The scheduled jobs call their routes with it | Yes |
| `BNET_CLIENT_ID` | `web/src/lib/auth/battlenet.ts`, `web/src/app/api/auth/bnet/route.ts` | Battle.net sign-in | For sign-in |
| `BNET_CLIENT_SECRET` | `web/src/lib/auth/battlenet.ts`, `web/src/app/api/auth/bnet/route.ts` | Battle.net sign-in | For sign-in |
| `BNET_REDIRECT_URI` | `web/src/app/api/auth/bnet/route.ts` | The old sign-in's callback address; the new sign-in derives it | No |
| `EVERLOOT_AUTH_V2` | `web/src/lib/auth/auth.ts`, `web/src/middleware.ts`, `web/src/lib/auth/social.ts` | The Better Auth sign-in instead of the old one | Switch |
| `BETTER_AUTH_SECRET` | `web/src/lib/auth/auth.ts` | Signs the new sign-in's sessions | With `EVERLOOT_AUTH_V2` |
| `BETTER_AUTH_URL` | `web/src/lib/auth/auth.ts` | The sign-in's base address; defaults to the site address | No |
| `RESEND_API_KEY` | `web/src/lib/auth/email.ts` | Sends confirmation and password-reset mail; email sign-up stays closed without it | No |
| `EMAIL_FROM` | `web/src/lib/auth/email.ts` | The sender of that mail | With `RESEND_API_KEY` |
| `EVERLOOT_CHARACTER_KEY` | `web/src/lib/census-intake.ts` | Keys the hash of census identifiers; census rows are dropped without it | For census |
| `EVERLOOT_PUBLIC_INSTALL_KEY` | `web/src/lib/public-install.ts` | Keys the pseudonym of a public install id; falls back to `EVERLOOT_CHARACTER_KEY` | No |
| `EVERLOOT_TRUSTED_INSTALLS` | `web/src/lib/upload-store.ts` (through `kb/src/trusted-source.ts`) | The install ids whose uploads publish before three reporters agree | No |
| `EVERLOOT_MCP_TOKEN` | `web/src/lib/mcp-mount.ts` | Bearer token the token-protected MCP mount requires | For that mount |
| `EVERLOOT_PUBLIC_CORPUS_URL` | `web/src/lib/mcp-mount.ts` | The approved public corpus the MCP reads; any other value turns the MCP off | No |
| `EVERLOOT_UPLOADS` | `web/src/lib/mcp-mount.ts` | A raw uploads folder for the local kb tools; set on the Worker it turns the MCP off | Must be unset |
| `ALLOWED_ORIGINS` | `web/src/lib/mcp-mount.ts` | Comma-separated browser origins the MCP accepts; defaults to the site's | No |
| `EVERLOOT_USAGE_METRICS` | `web/src/lib/usage-metrics.ts`, `web/src/lib/mcp-mount.ts` | Counts MCP and API use in storage | Switch |
| `EVERLOOT_ARMORY` | `web/src/lib/armory.ts` | The armory pages from Blizzard data | Switch |
| `EVERLOOT_GUIDE_SUBMISSIONS` | `web/src/lib/guide-submissions.ts` | Guide submissions from signed-in players; needs `EVERLOOT_PROFILES` | Switch |
| `EVERLOOT_PLAYER_PAGES_INDEX` | `web/src/lib/player-pages.ts` | Character pages drop `noindex` | Switch |
| `EVERLOOT_GUILDS_INDEX` | `web/src/lib/guild-switch.ts` | Guild pages drop `noindex` | Switch |
| `EVERLOOT_SHOWCASE_BUILDS` | `web/src/lib/character-showcase.ts` | A showcase label links a saved build; needs the showcase and saved builds | Switch |
| `EVERLOOT_PULL_SUMMARIES` | `web/src/lib/pull-summaries.ts` | Collecting and storing raid pull summaries | Switch |
| `EVERLOOT_SETTLED_TALLY` | `web/src/lib/settled-store.ts` | A tally instead of a row for a fact that matches its settled value | Switch |
| `EVERLOOT_FREE_CHAT_KEY` | `web/src/lib/chat/free-chat.ts` | The first free chat provider's key; the provider is off without it | No |
| `EVERLOOT_FREE_CHAT_BASE_URL` | `web/src/lib/chat/free-chat.ts` | That provider's endpoint; has a default | No |
| `EVERLOOT_FREE_CHAT_MODEL` | `web/src/lib/chat/free-chat.ts` | That provider's model; has a default | No |
| `EVERLOOT_FREE_CHAT_CF_ACCOUNT_ID` | `web/src/lib/chat/free-chat.ts` | The second free chat provider's account; the provider is off without both | No |
| `EVERLOOT_FREE_CHAT_CF_TOKEN` | `web/src/lib/chat/free-chat.ts` | The second free chat provider's token | No |
| `GAME_DATA_S3_ENDPOINT` | `web/src/lib/game-assets.ts` | The private game-data bucket behind item tooltips; tooltips are off without the four | No |
| `GAME_DATA_BUCKET` | `web/src/lib/game-assets.ts` | That bucket's name | No |
| `GAME_DATA_ACCESS_KEY_ID` | `web/src/lib/game-assets.ts` | Credential for that bucket | No |
| `GAME_DATA_SECRET_ACCESS_KEY` | `web/src/lib/game-assets.ts` | Credential for that bucket | No |
| `GAME_DATA_REGION` | `web/src/lib/game-assets.ts` | That bucket's region; has a default | No |
| `INDEXNOW_KEY` | `web/src/lib/indexnow.ts` | Served at `/indexnow.txt`; nothing is pinged without it (SEO.md) | No |
| `GSC_VERIFICATION` | `web/src/app/layout.tsx` | Search Console's verification meta tag | No |
| `BING_VERIFICATION` | `web/src/app/layout.tsx` | Bing Webmaster Tools' verification meta tag | No |

## Build-time, from the deploy workflow (`.github/workflows/deploy-worker.yml`)

Read while the site is built, so they come from repository variables and the workflow, not from
the Worker. The browser bundle keeps the `NEXT_PUBLIC_*` values.

| Name | Read in | What it is for | Set by | Required |
|---|---|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | `web/src/lib/seo.ts`, the sitemaps and feeds, `web/src/app/layout.tsx` | The site's public address | Repository variable | Yes |
| `NEXT_PUBLIC_GAME_ASSETS_URL` | `web/src/lib/talents/assets.ts` | The public asset folder for the talent calculator (ASSETS.md); text tiles without it | Repository variable | No |
| `NEXT_PUBLIC_BULK_URL` | `web/src/lib/docs/connect-data.ts` | The public address of the bulk export; `/connect` says there is none without it | Repository variable | No |
| `NEXT_PUBLIC_ADSENSE_CLIENT` | `web/src/components/AdSlot.tsx`, `web/src/app/layout.tsx` | Ad slots; off without it | Repository variable | No |
| `NEXT_PUBLIC_CF_BEACON_TOKEN` | `web/src/lib/analytics/config.ts` | Cookieless web analytics | Repository variable | No |
| `NEXT_PUBLIC_GA_ID` | `web/src/lib/analytics/config.ts` | Google Analytics, after consent | Repository variable | No |
| `NEXT_PUBLIC_METRICOOL_HASH` | `web/src/lib/analytics/config.ts` | Metricool's tracker, after consent | Repository variable | No |
| `NEXT_PUBLIC_POSTHOG_KEY` | `web/src/lib/analytics/config.ts` | Product analytics, production only | Repository variable | No |
| `NEXT_PUBLIC_POSTHOG_HOST` | `web/src/lib/analytics/config.ts` | Which analytics region to send to | Repository variable | No |
| `NEXT_PUBLIC_SUPABASE_URL` | `web/src/app/api/auth/auth.test.ts` only | Passed to the build; read by no page today | Repository variable | No |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `web/src/app/api/auth/auth.test.ts` only | Passed to the build; read by no page today | Repository variable | No |
| `GITHUB_TOKEN` | `web/src/lib/addon-github.ts`, `web/src/lib/polestar-github.ts`, `web/src/lib/everloot-releases.ts`, `kb/src/cli.ts` | Signed-in release reads from GitHub, past the anonymous rate limit | The workflow's own token | No |
| `EVERLOOT_COMMIT_SHA` | `web/src/lib/platform.ts` | The deployed commit, for the footer and the source link | `web/scripts/cf-deploy.mjs` | No |
| `EVERLOOT_DOWNLOADS` | `web/src/lib/addon-release.ts` | The addon zips' sizes and hashes, worked out at build time | `web/next.config.js` | Build only |
| `NEXT_PHASE` | `web/src/app/addon/page.tsx`, `web/src/app/addons/polestar/page.tsx` | Tells a build from a request, so a build without GitHub does not fail | Next.js | Framework |

## Actions secrets (repository settings, Secrets)

| Name | Read in | What it is for | Required |
|---|---|---|---|
| `CLOUDFLARE_API_TOKEN` | `.github/workflows/deploy-worker.yml` | Deploys the Worker | For deploys |
| `EVERLOOT_EDGE_CHECK` | `.github/workflows/deploy-worker.yml`, `web/scripts/cf-warm.mjs` | Lets the warm pass past the zone's challenge and rate-limit rules | No |
| `BUILD_WATCH_TOKEN` | `build-watch.yml`, `changes.yml`, `ecosystem.yml`, `spot-check.yml` | Opens data pull requests with a token whose pushes start checks; falls back to the workflow's own token | No |
| `ANSWER_EVAL_KEY` | `.github/workflows/build-watch.yml` | The answer evaluation's model provider key | With `ANSWER_EVAL_MODEL` |
| `CF_API_KEY` | `.github/workflows/release.yml`, `scripts/upload-curseforge.py` | Uploads the tested addon archive to CurseForge | For releases |
| `DISCORD_BOT_TOKEN` | `.github/workflows/discord-bridge.yml`, `scripts/discord_bridge.py` | The Discord bridge | For the bridge |

## Actions repository variables (repository settings, Variables)

| Name | Read in | What it is for | Required |
|---|---|---|---|
| `WORKER_DEPLOY` | `.github/workflows/deploy-worker.yml` | The deploy job runs only while this is `1` | For deploys |
| `CLOUDFLARE_ACCOUNT_ID` | `.github/workflows/deploy-worker.yml` | The account the Worker deploys to | For deploys |
| `ANSWER_EVAL_MODEL` | `.github/workflows/build-watch.yml` | The model the answer evaluation runs against; the job is skipped while empty | No |
| `ANSWER_EVAL_BASE_URL` | `.github/workflows/build-watch.yml` | That provider's endpoint; has a default | No |
| `NEXT_PUBLIC_*` | `.github/workflows/deploy-worker.yml` | The eleven build-time names above, passed to the build | See above |

## Local development and tests (`web/.env.local`)

`web/.env.example` lists every name below with an empty value and a one-line comment. None is
needed to work on most pages. The Worker names above also go here when a local run needs them.

| Name | Read in | What it is for | Required |
|---|---|---|---|
| `AUTH_DATABASE_URL` | `web/src/lib/auth/db.ts` | The accounts database for a Node run; the Worker uses `AUTH_DB_HYPERDRIVE` instead | For sign-in locally |
| `KB_SNAPSHOT_PATH` | `web/src/lib/release.ts`, `kb/src/mcp-http-main.ts` | The public knowledge release file for a Node run; the Worker uses `KNOWLEDGE_D1` | No |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `web/src/lib/auth/social.ts` (by provider prefix) | Google sign-in; the provider is off unless both are set | No |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | `web/src/lib/auth/social.ts` | Microsoft sign-in | No |
| `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` | `web/src/lib/auth/social.ts` | Twitch sign-in | No |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | `web/src/lib/auth/social.ts` | Discord sign-in | No |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | `web/src/lib/auth/social.ts` | GitHub sign-in | No |
| `BULK_BUCKET` | `web/scripts/upload-bulk.mjs` | The public bucket the bulk export is uploaded to | For that script |
| `EVERLOOT_SUPABASE_REF` | `web/scripts/launch-maintenance.mjs` | Names the storage project the maintenance script works on | For that script |
| `EVERLOOT_API_KEY` | `kb/src/mcp-server.ts` | A player's own API key, sent by the local MCP server | No |
| `QUOTA_TEST_DATABASE_URL` | `web/src/lib/auth/auth.pg.test.ts` and the other `*.pg.test.ts`, `*.rest.test.ts` files | A throwaway database for the database-backed tests; they skip without it | Tests |
| `PULL_TEST_DATABASE_URL` | `web/src/lib/pull-store.pg.test.ts` | The same, for the pull summaries test | Tests |
| `LOCAL_REST_URL` | `web/src/lib/guide-submissions.rest.test.ts` and the other `*.rest.test.ts` files | A local REST endpoint for the row-level security tests | Tests |
| `LOCAL_REST_JWT_SECRET` | the same files | Signs the tokens those tests send | Tests |

## The kb command line and the local MCP server (`kb/src`)

Set in the shell that runs `npm run kb`, or by the Actions runner.

| Name | Read in | What it is for | Set by | Required |
|---|---|---|---|---|
| `EVERLOOT_PUBLIC_CORPUS_URL` | `kb/src/mcp-server.ts`, `kb/src/mcp-http-main.ts` | Where the local MCP server reads the public corpus | Shell | One of the two |
| `EVERLOOT_UPLOADS` | `kb/src/mcp-server.ts` | A raw uploads folder the local tools read instead; refused by the HTTP server | Shell | One of the two |
| `EVERLOOT_MCP_TOKEN` | `kb/src/mcp-http-main.ts`, `kb/src/cli.ts` | Bearer token for the local HTTP bridge | Shell | No |
| `ALLOWED_ORIGINS` | `kb/src/mcp-http-main.ts` | Comma-separated browser origins the local bridge accepts | Shell | No |
| `PORT` | `kb/src/mcp-http-main.ts` | The local bridge's port; has a default | Shell | No |
| `RATE_LIMIT_PER_MINUTE` | `kb/src/mcp-http-main.ts` | Requests per minute per address; has a default | Shell | No |
| `MAX_REQUEST_BODY_BYTES` | `kb/src/mcp-http-main.ts` | The largest request body accepted; has a default | Shell | No |
| `PYTHON` | `kb/src/client-assets.ts` | Which Python runs the asset scripts; defaults by platform | Shell | No |
| `GITHUB_ACTIONS` | `kb/src/build-watch/command.ts` | Tells the build watch it runs in Actions | Actions runner | No |
| `GITHUB_OUTPUT` | `kb/src/build-watch/command.ts` | Where the build watch writes its step outputs | Actions runner | In Actions |
| `GITHUB_REPOSITORY` | `kb/src/build-watch/command.ts` | The repository the build watch reports on | Actions runner | In Actions |
| `GITHUB_RUN_ID` | `kb/src/build-watch/command.ts` | The run the build watch links to | Actions runner | In Actions |
| `GITHUB_SERVER_URL` | `kb/src/build-watch/command.ts` | The host that link points at | Actions runner | In Actions |

## Companion and desktop app (`companion/src`, `desktop/src`)

Neither has a `.env.example`; neither needs one. They read the operating system's own variables
to find their settings folder.

| Name | Read in | What it is for | Set by | Required |
|---|---|---|---|---|
| `APPDATA` | `companion/src/cli.ts`, `desktop/src/main/index.ts` | The settings folder on Windows | Operating system | No |
| `XDG_CONFIG_HOME` | `companion/src/cli.ts`, `desktop/src/main/index.ts` | The settings folder elsewhere; has a default | Operating system | No |
| `PUBLIC` | `desktop/src/main/game-folder.ts` | The shared folder on Windows, where the game is often installed | Operating system | No |
| `EVERLOOT_DATA_DIR` | `desktop/src/main/index.ts` | Overrides the desktop app's data folder | Shell | No |
| `PORTABLE_EXECUTABLE_FILE` | `desktop/src/main/index.ts` | Set by the portable build's launcher; turns off installer-only behaviour | The portable launcher | No |

## Not covered

Scripts under `web/scripts/` read a few more names of their own (the asset upload scripts, the
integration scripts, the maintenance script). They are documented in each script's header, and the
check does not cover them.
