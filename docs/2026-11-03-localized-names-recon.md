# What the Forever client holds for localized names

Date: 2026-11-03. Report only; no code, no new tables, no keys, nothing decrypted.

## Verdict

**Build wowf 1.60.1.70755 lists all ten of Azeroth DB's locales (enUS deDE esES esMX frFR koKR ptBR ruRU zhCN zhTW) as separate content keys for twelve of the thirteen tables asked about. The local snapshot of this build holds enUS only, but the other locales do download and read from the CDN: deDE and esMX strings for CharTitles (41 rows each) and deDE strings for QuestInfo (7 rows) were read in full, with no encrypted blocks and the same row ids as enUS. esES, frFR, koKR, ptBR, ruRU, zhCN and zhTW were not downloaded, and no table beyond QuestInfo and CharTitles was read in any other locale. QuestV2 has no string column in any locale, so quest titles are not in this table.**

## What was read, and how

Every number below names its source:

- **Snapshot**: the local snapshot of build 70755 (wowf, build config `9d9888f2d89a2dcc9eacc68a2d7cb3dc`, extracted 2026-11-03T22:07:47Z, library `@rhyster/wow-casc-dbc@2.16.19`, definitions pinned at WoWDBDefs commit `92bb4dc62114`). Copied and opened read-only. `client-extract` was not run again. Queries were ad-hoc SQLite reads of `client_rows` (rows are JSON, one per id) and of the snapshot manifest. Called "snapshot" below.
- **Definitions**: `definitions/<Table>.dbd` fetched from `raw.githubusercontent.com/wowdev/WoWDBDefs` at commit `92bb4dc62114`; the block listing build `1.60.1.70755` was parsed for `locstring` columns. Called "definition" below.
- **Root listing**: an ad-hoc read-only script using the pinned library: `CASCClient.getProductVersion("us","wowf")`, `init()`, then `getContentKeysByFileDataID(<id>)` for each table's file data id (ids from `CLIENT_TABLES`). It reads the build's root listing only, no table content. The CDN reported version `1.60.1.70755`, build config `9d9888f2d89a2dcc9eacc68a2d7cb3dc`, matching the snapshot. Called "root listing" below. `client-scan` was not run: its candidate list covers tables outside `CLIENT_TABLES`, and every table asked about is already in it.

- **Other-locale read** (follow-up, same day, section "Other locales, verified"): an ad-hoc read-only script using the same pinned library and the same WoWDBDefs commit. It opened the CDN's current wowf version (the CDN again reported `1.60.1.70755`, build config `9d9888f2d89a2dcc9eacc68a2d7cb3dc`, build id 70755), took from the root listing the content key whose locale flags carry deDE or esMX instead of enUS, downloaded that one file, parsed it as the extractor does and compared it with the snapshot's enUS rows. Three files in total: QuestInfo (deDE), CharTitles (deDE), CharTitles (esMX). Called "other-locale read" below.

All thirteen tables are in the snapshot, so none is "not in the snapshot" or unscanned.

## Per-table findings

"Columns in rows" are the `_lang` columns present in the snapshot's extracted rows (build 70755). "Layout only" are `locstring` columns the definition lists for 1.60.1.70755 that do not appear in any extracted row; why they are absent was not determined (see the last section).

| Table | Rows (snapshot) | `_lang` columns in rows | Layout only | Name column |
|---|---|---|---|---|
| ItemSparse | 19,281 | `Display_lang` (name, 19,281 non-empty), `Display1_lang`, `Display2_lang`, `Display3_lang` (all empty), `Description_lang` (4,803 non-empty) | none | `Display_lang` |
| Creature | 179 | `Name_lang` (179), `Title_lang` (3 non-empty) | `NameAlt_lang`, `TitleAlt_lang` | `Name_lang` |
| QuestV2 | 6,614 | none (rows hold only `ID`, `UniqueBitFlag`, `UiQuestDetailsThemeID`) | none | none |
| QuestInfo | 7 | `InfoName_lang` | none | `InfoName_lang` (quest category names, for example "Elite", "PvP") |
| SpellName | 32,046 | `Name_lang` (32,033 non-empty, 13 null) | none | `Name_lang` |
| Achievement | 440 | `Title_lang` (440), `Description_lang` (396), `Reward_lang` (130) | none | `Title_lang` |
| Faction | 253 | `Name_lang` (253), `Description_lang` (59) | none | `Name_lang` |
| CharTitles | 41 | `Name_lang`, `Name1_lang` (41 each; both carry `%s`) | none | `Name_lang` |
| QuestLine | 3 | `Name_lang` | `Description_lang` | `Name_lang` |
| Mount | 141 | `Name_lang` | `Description_lang`, `SourceText_lang` | `Name_lang` |
| ChrRaces | 58 | `Name_lang`, `Name_female_lang`, `Name_lowercase_lang`, `Name_female_lowercase_lang`, `Lore_name_lang`, `Lore_name_lower_lang`, `LoreDescription_lang`, `Short_name_lang`, `Short_name_lower_lang` | `Lore_name_female_lang`, `Lore_name_lower_female_lang`, `Short_name_female_lang`, `Short_name_lower_female_lang` | `Name_lang` |
| LFGDungeons | 71 | `Name_lang` | `Description_lang` | `Name_lang` |
| SkillLine | 154 | `DisplayName_lang` (154), `Description_lang` (56) | `AlternateVerb_lang`, `HordeDisplayName_lang` | `DisplayName_lang` |

