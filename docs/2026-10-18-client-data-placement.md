# The readable client, positioned

Planning note, 2026-10-18. Companion to the [database taxonomy research](2026-10-18-database-taxonomy-research.md)
and to the scan command it feeds (`npm run kb -- client-scan`). It takes the complete map of tables the
Forever client ships, cross-references it with everything Everloot already holds, and places each domain
where it belongs so the site's database can be built from the right structure.

**Short version:** the build holds 1,159 readable tables and we read 68. All 68 are present and correct.
The 1,091 unread candidates sort into site areas that already exist or that the taxonomy note already
identified as gaps (object, item set, instances, faction, profession, collections). Nothing in the scan
changes the pipeline shape; it selects what enters `CLIENT_TABLES` next, one reviewed wave at a time.

**Status at close of 2026-10-18:** W0, W1, W2, W3 and W4 all executed on `wow_classic_beta` 1.60.1.70450.
The read set grew 68 → 321 tables (of 1,159 the build ships); unread candidates 1,091 → 883, the
first triage pass moved 216 dead-system and plumbing tables to the never-list (`bcc4f02`), and W4
read the live-support group (`3a1c007`), leaving **622 candidates**. Snapshot and scan stay local and
gitignored; no generator reads the W4 tables yet, so nothing is published.

**Status update 2026-10-27:** W5 executed on the launch product `wowf`, build **1.60.1.70630**
(`644ffedb`) — Forever went live and the version service now carries retail builds faster than the
beta bucket. The read set is **346 tables** (344 in this build; 332 before the wave, of 1,159) and
**599 candidates** remain. Talents (35) and achievements (6) domains are now read in full. The
committed site data was at 1.60.1.70532 when the wave ran; the scheduled build-watch opens its
game-data pull request per new build on its own.

**Status update 2026-10-27, W6:** the spell-math remainder plus the item stat scalars (`RandPropPoints`,
`ArmorLocation`) ran as W6 on the same `wowf 1.60.1.70630` snapshot. 20 tables: 18 spell tables + the two
item tables, leaving the spell tooltip math complete and items complete within its scalar rule. The read
set is **366 tables** (364 in this build) and **579 candidates** remain. Dead in
this build (recorded and left unread): `SpellPowerDifficulty`, `SpellScaling`, `SpellReagentsCurrency`,
`SpellEffectAutoDescription`, `QuestObjective`, `QuestHub`, `QuestPackageItem`; `CreatureLabel` (1,657
rows) and `NPCSounds` (196) were considered and dropped. Wave **W7** (the first integration commit) ships
`kb/src/client-achievements.ts`, the committed `web/src/data/game-data/client-achievements.json`
(441 achievements, 329 with criteria), the build-watch registration, and the map data's Difficulty join —
game file text reaching the pages for the first time as pages-only, merged player-first with reports and
labelled unconfirmed (docs/DATA_POLICY.md). The committed `map.json` stays at 1.60.1.70532: the
Difficulty fields only appear when the build watch regenerates it on a new build, so no build mixes in.

**Status update 2026-10-27, W8:** the second integration, again not a table wave. `kb/src/client-encounters.ts`
reads `DungeonEncounter` (read since W1) into the committed `web/src/data/game-data/client-encounters.json`: 341
named encounters across 41 instance map ids (ids and names in the files' order; two "no longer in use" rows on map
0 are dropped, `JournalInstance` and `JournalEncounter` are absent from this build so there is no journal text to
carry). The instance pages merge it player-first with the bosses 3 installs report: a reported boss keeps its
reported name, a reported boss the installs have not named borrows the files' name marked unconfirmed, and the
files' remaining encounters follow as unconfirmed rows with no kills, installs or dates. The list page shows the
files' count, marked, where no boss is reported yet. The files never add an instance row: an instance known only
from the files (Naxxramas, the Forever-new raids under held-back zones) stays off the list as the map keeps it
behind the spoiler switch. Pages-only by the data policy; the build watch regenerates the file.

