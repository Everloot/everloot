# Class, Legacy and dungeon sources: what our allowed sources can back

Audit, 2026-10-27. It answers one question per topic: can a source this project already allows (the
[ledger](LEDGER.md), the [data policy](../DATA_POLICY.md)) back the facts the class, Legacy and dungeon work needs?
It is read-only. Nothing was added to `CLIENT_TABLES`, no generator or published file changed, and no source was
added. A verdict here is not a decision to publish: publication stays a separate, reviewed step under the data
policy, and anything taken from the game files stays labelled *found in game files, unconfirmed*.

- **ready**: an allowed source holds the fact in a form a generator can read today.
- **partial**: part of it is held; the part that is not is named.
- **blocked**: no allowed source holds it today; the section says what would change that.

## Verdicts

| Topic | Verdict | In one line |
|---|---|---|
| Legacy tree and node ids, ranks, prerequisites | ready | Three trees of 9 nodes in the unencrypted trait tables; enough for a catalog on their own |
| Legacy spend gates | partial | Amounts (5 and 10), the nodes they guard and the group each condition names are in the files; that the named group is where points are counted is a column-name reading, so no planner enforces the gates yet |
| Legacy cost and cap | display only | Each tree names a cost of 1 and the currency a maximum of 16; shown as unconfirmed readings, enforced by no planner until confirmed |
| How Legacy points are earned | partial | 131 achievements give points; what each achievement asks for is in tables we do not read |
| Legacy names | partial | Every perk has a spell name; the three trees have no name in any table we read |
| Talented, the documented exception | ready from the game files | Every part of the stated fact matches unencrypted rows of builds 70450 and 70532, read from column names; the exception stays as written |
| Current Mage talents | blocked | The live product's newer build changes Mage talents the published catalog does not have; no Mage talent content is presented as current until the build watch follows the chosen product and the catalog is regenerated or shown to match |
| Class weapon and armour proficiency | partial | Which classes get each weapon and armour skill, and from what level; not which item kinds a skill allows |
| Trainer spells | partial / blocked | Class spell sets and learn levels are in the files; what a trainer sells, its price and the trainer are not anywhere we may read |
| Boss name to NPC identity | blocked in the files | Encounter names are in the readable rows with no NPC column; the only allowed join is players' uploads, three installs |
| Quests and dungeons | blocked in the files | No quest row says where a quest is given or which instance it belongs to |
| Zone level ranges | blocked | No zone carries a level row in the current build; the site keeps showing none |

The required coverage this leaves for the class and dungeon work is in [Required coverage](#required-coverage).

## Build and evidence

- **Build.** `wow_classic_beta` 1.60.1.70532, build config `ad1802f4`, the product the pipeline reads
  (`client-scan` at 2026-10-27 03:05 UTC; WoWDBDefs manifest commit `05e242b6acdc`). The manifest knows 1,346
  tables; 1,159 are in this build, 140 are not, 45 have no file data id. The read set is 332 tables (330 in the
  build), 613 tables are unread candidates and 216 are on the never-list.
- **Snapshot.** The rows quoted below come from a `client-extract` snapshot of that build taken on 2026-10-25
  (extraction library `@rhyster/wow-casc-dbc@2.16.17`, WoWDBDefs `12ce70d5fef1`, sha256 `02a5e8dfce0a…`, which
  matches its manifest). Each of the 52 tables the checks read has the row count and content hash that the
  committed [`client-digests.json`](../../web/src/data/game-data/client-digests.json) records for 70532.
- **The earlier build.** The same checks run on the 70450 snapshot of 2026-10-18 (library 2.16.15, WoWDBDefs
  `b9a63096cdd9`, sha256 `6c8c1e4715e4…`, matching its manifest) return the same Legacy, Talented and zone results.
- **`ContentTuning`.** It joined the read set on 2026-10-25, after both snapshots, so this audit read that one table
  of build 70532 with a short script outside the repository that calls the extractor's own `openCdn`,
  `pinDefinitions` and table reader: 100 rows, no encrypted blocks, content key `f4b8d521e141…`, row hash
  `2499b589186c`. The fields used are `MinLevelSquish`, `MaxLevelSquish`, `LfgMinLevel` and `LfgMaxLevel`. A
  `client-extract` run from 2026-10-25 on reads the table too, for whatever build the CDN serves at the time.
- **The live product.** Blizzard's version service also lists product `wowf` (WoW: Forever) at 1.60.1.70630,
  build config `644ffedb`, newer than the beta build above; an installed client's `.build.info` names the same
  product at 1.60.1.70532. A `client-scan` of `wowf` finds the same 1,159 tables and the same 613 candidates. The 37
  tables behind the queries below were read from both products under one WoWDBDefs commit, by the same kind of
  script and written with the repository's snapshot writer (sha256 `80a4e45a3eba…` for the beta file, `ffcb371ec005…`
  for `wowf`). 29 are identical, and every query below gives the same result on `wowf`, except the `ContentTuning`
  reference count, which needs item, spell and creature tables read from 70532 only. The other tables the verdicts
  rest on were read from 70532 only: `SpellLevels`, `Spell`, `SpellMisc`, `FileStatus`, `ItemSubClass`, `QuestLine`,
  `QuestLineXQuest`, the three Journal tables, `TraitSubTree`, `Item`, `ItemSparse` and `CreatureDifficulty`.
