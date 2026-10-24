# Guilds: the guild board as a ladder

Date: 2026-10-24. Status: design, with the first slice built behind `EVERLOOT_GUILDS` (off). Owner brief (Carlos,
2026-10-24): the Guild Board should work like WoWProgress, with a direct logic for guild data, guilds connected to
their characters and their kills so people can explore them, and the same data reachable through MCP and agents.
Builds on `2026-09-29-everloot-guild-system.md` (the legal split, officer publication, no combined score) and
`2026-10-20-player-pages-design.md` (player rows carry a guild name). Where this design changes an earlier owner
decision, section 9 says so.

## 1. What WoWProgress does, and what we take from it

| WoWProgress | Everloot |
| --- | --- |
| A ladder per raid tier: rank, guild, realm, progress (`6/8`), filterable by region, realm, faction. | `/guilds`: a ladder per raid instance from agreed kills, filterable by realm and faction. |
| A guild page: progress per raid with kill dates, a roster with class and level, a rank on the realm and overall. | `/guilds/<realm>/<guild>`: the same, from the guild's own members' uploads and, when officers publish, their roster. |
| A character page that names the guild and links to it. | `/players/<ruleset>/<realm>/<name>` links to the guild page. |
| Armory sync fills everything. | There is no Forever armory. Everything comes from the addon, and a fact is published only when enough installs agree, as everywhere on the site. |
| A score. | None. Carlos decided on 2026-09-29 that the components stay separate; the ladder orders by progression alone, which is also how WoWProgress ranks within a tier. |

## 2. The direct logic: three sources, one key

A guild is `(ruleset, realm, name)`, keyed lower-cased and trimmed, the same way `players` keys realms. Three
sources feed one guild record, and each fact says which source it came from:

1. **Kills, from members (new).** The players module already reads the player's own guild. When `ENCOUNTER_END`
   reports a kill inside a raid or dungeon, the module writes a `guild_kill` row: the guild, the realm, the
   encounter and the time. No character name is in it. A kill is the guild's once **2 distinct installs** report the
   same guild and encounter; the kill time is the earliest of the agreeing reports. This is the same bar as the
   officer board (`GUILD_AGREEMENT`) and below the 3-install bar of anonymous world facts, because the row already
   names its guild and a second member is a second witness.
2. **Seen members, from player rows (exists).** `players.guild` holds the guild a character was last seen in. A
   guild's seen roster is every visible player row with that guild on that realm, newest first, with level, class
   and the day. Suppressed characters are already excluded by the table's functions.
3. **The officer board (exists).** `guild_snapshot`, `raid_lockout`, `attendance`, `loot_award` and
   `gear_snapshot` under a verified grant, published when 2 officer uploads agree (`kb/src/guild-board.ts`). On the
   guild page these are the confirmed roster, the lockout progression, attendance and loot, labelled as the
   officers' publication.

Progression on the page is the union of 1 and 3, each kill marked `members` or `officers`; a boss both report is
one line. The ladder uses the union too.

## 3. Pages

### `/guilds` (the hub; replaces "Guild board" in the Tools menu, which becomes "Guilds")

- PageHeader: "Guilds", lede "WoW: Forever guilds by progression, from their members' uploads."
- A search form (GET, `q`, 2 to 24 letters) that finds guilds by the start of the name, like `/players`.
- A FilterBar: instance (the raid instances with any agreed kill, newest tier first), realm, faction.
- The ladder: rank, guild (link), realm, faction mark, progress as `killed/bosses` with a share bar, the date of the
  latest agreed kill, members seen. Ties share a rank. Twenty rows a page.
- Before any agreed kill: a framed EmptyState ("The ladder starts with the first kill two members report.") and a
  "What will be here" card, as the rankings do.
- A "Publish your guild" card for officers, linking to `/tools/guild-board` (the officer side keeps its page).
- The Olympus family record stays at `/guilds/olympus`; the hub lists families under "Guild families".

### `/guilds/<realm>/<guild>`

- PageHeader: the name; lede "<faction> guild on <realm>"; meta: rank on the realm and overall for the newest
  instance with a kill, "Last activity <day>". Trail Home > Guilds > realm.