**Status update 2026-10-27, E and W9:** Carlos approved reading E (text-bearing, pages-only) and deferring F to the
sound feature. E adds 13 tables to the read set: `GossipNPCOption` 1577 rows (1 encrypted block skipped),
`GossipNPCOptionDisplayInfo` 50, `BroadcastText` 12, `BroadcastTextDuration` 1, `ConversationLine` 634,
`SceneScript` 147, `SceneScriptText` 147, `SceneScriptGlobalText` 29, `SceneScriptPackage` 9,
`SceneScriptPackageMember` 69; `GossipXUIDisplayInfo`, `GossipOptionXUIWidgetSet` and `GossipUIDisplayInfoCondition`
are present with 0 rows. `GossipXGarrTalentTrees` is garrison plumbing and stays on the never side. Nothing from E
reaches a page yet: the option-to-text binding is server-side, so the client declares option ids and icons, not
words. The read set is **379 tables** (377 in this build) and **566 candidates** remain. The CDN moved to
`wowf 1.60.1.70634` (config `7d8ae4cd`) while this ran, and `main` took the build watch's 70634 game data in #505
meanwhile, so the E extraction and coverage report are from 70634 and the three generated files
(`client-achievements.json`, `client-encounters.json`, `client-mounts.json`) were regenerated from the 70634
snapshot before the pull request, so no build mixes once it merges.
W9 is the third integration: `kb/src/client-mounts.ts` reads `Mount` with the riding skill its type asks for
(`MountType` → `MountTypeXCapability` → `MountCapability.ReqRidingSkill`, the lowest) into the committed
`web/src/data/game-data/client-mounts.json` (141 mounts). The collections tool gains a Mounts view:
the mounts 3 installs list under the "Mounts" collection lead, the files' remaining mounts follow marked
unconfirmed. No addon module uploads mount collections yet, so today every row is the files'.

## What the scan measures

- The WoWDBDefs manifest (pinned commit `b9a63096cdd9`) against the build's root listing, by file data id.
  Root-listing lookups only: no file content is downloaded and no keys are loaded.
- Build scanned: `wow_classic_beta` **1.60.1.70450** (config `84bea423`), the same build a local install of
  the game carries, so what the scan says about the build matches the install.
- **1,346** tables known → **1,159 in this build**, **140 not in this build**, **0 encrypted**,
  **45 with no file data id in the manifest**, **1,091 unread candidates**. Two key-material tables
  (`TactKey`, `TactKeyLookup`) are counted, named and never candidates; the command hard-codes that.
- The 68 tables the knowledge base reads today are all present, with no mismatches (no absent table, no
  moved id, no curated id the manifest disagrees with).
- Raw report: `kb/data/client-scan/wow_classic_beta-70450-84bea423-scan.json` and `-scan.md`
  (gitignored runtime output; re-run any time, do not edit by hand).

## What Everloot holds today (the cross-reference baseline)

The 68 read tables, by area:

| Area | Tables |
|---|---|
| Items | `Item`, `ItemSparse`, `ItemClass`, `ItemSubClass`, `ItemSet` |
| Spells | `Spell`, `SpellName`, `SpellEffect`, `SpellRadius`, `SpellMisc`, `SpellDuration`, `SpellAuraOptions`, `SpellItemEnchantment`, `SpellReagents` |
| Talents | the 24 `Trait*` tables of trees, nodes, costs, currencies and loadouts |
| Classes and professions | `ChrClasses`, `ChrSpecialization`, `SkillLine`, `SkillLineAbility`, `SkillRaceClassInfo`, `SkillLineXTraitTree` |
| Maps | `Map`, `UiMap`, `UiMapAssignment`, `UiMapArt`, `UiMapArtTile`, `UiMapArtStyleLayer`, `UiMapXMapArt` |
| Interface art | `UiTextureAtlas`, `UiTextureAtlasElement`, `UiTextureAtlasMember` |
| Entity lists | `AreaTable`, `ChrRaces`, `Faction`, `CharTitles`, `Languages`, `CurrencyTypes`, `CreatureFamily`, `CreatureType`, `Holidays`, `Toy`, `BattlePetSpecies` |
| Partial on the client | `Creature`, `GameObjects`, `QuestV2` (spawns and text live on the server) |

What those produce, and where it lands:

