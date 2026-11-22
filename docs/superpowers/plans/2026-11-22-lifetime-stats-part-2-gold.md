# Lifetime Stats, Part 2 (the addon's gold layer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The addon reads the logged-in character's lifetime gold statistics, the Desktop App syncs them for linked
characters as a private `gold` category, and the character's page shows them only while its owner turns on `show_gold`.

**Architecture:** A new addon module reads `GetStatistic(id)` for fifteen Wealth and auction statistics into one local-only
`wealth_owned` row per character. The protocol gains the kind, the companion sends it under `gold`, the database accepts
the category, and the site renders a Gold section from the stored fact. Gold is never ranked.

**Tech Stack:** Lua 5.1 addon (tests: Python + lupa), TypeScript + zod (protocol, companion, web), vitest, Next.js,
Supabase Postgres (SQL tests on PGlite).

**Spec:** `docs/superpowers/specs/2026-11-20-lifetime-stats-design.md` ("Part 2"). Part 1 shipped as #1443, #1445, #1453.

## Global Constraints

- Statistic ids, exactly these: money (copper) `328` total acquired, `333` looted, `326` quest rewards, `921` vendors,
  `919` auctions earned, `334` most ever owned, `331` most expensive bid, `332` most expensive sale, `1146` travel, `1147`
  barber shops, `1148` postage, `1150` talent respecs spent; counts `329` auctions posted, `330` auction purchases, `1149`
  talent respecs. Titles from `web/src/data/game-data/client-achievements.json`.