- **What `wowf` changes.** Of the 8 tables that differ, four are the talent tables. In the Mage trait tree, Frost
  node 105773 is gone; node 113627, a one-rank talent the published catalog does not list, joins the Arcane display
  group, the group behind Arcane's 15-point gate and two groups that 25- and 20-point conditions name; four Frost
  nodes move; Frost node 105778 drops from 5 ranks to 3. Priest node 105837 joins two groups that 15- and 10-point
  conditions name. The other four tables change two area rows, one encounter's flags, seven skill ability flags and
  add nine spell names. `TraitNodeGroupDisplayInfo` was not read on `wowf`, so whether a catalog regenerated from it
  would list node 113627 under Arcane is not verified. This audit makes no claim that the published data matches the
  live game. Following `wowf` is the build watch's decision; until it is made and the catalog is regenerated or shown
  to match, Mage talent content is not presented as current.
- **Blizzard's own posts**, already stored by the blue tracker ([`kb/changes/blue-posts.json`](../../kb/changes/blue-posts.json)):
  [the Legacy system](https://us.forums.blizzard.com/en/wow/t/get-to-know-the-world-of-warcraft-forever-legacy-system/2359225)
  (2026-09-23), [Legacy points for beta testing](https://us.forums.blizzard.com/en/wow/t/legacy-points-for-beta-testing/2368776)
  (2026-10-01), [the new dungeons](https://us.forums.blizzard.com/en/wow/t/explore-the-new-dungeons-of-world-of-warcraft-forever/2387658)
  (2026-10-20) and [the raid overview](https://us.forums.blizzard.com/en/wow/t/world-of-warcraft-forever-raid-overview%E2%80%94locations-raid-sizes-and-attunement/2387821)
  (2026-10-20). Their stored excerpts back the December 9 raid date, the 16-point beta grant and the account-wide
  system. The new dungeons' excerpt names none of the nine; their names come from the committed draft pages in
  `kb/wiki/`, each citing Blizzard's full news article and forum post, checked 2026-10-20.

Not used: decryption keys, listfiles, hotfix caches (`DBCache`), any third-party game-data host or community
site, and the rows of any table outside the read set. For those tables only two things were looked at: whether the
build's root listing has them (no content download) and their column layout in WoWDBDefs.

## Legacy

The game files hold the Legacy system as three trait trees, identical in 70450, 70532 and `wowf` 70630.

- **Trees.** `TraitTree` 1187, 1188 and 1189 belong to trait system 45 and spend currency 4225
  (`TraitTreeXTraitCurrency`). Tree 1118 is in the same system with no nodes and 15 empty node groups. The talent
  catalog already lists all four in `otherTraitTrees` and reads none of them.
- **Nodes and ranks.** 9 nodes per tree, 27 in all: 26 single nodes and one tiered node (Talented, five one-rank
  entries bought in order). The entries' `MaxRanks` give 25 ranks per tree with every node maxed, 75 in all.
- **Layout and prerequisites.** Each tree has four columns (`PosX` 2400 to 5100). Its 3 `TraitEdge` rows are all
  type 2, "sufficient for availability" in WoWDBDefs (`prereqs` rule `any` in the catalog's terms), each leading
  from one column to a later one.
- **Spend gates.** Each tree has two `TraitCond` rows of type 0 ("available"): spend 5 and spend 10 of currency
  4225. Each names its tree and, in `TraitNodeGroupID`, the same node group: the tree's 7-node group (12440, 12449
  and 12450), which holds the first two columns and the third-column node the 10-point gate guards. `TraitNodeID` is
  0. The 5-point gate guards every node of the second column (Talented is one), the 10-point gate one node of the
  third. No level gate (`RequiredLevel` 0) and no player condition on the trees.
- **Cost.** Each tree's `TraitTreeXTraitCost` row names a `TraitCost` (4843, 4844 and 4846) of 1 in currency 4225.
  The three tables that would override it per node, group or entry are read and empty.
- **Cap.** `TraitCurrency` 4225 has `SourcedMax` 16. The class talent currency 3820 has 51, which matches the 51
  class talent points the catalog publishes. Legacy's 16 is also the number of points Blizzard said it would grant
  beta testers, and the 131 sources below add up to 146 points.
- **How points are earned.** 131 `TraitCurrencySource` rows for currency 4225, all through achievements: 130 give
  1 point and one, achievement 64283, gives 16. All 131 achievements are rows of `Achievement`. Each source row also
  carries a requirement string, not reproduced here.
- **Names, text and icons.** All 31 entries resolve to a `SpellName` (none falls in an encrypted block), and each
  has a description and an icon present in the build. The trees themselves have no name: `TraitTree` has no name
  column and `TraitSubTree` ships empty.
- **Encryption.** The trait tables have no encrypted blocks in any build checked.

What the files do not settle, so a catalog must carry these as unknowns, never as defaults:

- **Where a gate counts.** Both conditions of a tree name its 7-node group. Read by the column name, a gate counts
  the points spent in that group, inside its own tree, so points spent in the other two trees would not count. The
  class trees point the same way: every one of their 163 spend conditions names a group, and in 130 of the 131 row
  gates where the catalog finds a companion group, the named group is that companion (build 70532; see
  [TALENT_CATALOG](../TALENT_CATALOG.md)). Unlike the class trees, though, the Legacy group also holds the nodes its
  gates guard. This is a reading of a column name backed by an analogy, not observed play. One check in the game
  tests it: with 5 points spent in one tree only, does another tree's second column open? The tree-local reading
  says it does not.
- **Per rank and cap.** That a cost of 1 applies to each rank, and that `SourcedMax` is what a character can hold,
  are readings of the column names. The class currency's 51 supports the cap reading; the coincidence with the beta
  grant and the 146 points the sources add up to are reasons for caution. Neither 16 nor 146 becomes a spend default.
- **What each achievement asks for.** The criteria are in `Criteria`, `CriteriaTree` and `ModifierTree`, present in
  the build and not read.
- **The 16-point source.** Blizzard's 2026-10-01 post said it planned to grant all beta testers 16 Legacy points.
  That achievement 64283 is that grant is a guess, and whether it exists on live realms matters for how points are
  earned.
- **Account or character.** The currency rows name neither. Blizzard's 2026-09-23 post calls Legacy an account-wide
  system with character-specific perks.

**Go or no-go.** Go for a Legacy catalog of ids, ranks and prerequisite edges: they come from unencrypted rows of the
current build and need no third-party source. The catalog may show the cost and the cap beside them, labelled as
unconfirmed game-file readings. No planner enforces the cost, the cap or the spend gates until each is confirmed in
game or by Blizzard; until then the gate amounts are shown, not applied. The go decision itself is the maintainer's,
at the catalog's release gate. Until it passes, the planner stays blocked, and an explainer is only a stand-in.

## Talented

**The exception as documented.** The [ledger](LEDGER.md) records one fact in our own words, read on 2026-10-19 from
two community sites: Talented has 5 ranks and moves the first talent point earlier, to level 5 at rank 5, with 51
points either way. It says the fact is not in our game files, so it is shown beside the game-file level and not
computed. It is used by `firstPointLine` in `web/src/lib/talents/facts.ts` and by the `talent_tree` answer text in
`kb/src/talent-tools.ts`, both added in `693662d` on 2026-10-19.

**What the game files hold**, in 70450, 70532 and `wowf` 70630:

| Part of the fact | Row in the game files |
|---|---|
| The perk is called Talented | Spell 1225474 (`SpellName`), the definition of all five entries of node 110298 in Legacy tree 1188 |
| 5 ranks | Node 110298 is tiered (`TraitNode.Type` 1) with five entries of one rank each (`TraitNodeEntry.MaxRanks`) |
| Level 5 at rank 5 | Five `TraitCurrencySource` rows for the class point currency 3820, one per entry: bought in order (`TraitNodeXTraitNodeEntry.Index` 100 to 500), they give a point at levels 9, 8, 7, 6 and 5 |
| 51 points either way | 51 sources with no entry, at levels 10 to 60, and `TraitCurrency` 3820 `SourcedMax` 51 |

That a source tied to an entry grants its point only once the entry is bought, and that `SourcedMax` caps the total,
are readings of the column names, so the fact stays unconfirmed in game. The rows had not shown up before because the
catalog takes point levels only from sources with no entry (`TraitNodeEntryID` 0) and does not read the Legacy trees.

**Status.** The exception is unchanged: this audit does not call it a breach of policy and does not remove it.
Citing the game files as the fact's source instead, labelled unconfirmed, is a separate, reviewed change; the MCP
answer text stays as it is until then.

## Class weapon and armour proficiency

Ready, unconfirmed, from tables already read:

- Which classes each of the 19 weapon skill lines (`SkillLine.CategoryID` 6) and 5 armour skill lines (category 8)
  belongs to, per race, from `SkillRaceClassInfo.ClassMask`, and from what level, `MinLevel`: Plate Mail from level
  40 for Warrior and Paladin; Mail from the start for Warrior and Paladin and from 40 for Hunter and Shaman;
  Polearms from 20.
- The proficiency spell on each skill line (`SkillLineAbility`, for example spell 750 Plate Mail) and the classes it
  lists.
- `ChrClasses.ArmorTypeMask`, one mask per class. Reading bit N as armour subclass N is a convention, not a fact
  in the files: three classes set bit 11, which matches no armour subclass in this build, and the masks carry no
  level (Hunter's includes mail it gets at 40).

Missing: which item classes and subclasses a skill line or proficiency spell allows. That is `SpellEquippedItems`
(`SpellID`, `EquippedItemClass`, `EquippedItemSubclass`), present in this build and not read. Matching skill line
names to item subclass names would be a guess and is not done. **Partial**: a "usable by this class" filter waits
for a wave that reads `SpellEquippedItems`.

## Trainer spells

- **In the files.** Each class has 3 or 4 class-only skill lines (category 7). The readable rows of
  `SkillLineAbility` list 277 to 534 spells per class on them, ranks, talents, passives and helper spells mixed
  together. `SpellLevels` gives a learn level for 125 to 344 of them, and `SupercedesSpell` links some ranks.
  `AcquireMethod` takes the values 0 to 3, with no documented meaning for this build.
- **Not anywhere we may read.** Which of those spells a trainer teaches, what it costs and which NPC trains it: the
  WoWDBDefs manifest has no trainer table at all (none of its 1,346 tables), so this lives on the server. The addon
  records trainer services only when they need a profession (`trainer_seen`, `addon/modules/professions.lua`) and
  leaves class training out by design.
- **Verdict.** Partial for "class spells with the level the files give, found in game files, unconfirmed"; blocked
  for a trainer list. A trainer list needs a reviewed capture of class trainer windows (an addon change and a data
  policy decision), not another table.

## Boss names and NPC identity

- **In the files.** `DungeonEncounter` has 264 readable rows for the 25 original instance maps, all named, with map,
  difficulty and order, and no creature or NPC column. The client's `Creature` table has 179 readable rows and none
  of the 264 encounter names. `LFGDungeons.FinalEncounterID` is 0 in every readable row. (These tables carry a few
  encrypted blocks, skipped: 3 in `DungeonEncounter`, 6 in `Creature`, 1 in `LFGDungeons`.) The Journal tables ship
  empty, and `JournalEncounterCreature` (present, not read) points at a creature display in WoWDBDefs, never an NPC
  id.
- **The allowed join.** The addon's `encounter` rows carry the encounter id, its name and the NPC ids the player's
  client saw; an NPC id joins an encounter only when 3 installs report it (`instanceBosses` in `kb/src/instances.ts`).
- **Verdict.** Encounter names are in the files (unconfirmed; an encounter's name is not always one NPC's name). The
  NPC identity is blocked in the files; uploads under the three-install rule are the only allowed join. Joining by
  matching names is refused.

## Quests and dungeons

- **In the files.** `QuestV2`'s readable rows hold an id, a completion bit and a quest details theme, nothing about
  where a quest is given. The 57 `QuestPOIBlob` rows sit on the two continents, none on an instance map.
  `QuestLineXQuest` (22 rows, 3 lines) names no map. `QuestObjective` (present, not read) would give objective
  targets, not where a quest is given or which instance it belongs to.
- **In players' uploads.** Each quest's log header is recorded and becomes its public category once 3 installs
  report the same one (`questTraits` in `kb/src/world-pages.ts`). For a dungeon quest the header is often the
  dungeon's name, but nothing maps a header to an instance today, and quests that send you to a dungeon from
  outside it are not marked by any header.
- **Verdict.** Blocked in the files. A reviewed rule over the upload data is the allowed way forward; until then a
  page says nothing about quests rather than guess. The classic quest baseline in the ledger is local only and is
  never published.

## Zone level ranges

- All 51 zone maps (`UiMap.Type` 3) have `ContentTuningID` 0, and so do the 50 areas their map assignments name.
- 21 readable areas carry a tuning row (`AreaTable` has 3 encrypted blocks, skipped): 18 instance interiors of the
  original world, the outdoor area named after Blackrock Spire, and two areas on maps outside the listed instances.
- Of the 100 `ContentTuning` rows, 51 have `MinLevelSquish` below `MaxLevelSquish`. Of the eight read tables with a
  `ContentTuningID` column (areas, zone maps, instance difficulties, LFG rows, creatures, spells and the two item
  tables), only one row points at any of those 51: an area on a map outside the listed instances. `LfgMinLevel` and
  `LfgMaxLevel` are set on 2 rows, each a single level. `AreaTable.ExplorationLevel` is a single number on 6 zone
  areas, not a range.
- **Verdict.** Blocked. In `wowf` 70630 the zone maps, the `ContentTuning` rows and every area's tuning id, parent
  and exploration level are the same (the two area rows that change there change a faction mask and a name). The
  site's current position, no zone level ranges, stands. No range is worked out from instance levels, creature
  levels or exploration levels.

## Required coverage

Bounded by what the sources above allow. Content work for classes and dungeons follows these rows; an entry that is
source-blocked stays listed as blocked and never counts as covered.

**Classes (9).** Warrior, Paladin, Hunter, Rogue, Priest, Shaman, Mage, Warlock and Druid: the nine `ChrClasses`
rows of the build, each with a published talent catalog (build 70532). None has a reviewed guide yet. For each:
talents ready (unconfirmed), proficiency partial, trainer spells partial or blocked as above. **Mage talents are
blocked as current content**: the live product's newer build adds, removes, moves and re-ranks Mage talents (see
[Build and evidence](#build-and-evidence)), so no Mage talent content is presented as current until the build watch
follows the chosen live product and the catalog is regenerated or shown to match. Priest's change there is to two
gate groups; the same refresh checks it before Priest talent content claims to be current.

**Dungeons required now (19).** The original-world dungeons the site lists today, each with a game-file entrance in a
released zone (the rule in `web/src/lib/instances.ts`) and a single game-file level:

| Map id | Instance | Level (game files) | Wiki page |
|---|---|---|---|
| 389 | Ragefire Chasm | 13 | draft |
| 36 | Deadmines | 16 | draft |
| 43 | Wailing Caverns | 17 | draft |
| 33 | Shadowfang Keep | 18 | draft |
| 48 | Blackfathom Deeps | 22 | draft |
| 34 | Stormwind Stockade | 23 | draft |
| 47 | Razorfen Kraul | 24 | draft |
| 90 | Gnomeregan | 25 | draft |
| 189 | Scarlet Monastery | 30 | none |
| 129 | Razorfen Downs | 34 | none |
| 70 | Uldaman | 35 | none |
| 209 | Zul'Farrak | 42 | none |
| 349 | Maraudon | 42 | none |
| 109 | Sunken Temple | 45 | none |
| 230 | Blackrock Depths | 48 | none |
| 229 | Blackrock Spire | 53 | none |
| 429 | Dire Maul | 54 | none |
| 329 | Stratholme | 55 | none |
| 289 | Scholomance | 57 | none |

**Raids dated by Blizzard (3).** Onyxia's Lair, Barrow Deeps and Hyjal Summit unlock on December 9 (raid overview,
2026-10-20). Onyxia's Lair has a game-file entrance and no game-file level. Barrow Deeps and Hyjal Summit have no
readable instance row under those names in this build. All three have draft pages. They are not required at launch;
each becomes required when it unlocks and a source places it.

**New dungeons, announced (9).** Alcaz Prison, Blackmaw Hold, City of Dalaran, Excavation Site, Hall of Thanes,
Krol'dok Stronghold, Ruins of Lordaeron, Shaper's Terrace and The Drowned City. The names are those of the committed
draft pages, which cite Blizzard's new dungeons article and forum post of 2026-10-20; the post's stored excerpt names
none of them and gives no date. Matched by name, four have a readable instance map with no entrance point and five
have no readable instance row; their game-file details stay under the spoiler rule and are not repeated here. The site
lists none of them, because no source places an entrance in a released zone. All nine have draft pages.
**Source-blocked** until the files or three installs place an entrance.

**Listed, not required (5).** Molten Core, Blackwing Lair, Zul'Gurub, Ruins of Ahn'Qiraj and Ahn'Qiraj Temple have
game-file entrances and draft pages, and each page says the raid is not among the first Blizzard has named for WoW:
Forever; no allowed source names them among its raids. They stay listed as instances, with no preparation content
required.

## Tables for a later wave (not added here)

From the scan's candidate list, with their WoWDBDefs file data ids. Adding any of them is a reviewed wave with its
own pin test and coverage check, not part of this audit.

| Table | File data id | Would settle |
|---|---|---|
| `SpellEquippedItems` | 1140011 | Which item classes and subclasses each proficiency allows |
| `Criteria`, `CriteriaTree`, `ModifierTree` | 1263817, 1263818, 1267645 | What each Legacy achievement asks for |
| `PlayerCondition` | 1045411 | Conditions tied to trait entries or other gates, if a perk uses one |
| `QuestObjective` | 1251960 | Quest objective targets (not where a quest is given) |

Not proposed: `JournalEncounterCreature` (display ids only, no NPC identity) and `NumTalentsAtLevel` (Forever's points
come from the trait currency sources). No trainer table exists.

## Acceptance checks

| Check | Result |
|---|---|
| Every ready fact names its build, table and field, and the commands and queries below reproduce it | Pass |
| Facts in encrypted blocks, unread tables or the server stay blocked; no key, listfile, hotfix cache or decryption | Pass |
| The Talented exception is audited, not called a breach and not removed; the MCP text is unchanged | Pass |
| Legacy has an explicit go or no-go, and a no-go would keep the planner blocked | Pass: go for a catalog of ids, ranks and edges; cost, cap and gates shown, not enforced |
| The group each Legacy gate names is reported, and what it means is stated as a column-name reading | Pass |
| The live product's changes are stated as found, with no claim that published data matches it, and current Mage talent content is blocked | Pass |
| No zone range is inferred from instance, creature or exploration levels, or from the LFG level fields | Pass |
| No boss is tied to an NPC by matching names (no encounter name matches a client creature anyway) | Pass |
| No skill line is tied to an item subclass by matching names | Pass |
| The 16-point achievement source is not assumed to exist on live realms | Pass |
| The coverage list is finite: 9 classes and 36 named instances, each with a status | Pass |

## Reproduce

From `kb/`, after `npm ci` in both `kb/` and `web/` (the kb command line imports a few web modules, as in CI):

```
npm run kb -- client-scan --product wow_classic_beta --out data/client-scan
npm run kb -- client-scan --product wowf --out data/client-scan
npm run kb -- client-extract --product wow_classic_beta
npm run kb -- client-extract --product wowf --out data/client-wowf --registry data/builds-wowf.json
npm run kb -- client-coverage data/client/<beta snapshot>.sqlite --out data/client-scan/coverage.md
npm run kb -- client-diff data/client/<beta snapshot>.sqlite data/client-wowf/<wowf snapshot>.sqlite --out data/client-scan/wowf-diff.json
```

These commands read whatever build the CDN serves when they run, with the WoWDBDefs layouts of that moment. They give
70532 and 70630 only while those are the current builds; run both extractions on the same day so they share a
WoWDBDefs commit. Once the CDN moves on, re-running them checks the new build instead, and the files this audit read
are the only record of these results, identified by sha256: the 70532 snapshot `02a5e8dfce0a…`, the 70450 snapshot
`6c8c1e4715e4…`, the two 37-table files (`80a4e45a3eba…` beta, `ffcb371ec005…` `wowf`), and the `ContentTuning` read
(row hash `2499b589186c`). Like every snapshot, they are kept outside the repository. This audit read the 37 tables and
`ContentTuning` with short scripts that call the extractor's own functions, not with the full commands above.

The snapshot is SQLite with one row per table row in `client_rows(tbl, id, raw)`, `raw` being JSON. Any SQLite with
JSON functions runs the checks. The results are those of build 70532; every query also gives the same result on
`wowf` 70630, except the `ContentTuning` reference count (70532 only), and those marked give it on 70450 too. The
`ContentTuning` queries need a snapshot made from 2026-10-25 on. `tableHash` in
`kb/src/build-watch/client-digests.ts` gives the hash to compare with `client-digests.json`.

```sql
-- Legacy trees and currency: (1187,4225) (1188,4225) (1189,4225)
SELECT json_extract(raw,'$.TraitTreeID'), json_extract(raw,'$.TraitCurrencyID') FROM client_rows
 WHERE tbl='TraitTreeXTraitCurrency' AND json_extract(raw,'$.TraitCurrencyID')=4225;
-- Currency maximums: (3820,51) (4225,16)
SELECT id, json_extract(raw,'$.SourcedMax') FROM client_rows WHERE tbl='TraitCurrency';
-- Nodes per tree and kind: 1187 9 single; 1188 8 single, 1 tiered; 1189 9 single
SELECT json_extract(raw,'$.TraitTreeID') t, json_extract(raw,'$.Type') k, count(*) FROM client_rows
 WHERE tbl='TraitNode' AND json_extract(raw,'$.TraitTreeID') IN (1187,1188,1189) GROUP BY t, k;
-- Ranks per tree with every entry maxed: (1187,25) (1188,25) (1189,25)
SELECT json_extract(n.raw,'$.TraitTreeID'), sum(json_extract(e.raw,'$.MaxRanks')) FROM client_rows n
 JOIN client_rows x ON x.tbl='TraitNodeXTraitNodeEntry' AND json_extract(x.raw,'$.TraitNodeID')=n.id
 JOIN client_rows e ON e.tbl='TraitNodeEntry' AND e.id=json_extract(x.raw,'$.TraitNodeEntryID')
 WHERE n.tbl='TraitNode' AND json_extract(n.raw,'$.TraitTreeID') IN (1187,1188,1189) GROUP BY 1;
-- Spend gates: per tree, CondType 0 with 5 and 10 of currency 4225, RequiredLevel 0
SELECT json_extract(raw,'$.TraitTreeID'), json_extract(raw,'$.SpentAmountRequired'), json_extract(raw,'$.TraitCurrencyID'),
 json_extract(raw,'$.RequiredLevel') FROM client_rows WHERE tbl='TraitCond' AND json_extract(raw,'$.TraitTreeID') IN (1187,1188,1189);
-- The group each condition names (70450, 70532, wowf 70630):
-- (1187,10,12440) (1187,5,12440) (1188,10,12449) (1188,5,12449) (1189,10,12450) (1189,5,12450)
SELECT json_extract(raw,'$.TraitTreeID'), json_extract(raw,'$.SpentAmountRequired'), json_extract(raw,'$.TraitNodeGroupID')
 FROM client_rows WHERE tbl='TraitCond' AND json_extract(raw,'$.TraitTreeID') IN (1187,1188,1189);
-- Nodes behind each gate, by column: (tree, 5, PosX 3300, 4 or 3 nodes) and (tree, 10, PosX 4200, 1 node)
SELECT json_extract(c.raw,'$.TraitTreeID'), json_extract(c.raw,'$.SpentAmountRequired'), json_extract(n.raw,'$.PosX'), count(*)
 FROM client_rows c JOIN client_rows l ON l.tbl='TraitNodeGroupXTraitCond' AND json_extract(l.raw,'$.TraitCondID')=c.id
 JOIN client_rows g ON g.tbl='TraitNodeGroupXTraitNode' AND json_extract(g.raw,'$.TraitNodeGroupID')=json_extract(l.raw,'$.TraitNodeGroupID')
 JOIN client_rows n ON n.tbl='TraitNode' AND n.id=json_extract(g.raw,'$.TraitNodeID')
 WHERE c.tbl='TraitCond' AND json_extract(c.raw,'$.TraitTreeID') IN (1187,1188,1189) GROUP BY 1, 2, 3;
-- Prerequisite edges from Legacy nodes: (2, 9)
SELECT json_extract(e.raw,'$.Type'), count(*) FROM client_rows e JOIN client_rows n ON n.tbl='TraitNode'
 AND n.id=json_extract(e.raw,'$.LeftTraitNodeID') WHERE e.tbl='TraitEdge' AND json_extract(n.raw,'$.TraitTreeID') IN (1187,1188,1189)
 GROUP BY 1;
-- Cost per tree: (1187,4843,1,4225) (1188,4844,1,4225) (1189,4846,1,4225)
SELECT json_extract(t.raw,'$.TraitTreeID'), c.id, json_extract(c.raw,'$.Amount'), json_extract(c.raw,'$.TraitCurrencyID')
 FROM client_rows t JOIN client_rows c ON c.tbl='TraitCost' AND c.id=json_extract(t.raw,'$.TraitCostID')
 WHERE t.tbl='TraitTreeXTraitCost' AND json_extract(t.raw,'$.TraitTreeID') IN (1187,1188,1189);
-- Cost overrides per node, group and entry, read and empty: (0, 0, 0)
SELECT (SELECT count(*) FROM client_rows WHERE tbl='TraitNodeXTraitCost'),
 (SELECT count(*) FROM client_rows WHERE tbl='TraitNodeGroupXTraitCost'),
 (SELECT count(*) FROM client_rows WHERE tbl='TraitNodeEntryXTraitCost');
-- Points earned: (1 point, 130 sources, 130 by achievement) (16, 1, 1)
SELECT json_extract(raw,'$.Amount'), count(*), sum(json_extract(raw,'$.AchievementID')<>0) FROM client_rows
 WHERE tbl='TraitCurrencySource' AND json_extract(raw,'$.TraitCurrencyID')=4225 GROUP BY 1;
-- Those achievements that are rows of Achievement: 131
SELECT count(*) FROM client_rows s JOIN client_rows a ON a.tbl='Achievement' AND a.id=json_extract(s.raw,'$.AchievementID')
 WHERE s.tbl='TraitCurrencySource' AND json_extract(s.raw,'$.TraitCurrencyID')=4225;
-- Legacy entries, and those with a spell name: (31, 31)
SELECT count(*), sum(json_extract(sn.raw,'$.Name_lang') IS NOT NULL) FROM client_rows n
 JOIN client_rows x ON x.tbl='TraitNodeXTraitNodeEntry' AND json_extract(x.raw,'$.TraitNodeID')=n.id
 JOIN client_rows e ON e.tbl='TraitNodeEntry' AND e.id=json_extract(x.raw,'$.TraitNodeEntryID')
 JOIN client_rows d ON d.tbl='TraitDefinition' AND d.id=json_extract(e.raw,'$.TraitDefinitionID')
 LEFT JOIN client_rows sn ON sn.tbl='SpellName' AND sn.id=json_extract(d.raw,'$.SpellID')
 WHERE n.tbl='TraitNode' AND json_extract(n.raw,'$.TraitTreeID') IN (1187,1188,1189);
-- Talented: levels 9,8,7,6,5 for entries at Index 100..500 of node 110298, spell 1225474 (70450, 70532, wowf 70630)
SELECT json_extract(s.raw,'$.PlayerLevel'), json_extract(x.raw,'$.TraitNodeID'), json_extract(x.raw,'$.Index'),
 json_extract(d.raw,'$.SpellID') FROM client_rows s
 JOIN client_rows x ON x.tbl='TraitNodeXTraitNodeEntry' AND json_extract(x.raw,'$.TraitNodeEntryID')=json_extract(s.raw,'$.TraitNodeEntryID')
 JOIN client_rows e ON e.tbl='TraitNodeEntry' AND e.id=json_extract(s.raw,'$.TraitNodeEntryID')
 JOIN client_rows d ON d.tbl='TraitDefinition' AND d.id=json_extract(e.raw,'$.TraitDefinitionID')
 WHERE s.tbl='TraitCurrencySource' AND json_extract(s.raw,'$.TraitNodeEntryID')<>0 ORDER BY 3;
-- Class point sources with no entry: 51, levels 10 to 60
SELECT count(*), min(json_extract(raw,'$.PlayerLevel')), max(json_extract(raw,'$.PlayerLevel')) FROM client_rows
 WHERE tbl='TraitCurrencySource' AND json_extract(raw,'$.TraitCurrencyID')=3820 AND json_extract(raw,'$.TraitNodeEntryID')=0;
-- Zones with a tuning row: 51 zones, 0 (70450, 70532, wowf 70630)
SELECT count(*), sum(json_extract(raw,'$.ContentTuningID')<>0) FROM client_rows WHERE tbl='UiMap' AND json_extract(raw,'$.Type')=3;
-- The areas the zones' first map assignments name, and those with a tuning row: (50, 0)
SELECT count(DISTINCT a.id), sum(json_extract(a.raw,'$.ContentTuningID')<>0) FROM client_rows u
 JOIN client_rows m ON m.tbl='UiMapAssignment' AND json_extract(m.raw,'$.UiMapID')=u.id AND json_extract(m.raw,'$.OrderIndex')=0
 JOIN client_rows a ON a.tbl='AreaTable' AND a.id=json_extract(m.raw,'$.AreaID')
 WHERE u.tbl='UiMap' AND json_extract(u.raw,'$.Type')=3;
-- Areas with a tuning row: 21
SELECT count(*) FROM client_rows WHERE tbl='AreaTable' AND json_extract(raw,'$.ContentTuningID')<>0;
-- ContentTuning rows; with MinLevelSquish below MaxLevelSquish; with an LFG level; of those, a single level: (100, 51, 2, 2)
SELECT count(*), sum(json_extract(raw,'$.MinLevelSquish') < json_extract(raw,'$.MaxLevelSquish')),
 sum(json_extract(raw,'$.LfgMinLevel') > 0),
 sum(json_extract(raw,'$.LfgMinLevel') > 0 AND json_extract(raw,'$.LfgMinLevel') = json_extract(raw,'$.LfgMaxLevel'))
 FROM client_rows WHERE tbl='ContentTuning';
-- Rows of the eight tables with a ContentTuningID that point at one of those 51 (70532 only): ('AreaTable', 1)
SELECT r.tbl, count(*) FROM client_rows r
 JOIN client_rows t ON t.tbl='ContentTuning' AND t.id=json_extract(r.raw,'$.ContentTuningID')
 WHERE r.tbl IN ('AreaTable','CreatureDifficulty','Item','ItemSparse','LFGDungeons','MapDifficulty','SpellMisc','UiMap')
 AND json_extract(t.raw,'$.MinLevelSquish') < json_extract(t.raw,'$.MaxLevelSquish') GROUP BY 1;
-- Armour skill lines: (293,3,40) (413,3,0) (413,68,40) (414,1103,0) (415,1503,0) (433,67,0)
SELECT json_extract(i.raw,'$.SkillID'), json_extract(i.raw,'$.ClassMask'), json_extract(i.raw,'$.MinLevel') FROM client_rows i
 JOIN client_rows s ON s.tbl='SkillLine' AND s.id=json_extract(i.raw,'$.SkillID')
 WHERE i.tbl='SkillRaceClassInfo' AND json_extract(s.raw,'$.CategoryID')=8;
-- Polearms (skill line 229): (7, 20) (1024, 20)
SELECT json_extract(raw,'$.ClassMask'), json_extract(raw,'$.MinLevel') FROM client_rows
 WHERE tbl='SkillRaceClassInfo' AND json_extract(raw,'$.SkillID')=229;
-- Encounter rows on the 25 original instance maps: 264
SELECT count(*) FROM client_rows WHERE tbl='DungeonEncounter' AND json_extract(raw,'$.MapID')
 IN (33,34,36,43,47,48,70,90,109,129,189,209,229,230,249,289,309,329,349,389,409,429,469,509,531);
-- LFG rows with a final encounter: 0
SELECT count(*) FROM client_rows WHERE tbl='LFGDungeons' AND json_extract(raw,'$.FinalEncounterID')<>0;
-- Encounter names that equal a client Creature name: 0
SELECT count(*) FROM client_rows d JOIN client_rows c ON c.tbl='Creature'
 AND lower(trim(json_extract(c.raw,'$.Name_lang')))=lower(trim(json_extract(d.raw,'$.Name_lang'))) WHERE d.tbl='DungeonEncounter';
-- Quest map points by map: (0, 33) (1, 24)
SELECT json_extract(raw,'$.MapID'), count(*) FROM client_rows WHERE tbl='QuestPOIBlob' GROUP BY 1;
```

`ContentTuning` (the zone and LFG level findings) is in a snapshot made by `client-extract` from 2026-10-25 on. The
2026-10-25 snapshot above predates it; this audit's `ContentTuning` results come from the separate read of build 70532.
