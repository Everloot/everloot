# MCP parity batch: wider search, field reads, routing descriptions, popular builds (design, 2026-11-03)

## Intent

Everloot's public MCP (`https://everloot.app/mcp/public`, 32 read-only tools) was the only WoW: Forever
connector an assistant could reach without an install. On 2026-11-03 a read of the Glama listings
next to Everloot's (kept in the maintainers' notes) found Azeroth DB
(wiki.wowdb) running the same model with a connector scored A 3.8 against Everloot's B 3.4, searching
fifteen record kinds in ten locales with a field-level read, and TalentAnvil scoring A 4.0 on description
quality alone. Carlos's words: "this is one of our selling points and if someone else has the same stuff
it's not special", "max out our structure and get more rock solid", and "we want to offer a full on
completionist experience: track down, and for that to be offered we need that info and details".

**The baseline rule (Carlos, 2026-11-03, "same for all aspects").** For every kind of record, the Everloot
team publishes a base first and players add to it. The base is the game-file layer ("found in game
files, unconfirmed", build stamped) where the files hold the kind, and the curated layer (entries in the
team's own words, with evidence) where they do not. Player uploads confirm base entries and add what the
base lacks; they are never the only way a list fills. The data policy already provides for this
("publishing the table data comes later, as a separate step": the unconfirmed label, a spoiler switch,
maintainer review), and each layer published so far was one dated decision in the source ledger. This
batch applies the rule to the completionist kinds whose tables the pipeline already extracts but never
published: factions, titles and quest lines. Player data is the one kind with no file base; see
"Later" at the end.

What stays Everloot's alone is the trust layer (install count and date on every fact, the three-install
rule, no character names, AGPL plus CC BY-SA, the ChatGPT-approved app, the sealed registry name and the
verified Glama page). This batch closes the gaps that let a competitor claim the rest, and makes every
record a completionist cares about reachable through the same search an assistant already calls.

## Goals

1. **Search reaches every record kind the site already has.** Achievements, factions (reputations),
   titles, quest chains, mounts, recipes, legacy perks, races and instances become `search_knowledge`,
   `search`, `get_by_name`, `get_entity` and `fetch` results, with the same id, URL and licence shape as
   items and lore pages. This is the completionist foundation: an assistant can list what exists to
   complete, then `completion_progress` and `collection_gap` say what one install has done.
2. **Field reads.** `get_entity` and `fetch` accept an optional JSON pointer (`field`) and page arrays
   (`offset`, `limit`, at most 48 rows) so an assistant pulls one sub-array without the whole record.
3. **Descriptions that route.** Every tool description opens with a verb, says when to use it and which
   sibling to use instead, documents each parameter with its default, and says how to obtain ids. No tool
   below Glama's A band; `npc_page` (C 2.8) and `vendor_page` (B 3.0) first.
4. **Builds with a base.** `talent_tree` can return the Everloot team's starter builds for a class,
   written and labelled as the team's with their share codes (the curated layer), so an assistant never
   answers "no build" on day one. The observed popular build (the modal node set from uploaded
   `talent_snapshot` records, pick rates, install count) is designed here but built later, once uploads
   exist; it will appear next to the starter build, never instead of it.
5. **Findable by the game's full name.** The registry description and the listing text say "World of
   Warcraft: Forever" once.
6. **Localized names: recon only.** A written report on whether the current CDN build carries localized
   name strings the client-mining pipeline can extract, with table names, locales found and a size
   estimate. No build until the report is read.

## Non-goals and anti-goals

- No new tools. Glama already marks 32 as "heavy"; every goal above widens an existing tool.
- No change to the ChatGPT contract shape: `search` keeps its ten-result list with id, title and URL;
  `fetch` keeps its single-record body. Adding optional parameters is allowed; renaming or removing is not.
- No auction work. Capture, `auction_history` and `market_value` already exist; the volume lever
  (importing Auctionator and AHledger saves through the desktop app) is the next project, after a licence
  read of those save formats.