| Structure | Fed by | Read by |
|---|---|---|
| `web/src/data/game-data/client-layer.json` | snapshot tables | item pages, `/database/items`, MCP `entity_relations` and `item_categories`, `/api/edges`, `/api/items` |
| `web/src/data/game-data/map.json` | `Map`, `UiMap`, `UiMapAssignment` | `/map` |
| `talents/<class>.json`, `raid-<build>.json`, `spell-values.json` | snapshot tables | `/tools/talents`, `/tools/raid`, build watch diffs |
| Icons and tooltip facts | unencrypted files of the snapshot build | asset bucket (pages only); tooltip facts stay in the private bucket |
| Observed layer: `entities` (9 kinds: item, npc, object, quest, zone, spell, lore_page, creator, realm) + rollups | addon uploads under the 3-install rule | `/database/{items,npcs,objects,quests,vendors,drops}`, `/tools/*`, `/lore`, `/search` |
| Edges (`kb/src/edges.ts`): kinds `item, spell, npc, object, quest, zone, item_set, icon`; rels `dropped_by, sold_by, reward_from, located_in, created_by, reagent_for, part_of_set, same_icon` | client snapshot + uploads | pages, MCP, API, bulk |

## Scan versus read set, by domain

Candidates are the unread tables; the destination column says where each domain's data belongs in the
existing structures, and the wave column proposes when to read it (W0 = next, small fixes first).

| Domain (present / read / unread) | What it holds | Destination | Wave |
|---|---|---|---|
| items 95/5/90 | display and appearance refs, bonus trees, extended costs, limits, names, disenchant loot, transmog sets and outfits | `/database/items` pages and the taxonomy path; item tooltips; edges (`part_of_set` exists, disenchant is new) | W1 meta (costs, limits, names, effects), W2 appearance/transmog |
| spells 87/9/78 | cast times, cooldowns, range, levels, power cost, categories, mechanics, shapeshift and totem refs, visuals | spell pages (no route yet) and item tooltips; edge labels (`created_by`, `reagent_for`) | W1 tooltip math subset, the rest with spell pages |
| talents 27/24/3 | loadout entries, effect points, account conditions | `/tools/talents` completion | W3 |
| characters 51/4/47 | customization clusters (`ChrCustomization*`), models, racial abilities, power types | class and race pages (a taxonomy-note gap); a dressing-room style tool later if approved | W2 class and race facts, W3 customization |
| creatures 15/3/12 | difficulty scaling, immunities, movement, sounds, display links | NPC page enrichment; `Creature` is near-empty on the client, so NPCs stay addon-observed (coverage finding) | W2 |
| models 46/0/46 | `CreatureDisplayInfo*`, `CreatureModelData`, animation kits, liquid and camera tables | model and render pipeline; a model viewer or dressing room only if that feature is approved | W3, feature-dependent |
| objects 8/1/7 | display info, art kits, labels | object pages (see `docs/design/specs/2026-10-18-object-pages-design.md`), which lean on the addon's `sourceObjectId` | W0 display info |
| quests 20/1/19 | log info and sort, POI points, money and XP rewards, quest lines | `/database/quests`, `/map` for POIs; quest-chain edge is new | W0 info and sort, W2 POI and chains |
| world 44/8/36 | area groups, map difficulty, overlays, zone music and light, phases, area triggers | `/map` and zone pages; extends the `map.json` generator | W1 groups and difficulty, W2 overlays and ambience |
| lore 3/0/3 | `LoreText`, `LoreTextPublic`, `ZoneStory` | `/lore` archive pages only; game text stays out of API, MCP and bulk (decision B) | W1 review pass |
| factions 3/1/2 | `FactionGroup`, `FactionTemplate` | faction pages (a taxonomy-note gap); NPC reaction fields | W2 |
| collections 27/2/25 | mounts and their displays, battle pets, heirlooms, pet loyalty | `/tools/collections` and mount and pet pages; the census can count ownership later | W1 mounts, W2 pets |
| professions 30/3/27 | the profession system and traits, skill categories, trade items, crafting | `/tools/professions` and `/tools/profession-planner` | W1 |
| achievements 2/0/2 | `Achievement`, `Achievement_Category` | completionist tool | W2 |
| currencies 3/1/2 | `CurrencyCategory`, `CurrencyContainer` | currency facts on vendor and tooltip surfaces; currency pages are a gap | W2 |
| holidays 4/1/3 | `HolidayNames`, `HolidayDescriptions`, `HolidayXTimeEvent` | fixes the documented gap: `Holidays` holds name ids, the names are in a table we do not read | W0 |
| pvp 1/0/1 | `ArenaTrackedItem` | internal tracking only | never |
| group content 25/0/25 | `LFGDungeons`, `JournalInstance`, `JournalEncounter`, `JournalTier`, `DungeonEncounter`, scenarios, keystone affixes | instance pages (a new route and kind); entrances already sit in `map.json` | W1 |
| travel 3/0/3 | `TaxiNodes`, `TaxiPath`, `TaxiPathNode` | `/map` overlay and route tools (`farming-routes`; gold per hour moved into the addon) | W2 |
| interface 32/3/29 | texture atlases, widgets, cameras, chat, fonts | internal tooling and the asset pipeline; not a database kind | mostly never |
| audio 21/0/21 | sound kits, ambience, zone music, weapon and weather sounds | page-only assets if a sound feature is ever approved, under the icon rules (credited, unencrypted, never in API, MCP or bulk) | W3, feature-dependent |
| other 612/2/610 | the catch-all: legacy systems shipped in the client but not live in Forever (`Garrison*`, `Azerite*`, `Artifact*`, `Covenant`, housing), live support tables (`Criteria`, `Emotes`), and internal plumbing (`Light`, `Weather`, `Node*`) | triage queue: each table moves to a domain, or to "never", by hand (first pass applied: 216 to the never-list, `bcc4f02`) | ongoing |

