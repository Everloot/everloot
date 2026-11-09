# Armory: every Forever character and guild from the Blizzard API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every WoW: Forever character and guild a page on Everloot without any player action: a crawler on GitHub Actions reads the Blizzard Forever API (characters, equipment, PvP summary, guild rosters), stores it in Supabase under the Blizzard Developer API Terms (30-day retention, delete on 404 or on request), and the site shows ad-free, credited pages: `/armory`, a character page, a guild page with its roster, and three boards (item level, Gear Score, honorable kills). Discovery starts from the guild names the addon already saw and from website submissions, and grows through rosters.

**Architecture:** Three independent pieces joined by one SQL contract. (1) A migration adds the `armory_*` tables and every function the other two call (service_role only, RLS on). (2) `kb/src/armory/` is the crawler: pure parsers over the API's JSON, a conditional-request client, a PostgREST writer, a budgeted run; `npm run kb -- armory-crawl` runs it, and `.github/workflows/armory.yml` runs that hourly per region. No Worker, no Cloudflare CPU in the ingestion path. (3) `web/src/lib/armory-store.ts` reads the same functions through `authQuery`, and the pages under `web/src/app/armory/` render what is stored, behind `EVERLOOT_ARMORY=1`. Nothing from the armory enters the addon-sourced tables, the CC BY-SA dataset, the MCP tools or any export.

**Tech Stack:** PostgreSQL (Supabase, migrations in `supabase/migrations`, tests in `supabase/tests` run on PGlite), TypeScript (`kb/` with vitest, `web/` Next.js App Router on Cloudflare Workers with vitest), GitHub Actions.

**Spec:** This file's Design section, the internal armory population and Blizzard API compliance decisions, and the internal research note on the Forever API.

## Design

### What the API gives (verified 2026-11-09 with the Everloot client)

- Namespaces `profile-forever-{us,eu}` (characters, guilds, rosters), `dynamic-forever-{region}` (ruleset index). Rulesets: 1 PvP, 2 Normal, 3 Roleplay, 15 Roleplay PvP. **Characters have no realm**: `realm` is `null`; identity is region + `slug` = `name-surname` (lower case).
- `GET /profile/wow/character/{slug}` → keys `id, name, surname, level, faction{type,name}, race{id,name}, character_class{id,name}, gender{type}, guild{id,name,faction, key.href}, ruleset{id,name}, last_login_timestamp (ms), equipped_item_level, average_item_level, experience, achievement_points`, plus `_links`/hrefs to `equipment, pvp_summary, statistics, specializations, …`. A guild's slug is the last path segment of `guild.key.href` before `?`.
- `GET …/character/{slug}/equipment` → `equipped_items[]` each with `slot{type,name}`, `item{id}`, `name`, `level{value}`, `quality{type}`, `inventory_type{type}`, `item_class`, `item_subclass`, `stats`. Slot types seen: HEAD, NECK, SHOULDER, SHIRT, CHEST, WAIST, LEGS, FEET, WRIST, HANDS, FINGER_1, FINGER_2, TRINKET_1, TRINKET_2, BACK, MAIN_HAND, OFF_HAND, RANGED, TABARD.
- `GET …/character/{slug}/pvp-summary` → `honorable_kills` (int), `pvp_rank` (int).
- `GET /data/wow/guild/{slug}` (profile namespace) → `id, name, slug, faction, ruleset{id,name}, member_count, created_timestamp, achievement_points`. `GET /data/wow/guild/{slug}/roster` → `members[] { character{ id, name, surname, slug, level, playable_class{id}, playable_race{id}, faction{type} }, rank }`.
- Unknown character or guild → HTTP 404. Responses carry `last-modified`; `If-Modified-Since` answers 304 with an empty body. Limit 36,000 calls/hour and 100/second per client.
- Class ids and race ids are the standard ones (`playable-class/3` = Hunter, `playable-race/8` = Troll); the profile call carries names, the roster carries ids only.

### Rules (Blizzard Developer API Terms, decided 2026-11-07)

