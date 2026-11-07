# Character sheet sync: talents, stats, PvP — Implementation Plan

**Status:** shipped 2026-11-06/07 in #856, #858, #862 (Desktop 0.1.20) and #866; migration `20261107140000_private_sync_stats_pvp.sql` applied in prod. The addon side waits on an in-game check before its release.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A linked character's public page shows its talents, its character-sheet stats and its PvP rank and honorable kills, synced from the owner's own addon through the Desktop App, like gear already is.

**Architecture:** Three new local-only addon row kinds (`talent_owned`, `stats_owned`, `pvp_owned`) on the `owned.lua` pattern (completion switch, opaque `characterKey`, latest state per character, never uploaded). The Desktop sync sender maps them to sync categories `talents` (exists), `stats` and `pvp` (new: one SQL migration plus the category lists). The site parses them in `web/src/lib/private-sync.ts` and renders them through `character-facts.ts` into the showcase sections; `pvp` is a new section.

**Tech Stack:** WoW addon Lua (tests: Python + lupa), TypeScript/zod (web Next.js on Cloudflare Workers, companion, desktop; vitest), Postgres SQL migration (Supabase).

**Spec:** research `tmp/sdd-research/a-feasibility.md` (sections 1–3; untracked, in this worktree) — the authority for file/line locations and the confirmed Forever API calls. Owner direction 2026-11-06: the character page must carry everything an armory shows (gear, talents, stats, PvP), from the owner's own data.

## Global Constraints