The "other" bucket is the honest state of the classifier, not a statement that 610 tables matter.
Presence in the client is not relevance: the Forever realm ships many retail-era tables it never uses.
Extending `DOMAIN_RULES` in `kb/src/client-scan.ts` as tables are triaged keeps the report shrinking.

## Structure recommendation

1. **The pipeline shape stands.** Snapshot (gitignored) → generated, build-stamped files in
   `web/src/data/game-data/` → pages, MCP, API, bulk. Observed facts stay in the database; client facts
   stay labeled *found in game files, unconfirmed*. Nothing from this scan is published by itself.
2. **Each wave is one coverage spec + `CLIENT_TABLES` additions + generator changes + tests**, following
   the client-coverage-tables pattern (ids pinned by test to the manifest commit, needed fields checked
   against the Forever layout, coverage report regenerated).
3. **New structures the scan justifies**, in the taxonomy note's gap order: object kind (spec exists),
   item set (edge kind exists; the item-set page is new), instances and group content, faction,
   profession pages, collections. Class and race pages come almost free from tables already read.
4. **Text-bearing tables** (lore text, holiday names, item names beyond the ones already read) follow the
   pages-only rule: page reads may show reviewed game text, and the generators must keep it out of API,
   MCP and bulk artifacts, the same way tooltip facts are kept in the private bucket.
5. **Two tables are never read**: `TactKey` and `TactKeyLookup`. The scan excludes them explicitly;
   extraction already has no key code and the forbidden-import test guards it.

## Proposed waves

- **W0 (small, fixes documented gaps):** `HolidayNames`, `HolidayDescriptions`, `HolidayXTimeEvent`;
  `QuestInfo`, `QuestSort`; `GameObjectDisplayInfo`, `GameObjectArtKit`.
- **W1 (extends existing pages):** `LFGDungeons`, `JournalInstance`, `JournalEncounter`, `JournalTier`,
  `DungeonEncounter`; `MapDifficulty`, `AreaGroupMember`; `ItemExtendedCost`, `ItemCurrencyCost`,
  `ItemLimitCategory`, `ItemBagFamily`, `ItemNameDescription`, `ItemEffect`; `SpellCastTimes`,
  `SpellCooldowns`, `SpellRange`, `SpellLevels`; `Mount`, `MountXDisplay`, `MountType`,
  `MountTypeXCapability`, `MountXSpellVisualKitPicker`; `Profession` and its trait and effect tables.
- **W2:** appearance and transmog cluster; quest POI and quest lines; battle pets and heirlooms;
  factions; `WorldMapOverlay`, `WMOAreaTable`, zone music and light; achievements; currencies.
- **W3 and feature-dependent:** character customization, creature models, taxi paths, audio, interface
  tooling. Each waits for the feature that needs it.
- **W4 (executed):** the live-support group from the "other" triage (banks, creation pieces, guild
  tabards, barber shop, progression, mail and auction house, emotes, world-object behaviour, creation
  helpers), 45 tables read plus two the build does not ship.
- **W6 (executed 2026-10-27):** the spell math remainder (18 spell tables) plus the item stat scalars
  `RandPropPoints` and `ArmorLocation`, per the D bullet's verified stragglers. Seven spell and quest
  tables are dead in this build and stay on the record.