- `GetStatistic(id)` returns the display string or nil (Blizzard's Forever `Blizzard_AchievementUI.lua` shows nil as "--").
  An unreadable value (nil, "--", an unparsable string, an error, or anything read in combat) is left out, never 0.
- Only the logged-in character is read. No other player's name or gold, ever.
- `wealth_owned` is local-only: never in an upload (`LOCAL_ONLY_KINDS`), only through private sync for a linked character.
- Default private: gold sync is a per-link consent like the others, and `show_gold` (already on `character_visibility`,
  default false) publishes it. `ranked_gold` stays unused; gold is on no board.
- No misconduct framing anywhere (no "consistent with active play").
- Migration version `20261123100000`, unique; production SQL only with Carlos's explicit OK.
- Addon release (version, zip, tag) and Desktop App release are out of this plan: the addon tag waits on Carlos's in-game
  check of `GetStatistic` formats. The site works before either ships (no rows arrive).
- Commits `type(scope): subject` (scopes: addon, web, kb, companion, desktop, protocol, infra, docs), `-s`, no AI
  attribution. CHANGELOG `- Addon:` / `- Site:` lines, CRLF.
- Before each PR: `python addon/tests/run_all.py`; `cd packages/protocol && npm test && npm run build`;
  `cd companion && npm test`; `cd web && npm test && npm run typecheck && npm run lint`.

## Review Focus

1. **A European thousands separator.** EU clients may print `1.234` or `1 234` (no-break space). Expect 1234, not 1 or nil.
   Pinned in Task 2.
2. **A stat that throws or returns a non-string (secret value in combat).** Expect the stat left out and no row written in
   combat. Pinned in Task 2.
3. **Sync with gold consent off, or from an unlinked character.** Expect nothing stored. Pinned in Task 4 (SQL) and Task 5.
4. **`show_gold` off on a public page.** Expect no Gold section and no gold numbers in the markup; the owner preview shows
   it. Pinned in Task 6.
5. **An upload file containing `wealth_owned`.** Expect it held back as local, not counted invalid, never sent. Pinned in
   Task 3.

---

### Task 1: Protocol kind `wealth_owned` and category `gold`

**Files:**
- Modify: `packages/protocol/src/private-sync.ts` (schemas near `ownedBase` :17, `SCHEMAS` :118, `SYNC_CATEGORIES` :10)
- Test: `packages/protocol/test/private-sync.test.ts`

**Interfaces:**
- Produces: `export const WEALTH_STATS = { money: [328, 333, 326, 921, 919, 334, 331, 332, 1146, 1147, 1148, 1150], counts: [329, 330, 1149] } as const`.
- Produces: `wealthOwned = ownedBase.extend({ kind: z.literal("wealth_owned"), stats: <record> })`. `stats` maps a statistic
  id (string key) to an integer 0 ≤ n ≤ 2^53−1. Keys outside `WEALTH_STATS` are dropped, not fatal. At least one known key
  is required after dropping. `SCHEMAS.wealth_owned = wealthOwned`. `SYNC_CATEGORIES` gains `"gold"`.

- [ ] **Step 1: Write failing tests:** a row with `stats: { "328": 1150905, "329": 1077 }` parses; `"999": 5` is dropped
  and the rest parses; `"328": -1`, `"328": 1.5` and `stats: {}` (or only unknown keys) fail; `wealth_owned` is not in
  `recordSchemas` (it's local-only, like `lockout_owned`).
- [ ] **Step 2: Run** `cd packages/protocol && npx vitest run test/private-sync.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, then `npm run build` so `dist/` carries the kind (web and companion import it).
- [ ] **Step 4: Run** the protocol tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(protocol): a wealth_owned private sync row under a gold category`.

### Task 2: Addon module that reads the gold statistics

**Files:**
- Create: `addon/modules/wealth.lua`
- Modify: `addon/Everloot.toc` (load after `gold.lua`), `addon/core.lua` (`E:Status` kinds :268-273),
  `addon/modules/options.lua` (`O.ADDED` :101-113 and `O.DELETES` :161-167 under gold),
  `addon/tests/protocol_schema.py` (`LOCAL_ONLY_KINDS` :20), `addon/tests/protocol_contract.py` (:33-36 accepts
  `wealth.lua`), `addon/tests/retired_kinds_contract.py` (`KEPT` :19), `addon/tests/run_all.py` (`TESTS`)
- Test: `addon/tests/wealth_contract.py`

**Interfaces:**
- Produces (Lua): `E.Wealth.ParseStatistic(text) -> integer|nil`, `E.Wealth.Read() -> boolean` (true when a row was
  written), `E.Wealth.Withdraw()`, `E.Wealth.KINDS = { "wealth_owned" }`.
- Row written via `E:Store` (latest row per `characterKey` only, as `owned.lua`'s `replace` does):
  `{ characterKey = E.CharacterKey(), class, level, capturedAt, installId, stats = { ["328"] = n, ... } }`.
- Registration: `E:RegisterModule("wealth", init, "gold")`, so it follows the existing `gold` toggle.
- Reads on `PLAYER_ENTERING_WORLD` (10 s debounce), `PLAYER_MONEY` (30 s debounce) and `PLAYER_LOGOUT`. It skips while in
  combat (`InCombatLockdown()` or between `PLAYER_REGEN_DISABLED` and `ENABLED`) and retries 15 s later, as
  `completion.lua` does. Each `GetStatistic` call goes in `pcall`.
- Parsing (the algorithm the tests pin): a number is digits with optional `,` `.` space or no-break-space group
  separators. A plain number is its value. Money text holds up to three numbers, each followed by
  `|TInterface\MoneyFrame\UI-GoldIcon…|t`, `…SilverIcon…` or `…CopperIcon…`: value = gold×10000 + silver×100 + copper.
  Anything else, `"--"` or non-strings return nil. Write Lua test strings with Write/Edit, never a bash heredoc (it halves
  backslashes).

- [ ] **Step 1: Write failing tests** in `wealth_contract.py` (stub `GetStatistic = function(id) return STATS[id] end`):
  - `ParseStatistic`: `"791"`→791, `"1,077"`→1077, `"1.077"`→1077, `"1\194\160077"`→1077, `"--"`→nil, `nil`→nil, `"abc"`→nil,
    `"115|TInterface\\MoneyFrame\\UI-GoldIcon:0:0:2:0|t 9|TInterface\\MoneyFrame\\UI-SilverIcon:0:0:2:0|t 5|TInterface\\MoneyFrame\\UI-CopperIcon:0:0:2:0|t"`→1150905,
    `"1,234|TInterface\\MoneyFrame\\UI-GoldIcon:0:0:2:0|t"`→12340000, `"50|TInterface\\MoneyFrame\\UI-CopperIcon:0:0:2:0|t"`→50.
  - `Read()` with 328 = money text, 329 = `"1,077"`, 1147 = `"--"`, 1150 = a function that errors: one row, with `stats`
    `{ ["328"]=1150905, ["329"]=1077 }` and no 1147 or 1150.
  - Two reads keep one row per character key; a second character key adds a second row.
  - In combat `Read()` writes nothing and returns false; after `PLAYER_REGEN_ENABLED` plus the retry, it writes.
  - With every stat unreadable, no row.
  - Gold toggle off: no events registered, and the gold delete path removes `wealth_owned` rows.
  - Rows pass `protocol_schema.check_all` treatment as local-only (no schema file).
- [ ] **Step 2: Run** `python addon/tests/run_all.py`. Expected: `wealth_contract` FAILS (module missing); the rest pass.
- [ ] **Step 3: Implement** `wealth.lua` and the list edits above.
- [ ] **Step 4: Run** `python addon/tests/run_all.py`. Expected: all PASS.
- [ ] **Step 5: Commit** `feat(addon): the gold module reads your character's lifetime gold statistics for private sync`.

### Task 3: Companion sends `gold`; uploads hold `wealth_owned` back

**Files:**
- Modify: `companion/src/sync-sender.ts` (`CATEGORY_OF` :67, category loop :109), `web/src/lib/upload-batches.ts`
  (`LOCAL_ONLY_KINDS` :29), `desktop/src/main/characters.ts` (only if its kind switch must name every kind)
- Test: `companion/test/sync-sender.test.ts`, `web/src/lib/upload-batches.test.ts`

**Interfaces:**
- Consumes: Task 1's `wealthOwned` (via `parseSyncRow`).
- Produces: `CATEGORY_OF.wealth_owned = "gold"`; the sender's loop is `["raids", "achievements", "boss_kills", "gold"]`.

- [ ] **Step 1: Write failing tests:** a save with a linked character's `wealth_owned` row sends it under `gold`; an
  unlinked character's row is not sent; `prepareUpload` on a file with a `wealth_owned` row counts it in `held.local`, not
  in invalid, and no batch carries it.
- [ ] **Step 2: Run** `cd companion && npx vitest run test/sync-sender.test.ts` and
  `cd web && npx vitest run src/lib/upload-batches.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** both, plus `cd desktop && npm test` if `characters.ts` changed. Expected: PASS.
- [ ] **Step 5: Commit** `feat(companion): the Desktop App syncs gold for a linked character`.

### Task 4: Database accepts the `gold` category

**Files:**
- Create: `supabase/migrations/20261123100000_private_sync_gold.sql`, `supabase/tests/private_sync_gold.sql`

**Interfaces:**
- Produces: `character_sync_consent_category_check` and `character_facts_category_check` allow
  `('raids', 'achievements', 'gold')`. Redefine from their latest definitions (grep each name; at plan time all are in
  `20261107140000_private_sync_stats_pvp.sql`): `set_sync_consent` (category list :92), `sync_character_facts` (:148),
  `own_character_facts` (the `unnest` list :188), `public_character_facts` (`CASE` :207-216 gains
  `when 'gold' then v.show_gold`). Signatures and grants stay the same. Header: owner OK required.

- [ ] **Step 1: Write the failing SQL test**, with invented identities and users with `name` and `email`:
  - `set_sync_consent(user, link, 'gold', true)` succeeds;
  - `sync_character_facts` stores a gold fact for a linked character with consent, and stores nothing without consent;
  - `own_character_facts` lists `gold`;
  - `public_character_facts` returns the gold fact only after `set_visibility(... '{"show_gold":true}')`;
  - a category `'silver'` is refused;
  - use `is distinct from` in comparisons.
- [ ] **Step 2: Run** all migrations and SQL tests on PGlite (memory `everloot-sql-tests-pglite`; runner in a temp folder).
  Expected: the new test FAILS; the 14 files that fail on main fail the same way.
- [ ] **Step 3: Write the migration.**
- [ ] **Step 4: Rerun.** Expected: PASS. Mutation check: drop the `gold` arm from `public_character_facts`; the test fails.
- [ ] **Step 5: Commit** `feat(web): the database accepts a private gold category` (scope `web`; `db` is not a scope).

**PR 1 boundary:** Tasks 1–4. The PR body says the migration needs Carlos's OK before merge. Merging is safe before the
addon or Desktop App ship.

### Task 5: Site sync and switches for `gold`

**Files:**
- Modify: `web/src/lib/private-sync.ts` (`SYNC_CATEGORIES` :31, `SHOW_SWITCH` :36, `CATEGORY_OF` :43, `categoryData`
  :116), `web/src/lib/character-links-store.ts` (`VisibilityFlags` :209-211 gains `show_gold`),
  `web/src/app/api/me/characters/links/[id]/visibility/route.ts` (doc comment :21-22),
  `web/src/app/settings/LinkedCharacters.tsx` (`SyncCategory` and `CATEGORY` :23-26: `gold: { name: "Gold", show: "show_gold" }`)
- Test: `web/src/app/api/me/characters/sync/route.test.ts` (it covers `buildCharacterFacts` and `categoryData`),
  `web/src/app/api/me/characters/links/[id]/visibility/route.test.ts` (:100, :141), `web/src/app/settings/linked-characters.test.tsx`

**Interfaces:**
- Consumes: Task 1's kind, Task 4's category.
- Produces: `categoryData("gold", row)` returns `{ stats: Record<string, number> }`. `SHOW_SWITCH.gold = "show_gold"`.

- [ ] **Step 1: Write failing tests:**
  - a sync request with a `wealth_owned` row yields one `gold` fact holding the stats;
  - with private sync on, the visibility route accepts `show_gold`. With sync off it still refuses it: adjust :100 to stub
    sync off, and keep :141 under armory only;
  - Settings shows a "Gold" sync toggle and a "Show gold on …'s page" switch, both off by default.
- [ ] **Step 2: Run** those files. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): gold is a private sync category with its own page switch`.

### Task 6: Gold section on the character page

**Files:**
- Modify: `web/src/lib/character-facts.ts` (`factSections` :35-62, `withFacts` :74), `web/src/lib/character-showcase.ts`
  (`SectionKey` :181, `SECTION_TITLES` :183: `gold: "Gold"`), `web/src/components/showcase/ShowcaseSections.tsx` (new
  `Gold` beside `Raids` :202, dispatched in `Body` :298), `web/src/app/me/characters/links/[id]/page.tsx` (:115 filter
  includes gold)
- Test: `web/src/app/characters/characters.test.tsx` (:336 currently expects a gold fact ignored),
  `web/src/app/showcase/character/showcase.test.tsx`, `web/src/app/me/characters/links/[id]/preview.test.tsx`

**Interfaces:**
- Consumes: the `gold` fact `{ stats }`, `Coins` from `web/src/components/ui/Coins.tsx` for copper values.
- Produces: `<Gold stats capturedAt />` with four groups:
  - Income: 328 Total gold acquired, 333 Looted, 326 Quest rewards, 921 Vendors, 919 Auctions;
  - Spending: 1146 Travel, 1148 Postage, 1147 Barber shops, 1150 Talent respecs;
  - Auctions: 329 Posted, 330 Purchases, 332 Largest sale, 331 Largest bid;
  - Records: 334 Most gold ever owned, 1149 Talent respecs (count).
  A missing id shows "Not reported". The section is labelled "From your addon" with the capture date.

- [ ] **Step 1: Write failing tests:**
  - with `show_gold` on, the public page shows "Gold", "Total gold acquired" with its coins, and "Not reported" for a
    missing id;
  - with it off, no Gold section and no stat value appears in the markup;
  - the owner preview shows it either way;
  - no "consistent" or "misconduct" text.
- [ ] **Step 2: Run** those files. Expected: FAIL.
- [ ] **Step 3: Implement** with the existing section components. No gradients and no opacity dimming (design guard).
- [ ] **Step 4: Run** them plus `src/design/guard.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): a linked character's page can show its lifetime gold`.

### Task 7: Gold on the lifetime totals page

**Files:**
- Modify: `web/src/lib/lifetime-summary.ts`, `web/src/app/me/characters/lifetime/page.tsx`
- Test: `web/src/lib/lifetime-summary.test.ts`, `web/src/app/me/characters/lifetime/lifetime.test.tsx`

**Interfaces:**
- Consumes: the owner's own facts per link (`ownCharacterFacts(userId, linkId)` in `web/src/lib/private-sync-store.ts`),
  joined to the armory rows by link.
- Produces: `lifetimeSummary(characters, gold?: Map<"region/slug", Record<string, number>>)` adds per-row and total
  values for `328` and `334`. The total of 334 is the largest, not the sum. Two columns: "Total gold acquired" and "Most
  gold ever owned (one character)", labelled from the addon.

- [ ] **Step 1: Write failing tests:** totals 1,150,905 + 50 = 1,150,955 copper for 328; 334 total = max; a character
  without a gold fact shows "Not reported"; the page reads facts only for the signed-in user's links.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run**, then the full web suite, typecheck and lint. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): your lifetime totals include the gold your addon synced`.

### Task 8: Docs

**Files:**
- Modify: `docs/DATA_POLICY.md` ("Private sync and owner-published sections" :947: a dated amendment, plus `gold` in
  **What is synced** and `show_gold` in **Private by default**), `CHANGELOG.md` (one `- Addon:` and one `- Site:` line,
  CRLF), `addon/README.md` (gold module paragraph: what it reads, that it leaves only through private sync for a linked
  character)

- [ ] **Step 1:** Write the three changes. Keep the policy wording in the style of the 17 November amendment.
- [ ] **Step 2: Run** `cd web && npx vitest run src/app/privacy src/app/legal-pages.test.tsx`. Expected: PASS.
- [ ] **Step 3: Commit** `docs: gold in the private sync policy, the addon README and the changelog`.

**PR 2 boundary:** Tasks 5–8, after PR 1 is merged and its migration applied. After merge: the addon release (with
Carlos's in-game check of the `GetStatistic` formats against Task 2's cases) and a Desktop App release carrying Task 3.
