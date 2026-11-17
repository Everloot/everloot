# Blizzard's character API first, the addon for what only it can see

Decided 2026-11-17 by Carlos. Status: accepted; the work lands in the pull requests listed at the end.

## Why

Blizzard's Developer API answers for any Forever character Everloot knows by name and surname. A read-only check on
2026-11-17 (one level 38 and two level 60 EU characters) found:

| Endpoint | Answer |
|---|---|
| `equipment`, `statistics`, `specializations`, `professions`, `pvp-summary`, `character-media` | Data. The armory crawler (`kb/src/armory/crawl.ts`) already reads them. |
| `achievements` | Data: about 48 entries, 12 or 13 completed (`completed_timestamp`), plus criteria progress. Points are always 0. |
| `reputations` | Data: 18 to 23 factions, each with its standing. |
| `quests` and `quests/completed` | Data: quests in progress, and 495 to 951 completed quest ids. |
| `collections/mounts`, `/pets`, `/toys` | Data. `/heirlooms` empty. |
| `titles` | 200 with no titles, even at level 60. |
| `encounters/dungeons`, `/raids` | 200 with no encounters, even at level 60. |
| `achievement-statistics` | 404. |

So the addon and the Desktop App upload and sync a lot that Blizzard already serves: gear, talents, professions,
stats, PvP, achievements, reputation and completed quests. Each of those is a record kind, a schema, an intake path,
a sync category, a store and a page section to maintain. Blizzard's copy covers every character the crawler knows,
not only the ones whose owner linked and synced them, and it refreshes after each logout.

## Decisions

1. **Blizzard data may be shown beyond the armory pages** (the "amend fully" choice). Character pages, the
   Completionist tools, rankings, guild boards, MCP tools and API answers may show it. It stays out of the
   CC BY-SA dataset, the public corpus, open-data snapshots and bulk exports. Wherever it appears it is labelled
   "From Blizzard's API" with the time of the read, credited "Data from Blizzard Entertainment", read from the
   armory tables (never copied into addon tables), and gone when the armory deletes it (30 days unrefreshed, a 404,
   or a hide). An API or MCP answer carries it in its own field with its own notice, as game-file data does.
2. **Drop what the API covers; keep what only the addon sees.** Stop recording and sending gear, talents,
   professions, stats, PvP, achievements, reputation and completed quests. Keep titles, raid lockouts, boss kills,
   gold, the census, player names and all world data. Accept that Blizzard's stats lack hit, haste and expertise,
   its PvP lacks rank points and season, and its talents lack node choices.
3. **Player names are on by default for new installs**, in the addon and in the Desktop App. They feed the
   armory's discovery (`upsert_players_armory`, #1166). An install that already exists keeps its choice. The addon
   says once, in chat and in the feature chooser, what it records and how to turn it off; turning it off still
   deletes the rows, and anyone can still hide a character.
4. **The addon stops recording what the site no longer needs** and reads the game live where an in-game feature
   needs it. An install's existing rows of a dropped kind are deleted from its saved file on the first load of the
   release that drops them.

## Each kind

| Kind | Addon | Upload or sync | What the site reads instead |
|---|---|---|---|
| `gear_snapshot` | Stop recording | Intake still accepts it from older addons (no protocol change) | Armory `equipment`, item level, gear score |
| `talent_snapshot` | Stop recording | Same | Nothing read it; armory talents cover display |
| `achievement_owned`, `reputation_owned`, `quest_owned` | Stop recording; the Collection view reads the game live | New addons stop sending them | Armory achievements, reputations, completed quests (crawler work below) |
| `title_owned` | Keep | Keep (upload, and sync under the achievements category, which keeps only titles) | Unchanged: the API returns no titles |
| `profession_owned`, `talent_owned`, `stats_owned`, `pvp_owned` | Stop recording | Private sync categories `professions`, `talents`, `stats`, `pvp` retired; stored rows deleted | Armory `details` and the profile's PvP fields |
| private sync `gear` | (from `gear_snapshot`) | Retired; stored rows deleted | Armory equipment |
| private sync `reputations`, and the achievements part of `achievements` | (from the owned kinds) | Retired; titles stay | Armory |
| `lockout_owned`, `boss_kill_owned` | Keep | Keep | Unchanged: the API returns no encounters |
| Catalog kinds (`achievement_catalog`, `reputation_catalog`, `title_catalog`, `quest_chain_catalog`) | Keep | Keep | Unchanged: anonymous, they confirm catalog names |
| `guild_snapshot` | Keep (rank names, last online) | Keep | Guild board item levels come from armory equipment |
| `character_link` | Keep | Keep | Unchanged: it is the account's claim |
| `player_seen` | On by default for new installs | Desktop sends it by default for new Desktop installs | Feeds armory discovery |

Linked characters reach their Blizzard data through the armory association #1166 already stores (`armory_links`).
The synced gear boards (`/rankings/item-level`, `/rankings/gear-score`) give way to the armory boards
(`/armory/rankings`), which rank every character the API knows; the old addresses redirect there.

## Order

1. Policy and this spec (docs).
2. Crawler: read `achievements`, `reputations` and `quests/completed` into the armory details, bounded and validated
   like the rest of `details`.
3. Site: pages, tools, boards and MCP read the armory; private sync retires the categories above and deletes their
   stored rows (a migration the maintainer applies).
4. Addon, Desktop App and companion: stop recording and sending the dropped kinds, names on by default for new
   installs, and the consent text that still says names leave only from the upload page. Ships with the next addon
   tag, after step 3 is live, so no page loses data while older addons still send it.