- Every commit: `git commit -s` (DCO `Signed-off-by` is a required check). No `Co-Authored-By` or any AI attribution line.
- Local-only kinds are never added to `packages/protocol` `recordSchemas`; each is listed in `LOCAL_ONLY_KINDS` (`web/src/lib/upload-batches.ts`) and in the local-only set of `addon/tests/protocol_schema.py`. Their zod shapes live in `web/src/lib/private-sync.ts` beside `professionOwned`.
- Addon reads only the calls the spec confirms from Forever's `Camelot/` UI files, each through the guarded `call()` that runs `E.Readable` (pattern `addon/modules/owned.lua:47-55`). A missing or unreadable call records nothing for that field or row, never a zero.
- New rows carry `characterKey` from `E.Completion.Identity()` (guard `E.Completion` nil), `installId`, `capturedAt` (`date("!%Y-%m-%dT%H:%M:%SZ")`), `class`, `level`, and are gated on `E:IsEnabled("completion")`, listed in `O.KINDS` (or the new module's own KINDS) so `/everloot completion off` deletes them.
- Site never shows an invented number: an absent stat is omitted, an absent section is `empty`; the `stats` section stays `unsupported` (NOT_RECORDED_LINE) until a fact exists.
- `web/src` design guard: no opacity dimming, no gradients (`web/src/**/guard.test.ts`).
- Stat keys (exact, shared by addon row and site): Attributes `strength agility stamina intellect spirit`; Melee `meleeAttackPower meleeHit meleeCrit meleeHaste expertise`; Ranged `rangedAttackPower rangedHit rangedCrit rangedHaste`; Spell `spellPower healing spellHit spellCrit spellHaste`; Defense `armor defense dodge parry block`. Percent keys: every `*Hit *Crit *Haste dodge parry block`, stored as numbers rounded to 2 decimals.
- New sync categories `stats` and `pvp`, switches `show_stats` and `show_pvp`. Migration file: `supabase/migrations/20261107140000_private_sync_stats_pvp.sql`, safe to re-apply. It is NOT applied to prod in this plan.
- Test commands: web `cd web && npx vitest run <file>`; companion/desktop same in their dir; addon `python addon/tests/run_all.py` (or one script `python addon/tests/<x>.py`); typecheck `npm run typecheck` in each touched package.

## Review Focus

1. Two linked characters on one install: talent/stats/pvp rows must replace only their own character's row (`replace()` by `characterKey`) and the sender must send each to its own link. Test in Tasks 2, 5, 7 (two keys) and 3 (sender, two links).
2. Stats read in combat or before the client has data (secret/nil values): no row at all, not a row of zeros. Tests in Task 5.
3. An unlinked character's rows are never sent. Test in Task 3 (and reused in 6/8 sender cases).
4. Old `talent_snapshot` rows (anonymous) reaching the sync endpoint must be refused, so an unkeyed row can never become a character's fact. Test in Task 1.
5. `GetStatistic` returns "--" or a comma-formatted string for honorable kills: parse to an integer or omit the field. Test in Task 7.

---

## PR 1 — talents (Tasks 1–3, no migration)

### Task 1: Site accepts `talent_owned`, refuses `talent_snapshot` on sync

**Files:**
- Modify: `web/src/lib/private-sync.ts` (schemas, `SCHEMAS`, `CATEGORY_OF`, `buildCharacterFacts` talents branch ~:153, `categoryData` "talents" ~:179)
- Modify: `web/src/lib/upload-batches.ts:29` (`LOCAL_ONLY_KINDS`), `addon/tests/protocol_schema.py:18`
- Test: `web/src/app/api/me/characters/sync/route.test.ts`, `web/src/lib/upload-batches.test.ts`, `web/src/lib/character-facts.test.ts`

**Interfaces:**
- Produces: `export const talentOwned` (zod) = `ownedBase.extend({ kind: z.literal("talent_owned"), treeId: int positive, specId: int positive optional, points: int 0..100, nodes: [{ nodeId: int positive, ranks: int 1..10, choice?: int positive }] max 200 })` with the same refinements as `talentSnapshot` in `packages/protocol/src/records.ts:586-591`. `CATEGORY_OF.talent_owned = "talents"`. The stored fact `data` keeps today's shape `{class, treeId, specId, points, nodes}`.

- [ ] Step 1: Tests: sync route accepts a `talent_owned` row for a linked character and stores a talents fact with sorted nodes; a `talent_snapshot` row in the same request is skipped (no talents fact from it); `upload-batches.test.ts` local-only check includes `talent_owned`.
- [ ] Step 2: Run, expect FAIL.
- [ ] Step 3: Implement; remove `talent_snapshot` from `SCHEMAS`/`CATEGORY_OF`; add `"talent_owned"` to both local-only lists.
- [ ] Step 4: Run the three web test files + `python addon/tests/protocol_schema.py` + `npm run typecheck` in web: PASS.
- [ ] Step 5: Commit `feat(web): sync talents from keyed talent_owned rows` (`-s`).

### Task 2: Addon writes `talent_owned`

**Files:**
- Modify: `addon/modules/owned.lua` (header comment, `O.KINDS`, reader, events, status), `addon/README.md` (owned rows paragraph)
- Test: `addon/tests/owned_contract.py`

**Interfaces:**
- Consumes: `E.Talents.Groups()`, `E.Talents.Snapshot(group)` (`addon/modules/talents.lua:60,161`), `E.Completion.Identity()`.
- Produces: rows `{kind="talent_owned", characterKey, installId, capturedAt, class, level, treeId, specId?, points, nodes}` for the ACTIVE group only, one per character, written on the events `talents.lua` already listens to (PLAYER_ENTERING_WORLD, TRAIT_CONFIG_UPDATED, ACTIVE_PLAYER_SPECIALIZATION_CHANGED, PLAYER_TALENT_UPDATE, PLAYER_LEVEL_UP); `points == 0` writes nothing.

- [ ] Step 1: Contract tests: active-group row shape; second read replaces this character's row and keeps another key's row; `points == 0` → none; completion off → rows deleted and no new rows; `E.Talents` missing → none, status names it.
- [ ] Step 2: Run `python addon/tests/owned_contract.py`, expect FAIL.
- [ ] Step 3: Implement in `owned.lua` (reuse `replace`, `now`, `call`).
- [ ] Step 4: `python addon/tests/run_all.py`: PASS.
- [ ] Step 5: Commit `feat(addon): record the active talent build per character for private sync` (`-s`).

### Task 3: Sender sends talents; DATA_POLICY wording

**Files:**
- Modify: `companion/src/sync-sender.ts` (header comment :15, `CATEGORY_OF` :58, `KEYED` :63, category loop :108)
- Modify: `docs/DATA_POLICY.md` (~205-209 local-only kinds list, ~831 "does not send talent builds yet")
- Test: `companion/test/sync-sender.test.ts` (fixture :35, registry :59, assertion :97)

- [ ] Step 1: Tests: a linked character's `talent_owned` row is sent under `talents`; a second linked character gets its own; an unlinked character's row is not sent; the :97 assertion changes to expect the keyed row.
- [ ] Step 2: Run `cd companion && npx vitest run test/sync-sender.test.ts`, expect FAIL.
- [ ] Step 3: Implement; edit the two DATA_POLICY passages to say the active talent build syncs as `talent_owned` under the talents switch (no new category).
- [ ] Step 4: companion tests + typecheck; `cd desktop && npx vitest run` (sender is imported there): PASS.
- [ ] Step 5: Commit `feat(companion): send linked characters' talent builds` (`-s`).

**PR 1 boundary:** push this branch as PR 1 (talents). Continue Tasks 4–8 on a branch stacked on it.

## PR 2 — stats and PvP (Tasks 4–8, migration Carlos applies)

### Task 4: Sync categories `stats` and `pvp` end to end (no row kinds yet)

**Files:**
- Create: `supabase/migrations/20261107140000_private_sync_stats_pvp.sql`
- Modify: `web/src/lib/private-sync.ts` (`SYNC_CATEGORIES`, `SHOW_SWITCH`), and the mirrors the spec lists (section 2, "New category change set" item 3): `web/src/components/LinkedCharacters.tsx`, `web/src/app/me/characters/links/[id]/page.tsx`, `web/src/app/api/me/characters/links/route.ts`, `.../links/[id]/sync/route.ts`, `.../links/[id]/visibility/route.ts`, `web/src/lib/character-links-store.ts`, `web/src/lib/private-sync-store.ts`
- Modify: `docs/DATA_POLICY.md` "What is synced" (~839) and visibility list (~854): add stats and PvP, self-reported, own switch each; `/privacy` page item if it lists the categories
- Test: `supabase/tests/private_sync.sql` (add cases), the three link route tests, `web/src/components/linked-characters.test.tsx`

**Interfaces:**
- Produces: `SyncCategory` includes `"stats" | "pvp"` after `"gear"`/`"raids"` respectively: order `["gear","stats","talents","pvp","professions","reputations","raids","achievements"]`; `SHOW_SWITCH.stats = "show_stats"`, `SHOW_SWITCH.pvp = "show_pvp"`.

- [ ] Step 1: Tests: consent and visibility routes accept `stats`/`pvp` and the new switches; account list shows the two rows; SQL test sets consent for `stats` and reads `show_stats`.
- [ ] Step 2: Run web tests, expect FAIL.
- [ ] Step 3: Migration (widen the category checks, `set_sync_consent`, sync and listing functions, add `show_stats`/`show_pvp` default false, extend `set_visibility`), then lib + mirrors + policy.
- [ ] Step 4: Web tests + typecheck + lint: PASS. (SQL test is run by CI's Supabase job, if present; otherwise note it in the report.)
- [ ] Step 5: Commit `feat(web): stats and pvp sync categories` (`-s`).

### Task 5: Addon `stats_owned` collector

**Files:**
- Create: `addon/modules/charstats.lua`, `addon/tests/charstats_contract.py`
- Modify: `addon/Everloot.toc` (after `owned.lua`), `addon/tests/run_all.py`, `addon/core.lua` status kinds (:172-180), `addon/README.md`; `LOCAL_ONLY_KINDS` + `protocol_schema.py` get `stats_owned`

**Interfaces:**
- Produces: row `{kind="stats_owned", characterKey, installId, capturedAt, class, level, stats = { <stat key> = number, ... }}` using exactly the Global Constraints keys; a key whose call is missing/unreadable is omitted; no row when fewer than the five attributes are readable. Reads out of combat (`InCombatLockdown()` true → skip) on PLAYER_ENTERING_WORLD, UNIT_STATS("player"), PLAYER_EQUIPMENT_CHANGED, PLAYER_LEVEL_UP, debounced 2 s. Calls per spec table section 2 (`UnitStat` i=1..5 effective stat; `UnitAttackPower` base+pos+neg; `UnitRangedAttackPower`; `GetCritChance`, `GetRangedCritChance`, `GetSpellCritChance`; hit = `GetHitModifier()`/`GetRangedHitModifier()`/`GetSpellHitModifier()` plus `GetCombatRatingBonus(CR_*)` only when the CR global exists; `GetMeleeHaste`, `GetRangedHaste`, `UnitSpellHaste("player")`; `GetExpertise` first return; spellPower = min of `GetSpellBonusDamage(2..7)`; `GetSpellBonusHealing`; `UnitArmor` effective; defense = `UnitDefenseSkill` base+modifier; `GetDodgeChance`, `GetParryChance`, `GetBlockChance`). Module KINDS `{ "stats_owned" }`, withdrawn with completion off.

- [ ] Step 1: Contract tests: full row from mocked calls with exact keys and 2-decimal percents; a missing call omits its key; in combat → no write; attributes unreadable (secret) → no row; second character keeps first's row; completion off deletes.
- [ ] Step 2: Run, expect FAIL.
- [ ] Step 3: Implement.
- [ ] Step 4: `python addon/tests/run_all.py` + `npx vitest run src/lib/upload-batches.test.ts` in web: PASS.
- [ ] Step 5: Commit `feat(addon): record the character sheet stats per character for private sync` (`-s`).

### Task 6: Stats on the page

**Files:**
- Modify: `web/src/lib/private-sync.ts` (`statsOwned` schema: `stats` = record of the exact keys → finite number, ≥1 key; `CATEGORY_OF.stats_owned = "stats"`; `categoryData` "stats" → `{ stats }`), `web/src/lib/character-facts.ts` (`FactSections.stats`, parse to `StatsData` in `STAT_GROUPS` order with labels; percent keys formatted `"12.34%"`, others with thousands separators), `web/src/app/characters/[ruleset]/[realm]/[name]/character-view.ts` and `web/src/app/me/characters/links/[id]/page.tsx` (use the fact; keep `unsupported` when none), `companion/src/sync-sender.ts` (map + loop)
- Test: `character-facts.test.ts`, `sync/route.test.ts`, `characters.test.tsx`, `companion/test/sync-sender.test.ts`

**Interfaces:**
- Consumes: Task 4 categories, Task 5 row shape.
- Produces: `STAT_LABELS: Record<StatKey, { group: StatGroup; label: string; percent: boolean }>` in `character-facts.ts` (labels: Strength, Agility, Stamina, Intellect, Spirit, Attack power, Hit, Crit, Haste, Expertise, Spell power, Healing, Armor, Defense, Dodge, Parry, Block).

- [ ] Step 1: Tests: parse groups in order, unknown key dropped, empty group omitted, percent formatting; page shows Stats from a fact and NOT_RECORDED_LINE without one; sender sends `stats_owned` for linked only.
- [ ] Step 2–4: FAIL → implement → web + companion tests, typecheck, lint PASS.
- [ ] Step 5: Commit `feat(web): stats section from synced stats_owned` (`-s`).

### Task 7: Addon `pvp_owned` collector

**Files:**
- Create: `addon/modules/pvp.lua`, `addon/tests/pvp_contract.py`
- Modify: `addon/Everloot.toc`, `addon/tests/run_all.py`, `addon/core.lua` status kinds, `addon/README.md`; `LOCAL_ONLY_KINDS` + `protocol_schema.py` get `pvp_owned`

**Interfaces:**
- Produces: row `{kind="pvp_owned", characterKey, installId, capturedAt, class, level, rank?, rankPoints?, rankThreshold?, rankMax?, season?, honorableKills?}` (all integers ≥ 0). Rank from `C_MajorFactions.GetMajorFactionProgressionInfo(2800)` (`renownLevel`, `renownReputationEarned`, `renownLevelThreshold`, `maxLevel`; only when it returns a table); season `GetCurrentArenaSeason()`; honorableKills = statistic id 588 found by walking `GetStatisticsCategoryList()` / `GetCategoryNumAchievements(cat)` / `GetStatistic(cat, i)` matching `statID == 588`, the quantity parsed by stripping non-digits, "--" or empty → omitted. No row when both rank and honorableKills are absent. Events: PLAYER_ENTERING_WORLD, UPDATE_FACTION, MAJOR_FACTION_RENOWN_LEVEL_CHANGED, PLAYER_PVP_RANK_CHANGED, debounced 2 s. Module KINDS `{ "pvp_owned" }`.

- [ ] Step 1: Contract tests: full row; "1,234" → 1234; "--" → field omitted; `C_MajorFactions` missing → row with HK only; both absent → no row; two characters; completion off deletes.
- [ ] Step 2–4: FAIL → implement → `python addon/tests/run_all.py` PASS.
- [ ] Step 5: Commit `feat(addon): record PvP rank and honorable kills per character for private sync` (`-s`).

### Task 8: PvP section on the page

**Files:**
- Modify: `web/src/lib/character-showcase.ts` (`SectionKey` + `"pvp"`, `SECTION_TITLES.pvp = "PvP"`, page order gear, stats, talents, pvp, raids, collections, reputations, professions; `PvpData = { rank: number|null; rankPoints: number|null; rankThreshold: number|null; rankMax: number|null; season: number|null; honorableKills: number|null }`; `ShowcaseInput.pvp: Section<PvpData>`), `web/src/components/showcase/ShowcaseSections.tsx` (render "Rank N of M", points/threshold, "Season N", "Honorable kills N"; a null line is not drawn), `web/src/lib/character-facts.ts`, `web/src/lib/private-sync.ts` (`pvpOwned`, `CATEGORY_OF`, `categoryData`), `character-view.ts`, `/me/characters/links/[id]/page.tsx` (default `{ state: "empty" }`), `web/src/data/showcase.ts` (sample), `companion/src/sync-sender.ts`
- Test: `character-showcase.test.ts`, `character-facts.test.ts`, `showcase.test.tsx`, `characters.test.tsx`, `sync/route.test.ts`, `companion/test/sync-sender.test.ts`

- [ ] Step 1: Tests: section order; PvP renders rank/HK lines and omits nulls; empty → "Nothing synced for this yet."; private hides it; parser; sender linked-only.
- [ ] Step 2–4: FAIL → implement → web + companion tests, typecheck, lint PASS.
- [ ] Step 5: Commit `feat(web): PvP section from synced pvp_owned` (`-s`).

**PR 2 boundary:** push as PR 2 stacked on PR 1. Body states: migration `20261107140000_private_sync_stats_pvp.sql` must be applied in prod before merge; addon rows are harmless before then (held back by `LOCAL_ONLY_KINDS`, which must ship in the same Desktop release as the addon); one in-game check (stats out of combat, `GetStatistic` format, rank) before tagging the addon.