1. Armory pages carry **no ad slot** (no `AdSlot`, no ad component). The AdSense script in `layout.tsx` only serves the consent message; that is fine.
2. Free, our pages only: no armory row reaches `kb/src` exporters, the open-data snapshot, MCP tools, `/api/*` answers or the public corpus. The web store is read by pages only.
3. **30 days**: every stored character and guild is re-checked at most 20 days after `checked_at`; `armory_purge` deletes rows whose `fetched_at` is older than 30 days (a 304 refreshes both `fetched_at` and `checked_at`); a 404 deletes the row at once.
4. Every armory page shows the line **"Data from Blizzard Entertainment"** and the time of the newest read; nothing says or looks endorsed.
5. One client. Secrets only in GitHub Actions secrets (`BNET_CLIENT_ID`, `BNET_CLIENT_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`); never in a file, a test or a log line.
6. A person can hide a character at `/armory/hide` (region, name, surname): the row is deleted and never written again.

### Identity and addresses

- Region `us | eu`. Character slug: `name-surname` from the API, lower case, as the API spells it in `slug`. Guild slug: the API's `slug` (last path segment of `guild.key.href`; for seeds from addon data, lower-case the name, replace spaces with hyphens and drop straight apostrophes; skip guesses that fail the slug check; a 404 on a guess is recorded, not retried for 7 days, deferred for 90 days after 3 tries).
- Pages: `/armory` (hub + search), `/armory/{region}/{slug}` (character), `/armory/{region}/guilds/{slug}` (guild + roster), `/armory/rankings/{metric}` with `metric ∈ item-level | gear-score | honorable-kills` and filters `?ruleset=1|2|3|15&region=us|eu`, `/armory/hide`, `/armory/submit`.
- The addon-sourced pages (`/characters/…`, `/guilds/…`, `/players`) are not changed except for one link each to the armory; names without surnames are never joined to armory rows (ambiguous).

### Discovery

