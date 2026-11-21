# Lifetime Stats, Part 1 (Blizzard play history) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every armory character gets Blizzard's lifetime play history on its page, six new ranked boards, an owner
switch for it on linked pages, and an owner-only lifetime summary across linked characters.

**Architecture:** The crawler reads one more Blizzard endpoint (`achievements/statistics`) into
`armory_characters.details.playHistory`. Six stored generated columns read the ranked numbers out of that JSON, so
the board and rank functions extend their `case p_metric` lists without changing any upsert. The web reads the
details it already reads and adds sections, boards and one owner page.

**Tech Stack:** TypeScript, zod, vitest (kb, web), Next.js App Router, Supabase Postgres (SQL tests on PGlite).

**Spec:** `docs/superpowers/specs/2026-11-20-lifetime-stats-design.md`. Part 2 (the addon's gold layer) gets its own
plan once this part is merged.

## Global Constraints

- Blizzard data: ad-free path, "Data from Blizzard Entertainment" plus read time, gone after 30 days unrefreshed or a
  404 or a hide, `noindex`, never in the CC BY-SA dataset, corpus, open data, exports, MCP or API answers (this part
  adds none).
- Unreadable or missing statistics are left out, never stored or shown as 0. The page says "Not read".
- `details` stays under its 64 KB column check; play history is capped at 300 statistics.
- New migration version `20261121100000`, unique; production SQL only with Carlos's explicit OK.
- Fixture characters use the existing fictional names (`xelra-fable`, `zovra-fable`, `bulk-N`), never a real
  player's.
- Commits: `type(scope): subject`, `-s` (DCO), no AI attribution lines. CHANGELOG lines `- Site:` in CRLF.
- Before each PR: `cd kb && npx vitest run src/armory`, `cd web && npm test && npm run typecheck && npm run lint`, and
  the web design guard (`web/src/design/guard.test.ts`, part of `npm test`).

## Review Focus

1. **A malformed `playHistory` wipes every other section.** `ArmoryDetails.optional().catch(undefined)` in
   `web/src/lib/armory-store.ts:124` drops the whole details object on any parse error. Pin it in Task 1: a stored
   details object with a broken `playHistory` still parses its `talents`, and `playHistory` comes back undefined.
2. **A non-numeric ranked value breaks the row write.** If the generated column's cast throws, the whole upsert batch
   fails. Pin it in Task 3: a row whose `ranked.quests` is the string `"abc"` stores with `quests_completed` null.
3. **Fractional quantities.** Blizzard sends `791.0`. Pin it in Task 1: `791.0` is stored as `791`, and `791.5` or a
   negative number is dropped.
4. **The owner-only page leaks another account's characters.** Pin it in Task 7: the page reads only
   `armory_own_links` for the signed-in user and redirects to sign-in without a user.
5. **A hidden character stays ranked.** Pin it in Task 3: after `armory_hide`, the character appears in none of the six
   boards and `armory_rank` returns no rows for it.

---

### Task 1: Parse play history in `details`

**Files:**
- Modify: `kb/src/armory/details.ts`
- Create: `kb/src/armory/fixtures/play-history.json` (trimmed response: two top categories, one with a
  sub-category, the six ranked ids present, one stat with `description`; `character` block copied from
  `fixtures/pvp.json`)
- Test: `kb/src/armory/details.test.ts`, `web/src/lib/armory-store.test.ts` (Review Focus 1)

**Interfaces:**
- Produces: `DETAIL_KEYS` gains `"achievement-statistics"` (last). `detailPath(profile, "achievement-statistics",
  region, slug)` validates the profile's `achievements.href` exactly as for `"achievements"` and returns
  `<that path>/statistics`.
- Produces: `PLAY_HISTORY_RANKED = { quests: 98, creatures: 107, fish: 1518, flights: 349, dungeons: 932, deaths: 60 } as const`
  and `type PlayHistoryRankedKey = keyof typeof PLAY_HISTORY_RANKED`.
- Produces: `ArmoryDetails.playHistory` (optional, `.catch(undefined)` so a bad copy drops only itself):
  `{ asOf: date, groups: { name: text, rows: { id: gameId, name: text, value: int >= 0, note?: text }[] }[],
  ranked: Partial<Record<PlayHistoryRankedKey, int >= 0>> }`. A group name is the category name, or
  `"<category> · <sub-category>"`. At most `MAX_PLAY_HISTORY = 300` rows in total.

- [ ] **Step 1: Write the failing tests** in `details.test.ts`:
  - `detailPath` for `"achievement-statistics"` returns `/profile/wow/character/xelra-fable/achievements/statistics`
    and returns null for an achievements href on another host or another slug.
  - `normalizeDetails({ "achievement-statistics": fixture }, asOf).playHistory` has `ranked` equal to the fixture's
    six values, the first group named `"Character"`, a sub-category group named `"Character · Consumables"`, and the
    row with a description carrying `note`.
  - Quantities: `791.0` → `791`; a row with `791.5`, `-1`, a missing `quantity` or an empty name is left out, and its
    id is absent from `ranked`.
  - A response without a `categories` array gives no `playHistory`; `{ categories: [] }` gives
    `{ asOf, groups: [], ranked: {} }`.
  - 400 statistics in the response keep the first 300.
  - In `web/src/lib/armory-store.test.ts`: a stored row whose `details.playHistory` is `{ "asOf": "x" }` still
    yields its `talents`, with `playHistory` undefined.
- [ ] **Step 2: Run** `cd kb && npx vitest run src/armory/details.test.ts`. Expected: FAIL (`playHistory` undefined).
- [ ] **Step 3: Implement** in `details.ts`: the schema field, `detailPath`'s case, and a block in
  `normalizeDetails` that walks `categories[].statistics` and one level of `sub_categories`.
- [ ] **Step 4: Run** the kb test and `cd web && npx vitest run src/lib/armory-store.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(kb): the armory parses Blizzard's play history statistics`.

### Task 2: Crawl the endpoint and backfill rows without it

**Files:**
- Modify: `kb/src/armory/crawl.ts:61-64` (`SECTIONS`), `:269-273` (backfill rule)
- Test: `kb/src/armory/crawl.test.ts`

**Interfaces:**
- Consumes: Task 1's `"achievement-statistics"` key and `playHistory` field.
- Produces: `SECTIONS` gains `["playHistory", "achievement-statistics"]`. Per-character cost becomes
  `3 + DETAIL_KEYS.length` = 11 (already derived; no constant to change).

- [ ] **Step 1: Write the failing tests** in `crawl.test.ts`, following the existing details tests:
  - A details crawl requests `.../achievements/statistics` and stores `details.playHistory.ranked.quests`.
  - A stored row with fresh details but no `playHistory` is read without `If-Modified-Since` (no 304 shortcut).
  - A stored row with `playHistory` 5 days old and every other section fresh is sent `If-Modified-Since`.
  - A failed statistics read (500) keeps the previous `playHistory` when it is under 30 days old and sets `retry`.
  - A 403 on statistics stores the row without `playHistory` and does not set `retry`.
- [ ] **Step 2: Run** `cd kb && npx vitest run src/armory/crawl.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**: the `SECTIONS` entry, and a `noPlayHistory = oldDetails?.success && !oldDetails.data.playHistory`
  term in `backfill`.
- [ ] **Step 4: Run** the kb armory tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(kb): the armory crawler reads play history and backfills rows without it`.

### Task 3: Migration: ranked columns, boards, rank, `show_history`

**Files:**
- Create: `supabase/migrations/20261121100000_armory_play_history.sql`
- Create: `supabase/tests/armory_play_history.sql`

**Interfaces:**
- Produces: stored generated `numeric` columns on `armory_characters`: `quests_completed`, `creatures_killed`,
  `fish_caught`, `flight_paths`, `dungeons_entered`, `total_deaths`, each
  `case when jsonb_typeof(details #> '{playHistory,ranked,<key>}') = 'number' then (details #>> '{playHistory,ranked,<key>}')::numeric end`
  with `<key>` from `PLAY_HISTORY_RANKED`. One index per column on `(region, ruleset_id, <column> desc)`, as
  `armory_characters_kills` does.
- Produces: `armory_board`, `armory_board_filtered`, `armory_board_top_per_class` and `armory_rank` redefined from
  their latest definitions (`20261109120000_armory.sql`, `20261119160000_armory_class_boards.sql`) with the six
  column names added as `p_metric` values (and six `union all` arms in `armory_rank`). Signatures, grants and
  ordering stay the same.
- Produces: `character_visibility.show_history boolean not null default false`; `set_visibility` (latest:
  `20261107140000_private_sync_stats_pvp.sql:41`) accepts `show_history`; `public_character_armory` (latest:
  `20261117130000_site_reads_armory.sql:45`) returns `show_history` last. Its return type changes, so `drop function`
  first and repeat its grants.
- Header line: `-- Production application requires the owner's explicit OK.` and `set lock_timeout = '3s';`.

- [ ] **Step 1: Write the failing SQL test** `supabase/tests/armory_play_history.sql`, in the style of
  `supabase/tests/armory_class_boards.sql`:
  - Three `eu` ruleset-1 characters with `ranked.quests` 900, 800 and the string `"abc"`.
    `armory_board('quests_completed','eu',1::smallint,10)` returns two rows in order, values 900 and 800.
    The third row is stored, with `quests_completed` null (Review Focus 2).
  - `armory_board_filtered` with a class filter and `armory_board_top_per_class` return the expected winner for
    `fish_caught`.
  - `armory_rank('eu', <second>)` has `('quests_completed', 2, 2)`.
  - After `armory_hide` of the first, the six boards and `armory_rank` omit it (Review Focus 5).
  - `set_visibility` with `{"show_history": true}` sets the column, and `public_character_armory` returns it.
- [ ] **Step 2: Run** every migration and every `supabase/tests/*.sql` on PGlite (memory recipe
  `everloot-sql-tests-pglite`; install `@electric-sql/pglite@0.2.17` in a temp folder, never the repo). Expected: the
  new test FAILS (column missing); the other tests still pass.
- [ ] **Step 3: Write the migration.**
- [ ] **Step 4: Rerun** all migrations and all SQL tests. Expected: PASS. Mutation check: drop one `case` arm and
  confirm the test fails, then restore it.
- [ ] **Step 5: Commit** `feat(db): play history boards, ranks and the show_history switch`.

**PR 1 boundary:** Tasks 1–3, with a `- Site:` CHANGELOG line. The body says the migration needs Carlos's OK
before merge, and that the crawler's per-character cost rises from 10 to 11 calls.

### Task 4: Board definitions and the store

**Files:**
- Modify: `web/src/lib/armory.ts:116-139`, `web/src/lib/armory-store.ts:296-400` (in-memory store),
  `web/src/lib/leaderboards.ts:52`
- Test: `web/src/lib/armory.test.ts`, `web/src/lib/armory-store.test.ts`, `web/src/lib/leaderboards.test.ts` (create)

**Interfaces:**
- Produces: `ArmoryMetric` adds `"quests-completed" | "creatures-killed" | "fish-caught" | "flight-paths" |
  "dungeons-entered" | "deaths"`; `ArmoryMetricKey` adds the Task 3 column names. `ARMORY_METRICS` lists the three
  gear/PvP metrics, then these six. `ARMORY_BOARDS` entries: titles "Quests completed", "Creatures killed",
  "Fish caught", "Flight paths taken", "Dungeons entered", "Deaths". Each lede names the statistic and ends "as
  Blizzard's play history gives it."
- Produces: `PLAY_HISTORY_METRICS: readonly ArmoryMetric[]` (the six) and `HUB_PREVIEW_METRICS` (the first three).
  The `/rankings` hub previews only `HUB_PREVIEW_METRICS`; its link list shows all nine.
- Produces: `metricValue` shows no decimals for every metric except item level and Gear Score.
- Produces: `ArmoryCharacter` keeps its fields. The in-memory store reads the six values from
  `details.playHistory.ranked`, so `rank()` and `board*()` match the SQL.

- [ ] **Step 1: Write failing tests:** `isArmoryMetric("fish-caught")` is true; `metricOfKey("total_deaths")` is
  `"deaths"`; `metricValue("quests-completed", 1234)` is `"1,234"`; the in-memory store's `board("fish_caught", ...)`
  orders two fixture characters; `rank()` includes `fish_caught`; `leaderboards` calls `boardFiltered` three times,
  not nine.
- [ ] **Step 2: Run** `cd web && npx vitest run src/lib/armory.test.ts src/lib/armory-store.test.ts src/lib/leaderboards.test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): six play history boards in the armory rankings`.

### Task 5: Play history on the armory page and the boards' coverage line

**Files:**
- Modify: `web/src/app/armory/profile.tsx` (new section after professions), `web/src/app/armory/[region]/[slug]/page.tsx:50-60`
  (gear ranks stay in the facts list; play-history ranks move into the section),
  `web/src/app/armory/rankings/[metric]/page.tsx` (coverage line)
- Test: `web/src/app/armory/profile.test.tsx`, `web/src/app/armory/armory.test.tsx`

**Interfaces:**
- Consumes: `details.playHistory`, `PLAY_HISTORY_METRICS`, `ArmoryRank[]`.
- Produces: `<section aria-labelledby="armory-play-history">` titled "Play history". It has a headline list of the six
  ranked figures in `PLAY_HISTORY_METRICS` order, each with "#rank of N" linking to `armoryBoardHref(metric, { region,
  ruleset })` when ranked, and "Not read" when absent. Then one list per group. Its read time joins the existing credit
  line (`profile.tsx:87`).
- Produces: on a play-history board, one line under the lede: "Characters are ranked once their play history has
  been read; the armory reads each character at least every 20 days."

- [ ] **Step 1: Write failing tests:** the section renders the six headline values and a group row with its note;
  a missing ranked value shows "Not read" rather than 0; a character without `playHistory` renders no section; the
  page's facts list has no play-history rank rows; the fish board shows the coverage line and the item-level board
  does not.
- [ ] **Step 2: Run** `cd web && npx vitest run src/app/armory`. Expected: FAIL.
- [ ] **Step 3: Implement** with the existing section and list components in `profile.tsx`. No gradients and no
  opacity dimming (design guard).
- [ ] **Step 4: Run** `src/app/armory` and the design guard test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): play history on armory character pages`.

### Task 6: The `show_history` switch on linked pages

**Files:**
- Modify: `web/src/lib/character-armory.ts` (`ArmoryShown`, `ALL_SHOWN`, `BLIZZARD_SWITCH`, `PublicRow`,
  `publicCharacterArmory`, `shownCharacter`), `web/src/lib/character-links-store.ts:211`,
  `web/src/app/api/me/characters/links/[id]/visibility/route.ts`, `web/src/app/settings/LinkedCharacters.tsx:31-33`,
  `web/src/app/characters/armory-part.tsx`
- Test: `web/src/app/api/me/characters/links/[id]/visibility/route.test.ts`, `web/src/app/settings/linked-characters.test.tsx`,
  `web/src/app/characters/characters.test.tsx`

**Interfaces:**
- Produces: `ArmoryShown.history: boolean` ↔ `show_history`. `shownCharacter` keeps `details.playHistory` only when
  `history` is on. Settings label: "Play history". The linked page renders Task 5's section component.

- [ ] **Step 1: Write failing tests:** the visibility route accepts `show_history` under the armory flag and still
  rejects `show_gold`; Settings shows a "Play history" switch; with `show_history` off, the public page has no
  play-history section and the owner preview has one.
- [ ] **Step 2: Run** those three test files. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them again. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): owners choose whether their page shows play history`.