Notes on what these rows are:

- **Items and NPCs.** `Item` has 31,959 rows; `ItemSparse` has 19,281, and every `ItemSparse` id is in `Item`. So 12,678 item ids have no name in the snapshot. The manifest records 31 encrypted blocks for `ItemSparse` (skipped, never decrypted); whether the missing rows are exactly those was not checked. `Creature` holds 179 rows, so it is not a general NPC name list (the manifest records 6 encrypted blocks for it).
- **Quests.** Quest titles are not in `QuestV2` (no string columns in the definition either). `QuestInfo` names the seven quest categories only.
- **Spells.** `SpellName` and `Spell` have the same 32,046 ids.

## One string per locale, or one locale?

**One locale per file, and the snapshot holds enUS.**

- In every extracted row, each `_lang` column is a single string (or null), never a list or per-locale object. Checked on all rows of all thirteen tables (build 70755 snapshot).
- Every string is ASCII English; no accented, Cyrillic, Hangul or CJK character appears in any `_lang` value of the thirteen tables. One sample row: `SpellName` id 20395 `Name_lang` = "Suffering"; `ItemSparse` id 10832 `Display_lang` = "Fel Tracker Owner's Manual".
- The extractor (`openCdn` in `kb/src/client-extract.ts`) picks the content key whose locale flags include enUS, else the first key. The enUS keys in the root listing match the snapshot manifest's `cKey` for the tables checked (ItemSparse `9bacee47…`, SpellName `41d728e3…`).

## Locales in the root listing (build 70755)

For each table except QuestV2, the root listing has ten content keys, one per locale group, none flagged as encrypted at file level:

`koKR`, `frFR`, `deDE`, `zhCN`, `esES`, `zhTW`, `enUS|enGB` (one key for both), `esMX`, `ruRU`, `ptBR|ptPT` (one key for both).

QuestV2 has one key flagged for all locales (`enUS|koKR|frFR|deDE|zhCN|esES|zhTW|enGB|esMX|ruRU|ptBR|ptPT`), which fits it having no strings. `itIT` does not appear in these tables' keys.

Azeroth DB's ten locales against this listing:

| Azeroth DB locale | Key in the root listing | Content read |
|---|---|---|
| enUS | yes (one key shared with enGB) | yes, in the snapshot |
| deDE | yes | QuestInfo and CharTitles (other-locale read) |
| esES | yes | no |
| esMX | yes | CharTitles (other-locale read) |
| frFR | yes | no |
| koKR | yes | no |
| ptBR | yes (one key shared with ptPT) | no |
| ruRU | yes | no |
| zhCN | yes | no |
| zhTW | yes | no |

"Listed" means present in the build's root; the next section reports what was downloaded. For the seven locales marked "no" (esES, frFR, koKR, ptBR, ruRU, zhCN, zhTW), whether the CDN serves the file and whether its blocks are readable was not tested.

## Other locales, verified

Source: the other-locale read, build 70755 (wowf, build config `9d9888f2d89a2dcc9eacc68a2d7cb3dc`), definitions at WoWDBDefs commit `92bb4dc62114`. Counts come from that one run; enUS values come from the local snapshot of build 70755 (same ids).

| Table, locale | File downloaded | Rows readable | Rows | Encrypted blocks | Same ids as enUS | Non-empty strings read | Differ from enUS |
|---|---|---|---|---|---|---|---|
| QuestInfo, deDE | yes (505 B) | yes | 7 | 0 | yes | 7 (`InfoName_lang`) | 4 of 7 |
| CharTitles, deDE | yes (2,197 B) | yes | 41 | 0 | yes | 82 (`Name_lang`, `Name1_lang`) | 80 of 82 |
| CharTitles, esMX | yes (2,031 B) | yes | 41 | 0 | yes | 82 (`Name_lang`, `Name1_lang`) | 80 of 82 |

No download or read failed. For all three files the root listing had a content key for the locale and it was not flagged encrypted.

Sample strings (id; locale string; enUS string in the snapshot):

| Table, column | Id | Locale | String | enUS |
|---|---|---|---|---|
| QuestInfo `InfoName_lang` | 21 | deDE | Leben | Life |
| QuestInfo `InfoName_lang` | 1 | deDE | Elite | Elite |
| QuestInfo `InfoName_lang` | 41 | deDE | PvP | PvP |
| CharTitles `Name_lang` | 144 | deDE | Blutsegeladmiral %s | Bloodsail Admiral %s |
| CharTitles `Name1_lang` | 144 | deDE | Blutsegeladmiralin %s | Bloodsail Admiral %s |
| CharTitles `Name_lang` | 1017 | deDE | %s der Magram | %s of the Magram |
| CharTitles `Name_lang` | 144 | esMX | Almirante Velasangre %s | Bloodsail Admiral %s |
| CharTitles `Name_lang` | 1017 | esMX | %s de los Magram | %s of the Magram |
| CharTitles `Name_lang` | 1018 | esMX | %s de los Gelkis | %s of the Gelkis |