- No retiring of `search_knowledge` or `get_entity` in this batch (Carlos's call, after ChatGPT 1.0.2).
- No locale build. Goal 6 is a report.
- Anti-goal: inventing a build. The popular build is only ever the set of nodes three or more installs
  actually spent; a spec with fewer snapshots answers "unrecorded".
- Anti-goal: a catalog record that pretends to be observed. Achievements, titles, mounts and the rest come
  from game files and carry the existing "found in game files, unconfirmed" label with their build.

## Constraints

- **Deploy is the merge.** `deploy-worker.yml` deploys the site and MCP on every push to `main`. Any
  change to the tool list or descriptions reopens ChatGPT review, one review at a time, and 1.0.2 is open.
  Carlos decides when to merge; the branches wait. Merging all four in one sitting means one reset.
- **One version bump, once.** `server.json` and `SERVER_VERSION` in `kb/src/mcp-server.ts` move from
  0.8.0 to 0.9.0 together, in the last PR to merge (descriptions), so the registry refresh lands once.
  `@everloot/protocol` is published by `protocol-publish.yml`; its version follows the same bump.
- **Schema is the contract.** Tool input schemas live in `packages/protocol/src/mcp.ts` (`MCP_TOOLS`,
  `KNOWLEDGE_KINDS`); handlers in `kb/src/mcp-server.ts`; the public route in `web/src/app/mcp/public`.
  `tool-kinds.test.ts` checks which record kinds each tool reads against the fact functions and must
  stay green.
- **Knowledge release is SQLite with FTS.** `kb/src/db.ts` creates `entities` with a `kind` CHECK list
  (`item, npc, quest, zone, spell, lore_page, creator, realm`; `object` is in `KNOWLEDGE_KINDS` but not
  in the CHECK, a pre-existing mismatch to fix in passing) and `entities_fts`; `release-db.ts` only
  reads. The release is built offline (`kb snapshot`, published by `release.yml`, fetched at `prebuild`
  by `web/scripts/fetch-release.mjs`). New kinds need the CHECK widened and a new release cut; readers of
  an older release must not break.
- **Two kinds of catalog exist, with different provenance.** Game-file catalogs, static, labelled
  "found in game files, unconfirmed" with their build: `web/src/data/game-data/client-achievements.json`,
  `client-mounts.json`, `client-recipes.json`, `client-encounters.json`, `legacy-perks.json`,
  `races.json`, `talents/<class>.json`. Upload rollups, runtime, labelled "observed, N installs agree":
  `agreedCatalog()` in `kb/src/completion-rollup.ts` builds the achievement, faction (reputation),
  title and quest-chain catalogs the site pages use from uploaded `*_catalog` records under the
  three-install rule, and `web/src/lib/completion-lists.ts` reads nothing from game files. The batch
  reuses both; it mines nothing new.
- **Uploads for builds exist, but are not public rows.** `talent_snapshot`
  (`packages/protocol/src/records.ts`): one loadout slot (`group` 1 or 2, the dual-spec slot) of one
  character, no name, `nodes[]` with `nodeId`, rank and choice, Blizzard's `loadoutString`, points,
  optional `specId` and `treeId`. It is deliberately absent from `PUBLIC_RECORD_KINDS`, so the public
  corpus route rejects it and the MCP loader cannot read raw snapshots. The completion kinds solved the
  same problem with a rollup (`completion-rollup.ts`: state file, cron, three-install aggregation);
  builds follow that pattern, never the raw rows.
- Tests: `npm test` and `npm run typecheck` per package; `checks.yml` runs them. DCO sign-off on every
  commit; PR titles are `type(scope): plain sentence`. Nothing under wowhead.com is read.
- Launch is 2026-11-04 23:00 UTC. The branches do not need to merge before it.

## Approaches considered

1. **One PR, one version bump.** All goals in one branch. One review, one reset, one rescan. Dropped:
   a diff across the protocol package, the release builder, four handlers and 32 descriptions is too
   large to review well, and one bad item holds the rest.
2. **Stacked PRs, held unmerged, merged in one sitting.** One branch per goal, each reviewed on its
   own, all merged together when Carlos says go. Same single reset as approach 1 if merged together;
   any item can be dropped alone. Cost: branch upkeep until merge day.
3. **Flag the data goals, hold the text.** Goals 1, 2 and 4 behind a switch and deployed now; goals 3
   and 5 in a held PR. Dropped: two deploy moments, flags to remove afterwards, and a tool whose
   schema gained a parameter is already a contract change to ChatGPT's scanner, so the flag buys little.

**Picked: 2** (Carlos, 2026-11-03: "lets go on B and lets leverage sub agents and split all organized").

## The design

### PR 1: search over every catalog kind (goal 1)

**Kinds added** to `KNOWLEDGE_KINDS`, the `entities.kind` CHECK and the release builder:
`achievement`, `faction`, `title`, `quest_chain`, `mount`, `legacy_perk`, `race`, `instance`.
`object` is added to the CHECK at the same time. `recipe` waits: recipe spell names exist only in the
private assets bucket (`spell-names.json`), never in a committed file, so a recipe row would have no
honest name; recipes stay reachable through `profession_path`, `recipe_thresholds` and the spell pages
(found while planning, 2026-11-03).

**Base first, confirmation on top.** Every new kind gets a static base record from the game files,
labelled "found in game files, unconfirmed" with its build. (Ruled while building, 2026-11-03: those
records are served from the committed catalog files through an in-memory index that the knowledge tools
union with the release at query time, never as rows inside the release. The release is the open CC BY-SA
dataset and its publish guard refuses any other licence; game-file data stays under Blizzard's credit,
exactly as the client layer and race table reach the MCP today. Nothing changes for the assistant: the
same search, the same ids in `fetch`, the same page URLs.) Where the upload rollup
(`agreedCatalog()`) has an agreed entry for the same id, the hit and the `fetch` body add "observed, N
installs agree" with the date; the rollup confirms, it never creates. All rows share the `SearchHit`
shape (id, kind, name, snippet, page URL, licence, date).

| kind | base source | snippet | page URL |
|---|---|---|---|
| achievement | `client-achievements.json` (already published) | category, points, criteria count | `/database/achievements/<id>-<slug>` |
| faction | **new layer** from the `Faction` table (extracted since 10/18, never published) | header, major or not, standings | `/database/factions/<id>-<slug>` |
| title | **new layer** from `CharTitles` (same) | the source that grants it when the files say | `/database/titles/<id>-<slug>` |
| quest_chain | **new layer** from `QuestLine` (same; `QuestLineXQuest` for the quest list) | quest count | `/database/quest-chains/<id>-<slug>` |
| mount | `client-mounts.json` | source kind (vendor, drop, quest, profession) when the file says | the mount's item page when it is an item, else `/tools/collections` |
| legacy_perk | `legacy-perks.json` | tier, what it does | `/tools/legacy` |
| race | `races.json` | faction, classes, racial traits | `/classes/choose` |
| instance | `client-encounters.json` | level band, bosses, 5/10/20/40 size | `/database/instances/<slug>` |

The three new layers follow the precedent of the recipe table (decided 2026-11-02): one JSON file each
under `web/src/data/game-data/` (`client-factions.json`, `client-titles.json`, `client-quest-lines.json`),
ids and names and the fields above only, produced by the same `site-data` step of the build watch, with
a dated line in `docs/sources/LEDGER.md` and the status sentence in `docs/DATA_POLICY.md` ("Decided
2026-11-03 by Carlos: the faction, title and quest line tables"). Spoiler handling follows the existing
switch; anything the files mark as unreleased content stays hidden by default. The site's faction, title
and quest-chain list pages read the base layer first and overlay the rollup, so they are full on day one
and show the confirmation count where uploads agree. The rule for every URL: link to the page a player
would open, never to a page that does not exist.

**Search behaviour.** All new rows ride the same FTS query and exact-name boost as items and lore pages.
The `kind` filter accepts every new value. `get_by_name` works for every kind. `fetch` and `get_entity`
return a body for every new kind: a plain-text rendering (the fields the site table shows) plus the
JSON, with the confirmation line when the rollup agrees.

**Page URLs.** `recordUrl` (`kb/src/lore-slug.ts`) today gives a site URL only to `lore_page` and the
source URL to everything else. For the new kinds it gives the site page above; this is what ChatGPT
cites, so it must be a page that exists.

**Release compatibility.** The release builder writes the static rows; a reader on an older release
simply has none. The CHECK widening is a new release file, not a migration of a live database. On merge
day a new release is cut right after PR 1 merges (`release.yml`), before PR 4, so the widened `kind`
enum never advertises values that return nothing. Tests use a small fixture release with one row per
static kind and a fixture rollup with one entry per rollup kind.

**Tests.** `tool-kinds.test.ts` gains the new kinds; a search test per kind ("Loremaster" finds the
achievement; "Exalted with Argent Dawn" finds the faction); a `fetch` test per kind; the release builder
test counts rows per kind against the catalog files.

### PR 2: field reads with paging (goal 2)

`get_entity` and `fetch` gain three optional parameters:

- `field`: an RFC 6901 JSON pointer into the record's structured data (`/criteria`, `/reagents/0`,
  `/ranks`). Absent: the whole record, as today.
- `offset` (default 0) and `limit` (default 48, max 48): when the pointed value is an array, the slice,
  plus `nextOffset` when more rows remain. When the whole record is returned, arrays longer than 48 rows
  are cut at 48 with the same `nextOffset` note, so a huge record no longer blows the byte ceiling.

Output: the text block stays prose for a human; the structured block carries `{ value, pointer,
nextOffset? }`. An invalid or missing pointer answers "no such field" and lists the top-level keys, never
an error. `search` is unchanged (ChatGPT contract).

The same `field`/`offset`/`limit` trio is added to `item_page`, `npc_page`, `object_page`, `quest_page`
and `vendor_page` only if the builder finds it is one shared helper; otherwise those stay for a later
batch. (Builder's call; say which in the PR.)

### PR 3: starter builds inside `talent_tree` (goal 4)

**Built now: the base.** A new knowledge kind `build` holds curated starter builds: one YAML file
(`kb/data/curated/builds.yaml`, read by the existing `importCurated`) with, per entry, the class, the
tree it leans on, the purpose (leveling, raid, PvP), the Everloot share code (made in `/tools/talents`,
so it decodes with `talent_plan`), the points spent, the build it was made on, and a few sentences in the
team's words on why. Source URL points at the shared build page. `talent_tree` gains `builds: boolean`
(default false); with `builds: true` the answer lists the starter builds for the class (and `tree` when
given) with their codes, labelled "Everloot team starter build, not observed". Build rows are searchable
("warrior leveling build") like any curated entry. Writing the nine or more entries is content work for
the team, with sources; the PR ships the kind, the file with one example per class marked draft, the
tool parameter and the tests. Carlos decides when a draft becomes a published starter build.

**Designed now, built later: the observed popular build.** When uploads exist, `builds: true` also
returns, for the class and, when `tree` is given, that tree only, else each tree the class has:

- `installs`: distinct installs whose latest `talent_snapshot` counted in that bucket.
- `build`: the modal node set: each node with its rank, chosen by the most frequent complete node set
  among those installs; ties break toward the set seen most recently.
- `pickRate` per node: the share of counted installs that spent that node at that rank.
- `loadoutString`: Blizzard's import string carried by the snapshots that match the modal set (the one
  seen most often among them), so a player can paste it in game. An Everloot share code is added only if
  the encoder can produce one without a point order; if not, the answer says so and `talent_plan` is not
  involved.
- `points` and `asOf`: points spent in the modal set, and the newest snapshot date counted.
- `build` stamp of the snapshots, so a pre-patch build is visible as such.

**Bucketing.** A Forever build spends points across three trees, so "spec" is the dominant tree: the
`treeId` with the most points in the snapshot, with `specId` used when the snapshot carries it. Snapshots
are banded by points spent (builder picks the bands; a 31-point build and a 51-point build never share a
modal set). One snapshot per install per `group` slot (the latest); both slots count as separate samples.

Rules: under three installs the bucket reads "unrecorded, not zero" with the count. No character or guild
names anywhere, and no raw snapshot ever leaves the store.

**Data path: a rollup, like completion.** `talent_snapshot` is not a public record kind and stays that
way. A `builds-rollup` module (`kb/src/builds-rollup.ts`) follows `completion-rollup.ts`: a state file
of agreed buckets, rebuilt by the same cron cadence, served to the MCP handler through the same kind of
loader the completion tools use (`options.census` is the model for `options.builds`). Aggregation is a
pure function (`kb/src/popular-builds.ts`) unit-tested with synthetic snapshots: thresholds, dominant
tree, banding, modal choice, tie-break, per-node rates, one-per-install-per-slot.

The rollup is its own later PR, after launch-week uploads exist. PR 4's `talent_tree` description
says "starter builds" now and gains the popular-build sentence when the rollup ships.

`talent_plan` is unchanged in this PR; "compare my plan to the popular build" is a later addition.

### PR 4: descriptions, listing text, version bump (goals 3 and 5)

Every entry in `MCP_TOOLS` rewritten to one pattern, in this order:

1. Verb first: "Read one NPC's …", "Find …", "List …".
2. What the answer holds, in one sentence.
3. When to use it, and the sibling to use instead ("For what an NPC sells use `vendor_page`; for loot
   on a chest or node use `object_page`").
4. How to get its ids ("`npcId` comes from a `search_knowledge` hit of kind npc or from `world_map_near`").
5. Every parameter in the schema has a `.describe()` with its default and bounds (`limit`, 1 to 48,
   default 10).

The ChatGPT `search` and `fetch` descriptions keep their contract words. `search_knowledge` and
`get_entity` say which clients they serve so the duplicate is explained, not hidden.

`SERVER_DESCRIPTION`, `server.json` description and the Glama README field read "World of Warcraft:
Forever" once, then "WoW: Forever". `server.json` and `SERVER_VERSION` go to 0.9.0 in this PR.
`@everloot/protocol` (today 1.23.0) takes a minor bump to 1.24.0 for the new kinds and parameters;
`protocol-publish.yml` publishes it. `docs/2026-10-18-mcp-listings.md` gets the 0.9.0 text and the
stale Glama row fixed.

Verification: the rewritten descriptions are run through the same six dimensions Glama scores (behaviour,
conciseness, completeness, parameters, purpose, usage guidelines) by a reviewer subagent before the PR
opens; anything it cannot place in the A band is rewritten.

### Recon: localized names (goal 6)

Using the `everloot-client-mining` skill against the current CDN build: which tables carry localized
strings, which locales the build ships, whether the string columns are per-locale or client-locale only,
row counts and byte estimates for name-only extraction of the kinds in PR 1 plus item, npc, quest, spell.
Output: `docs/2026-11-0X-localized-names-recon.md` with a yes/no and a cost. No code.

### Order of merge

PR 1, then a release cut, PR 2, PR 3, then PR 4 (carries the version bumps), in one sitting, on
Carlos's word. Each PR is rebased on `main` the day of merge. If one is dropped, PR 4's description
text for that tool is reverted to today's wording before merge.

## Later: the player base (Carlos, 2026-11-03, recorded, not built)

Player data is the one kind with no game-file base. The two candidates are both blocked today: Blizzard
has no Forever namespace in the Battle.net API (Brain 10/17 analysis; community checks 10/26 and 10/28;
question 7 of the Blizzard letter asks), and its terms forbid redistribution; and other players' scans
(`player_seen`) are named data of people who did not opt in, which the data policy keeps behind that
person's sharing choice. The logic to add when the namespace appears: a Battle.net adapter behind the
existing character link, so a player who linked Battle.net can let Everloot read their own characters
from the profile API, shown on their profile under Blizzard's terms and never in the open dataset. The
base for players is "your own verified characters"; the crowd adds anonymous census on top. Watch item:
re-check the namespace after 2026-11-04.

## Decisions made while writing (check these while reading)

- Carlos's baseline rule (above) replaces the earlier runtime-union design: factions, titles and quest
  lines get a published game-file layer; the rollup confirms it.
- Starter builds are curated entries now; the observed popular build is a rollup later, never raw
  snapshots, to keep `talent_snapshot` private.
- "Spec" for builds means dominant tree by points, with `specId` when present.
- The build's shareable string is Blizzard's `loadoutString`; an Everloot share code only if encodable
  without a point order.
- A new knowledge release is cut right after PR 1 merges, on merge day.
- `@everloot/protocol` goes 1.23.0 to 1.24.0; the MCP server and `server.json` go 0.8.0 to 0.9.0.
- New kinds cite their everloot.app page as `recordUrl`.

## Left to the builder

- Exact page URLs for mount rows that are not items (rule above).
- Whether the field-read helper is shared with the page tools in PR 2.
- Point bands and the tie-break detail for popular builds.
- Rendering of the new kinds' `fetch` bodies (field order), following the site tables.
- The reserved id range for rollup hits.
- Test fixtures: a small release with one row per static kind, a fixture rollup, and synthetic snapshots.
