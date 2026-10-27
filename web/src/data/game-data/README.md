# Game data

Files in this folder are Blizzard's data, read from the WoW: Forever game files by `kb/src/client-extract.ts`
and cut down to the fields a page needs. They are **not under Everloot's licence** (CC BY-SA 4.0 covers our own
data, not these), and everything in them is **found in game files, unconfirmed**: being here does not mean
it is, or will be, in the game. Each file names the build it came from. Encrypted blocks were skipped, never
decrypted. Column names come from [WoWDBDefs](https://github.com/wowdev/WoWDBDefs) (CC BY-SA 4.0). See
[docs/DATA_POLICY.md](../../../../docs/DATA_POLICY.md).

| File | What | Made by | Build |
|---|---|---|---|
| `map.json` | Continents and zones with their rectangles in world yards (zones that may be unreleased are kept apart in `heldBackZones`, shown only behind the spoiler switch), dungeon and raid entrance positions, and flight masters with one flight line per pair (thinned to 20 yards). Each entrance and flight master carries `uiMapId`, its zone: for an entrance, the outdoor area named after the instance when the files have one, else the ground under the spot. `difficulties` names every difficulty id with its group size, and each entrance carries `difficultyIds`, the difficulties of its instance (both appear once the build watch regenerates the file; the committed one predates the join) | `npm run kb -- client-map <snapshot>` (tables `Map`, `UiMap`, `UiMapAssignment`, `TaxiNodes`, `TaxiPath`, `TaxiPathNode`, `AreaTable`, `Difficulty`, `MapDifficulty`, `ContentTuning` and `LFGDungeons` (each instance's `minLevel` and `maxLevel`, absent when the files give none), and `TerrainArea`: the area id of each terrain chunk under those spots, read from the continents' WDT and ADT files at extraction) | in the file's `source` |
| `client-layer.json` | What the database pages read from the files (`everloot.client-layer/2`). Relations between items and spells: created by (a spell's create-item effect), reagent for, part of an item set, and same icon (one row per item to the icon file it shares with other items), one `[fromKind, fromId, rel, toKind, toId]` row per line. Item categories: classes and subclasses with the client's English names, the slugs made from them and item counts, and one `[itemId, classId, subclassId, inventoryType, quality]` row per item. Ids and category names only, no item names or text. Read by the item pages and `/database/items`, the MCP tools `entity_relations` and `item_categories`, `/api/edges`, `/api/items` and `/api/edges/client-layer` | `npm run kb -- client-layer <snapshot>` (tables `SpellEffect`, `SpellReagents`, `ItemSet`, `Item`, `ItemSparse`, `ItemClass`, `ItemSubClass`); the build watch regenerates it | in the file's `build` |
| `talents/<class>.json` | One talent tree set per class (`everloot.talent-catalog/2`, see `docs/TALENT_CATALOG.md`): node ids, positions, ranks, prerequisites, unlock gates, point levels, spell ids and talent names. No descriptions, icons or tooltip text | `npm run kb -- client-catalog <snapshot>`, then `node scripts/trim-talent-catalog.mjs ../kb/data/catalog/<product>-<build>-<config>/talents` in `web/` | in each file's `build` |
| `raid-<build>.json` | Raid buffs and debuffs with their reach (`self`, `single`, `party`, `raid`, `area`, `enemy`, `mixed`, `unknown`), the talent tree each needs where the files prove it (`tree`, `treeProof`), and the class talent tree names. No tooltip text | `npx tsx scripts/build-raid-game-data.ts ../kb/data/catalog/<product>-<build>-<config> ../kb/data/client/<snapshot>.sqlite` in `web/`, which also writes `addon/modules/raid_data.lua`; `src/lib/raid.test.ts` fails if the two differ | in the file name and its `build` |
| `spell-values.json` | Numbers of the spells that talents show (effect values, duration, a hash of the tooltip), the comparison baseline for spell number changes. No tooltip text | the build watch, `npm run kb -- build-watch` (docs/BUILD_WATCH.md) | in the file's `build` |
| `client-digests.json` | How many rows each table the extractor reads has, and a hash of their content (`everloot.client-digests/1`, one table per line). Counts and hashes only: no ids, values or text. The comparison baseline for the read set's changes between builds | the build watch, `npm run kb -- build-watch` (docs/BUILD_WATCH.md) | in the file's `build` |
| `client-achievements.json` | Every achievement the build's files carry: title, points, own text when the files give one, and the criteria `Achievement.Criteria_tree` walks to in `CriteriaTree` (leaf texts in order; `amount` only when it is over 1; `everloot.client-achievements/1`, one achievement per line). No category names: the files carry only the id, so the category comes from player reports. Read by the achievement pages, which merge it with player reports player-first and mark the parts the reports have not confirmed | `npm run kb -- client-achievements <snapshot>`; the build watch regenerates it | in the file's `build` |
| `changes/<product>-<buildId>.json` | What a new build changed in the files above and in the client read set: talents, spell numbers, raid buffs, map, table row counts and content hashes. One file per build, marked `spoiler` for a build that is not live | the build watch; shape and notes in `changes/README.md` | in the file name and its `build` |

Icons, tooltip text and window art for the talent calculator are not in this folder and never go into git.
They live in asset storage with a build-stamped manifest; see [docs/ASSETS.md](../../../../docs/ASSETS.md).

Do not edit these files by hand. Regenerate them from a new snapshot (`client-extract`, then the commands
above) and commit the result with the build in the message, or let the build watch do it. Nothing from another project belongs here.

In the raid file, the only thing that is ours is `family`, which groups a group cast (Gift of the Wild)
with its single-target cast (Mark of the Wild) because they do not stack. Entries whose spells are not in
the build are left out.

World of Warcraft and its names are trademarks and copyright of Blizzard Entertainment, Inc.