What this shows: the other-locale files are separate WDC files of the same shape; the strings are real translations (in deDE, `Name1_lang` for id 144 reads "Blutsegeladmiralin" where `Name_lang` reads "Blutsegeladmiral"; enUS has one string in both), and the `%s` placeholder survives. Two of the three QuestInfo samples ("Elite", "PvP") are the same word in German as in English, which is why they match. The extractor picks the enUS key (else the first key), so these files are not in the snapshot.

What this does not show: that the other seven locales download, that the large tables (ItemSparse, SpellName) have the same encrypted-block pattern in other locales as in enUS, or per-locale file sizes for any table beyond these three.

## Byte estimate for a name-only extraction (enUS, measured)

One `{id: name}` map per table, from the snapshot (build 70755), using the name column in the table above, rows with a non-empty name only. "Payload" is id digits plus UTF-8 name bytes; "JSON" is the compact `{"id":"name",…}` text; "gzip" is level 9 on that JSON.

| Table | Named rows | Payload (B) | JSON (B) | gzip (B) |
|---|---|---|---|---|
| ItemSparse | 19,281 | 520,276 | 635,983 | 183,210 |
| SpellName | 32,033 | 722,065 | 914,273 | 244,745 |
| Achievement (Title) | 440 | 12,266 | 14,907 | 4,672 |
| Faction | 253 | 4,843 | 6,362 | 2,797 |
| Creature | 179 | 3,330 | 4,405 | 1,812 |
| Mount | 141 | 2,831 | 3,678 | 1,190 |
| SkillLine | 154 | 2,226 | 3,151 | 1,366 |
| LFGDungeons | 71 | 1,093 | 1,520 | 810 |
| CharTitles | 41 | 779 | 1,026 | 446 |
| ChrRaces | 58 | 729 | 1,078 | 560 |
| QuestLine | 3 | 62 | 81 | 92 |
| QuestInfo | 7 | 56 | 99 | 98 |
| QuestV2 | 0 | none | none | none |
| **Total** | **52,661** | **1,270,556** | **1,586,563** | **441,798 (sum of per-table)** |

For comparison, the full rows of the same thirteen tables in the snapshot's `client_rows` total 30,488,690 bytes (`sum(length(raw))`).

Only three non-enUS files were downloaded (see "Other locales, verified"), so no per-locale size for these maps is measured. As an assumption only: if each of the ten locales were the size of enUS, ten maps would be about 15.9 MB JSON and 4.4 MB gzipped (sum of per-table). CJK and Cyrillic strings use more UTF-8 bytes per character and fewer characters per name, so the real figure differs.

## Cost: what `KNOWLEDGE_KINDS` rows would need

Facts only.

- Today a knowledge record carries one `name` string (`knowledgeHit` and `fetchedDocument.title` in `packages/protocol/src/mcp.ts`) and the `KNOWLEDGE_KINDS` list on main is `item, npc, object, quest, zone, spell, lore_page, creator, realm`. Localized names would need a `names` map in the record's `data` (locale code to string), as the plan proposes; the single `name` stays enUS.
- Source tables per kind, from the findings above: item = `ItemSparse.Display_lang` (19,281 of 31,959 item ids named in the snapshot); spell = `SpellName.Name_lang`; faction = `Faction.Name_lang`; title = `CharTitles.Name_lang`/`Name1_lang`; quest line = `QuestLine.Name_lang` (3 rows); mount = `Mount.Name_lang`; race = `ChrRaces.Name_lang`; dungeon = `LFGDungeons.Name_lang`; skill = `SkillLine.DisplayName_lang`; achievement = `Achievement.Title_lang`.
- No client source in the snapshot for: quest titles (`QuestV2` has no strings), NPC names beyond the 179 `Creature` rows.
- To read the nine other locales, the extractor would have to choose another content key per locale instead of the enUS one and fetch ten files per table. `CLIENT_TABLES` would not change; the key choice in `openCdn` would. The snapshot would need either a locale column or one snapshot per locale. None of this was built or tried.
- Each locale's text is Blizzard's game text. Whether localized names may be published is a policy decision (`docs/DATA_POLICY.md`), not decided here.

## Not determined

- Contents, readability and row counts of the other non-enUS files. Read so far: QuestInfo (deDE) and CharTitles (deDE, esMX); see "Other locales, verified". esES, frFR, koKR, ptBR, ruRU, zhCN and zhTW, and every other table in every other locale, were listed in the root and not downloaded.
- Why the definition's `locstring` columns marked "Layout only" are absent from the extracted rows. Possible causes (the extractor dropping them, the file lacking them in this build, or my parse of the definition block) were not separated.
- Whether the 12,678 item ids missing from `ItemSparse` sit in its 31 encrypted blocks.
- Download size per locale file beyond the three measured above, and the CDN's behaviour for the seven locales not tried.
- Other products' localized builds: not scanned. Everything above is the `wowf` product's own root listing.