**PR 2 boundary:** Tasks 4–6, a `- Site:` CHANGELOG line, and a `docs/DATA_POLICY.md` Armory sentence that play
history (Blizzard's `achievements/statistics`) is read and ranked under the same rules. Full web suite.

### Task 7: Lifetime summary page

**Files:**
- Create: `web/src/app/me/characters/lifetime/page.tsx`, `web/src/app/me/characters/lifetime/lifetime.test.tsx`
- Create: `web/src/lib/lifetime-summary.ts` (pure totals)
- Modify: `web/src/data/ad-free-paths.json` (add `/me/characters/lifetime`), the "Your Everloot" header or Settings
  linked-characters list (one link to the page)

**Interfaces:**
- Produces: `lifetimeSummary(characters: ArmoryCharacter[]): { rows: { name: string; region: string; slug: string;
  values: Partial<Record<PlayHistoryRankedKey, number>> }[]; totals: Partial<Record<PlayHistoryRankedKey, number>>;
  counted: Record<PlayHistoryRankedKey, number> }`. A total sums only characters that have the value, and `counted`
  says how many did.
- Page: `force-dynamic`, `robots: { index: false, follow: false }`, `notFound()` unless `armoryOn()` and
  `characterLinksOn()`, and a redirect to `signInPath(...)` without a user. Characters come from `armory_own_links`
  for that user (as `ownCharacterArmory` reads it) and then `armoryStore().character`. A table has one row per
  character plus a total row ("Total, N of M characters read"), the Blizzard credit and the newest read time.

- [ ] **Step 1: Write failing tests:** `lifetimeSummary` sums 791 and 100 to 891 with `counted` 2 and skips a character
  without play history; the page redirects without a user; it reads only the signed-in user's links (the store mock
  is called with that user id, Review Focus 4); `/me/characters/lifetime` is in `ad-free-paths.json`.
- [ ] **Step 2: Run** `cd web && npx vitest run src/lib/lifetime-summary src/app/me`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them again, then the full web suite, typecheck and lint. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): a lifetime summary of your linked characters`.

**PR 3 boundary:** Task 7 with its `- Site:` CHANGELOG line. After merge, write the Part 2 plan (gold layer).