Seeds: `armory_seed_from_players()` enqueues a guild for every distinct guild name in `public.players` (region from the realm's prefix: realm starting with `US` → `us`, `EU` → `eu`, otherwise both). Website submissions enqueue one character. A stored guild's roster enqueues every member not stored yet. A run takes queue rows first (oldest first), then stale rows (`checked_at` older than 20 days, oldest first), inside a per-run call budget (default 6,000 per region per hour; the hourly workflow runs each region once). Each character costs 1 call on 304, 3 calls on 200 (profile, equipment, pvp-summary). Each guild costs 2 calls (guild, roster).

### Numbers

- `item_level`: the plain average over the 17 ranked slots, an empty slot counting 0, a two-handed weapon filling both hands; `gear_score`: Gear Score v1 from `kb/src/gear-score.ts` with the same slot budgets, so an armory number and a linked-character number for the same gear agree. Equipment slot types map to the function's slots; a refused score stores null (the page then shows only item level).
- Boards rank within one `(region, ruleset)` and across all when the filter is "all"; ties keep API order of `last_login` desc; top 100 rows; a character's own rank is shown on its page.

## Global Constraints

- The SQL contract below is binding for all three tasks; a task that needs a different signature says so in its report and does not change the others' files.
- Every function is `security definer set search_path = '' set lock_timeout = '3s'`, revoked from `public, anon, authenticated`, granted to `service_role`; every table has RLS on and all privileges revoked from the API roles (same shape as `20261021130000_players.sql`).
- Fixtures and tests use invented names (never a real player's name); the real API shapes above are the reference.
- No secret in any file. `BNET_CLIENT_ID` / `BNET_CLIENT_SECRET` and `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` come from `process.env` only.
- `web/src` styling follows the design guard: run `npx vitest run src/design/guard.test.ts` in `web/` before every commit touching `web/src`; no opacity dimming, no gradients, components from `@/components/ui` (`Card, Container, DataTable, Facts, PageHeader, SectionHeading, ReadingLayout`).
- Commits: `git commit -s` (DCO). No AI attribution lines, no `Co-Authored-By`. Message and PR title: `type(scope): plain sentence` with scope `kb`, `web`, `infra` or `docs` (`scripts/check_pr_title.py`).
- Before committing: `npm ci` in `web`, `kb` and `packages/protocol` once per worktree; then `npm run typecheck`, `npm run lint` (web), `npx vitest run <your files>` plus the web design guard; the whole `web` or `kb` suite before opening the PR.
- Each task opens its own PR to `Everloot/everloot` base `main` with a body that states what was built, what was tested (commands and counts) and what is not verified. Never merge.

## SQL contract (`supabase/migrations/20261109120000_armory.sql`)

Tables (all `public.`):

```
armory_characters (region text check (region in ('us','eu')), slug text check (slug ~ '^[[:alnum:]]+(-[[:alnum:]]+)*$' and slug = lower(slug) and char_length(slug) <= 64),
  character_id bigint not null, name text not null, surname text not null, level smallint not null check (level between 1 and 60),
  ruleset_id smallint not null, ruleset text not null, race_id smallint not null, race text not null, class_id smallint not null, class text not null,
  faction text not null check (faction in ('Alliance','Horde')), gender text, guild_slug text, guild_name text, guild_id bigint,
  last_login timestamptz, equipped_item_level smallint, average_item_level smallint, item_level numeric(6,2), gear_score numeric(6,2),
  honorable_kills integer, pvp_rank smallint, equipment jsonb not null default '[]'::jsonb,
  last_modified text, first_seen timestamptz not null default now(), fetched_at timestamptz not null, checked_at timestamptz not null,
  primary key (region, slug))
armory_guilds (region, slug (same checks), guild_id bigint not null, name text not null, faction text not null, ruleset_id smallint not null, ruleset text not null,
  member_count integer not null default 0, created_at timestamptz, last_modified text, first_seen, fetched_at, checked_at, primary key (region, slug))
armory_members (region, guild_slug, character_slug, name, surname, level smallint, class_id smallint, race_id smallint, rank smallint, fetched_at,
  primary key (region, guild_slug, character_slug), foreign key (region, guild_slug) references armory_guilds on delete cascade)
armory_queue (region, kind text check (kind in ('character','guild')), slug, source text not null, added_at timestamptz default now(), tries smallint default 0, next_at timestamptz default now(),
  primary key (region, kind, slug))
armory_hides (region, slug, hidden_at timestamptz default now(), primary key (region, slug))
```

Slug checks on characters, guilds, queue and hides use the lowercase POSIX alphanumeric rule above. Single words and non-ASCII letters are valid; the crawler validates whether a character has a surname. Invalid seed guesses are skipped.

Indexes: `armory_characters (checked_at)`, `(region, ruleset_id, item_level desc)`, `(region, ruleset_id, gear_score desc)`, `(region, ruleset_id, honorable_kills desc)`, `(lower(name) text_pattern_ops)`, `(region, guild_slug)`; `armory_guilds (checked_at)`, `(lower(name) text_pattern_ops)`; `armory_queue (next_at, added_at)`.

Functions (exact signatures; jsonb shapes in the comments):

```
armory_enqueue(p_region text, p_kind text, p_slug text, p_source text) returns boolean      -- true when inserted; false when present, stored and fresh (<20 days), or hidden
armory_seed_from_players() returns integer                                                   -- guild queue rows from distinct public.players.guild (slug via lower/replace spaces→'-', drop apostrophes); region by realm prefix; skips existing guilds/queue rows
armory_take(p_region text, p_kind text, p_limit integer) returns table (slug text, tries smallint, stored boolean)
                                                                                             -- queue rows with next_at <= now() oldest first, then stored rows with checked_at < now() - interval '20 days' oldest first, up to p_limit; stored=true whenever the character or guild already exists, including queue rows
armory_upsert_characters(p_region text, p_rows jsonb) returns integer
   -- rows: [{slug,character_id,name,surname,level,ruleset_id,ruleset,race_id,race,class_id,class,faction,gender,guild_slug,guild_name,guild_id,
   --         last_login (ISO or null),equipped_item_level,average_item_level,item_level,gear_score,honorable_kills,pvp_rank,equipment:[{slot,item_id,name,level,quality,inventory_type}],last_modified}]
   -- at most 500 rows; skips hidden; sets fetched_at = checked_at = now(); deletes the queue row (kind character); returns rows written
armory_upsert_guild(p_region text, p_guild jsonb, p_members jsonb) returns integer
   -- guild: {slug,guild_id,name,faction,ruleset_id,ruleset,member_count,created_at,last_modified}; members: [{character_slug,name,surname,level,class_id,race_id,rank}]
   -- replaces the member rows; enqueues each member character that is not stored or is stale, source 'roster'; deletes the queue row (kind guild); returns members enqueued
armory_touch(p_region text, p_kind text, p_slugs text[]) returns integer                     -- 304: fetched_at = checked_at = now() on stored rows; confirmation counts as a refresh
armory_missing(p_region text, p_kind text, p_slug text) returns void                          -- 404: delete the stored row (members cascade; a character's membership rows too) and the queue row when stored;
                                                                                             --      a never-stored queue row gets tries+1 and next_at = now() + 7 days; at tries >= 3 keep it with next_at = now() + 90 days
armory_retry(p_region text, p_kind text, p_slug text, p_delay interval) returns void           -- transient error: next_at = now() + p_delay, tries + 1
armory_purge() returns integer                                                                -- delete characters and guilds with fetched_at < now() - 30 days, queue rows with tries >= 3 and added_at < now() - 90 days
armory_hide(p_region text, p_slug text) returns void                                          -- insert hide, delete character row, its membership rows and queue rows
armory_character(p_region text, p_slug text) returns setof armory_characters                   -- one row or none (hidden rows have no row)
armory_guild(p_region text, p_slug text) returns setof armory_guilds
armory_roster(p_region text, p_slug text) returns table (character_slug text, name text, surname text, level smallint, class_id smallint, race_id smallint, rank smallint, item_level numeric, gear_score numeric, stored boolean)
                                                                                             -- members left-joined to armory_characters; hidden characters left out
armory_search(p_prefix text, p_limit integer) returns table (region text, slug text, name text, surname text, level smallint, class text, race text, ruleset text, guild_name text)
                                                                                             -- lower(name) like p_prefix || '%' (2+ letters), name then surname order
armory_search_guilds(p_prefix text, p_limit integer) returns table (region text, slug text, name text, faction text, ruleset text, member_count integer)
armory_board(p_metric text, p_region text, p_ruleset_id smallint, p_limit integer)
   returns table (rank integer, region text, slug text, name text, surname text, level smallint, class text, race text, faction text, ruleset text, ruleset_id smallint, guild_name text, value numeric, fetched_at timestamptz)
   -- p_metric in ('item_level','gear_score','honorable_kills'); null p_region / p_ruleset_id = all; value non-null only; order value desc, last_login desc nulls last
armory_rank(p_region text, p_slug text) returns table (metric text, rank integer, of integer)   -- rank = 1 + count of strictly greater non-null values within its own (region, ruleset); of = count of non-null values; ties share rank
armory_counts() returns table (region text, ruleset_id smallint, ruleset text, characters integer, guilds integer, newest timestamptz)
```

## Review Focus

1. A hidden character must never reappear: `armory_hide` then `armory_upsert_characters` for the same slug writes nothing and `armory_character` returns no row (Task 1 test, Task 3 hide form).
2. A 404 on a stored character deletes it and its membership rows; a 404 on a queued guess does not delete anything stored (Task 1, Task 2).
3. The crawler must stop at its budget and never exceed 100 calls in flight per second; a 429 or 5xx retries the row later and does not abort the run (Task 2).
4. Armory pages render no `AdSlot` and show "Data from Blizzard Entertainment" (Task 3 test).
5. No armory function or table is reachable by `anon`/`authenticated` (Task 1 test, same block as `players.sql`).

---

### Task 1: Migration and SQL tests

**Files:**
- Create: `supabase/migrations/20261109120000_armory.sql`
- Create: `supabase/tests/armory.sql`
- Modify: `docs/DATA_POLICY.md` (new section `## Armory (Blizzard data)` after `## Gear rankings`, stating rules 1–6 of the Design in plain sentences and the hide path)

**Interfaces:** the SQL contract above, verbatim. Follow the comment style and privilege block of `20261021130000_players.sql` and `20261107150000_profile_pipeline.sql`.

- [ ] **Step 1: Write the failing test** `supabase/tests/armory.sql` (begin/rollback, same shape as `supabase/tests/players.sql`): privilege block over every table and function; enqueue → take returns it; upsert two characters (invented names) with equipment; `armory_character` finds one; `armory_board('item_level', null, null, 10)` ranks them; `armory_rank` gives rank 1 of 2 and 2 of 2; `armory_upsert_guild` with three members enqueues the two not stored; `armory_roster` joins the stored one's item_level; `armory_hide` deletes and a later upsert writes 0 and the row stays absent; `armory_missing` on a stored character deletes it and its membership row; `armory_missing` on a queued guess bumps tries and after 3 retains the queue row with a 90-day deferral; seeding cannot reset it; `armory_touch` moves both fetched_at and checked_at, and the refreshed row survives purge; `armory_purge` removes a row whose fetched_at is set to 31 days ago (update it directly in the test); `armory_seed_from_players` enqueues a guild from a `public.players` row (insert via `upsert_players`) with region from the realm prefix.
- [ ] **Step 2: Run it on PGlite** and watch it fail: install `@electric-sql/pglite@0.2.17` in a `%TEMP%` folder (never in the repo), a short Node script that creates roles `anon, authenticated, service_role`, runs every file of `supabase/migrations` in sorted order, then `supabase/tests/armory.sql`. Keep the script outside the repo.
- [ ] **Step 3: Write the migration** to the contract. Header comment says what it is for, what to apply first (`20261021130000_players.sql` and `20261022160000_players_realm_key.sql` for the seed function), and that it is safe to apply twice.
- [ ] **Step 4: Run all SQL tests** (every file in `supabase/tests`) on PGlite; all pass. Mutation check: comment out the hide check in `armory_upsert_characters`, rerun, the test fails; restore.
- [ ] **Step 5: DATA_POLICY section**, then commit `feat(kb): armory tables and functions for Blizzard Forever data` and open the PR.

---

### Task 2: Crawler, CLI and the hourly workflow

**Files:**
- Create: `kb/src/armory/api.ts`, `kb/src/armory/parse.ts`, `kb/src/armory/gear.ts`, `kb/src/armory/store.ts`, `kb/src/armory/crawl.ts`, `kb/src/armory/index.ts`
- Create: `kb/src/armory/*.test.ts` with fixtures under `kb/src/armory/fixtures/` (invented names, real shapes)
- Modify: `kb/src/cli.ts` (new `case "armory-crawl"`, flags `--region us|eu`, `--budget N` default 6000, `--dry-run`), `kb/README.md` or the CLI help text
- Create: `.github/workflows/armory.yml`
- Modify: `docs/sources/source-catalog.md` (one paragraph: what the armory reads and keeps)

**Interfaces:**
- `api.ts`: `class ForeverApi { constructor(cfg: { clientId; clientSecret; region: 'us'|'eu'; fetchImpl?; now? }); get(path: string, kind: 'profile'|'dynamic', opts?: { ifModifiedSince?: string }): Promise<{ status: 200 | 304 | 404; body: unknown | null; lastModified: string | null }> }` — throws on other statuses with the status in the message; one token per instance (client credentials, refreshed a minute before expiry); namespace from `kb/src/blizzard/namespaces.ts`; `User-Agent` from `kb/src/http.ts`; no sqlite cache (the database rows are the only copy).
- `parse.ts`: `characterSlug(name, surname)`, `guildSlugFromHref(href)`, `parseCharacter(profile, equipment, pvp, lastModified): CharacterRow` (the `armory_upsert_characters` row shape; `last_login` ISO from the ms timestamp; faction name from `faction.name`; `gender` from `gender.type`), `parseGuild(guild, roster, lastModified): { guild: GuildRow; members: MemberRow[] }`. Pure, with zod schemas that accept extra keys.
- `gear.ts`: `gearNumbers(equipped: EquipmentItem[]): { item_level: number | null; gear_score: number | null }` using `kb/src/gear-score.ts`; map `slot.type` to the ranked slots (`SHIRT`, `TABARD` ignored; `MAIN_HAND` with `inventory_type.type === 'TWOHWEAPON'` fills both hands).
- `store.ts`: `class ArmoryStore { constructor({ url, serviceKey, fetchImpl? }); rpc<T>(name, args): Promise<T> }` posting to `${url}/rest/v1/rpc/${name}` with headers `apikey`, `Authorization: Bearer`, `Content-Type: application/json`, `Prefer: return=representation`; plus typed wrappers for every contract function the crawler calls.
- `crawl.ts`: `runCrawl({ region, budget, api, store, now, log, dryRun }): Promise<Summary>` — order: `armory_seed_from_players`; guilds: `armory_take(region,'guild', n)` → for each: guild (conditional on stored `last_modified`? the take row has none; use plain GET) + roster → `armory_upsert_guild`; 404 → `armory_missing`; 429/5xx → `armory_retry(…, '1 hour')`; characters: `armory_take(region,'character', n)` → profile with `If-Modified-Since` when the row is stored (the crawler reads the stored `last_modified` through `armory_character` first; 1 call) → 304 → `armory_touch`; 200 → equipment + pvp → `armory_upsert_characters` in batches of 100; finally `armory_purge`. Concurrency 8, at most 50 calls started per second. Stops when `budget` calls were made. `Summary = { region, calls, guilds: {fetched, missing, retried}, characters: {fetched, unchanged, missing, retried}, enqueued, purged }` printed as one JSON line.
- `armory.yml`: `on: schedule: '17 * * * *'` and `workflow_dispatch`; `permissions: {}`; `concurrency: armory-${{ matrix.region }}`; `if: github.repository == 'Everloot/everloot'`; matrix `region: [us, eu]`; `timeout-minutes: 50`; checkout `persist-credentials: false`; node `22.23.2`; `npm ci` in `kb` and `web`; a step that skips the run with a `::notice::` when `BNET_CLIENT_ID` or `SUPABASE_URL` is empty; `npm run kb -- armory-crawl --region ${{ matrix.region }}` with the four secrets in `env`.

- [ ] **Step 1: Fixtures and parser tests first.** Capture the real shapes with the Everloot client on this machine: load the approved client credentials into the shell environment, then curl the token and the five endpoints for one EU character and its guild (see Design); write fixtures with every name, surname and guild name replaced by invented ones and ids changed; never commit a real name. Tests: slug helpers; `parseCharacter` row equals the expected row; `parseGuild` members; `gearNumbers` on a 17-slot set (known expected numbers computed by hand from the weights in `gear-score.ts`), a two-hander, an empty set → nulls.
- [ ] **Step 2: `api.ts` tests** with a fake fetch: token once per instance, 304 path returns `body: null`, 404, a 500 throws with the status, the `If-Modified-Since` header is sent only when given.
- [ ] **Step 3: `crawl.ts` tests** with fake api + fake store: budget stops the run mid-list; a 404 guild calls `armory_missing`; a 304 character calls `armory_touch` not upsert; a 500 calls `armory_retry`; batches of 100; the summary counts.
- [ ] **Step 4: implement**, `npm run typecheck`, `npx vitest run src/armory`, then the whole `kb` suite.
- [ ] **Step 5: CLI + workflow + catalog paragraph**; `node --check` is not enough for YAML: validate with `npx -y yaml-lint .github/workflows/armory.yml` or a careful read against `ecosystem.yml`. A `--dry-run` against the real API with the local credentials (no store writes) proves the token and one guild read; report the summary line (no names).
- [ ] **Step 6:** commit `feat(kb): the armory crawler reads Forever characters and guilds from Blizzard` (workflow and docs in the same PR), open the PR.

---

### Task 3: Web store and the armory pages

**Files:**
- Create: `web/src/lib/armory.ts` (switch `armoryOn()` reading `EVERLOOT_ARMORY === "1"`, paths, types, copy constants incl. `BLIZZARD_CREDIT = "Data from Blizzard Entertainment"`), `web/src/lib/armory-store.ts` (PostgREST reads through `authQuery` from `@/lib/supabase/server`, a Map-backed memory store in development like `player-store.ts`), tests for both
- Create pages: `web/src/app/armory/page.tsx` (hub: counts per region and ruleset from `armory_counts`, character and guild search forms, links to the three boards, the hide and submit links, the credit line), `web/src/app/armory/[region]/[slug]/page.tsx` (character), `web/src/app/armory/[region]/guilds/[slug]/page.tsx` (guild + roster table), `web/src/app/armory/rankings/[metric]/page.tsx` (board with ruleset × region filters, top 100), `web/src/app/armory/hide/page.tsx` + its POST route handler, `web/src/app/armory/submit/page.tsx` + POST route (enqueues `armory_enqueue(region,'character', slug, 'website')`, slug built from name + surname fields, both required, letters only), tests per page (`*.test.tsx` rendering with a memory store)
- Modify: `web/wrangler.jsonc` vars (**do not** add `EVERLOOT_ARMORY`; the owner flips it after the migration), `web/src/app/players/page.tsx`, `web/src/app/guilds/page.tsx`, `web/src/app/rankings/page.tsx` (one link each to the armory when `armoryOn()`), `web/src/app/sitemap.ts` only if it lists sections by switch (then add `/armory` and the three boards behind the switch; character and guild pages stay out), `web/src/app/privacy/page.tsx` (one paragraph: what the armory stores, 30 days, the hide path)
- Modify: `web/src/data/protected-paths.json` is not touched (armory pages are public and cacheable)

**Interfaces:** the SQL contract's read functions: `armory_character`, `armory_guild`, `armory_roster`, `armory_search`, `armory_search_guilds`, `armory_board`, `armory_rank`, `armory_counts`, and the writes `armory_hide`, `armory_enqueue`. `ArmoryStore` interface mirrors them with camelCase methods; `armoryStore()` picks Supabase when `SUPABASE_URL` is set, memory otherwise. Class and race labels: `className`, `classText`, `raceName` from `web/src/app/players/player-view` take the addon's class token (`HUNTER`); map the API's `class` name ("Hunter") to that token with `toUpperCase()`; ids in rosters map through a small table in `web/src/lib/armory.ts` (classes 1–11 by id, races 1–8 plus Forever's ids as seen: 10 Blood Elf? — **unknown ids render as "Unknown" rather than guess**; cover 1 Human, 2 Orc, 3 Dwarf, 4 Night Elf, 5 Undead, 6 Tauren, 7 Gnome, 8 Troll, and classes 1 Warrior, 2 Paladin, 3 Hunter, 4 Rogue, 5 Priest, 7 Shaman, 8 Mage, 9 Warlock, 11 Druid).

Page rules: `armoryOn()` false → `notFound()` and metadata `Page not found`. Character and guild pages `export const dynamic = "force-dynamic"` (a hide is gone at once); hub and boards `export const revalidate = 1800`. Every armory page: `robots: { index: false, follow: false }` for now, the credit line and "Read {relative time}" from `fetched_at` (use `dataAgeLabel` from `@/lib/data-age`). Character page sections: header (name surname, level race class, faction, ruleset, guild link, last login date), Facts (item level, average item level, Gear Score, honorable kills, PvP rank, rank on each board as links), Equipment table (slot, item name linking to `/database/items/{item_id}`, item level, quality colour via existing quality tokens if any, else plain), footer with hide link. Guild page: header (name, faction, ruleset, member count, created date), roster `DataTable` (rank, name surname linking to the character page when `stored`, level, class, race, item level, Gear Score). Board: `DataTable` rank, character (link), level, class, race, guild, value; filter links like `boardHref` in `leaderboards.ts`. Hide form: region select, name, surname → POST → `armory_hide` → redirect `?done=1`; copy says it takes effect at once and the character is not read again. Storage failure → the existing "unreachable" pattern (`STORAGE_UNREACHABLE` from `@/lib/upload-store`), never a throw.

- [ ] **Step 1: `armory.ts` + `armory-store.ts` with tests** (memory store behaviour, Supabase store builds the right RPC calls with a fake `authQuery`).
- [ ] **Step 2: pages, each with a render test** (switch off → not found; found → shows credit line, no `AdSlot` import anywhere under `web/src/app/armory` — add a test that greps the folder's files for `AdSlot`); hide and submit POST tests (400 on bad input, redirect on success).
- [ ] **Step 3: links on `/players`, `/guilds`, `/rankings`, the privacy paragraph.**
- [ ] **Step 4:** `npm run typecheck`, `npm run lint`, `npx vitest run src/design/guard.test.ts src/app/armory src/lib/armory*`, then the whole `web` suite. `npm run build` once (or `cf:build` if available) to prove the routes compile.
- [ ] **Step 5:** commit `feat(web): armory pages for every Forever character and guild, from Blizzard data`, open the PR.