- **Progression**: one card per instance (newest tier first): `killed/bosses`, then each boss with its kill date
  and source (`members` or `officers`), unkilled bosses muted. The boss list and order come from the game data the
  site already has for the instance (`encounter` ids settled per instance map; see `api.ts` ID_MAPS.encounter).
- **Roster**: the officer roster when published (name, rank, level, class), else the seen roster (name linked to
  the player page, class in its colour, level, last seen) with the line "Characters the addon saw in this guild.
  Not a member list from the game." Both when both exist, officer first.
- **Activity**: the agreed kills in time order, newest first (an "activity feed" like WoWProgress's history).
- **Loot and attendance**: the officer board's sections, when published.
- **Hide this guild** (officers, no account): a form like the character hide form; a hidden guild leaves the
  directory, the ladder and the page, and its `guild_kill` rows are dropped at intake. Decision 9c.
- noindex until `EVERLOOT_GUILDS_INDEX=1`, like player pages.

### Links into it

- A player page names the guild as a link when the guild has a page (the switch is on).
- The census "Look up a player" card gets a second field, "or a guild".
- The rankings rail adds "Guilds by progression" under Population.

## 4. The rollup (`kb/src/guilds.ts`)

Pure functions over rows, like `census.ts` and `guild-board.ts`, so the MCP server, the pages and the export
agree. The contract (types in the file; the first slice ships them):

```ts
guildKey(realm, name): string                       // "realm-key\u0000guild-key"
agreedKills(rows: GuildKillRow[], now: Date): AgreedKill[]   // 2 installs per guild+encounter; earliest time
guildProgression(kills: AgreedKill[], instances: InstanceDef[]): GuildProgress[]  // per instance: killed/bosses
guildLadder(progress: GuildProgress[], instanceMapId, filter: { realm?, faction? }): LadderRow[]
guildDirectory(sources: { kills, snapshots, seen }): GuildSummary[]  // one record per key, with sources named
formatGuildPage(page: GuildPage): string            // the MCP tool's text
```

`InstanceDef` is `{ instanceMapId, name, tier, bosses: { encounterId, name }[] }`, read from the knowledge
release's settled encounter ids (`api.ts` ID_MAPS). Tier is the instance's order in the game's raid list; the
newest tier is the ladder's default.

## 5. The record (`packages/protocol/src/records.ts`)

```ts
guild_kill: base.extend({
  kind: "guild_kill",
  guildName, realm, faction: "alliance" | "horde",
  encounterId, name, instanceMapId, difficulty, size?,
})
```

Written by `addon/modules/players.lua` only while `/everloot players on`, on `ENCOUNTER_END` with success, when
`GetGuildInfo("player")` shows a guild. `ENCOUNTER_END` joins the module's event list; no new game call (the
contract test's allowed list stays `UnitIsPlayer, UnitGUID, UnitName, UnitLevel, UnitRace, UnitClass, GetGuildInfo,
GetRealmName, GetTime, IsInRaid`; `UnitFactionGroup` is added for the faction, and the test's lists grow by that
one name). Built: the list also gained `GetInstanceInfo`, read on the player only, because `ENCOUNTER_END` does not
carry the instance's map id the record needs. Carlos to confirm. The row is public (`PUBLIC_KIND_LIST`): it names a guild and a boss, never a person. At most 60 kills a
UTC day per install.

## 6. Storage and the migration (`supabase/migrations/20261025120000_guilds.sql`)

Additive, applied by hand before the switch goes on:

- `players_guild` index on `(ruleset, realm_key, lower(guild))`.
- `guild_members(p_ruleset, p_realm_key, p_guild_key)` returns the visible player rows with that guild (same
  suppression rule as `search_players`), at most 500, newest `last_seen` first.
- `search_guilds(p_prefix, p_limit)` returns `(realm, guild, members, last_seen)` grouped from `players`, at most 25.
- `guild_suppressions(realm_key, guild_key, created_at)` and `suppress_guild(p_realm, p_guild)`; `guild_members`
  and `search_guilds` leave suppressed guilds out.

`guild_kill` rows live in the upload corpus like every other public kind; the rollup reads them through
`uploadStore.loadCorpus()` as `guild-board.ts` does.

## 7. MCP and API

- `guild_search(query)`: guilds whose name starts with the query, with realm, members seen, latest kill. New tool.
- `guild_board(guildName, realm)`: unchanged inputs; the text and `page` gain `progression` (union, each kill with
  its source and date), `seenRoster` (count and names), `ranks` (realm, overall, for the newest instance). Output
  schema extended, inputs untouched.
- `guild_rankings(instanceMapId?, realm?, faction?, limit?)`: the ladder. New tool.
- Every tool answers over `GET /api/tools/<name>` as today. The open data export gains `guild-kills.ndjson`
  (agreed kills) and `guilds.ndjson` (the directory), both CC BY-SA 4.0 like the rest.
- The public tool list goes from 29 to 31; the ChatGPT and Claude directory submissions carry the count and need
  a resubmission when one is next due (decision 9d).

## 8. Switches and rollout

| Switch | Effect |
| --- | --- |
| `EVERLOOT_GUILDS=1` | `/guilds` (hub, ladder, search), `/guilds/<realm>/<guild>`, the hide form, guild links on player pages, the two new MCP tools and the `guild_board` extension. Off: 404 for the pages and the new tools are not registered. The family pages and `/tools/guild-board` work either way. |
| `EVERLOOT_GUILDS_INDEX=1` | Lets search engines index guild pages. |
| `EVERLOOT_PLAYER_PAGES=1` | Needed for the seen roster and the search by name; without it a guild page shows kills and the officer board only. |

Slices: (1) this spec, the record, the rollup, the tools, the pages, the migration and the addon change, all
behind the switch and off. (2) Carlos: policy text (section 10), migration, addon release, switch. (3) After
launch data exists: the realm pages and the recruitment board (section 11).

## 9. Decisions this asks of Carlos

Accepted as proposed by Carlos on 2026-10-24 ("proceed"): a yes, b 2 installs, c yes, d 31 tools with a
resubmission, e yes.

a. **A guild page lists seen members.** The player-pages design (2026-10-20, section 1) said "no member list is
   published, and no guild page exists in version 1". This design publishes the seen roster: names that are each
   already public on their own player page, grouped by the guild the game showed. WoWProgress shows rosters the
   same way. The page says it is sightings, not the game's roster, and both the character hide form and the new
   guild hide form apply. Carlos says yes or no; "no" keeps the officer roster only and the slice still ships.
b. **Two members make a kill the guild's.** The agreement bar for `guild_kill` (2 installs, like the officer
   board) rather than 3 (anonymous world facts). "3" is a one-constant change.
c. **A guild hide form without proof of office.** Same stance as the character hide form: anyone can hide, at once,
   no account. The alternative is to require a verified grant, which no guild has yet.
d. **Tool count 31.** The directory listings (ChatGPT 1.0.1 in review, Claude pending) name 29 tools.
e. **The addon reads `UnitFactionGroup`.** One more game call on the players module's list, for the guild's
   faction. Without it the faction comes from members' races, which is slower to settle.

## 10. Text that changes with the switch

- Privacy policy, `player-pages` item: add that the players module also records your own guild's boss kills (the
  guild, the boss and the time, no names), and that a guild page lists characters seen in that guild.
- `docs/DATA_POLICY.md`: `guild_kill` joins the public kinds with its field list; the guild page paragraph.
- `/methodology`: "How guilds are counted": the 2-install rule for kills, what a seen roster is, the hide forms.
- `/addon` and the in-game `/everloot players on` message: name the kill rows.
- Terms: the guild pages carry the same unverified-information clause as player pages.

## 11. Out of scope for the first slice

Realm pages, recruitment posts and "looking for guild" listings (WoWProgress's second half), a guild score,
cross-realm or family rollups beyond the existing family pages, alt linking, officer dashboards beyond the existing
board, and anything from logs or an armory.

## 12. Testing

Rollup: agreement (1 install is not a kill, 2 are; the earliest time wins; a hidden guild is out), progression per
instance with unknown encounters ignored, ladder order and ties, directory merging of the three sources. Pages:
switch off is 404 and reads nothing; the hub's empty state; the ladder with fixtures; the guild page with kills only,
with the officer board only, with both; the hide form posts without JavaScript. Addon: the contract test's lists,
a kill with and without a guild, the daily cap, nothing written while the module is off. MCP: tool count and
schemas, `guild_board` output stays a superset, `guild_search` and `guild_rankings` answers. SQL: `supabase/tests`
for the functions and suppression.