- **W7 (executed 2026-10-27):** not a table wave — the first site integration: the achievements
  generator, the build-watch registration for it, the Difficulty join in the map data, and the
  achievements pages merging player reports with the files player-first. Pages-only by the data policy.

### Wave log (2026-10-18)

| Wave | Committed | Tables | Notes |
|---|---|---|---|
| W0 | `1142ba1` | 7 | HolidayXTimeEvent ships empty; `Holidays` name ids now resolve |
| W1 | `204e973` | 29 | added `ItemXItemEffect` beyond the plan to make `ItemEffect` joinable (no `ParentItemID` exists) |
| W2 | `d589242` | 69 | no failures; all coverage pins verified in-layout |
| W3 | `ef82618` | 102 | `LiquidType` dropped (see below); one concurrent edit from origin (PR #73) rebased in first, adding `LoadingScreens` |
| W4 | `3a1c007` | 45 | the live-support group; `ObjectEffectGroup` and `ObjectEffectPackage` are not in this build, and `ObjectEffectModifier`, `DeclinedWord` and `DeclinedWordCases` read empty; candidates 667 → 622 |
| W5 | `5a7fdf68` | 14 | achievement criteria (`Criteria` 3297, `CriteriaTree` 6771, `ModifierTree` 2845 rows; `CriteriaTreeXEffect` present, 0 rows), the classic talent family (`Talent` 432, `TalentTab` 27, `NumTalentsAtLevel` 80; `MinorTalent`, `SpecSetMember`, `SpecializationSpells`, `SpecializationSpellsDisplay`, `TalentTreePrimarySpells` present with 0 rows), and two live completes (`Difficulty` 22, `PowerType` 6). Talents and achievements domains now read in full; candidates 613 → 599 |
| W6 | `15d8a043` | 20 | the spell numbers and rules the tooltips compute from: `SpellPower` 3462, `SpellCategories` 10665, `SpellClassOptions` 6085, `SpellTargetRestrictions` 4454, `SpellInterrupts` 9895, `SpellShapeshift` 3457, `SpellLabel` 4654, `SpellProceduralEffect` 991, `SpellEquippedItems` 1886, `SpellFocusObject` 244, `SpellTotems` 1121, `SpellLearnSpell` 52, `SpellAuraNames` 650, `SpellShapeshiftForm` 32, `SpellMechanic` 36, `SpellDispelType` 11, `SpellDiminish` 11, `SpellProcsPerMinute` 11; plus the item scalars `RandPropPoints` 300 and `ArmorLocation` 23. Encrypted blocks are counted and skipped, never decrypted (several spell tables carry them); 7 spell/quest tables verified dead in this build stay unread. `CreatureLabel` (1,657 rows) and `NPCSounds` (196) considered and dropped; candidates 599 → 579. The items domain rule now also matches `RandPropPoints` and `ArmorLocation` |
| W7 | `abc3eb9e` | 0 (integration) | first generator to reach the pages: `kb/src/client-achievements.ts` walks `Achievement.Criteria_tree` through `CriteriaTree` into the committed `web/src/data/game-data/client-achievements.json` (441 achievements, 329 with criteria; pages-only per docs/DATA_POLICY.md), the build watch regenerates it, and `map.json` gains its `Difficulty` join (`difficulties` record plus per-entrance `difficultyIds`, applied when the build watch next regenerates it). The achievement pages merge player reports and the files player-first, marking the files' parts unconfirmed |
| W8 | `116ec4b7` | 0 (integration) | second generator to reach the pages: `kb/src/client-encounters.ts` reads `DungeonEncounter` into the committed `web/src/data/game-data/client-encounters.json` (341 encounters, 41 instances; pages-only), registered with the build watch and the workflow allow-list. The instance pages' boss table is player-first: reported bosses lead, the files' encounters follow as unconfirmed rows, and an unnamed reported boss borrows the files' name. The files add no instance rows, so held-back content stays unlisted |
| E | `c8b756d1` | 13 | text-bearing, pages-only: the gossip, broadcast, conversation and scene-script tables (rows above); three present with 0 rows; candidates 579 → 566. Extracted and covered on 70634 |
| W9 | `768d7a17` | 0 (integration) | third generator to reach the pages: `kb/src/client-mounts.ts` reads `Mount` plus the riding-skill join into the committed `web/src/data/game-data/client-mounts.json` (141 mounts; pages-only), registered with the build watch and the workflow allow-list. The collections tool's Mounts view is player-first: reported mounts lead, the files' mounts follow unconfirmed |

Findings the waves surfaced while reading:

- **Ships empty in this build, read so the snapshot stops asking:** the Journal tables
  (`JournalInstance`, `JournalEncounter`, `JournalTier`), `ItemCurrencyCost`, the whole BattlePet
  cluster, `Heirloom`, the lore texts (`LoreText`, `LoreTextPublic`, `ZoneStory`), the Profession trait
  and effect tables (plain `Profession` carries 12 rows), `MountXSpellVisualKitPicker`,
  `ItemAppearanceXUiCamera`, `TransmogIllusion`, `ChrClassUIDisplay` and the `ModelSound` cluster.
- `LFGDungeons.MapID` is zero in every row; the dungeon-to-map link lives on `DungeonEncounter`.
- `QuestMoneyReward` and `QuestXP` carry ids and difficulty only — amounts are server-side.
- **Upstream gap:** `LiquidType` (1371380) cannot be read at all. The pinned WoWDBDefs layout marks its
  `Texture` column as a string without a string definition, so extraction fails on it. The reason is
  recorded next to the table in `kb/src/client-snapshot.ts`; revisit when the pinned definitions fix the
  layout.
- **W4:** `ObjectEffectGroup` and `ObjectEffectPackage` are not in this build, and `ObjectEffectModifier`,
  `DeclinedWord` and `DeclinedWordCases` are present with 0 rows. Six tables carry encrypted blocks
  (`Emotes`, `Lock`, `SummonProperties`, `TotemCategory`, `ObjectEffect`, `ObjectEffectPackageElem`);
  the blocks are skipped, never decrypted.

## Decisions for Carlos

1. ~~Which wave to approve first.~~ Resolved: W0 approved, then all four waves executed the same day
   (see the wave log); W4 followed as the approved live-support group. Nothing read so far is published.
2. ~~**Push the local commits, or keep the read set local for now.**~~ Resolved: pushed. `main` deploys
   on push; none of the wave commits touch generated site data, so the pushes shipped no visible change.
3. **"Other" triage appetite.** Draft below; a quick pass can move whole prefixes to a documented "never"
   list, the alternative is leaving them in the catch-all. Groups A and B applied; C ran as W4.
4. **Next wave.** Praised D and the achievements criteria cluster both executed as W5 (2026-10-27), the
   spell math remainder plus the item scalars as W6 the same day, and the first site integration
   (achievements player-first pages, the Difficulty join in the map data) as W7, the files' boss lists on the
   instance pages as W8, E as a read-only wave and the files' mount list in the collections tool as W9 (all
   2026-10-27). What remains is
   feature-tied: E as a reviewed pages-only pass (`GossipNPCOption` 1577 rows declare an NPC's option ids,
   but the option-to-text binding is server-side, so the read yields declarations only) and F with the
   sound feature. Further site-merge candidates exist (difficulty names into the instance pages');
   the mining loop is at a natural stop until a feature is picked.

## "Other"-bucket triage — first pass applied, rest drafted

The 609 unread "other" tables group more cleanly than their size suggests. First pass (groups A and B,
applied 2026-10-18 in `bcc4f02` via `NEVER_TABLE_RULES` in `kb/src/client-scan.ts`): **216 tables**
counted, named with a reason, and kept out of the candidate pool — unread candidates 883 → 667. Group C
followed the same day as wave W4 (`3a1c007`), leaving **622 candidates**. The rest of the draft below
still waits; per-table moves land in `DOMAIN_RULES` as they are confirmed.

**A. Dead retail systems → "never" ✅ applied (200 tables).** Shipped in the client, not live in Forever:
`Garr*` garrison (55), `Artifact*` (12), `Azerite*` (12), the Shadowlands set `Soulbind*`, `MawPower*`,
`Runeforge*`, `Covenant`, `CorruptionEffects` (12), `Perks*` Trading Post (14), `Warband*` (9), player
housing `House*`, `Decor*`, `Room*`, `ExteriorComponent*`, `SuperDistrict*`, `Neighborhood*` (38),
`MythicPlus*` (5), `Delves*` (2), `AssistedCombat*` (3), dragon-riding `FlightCapability*`, `GlideEvent*`,
`DriveCapability*` (6), `WeeklyRewardChest*` (2), esports `Commentator*` / `PVPScoreboard*` (6),
`AdventureJournal*` (2), `Bounty*` (2), `Initiative*` (7), retail-PvP `PvpTalent*`, `PvpBrawl`,
`PvpSeason*`, `PrestigeLevelInfo`, `PvpTier`, `PvpRating`, `PvpScalingEffect*` (11), `Relic*` (2).
`PVPDifficulty`, `PVPStat` and `PVPBracketTypes` deliberately stay candidates pending the PvP review.

**B. Client plumbing → "never" ✅ applied (16).** `GlobalStrings`, `Cfg_*`, `Locale`, `Hotfixes`,
`StartupFiles`, `SharedString`, `SpamMessages`, `ServerMessages`, `BannedAddons`, `GameClockDebug`.

**C. Live support tables → wave W4 ✅ executed (`3a1c007`, 45 of 47 read; the other two are not in this build).** Tables Forever's live realm plausibly uses today:
banks and slots (`BankBagSlotPrices`, `BankTab`, `StableSlotPrices`), character creation pieces
(`CharBaseInfo`, `CharBaseSection`, `CharHairGeosets`, `CharComponentTexture*`, `CharStartKit`,
`Component*FileData`), guild tabards and emblems (`GuildEmblem`, `GuildTabard*`, `GuildShirt*`,
`GuildColor*`), `BarberShopStyle`, progression (`LevelExperience`, `Exhaustion`, `DurabilityCosts`,
`DurabilityQuality`), `MailTemplate`, `AuctionHouse*`, chat emotes (`Emotes*`), world objects
(`Lock`, `LockType`, `SummonProperties`, `TotemCategory`, `PowerDisplay`, `ObjectEffect*`,
`ParticleColor`), and creation helpers (`DeclinedWord*`, `NameGen`, `Resistances`, `RaceStat`).
These would land across characters, world and item domains.

**D. Classic talent trees → talents domain, with the spell work.** `Talent`, `TalentTab`,
`TalentTreePrimarySpells`, `SpecializationSpells*`, `SpecSetMember`, `MinorTalent`, `NumTalentsAtLevel`
(≈8). ✅ Executed as W5 (2026-10-27): `Talent` 432, `TalentTab` 27 and `NumTalentsAtLevel` 80 carry
rows; the retail specialization plumbing (`SpecializationSpells*`, `SpecSetMember`, `MinorTalent`,
`TalentTreePrimarySpells`) is present with 0 rows in this build.

**E. Text-bearing, pages-only.** ✅ Read 2026-10-27 (13 tables, see the status update above). `BroadcastText*`, `ConversationLine`, `GossipNPCOption*`, `SceneScript*`
(≈20) — same rule as lore text: pages may show reviewed game text; API, MCP and bulk stay clean.
Verified row counts on 70630: `GossipNPCOption` 1577, `GossipNPCOptionDisplayInfo` 50, `BroadcastText`
only 12 — NPC dialogue text is mostly server-side, so the client side of this wave is option kinds and
icons, not words.

**F. Ambience and lighting → defer with the sound feature (Carlos, 2026-10-27: deferred).** `Light*`, `LightData*`, `LightShaft*`,
`SkyScene*`, `VolumeFog*`, `Weather*`, `WindSettings`, `Terrain*`, `WaterfallData`, `WorldShadow` (≈30).

**G. Long tail stays "other"** until a feature or a page needs it. Per-table moves can be added to
`DOMAIN_RULES` in `kb/src/client-scan.ts` incrementally, so the report shrinks without a bulk edit.

## Pointers

- Command: `npm run kb -- client-scan [--product wow_classic_beta] [--manifest <path|url>] [--out data/client-scan]`
- Raw report (runtime): `kb/data/client-scan/<product>-<buildId>-<config8>-scan.{json,md}`
- Coverage spec pattern: `docs/design/specs/2026-10-18-client-coverage-tables-design.md`
- Procedure as an agent skill: `everloot-client-mining` in the operator's private agent workspace
  (scan → choose wave → CLIENT_TABLES → extract → coverage → regenerate; preflight and guardrails included)
- Follow-on specs: relation edges, item taxonomy, object pages, entity icon manifest (`docs/design/specs/`)
- Taxonomy and competitor context: `docs/2026-10-18-database-taxonomy-research.md`
