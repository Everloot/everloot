# Changelog

All notable changes to Everloot, in the style of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
The addon is versioned (`0.3.x`, tagged `addon-vX.Y.Z`) and so is the desktop app (tagged `desktop-vX.Y.Z`). The site and the knowledge base deploy from
`main` and have no version number, so their milestones are listed by date at the bottom. Site and MCP
server changes under Unreleased are already live on everloot.app; Unreleased means not yet in a tagged
addon or desktop release.

This file was started on 2026-10-17 from the merged pull requests and commit history. Addon releases
from 0.3.0 on have a GitHub release page with the zip and its `SHA256SUMS`; `0.2.1` is the first addon
build that has a zip in the repository. Earlier builds have none.

## [Unreleased]

Pull requests merged to `main` are listed in the nightly pre-releases until the next tagged release.

### Added
- Site: search engines and AI assistants now find more of the site: spell pages that create, cost or teach
  something or sit in a talent tree, each zone's coverage page once players have confirmed something there, the
  class chooser once it is reviewed, and the lore pages about an NPC, item or quest players have named in WoW:
  Forever are in the sitemaps, and llms.txt names every database list, from spells to quest chains. A talent
  spell's page now shows its class, tree, row and ranks.
- Site: a dungeon or raid page gains a Loot section after Bosses: for each boss 3 installs report, the loot table of
  its creature, the same rows its NPC page shows, or how many installs have looted it so far. In the list, an instance
  the game files place no entrance for says so beside its id, with the reason on hover.
- Site: every database page now tells search engines its name, id and address, so results link the right page.
- Site: the armory opens at `/armory`: a page for every WoW Forever character and guild that Blizzard's API returns,
  read hourly, with guild rosters, three boards (item level, gear score, honorable kills), a form to hide a character
  and a form to ask for one. Each page says "Data from Blizzard Entertainment", carries no ad and is not indexed yet.
- Addon: the Collection tab gains a Quests section, each quest chain you have started with how many of its quests are
  done, and a This character / Account switch. Account counts every character you log in with and names the one that
  has each achievement, title, reputation, lockout or chain. It reads what the completion tracker already keeps;
  nothing new is recorded or uploaded.
- Knowledge base: the open data export's game-files folder gains one file per committed catalog (achievements, factions,
  titles, quest lines, mounts, encounters, recipes, class gear and its restrictions, class spells, races, legacy perks,
  talent nodes, raid buffs): ids, the names the files hold and each file's build, every row counted, with a schema each
  and a manifest line. The README and the download page no longer list the catalogs as missing. Nothing observed changes.
- Addon: `/everloot where` finds an item's drops and vendors or an NPC's locations in your own saved sightings, with counts and a site link.
- Site: every record kind has a docs page, `/docs/api/records/<kind>`, generated from its schema: each field with its type,
  whether it is required and its description, nested fields included, whether the kind is in the public corpus, where it
  goes, and the cross-field rules the server checks. The sidebar lists them and the schemas table links each kind to its page.
- Site: the API docs list the site-internal routes, `/api/suggest` and `/api/map/pins`, with a note that they serve the site's pages, may change without notice and are not part of the protocol.
- Addon: the window's Professions tab has a Crafting costs page: each recipe you have recorded with its reagents' cost
  at market value (or a cheaper vendor price), the product's value per item and an estimated profit assuming one item
  per craft, sorted by that estimate or name, with the price file's age. A reagent without a price shows the cost as unknown, never zero. Pick a recipe
  and a count for a what-to-buy list of reagents and their total.
- Site: the account guide and the addon page link the sample character page (/showcase/character), so a player can see
  what a character page holds before linking one. The sample stays out of search and the sitemap.
- Addon: item tooltips show your own history with the item on this realm, from the gold ledger in your saved file:
  your last sale (day and price per unit), your average sale and units sold over the last 90 days, sales waiting for
  their mailbox letter, and what you paid where the ledger knows it. An item you never sold says nothing. Three new
  switches on the settings page turn prices, your history and sources in tooltips on or off; all start on.
- Site: a profession page answers to its skill line id, `/tools/professions/171` or `/tools/professions/171-alchemy`, and
  redirects for good to the slug page it already had, keeping the skill range and class context in the query; an unknown id
  is a 404 and no existing URL changes. The MCP profession_path and recipe_thresholds links carry the id in that form.
- Site: NPC pages show agreed goods and quests with their reports, link to the vendor, and show level, type and reaction even before players agree on a name.
- Addon: the Gold Overview shows earned, spent and profit for the selected period and character or account, with daily averages, top items and pending sales.
- Site: vendor, achievement, quest chain, zone and instance pages carry In short and Copy for AI like the other database
  pages, each line saying how many installs agree and when, or that nobody has reported it yet; a vendor links its NPC's
  card as Raw JSON. An achievement page also links the Collections tool and says under its criteria what Confirmed means
  and whether this one is.
- Site: a "Write a wiki page" guide under Docs › Guides says how a wiki page is proposed and reviewed, with the page
  types, the front matter, the rules and the check from the wiki README; the wiki hub and the lore archive link to it.
- MCP: generic search and exact-name lookup discover agreed gameplay names and zone ids, with separate record and
  game ids and source labels.
- Protocol: 2.1.0 adds optional gameplay identity and provenance fields to MCP knowledge hits.
- Site: a faction page and a title page carry In short, Copy for AI, a "Player reports" fact that stays an empty meter
  until three installs agree, a "Track this" link to the collections tool and a relation tab ("Reputation from" on a
  faction, "Earned by" on a title) whose empty state names the 3-install rule and says what no game file read so far
  carries; a faction page also shows its lore archive page when the archive has one under the same name.
- Desktop App: Reports shows your local ledger by day and item, with period, account, character and item filters, cumulative totals and a comparison with the previous period.
- Site: a class page links the census narrowed to its class and the classes ranking, and the search page with no
  query lists what a search finds (items, NPCs, quests, zones, objects, the lore archive, tools and docs), each
  linked to its list, with four queries to try. Before, the class page stopped at the database links and an empty
  search page showed the field alone.
- Site: `/docs/mcp` tables the record kinds the knowledge tools cover, where each kind comes from and the tool that
  reads it on its own, and says how a record id is formed: a catalog record's stable synthetic id against the in-game
  id the page tools take.
- Site: the limits and keys page has a Scopes section: a table of every scope a key can carry (read:public on every
  key; read:own, link:own and sync:own opt-in on the key form), what each allows and which routes check it. A test
  keeps the table at one row per scope the code defines.
- Site: the MCP resources page gives each prompt its own section (title, arguments with their allowed values, the
  `prompts/get` call and the message the server returns), shows one `resources/read` of the builds resource with the
  shape of its document and one entity read that equals the `item_page` answer, and the MCP sidebar lists the three
  prompts under the page.
- Site: an item, NPC or quest page shared on Discord or X shows its own card: the name, its type and how many of
  the 3 installs agree on the name, as text on the brand canvas. Before, every database page showed the site card.
- Site: the gear rankings are scored every 30 minutes by a new cron (`/api/cron/profiles`) and stored, instead of on
  every page view; the boards say how long ago. Each view still filters the stored boards against who is ranked right
  now, so a switch turned off takes a character off on the next request. Ranked characters get a daily history of
  level, item level and Gear Score, drawn as a chart on their page from the second day. Behind `EVERLOOT_LEADERBOARDS`
  (off; needs migration `20261107150000_profile_pipeline.sql`). Design: `docs/design/2026-11-07-profile-pipeline.md`.
- Site: item level and Gear Score rankings for linked characters at /rankings/item-level and /rankings/gear-score
  (`EVERLOOT_LEADERBOARDS`, migration `20261107120000_gear_board.sql`, the data policy's "Gear rankings"). A character
  is on them only while its player made the page public, turned gear sync on and chose "Rank my gear" on the account page.
  Both numbers are averages over 17 slots with each item at the game files' item level; Gear Score v1 weighs each slot by
  its stat budget in the game's `RandPropPoints` table. Filters by ruleset and region, and the character page shows its
  place on each board.
- Addon, Desktop App and site: a linked character's active talent build syncs to its page. The addon keeps it as a
  keyed `talent_owned` row (local only, deleted by `/everloot completion off`), the Desktop App sends it with the other
  synced categories, and the site keeps it under the talents switch. The anonymous `talent_snapshot` is never synced.
- Site and MCP: while few players upload, Everloot's own installs (Worker secret `EVERLOOT_TRUSTED_INSTALLS`) make an
  Auction House day or a census count public on their own. Everyone else still needs 3 reporters, and a census count
  still needs 10 characters, the hiding of small counts and rounding to 5. A value that rests on them says "includes
  Everloot's own scans" on the Auction House pages, in chat price answers and `market_value`, and the census and
  `population` say when their numbers include them. Scans already waiting for a third reporter count from the next
  rollup run.
- Site, behind `EVERLOOT_PRIVATE_SYNC` (off; its migration is not applied): private sync of your own linked characters.
  A key with the new `sync:own` scope sends a character's gear, active talents, professions, reputations, raid lockouts,
  and achievements and titles. Each category is kept only when you hold that character's live link and turned its sync
  on, and only its newest capture is kept. You see it all on a signed-in preview, and each section shows on the
  character's public page only when you switch it on. Turning a category's sync off or unlinking deletes what was synced.
- Site, behind `EVERLOOT_PRIVATE_SYNC` (off): /account turns each linked character's sync and page sections on and off,
  and links to the preview. A sync key may send 20 times an hour, and achievements count only those the character earned.
- Addon and Desktop App: with the completion tracker on, the addon keeps each of your characters' professions (rank of
  max rank) and this week's raid lockouts (bosses killed of total, reset time) under the completion key, latest state
  only, and the Desktop App's Characters page shows them on the keyed rows. They stay on your computer: no upload, the
  upload page included, sends them, and the Desktop App's Chat does not read them. Not yet checked in game.
- Site: the Auction House lists each realm that has scans but no public prices yet, with how many of the 3 players needed
  have scanned there ("1 of 3 players have scanned; prices go public at 3"). A player is counted once per upload address,
  on the item with the most players on one day in the last 7. `/api/market/prices` without a realm returns the same counts
  in `pending`. Counts only: no price or quantity below 3 players is shown.
- Desktop App and site, behind `EVERLOOT_CHARACTER_LINKS` (off): the addon's `/everloot link <code>` (0.3.15) writes one
  link row for the character you are playing, with a code made on the account page. The Desktop App, signed in, sends it only
  to the account's own link endpoint; uploads never carry link rows. The account page lists your linked characters,
  linked or frozen, and unlinks them. A link is a claim from the addon file, not proof of ownership.
- Site and MCP: racial traits from the game files (build-stamped `races.json`, found in game files, unconfirmed).
  Each class page lists, under "Who can be a {Class}", every race's traits with active or passive and the short
  text; `/wow-forever` adds a trait table per faction. New MCP tool `class_races` (protocol 1.20.0): the races that
  can be a class per faction, with trait names and no game text; the chat uses it for builds questions.
- Site: **Copy for addon** on both planners, exporting the selected talent set or planned raid code.
- Site: a news section. Posts are Markdown files under `kb/news/` with front matter (`npm run kb -- news-check`
  runs in CI), written in the wiki's syntax so they link database entities and wiki pages the same way. Published
  posts appear at `/news` and `/news/<slug>` with Article structured data, in the `/news/feed.xml` RSS feed, in the
  sitemap and in llms.txt; a draft is built nowhere. Blizzard's own posts stay on `/changes`, which the hub links.
- Site, behind `EVERLOOT_GUILDS` (off): `/guilds`, a ladder per raid from the kills two members' installs agree on
  (bosses killed, then first to the latest kill; no score), with guild search and realm and faction filters;
  `/guilds/<realm>/<guild>` with progression per instance, the officers' roster and the characters seen in the guild
  (labelled as sightings), activity and a hide form that works without an account. MCP `guild_search` and
  `guild_rankings`, and `guild_board` gains the ladder side; the open data export gains `guild-kills.ndjson` and
  `guilds.ndjson`. Migration `20261025120000_guilds.sql`, applied by hand before the switch goes on.
- Site: `/tools/collections` opens on a completionist overview, a "Total complete" bar and one bar per category
  from the agreed lists, with done, missing and started views and a "remember this character" helper on the browser.
- Site: `/tools/gold-ledger` reads `Everloot.lua` in the browser, nothing sent: characters, the last 30 days of money
  in and out, this week, categories, receipts and gold history. The published ledgers stay below.
- Site: the header search box suggests dungeons and raids as you type, from the same rows as full search, with or without
  the leading "The": "deadm" offers the Deadmines, labelled "Dungeon, level 16". A box scoped to items, NPCs, quests or
  objects keeps to that type.
- Addon and site: the census also counts players the game shows a nameplate for (`via: "nameplate"`, protocol 1.26.0),
  at most 10 new ones a second; still race, class, level and faction only, and the players module still never reads
  nameplates. Needs the next addon release; no migration.
- Site: `/api/health` has a route test: a fresh heartbeat answers 200, any other 503, both `Cache-Control: no-store`,
  and the snapshot is read again only after a minute. The route itself is unchanged.
- Site: the open data export, at `/database/download`. The published data as NDJSON files anyone can download
  and build on, under CC BY-SA 4.0: what three installs agree on, and the game files' own layer, with a
  manifest that says the build, the date the data was current, the method, the row count of every file and
  what each one counts. The local Classic baseline is never in it — it is GPL-derived and stays on the
  maintainer's machine — and a fact fewer than three installs agree on is not in it either. The page says so
  in the same words as the policy.
- Site: `/database/coverage` says how much of the game three players have agreed on, per zone, per type and
  per field, with the confirmed share beside the settled one, and the zones that need players first. A type is
  at its plateau when 90% of its expected facts are confirmed, 75% are settled, and under 0.5% became confirmed
  in the 28 days before the data date; about 2% of the settled facts are left out each week, picked by a hash
  of the fact and the week, so every settled fact is looked at again about once a year and the load stays
  flat. A fact a patch may have changed counts as neither confirmed nor settled.
- Knowledge base: `npm run kb -- coverage-report`, a local report of the facts that are missing, reported,
  contested or spread, by zone and level, with the expected counts written beside it. Local only: the counts
  are uploaded, never the rows.
- Knowledge base: the settled list, one list per client build of the facts three players confirmed and two
  more agreed on, and the uploaders that stop sending what is already settled. The site's copy is served at
  `/api/coverage/settled`. The server-side tally of the extra agreement is behind a switch that stays off
  until the data policy says how it is published.
- Site and MCP server: a `coverage` tool, the same counts as the coverage page as text, per zone and per
  type. The public tool list is 29 tools; the directory submissions carry the older count until they are
  updated.
- Site: a page per dungeon and raid, with the entrance players confirmed, the bosses and their kill counts,
  and the treasure markers on the map, all read from the same readers the zone and object pages use, so a
  marker on the map and a row on a page cannot disagree. The pages are in the sitemap and `/database` links
  the index.
- Knowledge base: `npm run kb -- name-gaps` opens with the counts: how many items, quests, item sets and
  spells carry a name today, and which source each name came from — the game files, the Warcraft Wiki, the
  local baseline, or the players. A source that was not read says so instead of printing a zero.
- Knowledge base: `npm run kb -- name-gaps`, a local report of the items, quests, item sets and spells that
  still print as an id, each with the reason and what would fill it (a rule decision, the addon's uploads, or no
  source yet). Ids only, never names.
- Site: the data layer for linking a character to an account, off by default. A signed-in player gets a code
  (live 15 minutes, good once), and a `character_link` row with that code is sent to `/api/me/characters/links`
  from the site or with an API key that has the new `link:own` scope. The GUID is replaced by a keyed hash, the
  census must agree on race, class and faction, hidden characters are refused, and a character claimed by a second
  account is frozen on both. Nothing is public and there is no page for it yet. Off until the migration is applied
  and `EVERLOOT_CHARACTER_LINKS=1` is set; intake never stores link rows.
- Site: rankings at `/rankings`. Classes, races and faction balance by ISO week, from the census under its
  usual rule, with a weekly chart and each rank's change against the week before. They start with the first
  full week after launch.
- Site: an achievement's page lists its criteria, with how many each needs, once three players sent the same complete list; the list is agreed apart from the entry itself. Lists and search still show no criteria wording. Run the completion rebuild (`?rebuild=1`) once to fill it from uploads already stored.
- Knowledge base: an NPC seen at its window places a pin like a spawn position (three installs on one map);
  a targeting position still never does. Object spawn points are clustered per object and zone, become a pin
  at three installs with a key that stays put once published, and an object's name needs three installs to
  agree. Fishing (the bobber, or an object installs agree is fished) is never a pin. An upload of an event
  that only adds fields to an earlier copy, as when an older Desktop App had dropped them, replaces that copy
  instead of withdrawing the event as a conflict. The map shows none of this yet.
- Docs: a page for addon authors at `/docs/addon-authors`: the licences and the credit line, the records API, a free key and
  the files as three ways to get the data, a skinning loot recipe in curl, JavaScript and Python, why the site's drop
  rates leave skinning out, and how to build an offline pack.
- Site: download shortcuts (`/download`, `/downloads`, `/desktop`, `/curseforge`), CurseForge install choices and a
  Desktop App button for your operating system make downloads easier to find, including on phones.
- Site: Zone pages have an Items tab with the items players looted from the NPCs and objects confirmed there, each with its source, observed frequency and installs (an item two sources drop is one row with its sources under it, 50 items a page), and an empty zone says a rate needs loot windows from 3 installs. The header links the zone's coverage page and its wiki page when one is published, and a line under the tabs links the farming and gathering pages that list the zone. When the loot tables cannot be read the tab says so instead of vanishing.
- Site: dungeon and raid pages list the quests players filed under the instance in their quest log (matched by the quest-log header 3 installs agree on), with installs and last seen, and every boss under Loot says when no creature is tied to it yet. Instance 2999 shows as Ruins of Lordaeron, a name taken from the game files and marked as such.
- Site: Quest pages link their chain, previous and next quests, and reported zone; chain lists explain quests whose names are not reported yet.
- Site: object, instance, faction, title, achievement and vendor pages now link the Warcraft Wiki lore page of the same name, item pages do too when the name shown is the wiki's, and lore pages link back to the database page (zone, instance, object, faction, title, achievement, NPC, item or quest). A link needs an exact name that only one page has on each side; a name two pages share gets no link. Zone pages follow the same rule, and a Warcraft Wiki copy is indexed and listed in the lore sitemap exactly when it links back.
- Site: spell and vendor links show hover cards, with the spell text and build or the vendor's agreed goods count.
- Addon: shopping lists. The Everloot tab at the auction house has a Shopping list page: named lists of items with a wanted count and an optional max price per unit, each beside the price file's market value and its age, and a Search button that sends one auction-house search per press when the client's throttle allows (the lowest buyout found shows in the row; you buy from the Buy tab yourself). The Professions tab's what-to-buy list adds a recipe's reagents. Saved in your file only, up to 10 lists of 50 items; bags and bank are not read.
- Site: the home page now states the site's promise, "Every fact shows how many players saw it, and when", with three counts under it: the installs that have reported, the facts they have confirmed and the facts waiting on one or two more installs, each with the data date and build, or "unrecorded" when the stored coverage score cannot be read. An empty loot tab on an NPC, item or object page now ends on how many installs it takes, beside the Get the addon link, and the MCP server's instructions state the same promise.
- Site: /database/recent and its RSS feed list the entities whose facts reached three installs in the last 30 days;
  dates from before the feed existed are marked estimated.

### Fixed
- Site: the header shows the build whose files the site reads and the newest build seen, each linked to what it means.
- Site: /api/suggest spends the per-IP quota and shares one edge cache entry for `Thunder` and `thunder `, the coverage 400 and waitlist 503 are `no-store` (the 503 adds `Retry-After`), and the docs list every route that sends CORS from one file.
- Site: when a database or tools page can't be read, you now get a "Database unavailable" or "Tool unavailable" page that says it could not be read, not that it is empty, with a Try again button and a link back to the section, instead of the generic error page.
- Site: item list pagination is crawlable while filter URLs stay blocked.
- Site: the stored profession and map views work out the derived profession steps and the recheck list on read, so a
  deploy that changes either shows at once; an idle cron run rewrites a view built from an older snapshot, and the
  cron reads the corpus once for all the stored views it writes.
- Site: /database splits its rows into "Seen by players" and "From the game files", says after launch that a row fills when 3 installs agree, and drops the Guilds lookup row (the Tools menu has it).
- MCP: `market_value` and `auction_history` read a realm the same way. A name that is the end of exactly one realm's
  full name (`US1 Realm 4 PvP`) answers for that realm (`CAMWOW US1 Realm 4 PvP`) and says so; a name that ends several,
  or that no scan uses, answers ambiguous or unknown with the closest realms to ask with, instead of "No public market
  value"; an ambiguous name returns no price at all, not even from browsing history stored under the name as typed.
  `auction_history` lists the public full-scan days `market_value` values the item by, and its browsing days follow the
  market's rule, so a day Everloot's own installs scanned is public under 3 and says so. Before, it answered "Price
  unrecorded" for days `market_value` listed.
- Knowledge base: a self-hosted MCP server and `coverage-report` read the whole public corpus again. The reader stopped
  at 50 pages and 2 MB in all, and the feed is now about 98 pages and 13 MB; the limits are per page with a high total
  guard. Without a key the site allows 30 requests an hour, so a rate-limited read now says to set `EVERLOOT_API_KEY`.
- Desktop App: the guide covers every page and signing in, setup points to `_forever_`, and empty Addon and Market panels offer Open Settings or Refresh prices.
- Site: title pages and lists no longer show the game's raw `%s`: the name reads "Bloodsail Admiral <Name>", the address
  drops the trailing `-s` (`/database/titles/144-bloodsail-admiral`) and the old address redirects to the new one.
- Site: the schemas page marks the three shapes that describe a bulk-export file rather than an endpoint and says that
  `reporters` in the API and MCP shapes is the count the open-data files call `installs`; the API page names the routes
  its own pages fetch (/api/map/pins, /api/suggest) as outside the OpenAPI contract. The open-data notes say the same.
- Site: profession pages and map pins read files the snapshot cron writes instead of replaying the corpus on each request.
- Site: the tools catalogue supplies the menu, uses Collections and Guild board, and farming no longer asks for a launch notification.
- Site: a database address with an id nothing knows (an item or NPC such as /database/items/999999) answers its 404 with a
  body again: the heading, "No report for this id yet; three installs make it public" with the addon link, and a search box
  prefilled with the id. The site 404 leads with the same search box, prefilled with the last part of the address tried.
- Site: the zones list and the dungeons and raids list take a name in the box and sort from their column headers
  (`/database/zones?q=dur&sort=name`, `/database/instances?sort=-level`), as the NPC list does; the zones are one
  table with a Continent column. The objects list sorts by name first, and an object with no agreed name says
  "no agreed name yet" beside its id. A spell list whose names were not read says so for its build, with no addon
  link. The coverage list and the item lists read the same query and page size as the other lists.
- Site: an Auction House price page for an item with no public name says why under its title: a name shows once
  three installs report the same one, or when the game files and the Warcraft Wiki agree on one. The title stays
  "Item N" and the prices stand. Before, the page gave the id and the prices with no reason.
- Site: the achievement, title, faction and quest chain lists, the farming and profession pages and the scoring method say
  a fact is confirmed by three installs, not three players, as the upload guide has it; the install count is one column,
  "Installs", on every table (it was "Install IDs" on objects and drops and "Reporters" on NPCs, items and vendors); and
  the coverage, instance and item pages count "n of 3 installs" from the meter's own labels instead of a written 3.
- Site: an addon page typed in the wrong case, and the four retired tool addresses (/tools/database, /tools/completionist,
  /tools/guild-tracker, /tools/profession-planner), answer a permanent 308 like every other moved address on the site.
  Before, they answered a temporary 307, so a crawler kept asking for the old address.
- Site: Shared breadcrumbs cover the missing pages, professions and utility forms.
- Site: a faction page says whether the faction is a header of the reputation pane (Yes or No) and names its parent
  faction from the game files, with the id shown once; a header with no standing of its own is noindex and out of the
  sitemap. Faction, achievement and instance pages take the item pages' title, "Ironforge – WoW Forever faction".
- Site: a spell page's tab reads "Spell 1 · Everloot" once; its title went around the shared page metadata, so the
  layout added the brand a second time, and it had no Open Graph or Twitter card. The title check now covers the route.
- Site: a named spell page is titled "Blizzard – WoW Forever spell" with a description that names it, and its Creates,
  Costs and Taught by sections no longer say "Get the addon" or show the agreement meter: those relations are the game
  files' own, so an empty one is left out and a spell the files relate to nothing gets one line naming the build read.
- Site: an Auction House item page and the MCP `auction_history` tool read the daily prices from a file the snapshot
  cron writes, instead of replaying the whole corpus on each request. The values are the same; with no file yet (the
  first minutes after a deploy) they read the corpus as before, and with neither readable they still say unrecorded.
- Site: every public database list and detail page (NPCs, quests, objects, vendors, spells, achievements, titles, factions,
  quest chains, drops, coverage), the census and the rankings are kept at the CDN for five minutes like the profession pages,
  and the database index, zones and instances come down from an hour to the same five minutes, so a page drawn while
  storage was unreachable is replaced within minutes. Items and the map keep their hour.
- Web: the accessibility page describes the motion the site has, Glint included, instead of only 150 ms fades, and the
- Site: the accessibility page describes the motion the site has, Glint included, instead of only 150 ms fades, and the
  accessibility, terms, privacy and rankings dates use the site's one date format (November 4, 2026).
- Site: an addon page, title and download links exist only for an addon the owner approved (the curated source map or the
  ecosystem registry). Before, any addon three installs reported got a page, and its title came from the uploads. The
  usage board at /addons/popular still counts what players run, and links only the approved ones.
- Site: the public-page cache keeps its pages across a deploy that changes nothing they show. Its versions are computed
  from the build itself (the rendering source, the dependencies, the files a page names under `_next/static`, the
  Worker's switches) and ship inside the Worker bundle; an API-only or test-only change keeps the cache, and a changed
  script, style or page starts a new one. A name repeated in the query keeps its order in the cache key, and the
  sign-in, sign-up, password-reset, `/me` and auth routes are never read from or stored in it.
- Site and MCP: chat search reads a misspelled place or word as its common spelling and says so: "does thunderbluff have
  a zeppeling?" is read as "thunder bluff" and "zeppelin" and finds The Zephyr instead of unrelated lore. Names from the
  game files are never respelled. "learn mining in orgrimmar" finds the trainer, "what dungeon at level 30" lists the
  dungeons near that level from the map entrances, a page named in the question opens with its first sentence, and
  flight masters show only when the question is about flying or that place. Spanish price questions ("cuánto cuesta
  linen cloth") go to the price lookup, and the chat no longer opens with the archive note meant for AI clients.
- CurseForge: an Alpha release uploads as a CurseForge Beta, named "Everloot <version> Beta". CurseForge's Files tab hides
  alpha files unless a visitor ticks "Show alpha files", so with every file an Alpha it read "No Results". GitHub still marks
  the release a pre-release, and the site still calls the addon an Alpha.
- Site: a realm whose name ends in RP-PvP written as one word ("CAMWOW US1 Realm 9 RPPVP", as players copied Forever's
  realm list) is filed under RP-PvP on the Auction House instead of "Realms not mapped yet".
- Site: the separator between the facts under an Auction House title reads "·", not "Â·".
- Site and MCP: recipe skill ranges agree on the recipe id the trade-skill window reports, not the recipe's name, so an
  install on a Spanish client ("Peletería") counts toward the same range as English ones. A recipe the game files list
  is published under the files' English profession name, with the recipe name and reagents English clients showed.
- Site: search finds dungeons and raids by name, with or without the leading "The", and an exact name puts the instance page
  first: "deadmines" now opens with `/database/instances/36-deadmines`. The group of wiki pages is headed Wiki, not Guides,
  so it no longer reads as the reviewed class guides at `/guides`.
- Site: the Auction House tab reads "All houses", not "Allhouses"; an instance's difficulties from the game files name each
  difficulty once (the Deadmines: "Normal, Infinite", not "Normal, Normal, Infinite"); the map's Zones row shows a small map
  mark instead of an empty square that looked like a second checkbox. The talent copy says addon 0.3.13 and later load the
  spend order from a link, and the "live-client verification is pending" note comes from one flag.
- Site: an instance page whose bosses no install has confirmed lists them by name with the unconfirmed marker, not four
  columns of [?]; on a phone the bosses table fits the screen. The entrance the game files give is labelled as such. On
  `/wow-forever` the race and class tables use the page's full width, so they no longer scroll on a laptop screen.
- Site: search finds Everloot's own published guides (the dungeon and raid pages) by title, with or without the leading
  "The", in a Guides group above the lore archive. Before, "Deadmines" found a cleaver and archive pages but not the guide.
- Site: `/ask` sends the visitor to the chat at `/chat` instead of a 404; the addon's command and the header both say Ask.
- Site: the talent calculator no longer asks for the account's saved builds when no one is signed in, so a signed-out
  visit leaves no 401 in the browser console. Save still offers sign-in as before.
- Addon and companion: when `/ask` cannot be answered (the companion offline, no model set up), the reason is shown once and
  the question stays queued, so the retry's answer still reaches the game. Before, the question was dropped and a later answer never
  appeared. After each `/reload` the addon says how many questions are still waiting. Needs the next addon and Desktop App
  releases; each half is harmless without the other.
- Companion: when two account folders carry the same install id (a copied WTF folder), upload history is kept whole, as the
  Desktop App already does. Before, each account's upload trimmed the other's, and the next run sent those events again.
- Site: without a key, `/api/tools/{tool}` (what the site's chat calls for each answer) counts against the MCP server's
  200 requests an hour per address instead of the bulk endpoints' 30, so a signed-out chat no longer runs out after a
  dozen questions. A key is counted as before.
- Site: `/addon` links the CurseForge project beside the zip download ("Get it on CurseForge"), counted as an
  `addon_download` to CurseForge like the other download links. The same tested zip is uploaded there on each release.
- Site: a saved build's short link (`/b/<slug>`) reads the store once per visit, for the page and its metadata together,
  instead of twice. The short "Storage unreachable" notice on the collections, guild board, gold ledger, census, addon,
  popular addons and profession pages is one shared constant beside the long one.
- Site: `/sitemap.xml` answers 503, uncached, while the instance store or the item names cannot be read, as it already
  did for the world facts and the census, instead of a sitemap without the dungeon pages and item categories that the
  CDN kept for an hour.

- Site: /addons and the addon tracker's Rising board count a star change over the same window, the 7 days before
  the newest daily count, and print it the same way ("+21 since 2026-10-28"); before, one counted from the snapshot
  and the other from the clock, so they disagreed. Both pages say when the GitHub facts are older than 26 hours.
- Site: auction prices no longer blend auction houses. Every scan now counts for its own house only (the house it read,
  else its scanner's faction), and the Auction House pages, the item box, `market_value` and the chat show each house's
  price apart and name it; "All houses" lists every house's rows side by side. `/api/market/prices` without `house`
  answers only from scans that recorded no house. Days folded before this change still mix houses until they age out.
- Site: the local gold ledger keeps two characters with the same name and realm from different installs apart.
- Addon: tooltips, `/everloot price` and crafting costs read the community price of your character's own auction house,
  or the open auctioneer's, and say which. An older price file keyed by realm alone is not read, since its values may mix
  both factions; the tooltip and `/everloot price` say so, also beside your own scan. Your own scans are kept per realm
  and house; an older scan that did not record its house says so. Update the addon and the Desktop App together, then
  `/reload`: the 0.3.22 addon release or earlier shows no community prices from the new price file.
- Desktop App: the price file is fetched and written per auction house, and the Market page lists each realm's houses
  apart. The Characters page keeps two characters with the same name and realm apart.
- Site: the home page banner no longer makes the page a few pixels wider than the window on a computer with a
  scrollbar, so the page has nothing to scroll sideways at any width.

### Changed
- Site: hover cards on item, NPC, quest and object links open faster. The card's frame shows at once with the name
  and quality colour the link already has, then fills in; a card you hovered before opens whole with no wait; and the
  site keeps each card ready for every visitor instead of working it out again on each hover. A card that could not be
  read whole while storage is down is never kept, and hovering the link again a few seconds later asks for it again.
- Docs: the launch-day page is marked historical, and day-to-day operation of the site is in docs/OPERATIONS.md.
- Site: pages no longer jump when the footer arrives while a page is still loading, the Auction House table scrolls inside its own frame on a tablet instead of pushing the page sideways, the header's keyboard focus rings are no longer cut off at the top of the window, quick facts are one column on a phone, item, NPC, quest and spell pages keep an even gap above their auction and relation sections, the unavailable page arrows are readable, and the Auction House line under the title has spaces around its dot.
- Protocol: `itemsResponse.items` is typed with the row `GET /api/items` returns (item id, then class, subclass, slot
  and quality, each null when the build does not name it), so a client generated from `schema/api/itemsResponse.json`
  gets fields instead of `any`. Protocol package 2.0.0 (the row's fields are now required); the answers do not change.
- Site: item icons have quality-coloured borders, and an item without its own icon shows the game's question mark from the
  same asset files (no icon without them); an item page's name uses the quality colour token of the theme, and a shared
  item card colours the name only when one is shown;
  empty tabs say when 3 installs must agree; the tooltip embed's icon border takes the quality colour, and the tooltip docs
  list the class and quality colours for both themes; the SVG and Apple touch icons are linked.
- Docs: the docs index lists the backlog, the open-data export, the live-client probes, and the dated notes and folders it had left out.
- Site: item tooltips read like the game's: the item level first and in yellow, slot and armour or weapon type in two
  columns, damage left and speed right, Equip, Use and Chance on hit lines in green, a named set and the flavour text in
  yellow, and the sell price as gold, silver and copper coins. Every line keeps its words, so no colour is the only cue.
- Companion: the command line's `main` takes its uploader, price refresher, file watcher and console as an optional argument,
  with the real ones as defaults, so the watch and prices loop is tested with fakes (upload then prices on each settled
  write, prices alone, a failed refresh that keeps the previous file, upload never writing prices). Nothing it sends changes.
- Site: the item lists, the census, the rankings and the MCP `population` tool read stored files the snapshot cron
  writes, instead of rebuilding from every upload on each new server instance. The census is one snapshot the cron
  extends with only the uploads received since its last run; the item lists' agreed names, public drops, and the items
  players have seen with where they came from are one small file written after each snapshot that added uploads.
  Both show the same values as before. With no file yet (the first minutes after a deploy) the pages read as before.
- Site: private sync is on (`EVERLOOT_PRIVATE_SYNC`). A player can make a key with "Sync my linked characters", turn
  sync on per character and category on /account, see what arrived on a signed-in preview, and show each section on
  the character's public page. The data policy section is in effect and /privacy has the matching item.
- MCP (0.9.1): every tool's annotations carry all four hints (`readOnlyHint: true`, `destructiveHint: false`,
  `idempotentHint: true`, `openWorldHint: false`), in the live tool list and in `/schema/mcp/<tool>.json`, so a directory
  that scores unannotated tools as destructive and open-world has nothing to assume. Lore hits open and guild boards close by
  saying their names and excerpts are quoted source text, not instructions, as Blizzard's posts already did, and the
  server's instructions tell every client the same and that no tool writes. `server.json` (and its copy at
  `/.well-known/mcp/server-card.json`) now carries the listing icons and the `kb` subfolder for the registry.
- Site: a character's page reads as one page. Its parts come in a fixed order, each with its own source line: the
  owner's showcase, what the addon last saw, the guild it was seen in (the guild's own page: its size, its agreed raid
  progress, labelled as the guild's and not the character's attendance, and up to eight other characters seen in it),
  then links to the class's pages at the character's level. A rail lists the parts and the date of each source. The
  sighting names the faction its race plays on (none for Skyborne). When the guild's officers published a board, the
  guild part also shows that character's rank, the loot they gave it and whether it was at their last raid
  (`EVERLOOT_CHARACTER_GUILD_FACTS`); the privacy policy, the privacy guide and the data policy say so.
- Site: the drop rates API (`/api/rollups/drops`) gives each rate `sourceName` once 3 installs agree on the NPC's or
  object's name, so the Desktop App's price file can name sources a player never met.
- Site: the Auction House files a realm under the PvE, PvP, RP, RP-PvP or Hardcore tab when its name ends in that
  ruleset, as Forever's realm list names them ("CAMWOW US1 Realm 4 PvP"); the realm map still overrides, and a realm
  whose name names no ruleset stays under "Realms not mapped yet". Realm names show split the same way: the name, then
  its ruleset in that ruleset's colour, in the realm column, the realm menu, a realm's page title and an item's
  Auction House box. The Normal tab reads PvE.
- Site: `/sign-in` and `/sign-up` are one centred card under Glint and the home art: the Battle.net button, a row of provider
  tiles (Google, GitHub, Discord, Twitch; Microsoft keeps its text button, as its guidelines ask), then email, then the links.
  GitHub joins the social providers behind `EVERLOOT_AUTH_V2` (`GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`).
- MCP: answers no longer end with the licence line ("Licence: CC BY-SA 4.0. Credit: Everloot contributors, …"). An
  answer built on player data ends with the data's age, after the `More:` line that links its everloot.app page, and the
  server's instructions ask the client to show that link: the link is the credit. `answer_sources` names each page once
  (the bosses of one instance share its page) and drops its closing credit sentence. The licence and credit line still
  travel in every response's `X-Everloot-Licence` and `X-Everloot-Credit` headers and in the methodology resource.
  Protocol: `TOOL_OUTPUT.lastLine` (`DATA_AGE`) replaces `endsWith`; `MCP_CREDIT` stays exported.
- Site and Desktop App: Ollama suggests one small model, `qwen3:4b` (2.5 GB, calls tools), instead of `qwen3:8b`, and
  says what running a model on your own computer means: private and free, slower, and it uses your memory while it
  answers. The free cloud models stay the first choice.
- Knowledge base: `entities.name_norm` stores each name's words as the search re-rank reads them, with an index on
  `(name_norm, kind)`. The exact-name lookup reads it instead of scanning every row through `lower(replace(...))`,
  and now matches non-ASCII capitals and punctuation the SQL expression missed. A punctuated name with stopwords
  ("Rise of the Lich-King") is found when asked with all its words. Releases built before the column still open and
  search through the old expression; the speedup reaches the site with the next knowledge release.
- Site and MCP: the public page tools count only reports after a recheck scope's date, as the coverage score and
  the site's pages already did. `ToolOptions.recheck` carries the curated scopes into every page tool, the object
  pages cut their loot windows, names and pins the same way, relation edges settle their drop, vendor, quest and zone
  facts on the same cut-off, world-map-near drops stale entrance confirmations, and answer_sources stops citing a
  scoped-out NPC name. The site's relation edges read the same scopes as the MCP tool, so both answer with the same
  edges. The facts memo keys on the scopes so a scoped and an unscoped read never share facts. The standalone MCP
  server has no curated file and stays unscoped.
- Site and knowledge base: the settled list leaves out about 2% of settled facts each ISO week (the spot check), so
  the desktop app re-sends them and a hotfix that never changed a build still reaches the corpus. A loot source under
  a recheck scope counts only its windows after the scope's date and settles again, instead of staying out until the
  scope is removed. The cron rewrites the list once per ISO week even when no uploads arrive, so the spot check keeps
  rotating across an idle week; the heartbeat keeps the week it last wrote, and a failed rewrite is retried next run.
- Site: an upload whose R2 PUT rejects on the network logs `R2 put failed` and the error, like a refused PUT,
  rather than the generic `store failed`, so the half behind a 503 is named in the log.
- Site: the snapshot cron stops rewriting the whole corpus when nothing arrived. One query asks whether an
  upload is newer than the snapshot; if not, the snapshot and the completion rollup are skipped, the market fold
  runs only when the UTC day changed, and `/api/health` reads the last successful run from a heartbeat instead
  of the corpus's age. An idle week no longer reads as an outage, and the cron does no work for nothing.
- Site: the item pages and the hover card say the item's set, its restrictions, its class and race
  requirements, the skill it needs and its Use, Equip and Chance-on-hit lines, read from the game files. A
  value the files do not carry reads `[?]` and says which table the game uses and the extract does not: the
  stat amounts and the armour, which the game works out from tables we do not read, and the weapon damage,
  which it works out from its weapon damage tables, the weapon speed and its own rounding. The numbers are
  checked against the game's own tooltip before any range is printed.
- Site: the sitemap is back. It had answered 500 since the wiki landed, because the build traced the wiki's
  pages into the `/wiki` routes only, and the sitemap reads them on every request. The site had no sitemap for
  two days; a build now fails for any route that reads the wiki without carrying it.
- Site: records in `/api/corpus/public` and the bulk `corpus.ndjson` carry a per-install pseudonym (`pub-` and 32
  hex, a keyed hash) in place of the install id, so they pass the protocol's parser again and anyone can count
  installs. The addon's install id still never leaves. Protocol package 1.13.0, description only.
- Site and knowledge base: game objects show the name three installs agree on, on the object page, the objects
  and drops lists, hover cards, search and the item pages that list them as a source, and in the `object_page`
  answer. Until three agree, they still read Object and the id.
- Site: every item, quest, item set and spell the game files or the Warcraft Wiki name is named on its page,
  with no id range and no placeholder filter. A name from the game files alone carries the unconfirmed marker;
  a name from the wiki says so in its tooltip. Items no source names still read "Item N" until players name them.
- Site: the player pages are live. A player page shows what the addon last saw of a character — race, class,
  level, guild and the day — found by the start of the name, and every page carries a hide link and a hide
  form. The search index stays off for now, so the pages are reached by name and are not listed anywhere.
- Site: character links and public character pages are on (`EVERLOOT_CHARACTER_LINKS`, `EVERLOOT_SHOWCASE`). On
  /account a player links their own characters with a code typed in game, unlinks them, and can give each one a
  public page at `/characters/<ruleset>/<realm>/<name>` with its name, level, race, class, faction and realm and two
  share images. A new link is private, every page is noindex, and the hide form takes a page down without an
  account. A character two accounts link stays frozen until it is settled: write to hello@everloot.app, we reply
  within 7 days. The data policy, /privacy and the account page say so.
- Docs: OPEN_DATA.md and RELEASING.md no longer say the open data export sits in the roadmap's Next section; they point to ROADMAP.md.
- Docs: each gap in DATA_PLACEMENT.md carries a dated state, and the WAF row now describes the Cloudflare rules that apply on /database/*.
- Docs: CONTRIBUTING.md and the pull request template describe the changelog line, the labels in use and the addon install link.
- Site: zone and instance pages open with the same title row as the other database pages (name, type line, quiet controls at its end), and the instance and spell-talent facts use the same label-and-value list.
- Site: the web-font swap no longer moves the page. Geist and Geist Mono now fall back to Arial and Courier New resized per weight to Geist's widths (the Arial fallback was 4% too wide at regular), and a screen of height is reserved only while the database hub streams, so a 404 or an empty result keeps its footer in view.
- MCP: clarify tool choice, name and id discovery, realm aliases, evidence limits and price methods, with three example journeys.
- MCP: the `coverage` tool answers from the stored coverage report the snapshot cron writes for the build, the same
  one the home page counts, so both show the same installs and facts and no answer replays the corpus. Only when
  that report is missing, for another build, or not confirmed by storage in the last five minutes (a failed refresh
  no longer keeps it) does it compute the score live; the answer's date line says which.

## [desktop-v0.1.21] - 2026-11-10

The Characters page's week matches the Gold tab, and the price file reader accepts the optional `sources` block
addon 0.3.22 can show (the app does not write it yet). Builds are still unsigned.

### Added
- The EverlootPrices slot file can carry a `sources` block after the drops (public vendor NPC ids and a
  reagent-of count per item, checksummed like the drops, with the vendors' names outside the checksum). The block is
  optional: a file without it is read as before. The Desktop App does not write it yet.

### Fixed
- The Characters page reads the addon's local ledger (`EverlootDB.ledger`) from the save file beside the
  `money_event` rows, so its 7-day net is the Gold tab's "7 days" for the same character (today and the six UTC days
  before it) and repairs, vendor purchases, trades and mail appear in money by category, marked local only. Uploaded
  rows count only from before the ledger's first event, as the Gold tab reads them. Nothing recorded or uploaded changes.

## [0.3.22] - 2026-11-10

Release channel: Alpha

The Everloot window is rebuilt around Home, Gold, Collection, Professions and Settings, with a gold ledger that
stays on your computer. Tooltips can say who sells an item, what it is a reagent for and where it drops. The census
also counts players the game shows a nameplate for (race, class, level and faction only). The tooltip lines come
from this install's own sightings; public vendors and reagent counts show once a Desktop App writes them into the
price file, which none does yet. Not yet seen in the Forever client: the window, the ledger's mailbox, repair, trade and mail reads, and the nameplate census pass the
addon's tests only.

### Added
- Item tooltips and `/everloot price` end with up to three muted lines from this install's own rows: "Sold by
  <NPC> (your sighting)" from the vendor windows it opened, "Reagent for n recipes you know" from its recipe colours,
  and "Seen in <zone>" for a drop source it met. Without own rows the price file's public vendors and reagent count
  show instead, when the file carries them. Display only; nothing recorded or uploaded changes.
- The Gold tab's Overview chart follows the period buttons (today, 7 days, 30 days, or all for the ledger's
  90 days), one bar a day; Sales shows the auction house's cut beside each sale's deposit, and the by-item rows show
  sales per day over the period and the last sold day. Display only; nothing recorded or uploaded changes.
- Each Professions block lists the next recipes a trainer teaches at or above the current rank (up to three,
  lowest rank first) with the cost and the trainer's name, from the trainer rows the install already has, or says to
  open a trainer's window; under the blocks, "Other characters" lists every other character's professions and ranks
  from the local roster. Display only: nothing recorded or uploaded changes.
- The Everloot window's sidebar is now Home, Gold, Collection, Professions and Settings. Ask, Build plan and
  Auctions left the sidebar; `/ask` and `/everloot plan` still work.
- Home lists every character this install has seen (gold, level, professions, raid lockouts, last seen) with
  realm and account totals and a "This week" line. "What you've added" moved to the Settings page.
- Home says what this character is missing, under the portrait: achievements left, factions not exalted, titles
  not held, professions with no recipe read and this week's raids with bosses left, counted from the rows Collection
  and Professions already show; each line opens that tab. With the completion tracker off the strip says so and offers
  Collection's Turn on button. The gold box adds "Account this week: +in / -out" over every character under this
  character's own week line.
- The Gold tab has Overview (gold by character and realm, the last 30 days as bars), Ledger (by category, day or
  receipt), Sales and Session. It reads a new local ledger, `EverlootDB.ledger` (5,000 events or 90 days, 2,000 sales,
  400 daily closes per character), and a local roster, `EverlootDB.roster` (options row "Your characters"). Neither is uploaded.
- Each auction sale is recorded by item from the mailbox invoice (item name, count, price after the cut,
  deposit) when you collect the letter. The buyer's name is not read.
- Sales lists a sale as "sold, gold pending" from the moment the game says a buyer was found, and the same row
  turns "paid" when you collect the letter. A letter collected after 48 hours still fills its row.
- The ledger records repairs and vendor purchases at an open merchant (a guild-bank repair costs you nothing and
  is left out), gold traded with another player, gold sent with a letter, and gold in a letter from one of your own
  characters. With the account selected, gold moved between your own characters leaves the totals and shows on its own
  line, "Moved between your characters". These categories stay in the local ledger and are not uploaded.
- The Gold tab's Today, 7 days and 30 days start at UTC midnight, so the first day is a whole day.
- Collection tab for achievements, reputation, titles and raid lockouts (needs the completion tracker on) and a
  Professions tab with each profession's rank and recorded recipe colours.
- Player names stay off by default, and the addon now asks once, in game, whether to turn them on. The question
  comes a few seconds after the first loading screen, never in combat, and says what is recorded (name, realm, race,
  class, level and guild of your characters and of players you target, mouse over or group with), how to turn it off
  (`/everloot players off`) and where to hide a character (everloot.app/players/opt-out). After an answer, or a choice
  made with `/everloot players on|off` or the settings page, it is never asked again.
- The census also counts players the game shows a nameplate for, at most 10 new ones a second: still race, class,
  level and faction only, never names. The players module still never reads nameplates.
- With the completion tracker on, the addon keeps each of your characters' professions (rank of max rank) and this
  week's raid lockouts, latest state only, for Home and the Desktop App's Characters page. They stay on your computer.
- A linked character's active talent build is kept as a local row the Desktop App can sync to its page; the
  anonymous talent snapshot is never synced. `/everloot completion off` deletes it.

### Fixed
- The in-game help line, the README's command table and the site's addon guide list the same commands, with
  `version`, `planner`, `gph hide`, `gph cut on|off`, `plan hide|clear`, `window`, `vendor`, `mail`, `link` and
  `plan <number>` where one list had left them out; the guide says a left-click on the minimap button opens the window;
  the README's file tree names every module; and a contract test fails when the three lists drift.
- A loading screen inside the minute after the last gold snapshot writes no new row unless the balance changed;
  the last snapshot's time is kept in the saved file, so a /reload no longer adds a row each.
- The button drawer leaves the minimap buttons to MinimapButtonButton when that addon is loaded, and to any
  addon that takes a button after Everloot did. Before, both gathered the same buttons and hovering the crest opened
  an empty Everloot panel over the other addon's, which dimmed every icon under it. The drawer's cells also leave
  room for a LibDBIcon ring, each button draws above the one before it, and the panel is the window's own canvas and
  bronze edge with a thin bar in the window's green down the side that faces the crest.
- The PvP row keeps a character's last honorable kill count when a read comes before the Statistics tab has
  loaded, and skips a statistic the game flags to skip. A talent choice past the site's range is left off that node
  instead of failing the whole talent row on sync.
- An item's name and quality are recorded once, not again in every loot window and on every vendor that sells
  it, and a vendor is recorded once per UTC day unless an item, a price or a limited stock changed. Before, about ten
  vendor visits filled the 2,000-row cap for item names and every new name after that was lost.
- The Everloot price block shows once per hover. Comparing an item opens the game's comparison tooltips beside
  the main one, and each of them carried the block too, so one hover read it up to three times.
- A guild roster snapshot is stored at most once every six hours, and not when the roster reads the same as
  the last one; a raid lockout is stored once until a boss goes down or the week resets, and an expired one not at
  all; attendance is stored once per set of people in a raid run. Before, every guildmate's login or logout stored a
  whole snapshot (about 50 KB for a 500-member guild) and every loading screen stored the lockouts again.
- A partial price sample (the search-based fallback when a full scan cannot run) keeps only the newest earlier
  sample of that realm before it stores, so two samples no longer fill the 2,000-row `auction_scan` cap and later samples no
  longer report "stored 0". Another realm's rows stay.

## [desktop-v0.1.20] - 2026-11-06

### Added
- Private sync now sends three more parts of a linked character: the active talent build, the character sheet's stats
  (attributes, attack power, hit, crit, haste, expertise, spell power, healing, armor, defense, dodge, parry, block) and
  PvP standing (rank, rank points, top rank, season, lifetime honorable kills). They come from the addon's next
  release, which records them with the completion tracker on. As before, only characters you linked are sent, and
  everloot.app keeps only the categories you switched on for that character on /account.

### Changed
- The Characters page no longer says professions and raid lockouts stay on your computer. They never go in an upload,
  and private sync sends them only for a character you linked.

## [0.3.21] - 2026-11-06

Release channel: Alpha

Drop rows name their source even when you never met it, with the names the site knows. Needs Desktop App 0.1.18 or
later to write the names into the price file. Not yet seen in the Forever client.

### Changed
- A tooltip's drop row names its source from the price file when you never met it: "Drops from Battered Chest" instead
  of "Drops from object 106318", and `/everloot price` says "Battered Chest (object 106318)". A name your own client
  showed still comes first, and a source the site has no name for keeps its id.

## [desktop-v0.1.19] - 2026-11-06

### Added
- Private sync of your linked characters. Signed in with a key made with "Sync my linked characters" on everloot.app,
  the app sends the characters you linked from this save file after each upload: the newest gear, professions,
  reputations, raid lockouts, and achievements and titles. The site keeps a category only when you turned its sync on
  for that character on /account. A capture the site has kept is not sent again; a changed one is, and so is one for a
  category whose sync is off or a character not linked yet, so turning sync on later still fills it in. Talent builds
  are not sent yet: the addon's talent rows do not say which character they belong to. A key without that permission
  gets one line saying which key to make.
- The Characters page shows each character's professions and this week's raid lockouts once the addon records them
  (the next addon release). They stay on your computer: no upload sends them.

## [desktop-v0.1.18] - 2026-11-06

### Changed
- The app keeps the Everloot addon up to date on its own: a newer release installs into a game folder that already has
  the addon, checked against the release's checksums, and the app says so once: "Everloot addon updated to X. Type
  /reload in game." Settings → Game has the switch, "Keep the addon up to date", on by default. With it off, or when
  an install fails, the tray's tooltip and menu show "Addon X available", which opens the Addon page. Before, the only
  sign was one silent notification per version, easy to miss while the game is full screen.
- The price file names the drop sources the site knows, beside the drop rates, so addon 0.3.21 and later can name a
  source you never met ("Drops from Battered Chest" instead of "Drops from object 106318").

### Fixed
- On macOS the app no longer logs "Unable to set login item" on every start. Start-up registers a login item only when
  "Start when I sign in" is on; Settings still applies the switch either way.
- The game-folder hint on the first-run screen shows a macOS or Linux path on those systems, not a Windows one.

## [0.3.20] - 2026-11-06

Release channel: Alpha

RP-PvP realms whose name ends in one word, "RPPVP", get their ruleset in the tooltip header. Not yet seen in the
Forever client.

### Fixed
- On a realm whose name ends in RP-PvP written as one word ("CAMWOW US1 Realm 9 RPPVP", as players copied Forever's
  realm list), the tooltip header splits RP-PvP off in its own colour, as it does for the other rulesets.

## [0.3.19] - 2026-11-05

Release channel: Alpha

Drop rows in item tooltips name the creature or object they come from, when you have met it. Not yet seen in the
Forever client.

### Changed
- A tooltip's drop rows name the sources you have met, as your client showed them: "Drops from Defias Bandit"
  instead of "Drops from NPC 116", and `/everloot price` says "Defias Bandit (NPC 116)". The names come from your own
  NPC and object sightings and what you looted, already in the saved file; nothing new is written. A source you never met
  keeps its id.

## [0.3.18] - 2026-11-05

Release channel: Alpha

Item tooltips read like the game's own: each price on its own row with gold, silver and copper icons, your realm and
its ruleset in the header, and drop rates beside their sources. The minimap button gathers other addons' buttons.
None of this has been seen in the Forever client yet.

### Changed
- Item tooltip prices are two-column rows, the label on the left and the amount on the right in the game's
  gold, silver and copper icons (Market value, Min buyout, Historical, your scan's min buyout and value, and the
  vendor sell price when the client knows it), with dates, units, reporters and warnings on muted lines beneath. The
  Everloot header names the realm with its ruleset (PvP, PvE, RP, RP-PvP, Hardcore) split off in its own colour, and
  says once that amounts are per unit. Drop rates sit in the value column too, their loot windows and installs beneath;
  the note for what is missing drops its own "Everloot:". The Auction House tab's lookup shows the same rows in a
  scrolling result, and Home, Options and the Auction House tab share one native style. `/everloot price` prints the
  same amounts as plain text.

### Added
- The Everloot minimap button gathers other addons' minimap buttons. Hover the crest to see them in a small
  panel; its clicks work as before, and Blizzard's own buttons stay where they are. It is on by default and covers
  buttons made with LibDBIcon, which most addons use. `/everloot buttons off`, or the switch in the settings, puts
  them back after a `/reload`.

## [0.3.17] - 2026-11-05

Release channel: Alpha

Fixes from the first night of WoW: Forever. Quests, vendors and recipes now reach everloot.app from the live client,
and the minimap button wears the Everloot crest. Quest and vendor capture follows the build's own API documentation and
merchant window; it still needs to be seen working in game.

### Fixed
- Quests you accept and vendors you open are recorded again. On launch night no install sent a single quest or vendor:
  Forever's client uses the modern quest log and merchant calls, and the addon now reads them.
- Recipe collection no longer stops within hours. Every install paused it at its 2,000-row limit on night one, filled
  almost entirely with recipes the player had not learned, which the site does not use. Only learned recipes are kept
  now, and only the ranks that narrow a skill range. On first load the addon drops the unused rows and starts again.
- The minimap button and the in-game addon list show the Everloot crest instead of stock game icons.

## [0.3.16] - 2026-11-05

Release channel: Alpha

Layout fixes for the Options and auction-house panels reported from the live Forever client.
The corrected layout still needs in-game verification; automated UI contracts do not verify the game renderer.

### Fixed
- Settings scroll within the Options panel, keep Reload reachable, and fit the Ask controls inside the panel.
  Wrapped descriptions retain enough space at smaller panel sizes.
- The auction scan prompt fits its wrapped explanation and button; the backup scan action sits below the
  auction window instead of overlapping Search. Scan cooldowns and click-only behavior are unchanged.

## [0.3.15] - 2026-11-01

Release channel: Alpha

Live-client verification is pending. This is a pre-release for WoW: Forever 1.60.1, not a verified stable build.
None of the changes below has been run in the Forever client yet: the one-line login message, the price-file hint,
the `/ask` no-answer message, `/everloot link`, the fuller recipe read and the auction fallback sample still need
an in-game check. The 0.3.14 Home window and the collection checks listed there also remain unverified.

### Added
- `/everloot link <code>` and `/everloot link clear`, for tying the character you are playing to your everloot.app
  account. Linking is not open yet: everloot.app does not hand out link codes, so there is no code to type for now.
  The command itself is in place. A code in the right shape (like `EL-7K3Q-9P`) saves your own character's name,
  realm, race, class, level and faction in your Everloot file and asks you to `/reload`; a code in the wrong shape
  is refused. Nothing is sent from the game. `/everloot link` on its own explains the command and how many link rows
  your file holds, and `/everloot link clear` deletes them all. At most 10 are kept.

### Changed
- Logging in or `/reload` prints one line instead of the full status: the version, how many modules are on and off,
  any that could not start and any collection paused at capacity. `/everloot status` still shows everything.
- `/ask` messages name the Everloot Desktop App (with Ask turned on) instead of the companion.
- Raid buff data now comes from the game files of build 1.60.1.70707.

### Fixed
- Without the Desktop App's price file, item tooltips showed only your own scans and never said why. The first
  tooltip now says once per install, in chat, that community prices come from the Everloot Desktop App, and that
  `/everloot price [item]` shows what Everloot has for an item.
- A question asked with `/ask` that still has no answer two loads later now says so once, and tells you to open the
  Everloot Desktop App with Ask turned on (from everloot.app/addon) and `/reload`. The question stays saved until answered.
- Recipe recording reads the full recipe list when the game offers it, keeps each recipe's id and whether you have
  learned it, and no longer counts a recipe you have not learned toward your craftable skill ranges. Your
  profession window filters are left as they were. Turning profession collection off also stops a read in progress.
- When an auction scan you start cannot run or times out, Everloot can fall back to a browse search that records
  real listing prices as a partial sample, clearly labelled as such. It respects the auction house's query limit,
  stops when you close the auction house or turn collection off, and never presents the sample as a full scan.

## [0.3.14] - 2026-10-30

Release channel: Alpha

Live-client verification is pending. This is a pre-release for WoW: Forever 1.60.1, not a verified stable build.
The new window's layout, fonts, crest texture and interactions still need an in-game check. Disenchanting,
skinning, pickpocketing, lockboxes, selling greys, repairs and auction-mail collection also remain unverified
in the live client. Optional convenience helpers stay off until enabled.

### Added
- An Everloot Home window, opened from the minimap button or `/everloot window`: your character, gold on hand
  and its peak, recorded money by source, gold per hour with Pause/Resume, professions with skill bars and saved
  record counts. Missing values show a dash. The window is built on first open; a UI error closes it while
  recording continues. The **Everloot window** setting turns it off.
- A dark panel with a bronze game border, game fonts and the Everloot crest. Item tooltips keep their existing
  price and drop lines under one Everloot header. Other sidebar views open existing panels or say coming soon.

### Fixed
- Values the client marks secret (a unit's GUID or name, a position, a chat line) count as missing instead of
  raising an error that stops capture. An uncached item's stand-in name is no longer recorded.
- The minimap contract tests now execute in CI, covering the no-minimap fallback, one button and the ask box.
- A temporary `/ask` failure leaves the question queued for a later answer, shows the failure once and says
  how many questions are still waiting. A missing answer file no longer hides the waiting count.

## [0.3.13] - 2026-10-29

Release channel: Alpha

Live-client verification is pending. This is a pre-release for WoW: Forever 1.60.1, not a verified stable build.

### Added
- `/ask` carries the realm you are on, so a price question such as `/ask price 2589` needs no realm in its words. The
  Desktop App or companion answers it from the recorded market, with no AI provider needed.
- `/ask` also carries your character's class, level and zone, for that answer only: "here" (or "aquí") is looked up as
  your zone and "my class" (or "mi clase") as your class. The question queue never leaves your computer, and your
  class and level are not kept.
- Talent plans keep their spend order. A plan from the site or the Desktop App shows the next point only when its
  order is known; an unordered plan lists the talents you can take without inventing a sequence.

### Changed
- Price tooltips say the community price is per unit and blends every auction house on the realm. An item whose
  newest public day is old is marked stale, and a price file the Desktop App or companion has not refreshed for a
  while is flagged separately.
- The raid buff data is stamped with game build 1.60.1.70685.

## [0.3.12] - 2026-10-24

Release channel: Alpha

Live-client verification is pending. This is a pre-release for WoW: Forever 1.60.1, not a verified stable build.

### Added
- While `/everloot players` is on, a boss kill inside a dungeon or raid with your character in a guild writes a
  `guild_kill` row: guild, realm, faction, encounter, instance and time, never a character name. At most 60 a UTC
  day; `/everloot players off` deletes them with the player rows. The players module now also reads
  `UnitFactionGroup` (the guild's faction) and `GetInstanceInfo` (the instance the kill was in), on your own
  character only. The site's guild ladder, built from these rows, stays off until its switch is turned on.
  Design: `docs/design/specs/2026-10-24-guild-board-design.md`.

## [0.3.11] - 2026-10-24

Release channel: Alpha

Live-client verification is pending. This is a pre-release for WoW: Forever 1.60.1, not a verified stable build.

### Added
- A Talents / Raid workspace opened with `/everloot` or the minimap. Build on the website, choose
  **Copy for addon**, then paste into the matching tab and choose **Import**.
- Talent progress, next-point guidance and click-through highlights, with one Everloot window at a time.
- Raid plan imports compare class counts by group beside the current roster's buff check. Plans stay local;
  the addon cannot identify players from a plan or verify their talent choices. No points are spent or players moved.
- Copy imported plans or the current raid back to the website. Right-click the minimap button for settings.

### Fixed
- Mail collection stops retain an unresolved money transfer until its event or timeout clears it. An early
  restart asks for another click rather than automatically taking the same pending money again.
- Planner links handle saved builds, second-set-only links and differing game builds; damaged imports keep
  the last valid plan. Workspace preference survives reloads without opening a second guide panel.

## [0.3.10] - 2026-10-23

### Added
- Addon, protocol and site: item numbers players see. When the game shows an item's tooltip, the addon records
  its armor, block, damage per second, stats and resistances for the plain item, with the client build (record
  kind `item_fact`, protocol package 1.15.0, record protocol 1.8.0). The item page, the site's hover card and the
  embeddable card show a number in place of its `[?]` once three installs on the newest build agree, with the
  installs, the build and when it was last seen; a line installs disagree on stays `[?]` and says so. MCP tools
  are unchanged. Not yet run in the Forever client.
- Addon and desktop app: item tooltips show where an item drops. The Desktop App writes the public drop rates
  (three installs looted the source) into the `EverlootPrices` file beside the prices, at most once a day; the
  tooltip and `/everloot price` show up to three sources as drops of loot windows, with installs and the upload
  date. With the file in the game, a missing price or drop source is said in one grey line. Nothing new is
  written to SavedVariables. Design: `docs/design/specs/2026-10-21-addon-value-loop-design.md`.
- Places for the world map. When an NPC's window opens (merchant, gossip, quest, trainer, flight map, bank,
  auction house, stable, innkeeper) the addon records where you stand as that NPC's place, with the service the
  window offered, once per NPC, service and zone. When you loot a herb, ore vein, chest or other object, its loot
  row gets where you stand, how you opened it (from the spell you cast) and the object's name. Trainer rows name
  the trainer. Event names and spell arguments not yet seen on the Forever client are read defensively: a missing
  one records nothing. Launch-day checks: `docs/2026-10-21-addon-0.3.10-launch-checklist.md`.

### Changed
- Targeting or mousing over the same NPC at the same spot (to 1 unit on the map's 0 to 100 scale) records it
  once, not every time. NPC window rows and object loot rows have their own 2,000-row room, apart from
  targeting rows and creature loot, so a full targeting or corpse share pauses only itself.
- An object's name comes only from a herb, ore or chest cast, never from another spell's target (such as a
  player you healed). A fishing cast counts for 30 seconds, for a slow bite.
- The raid buff list (`/everloot raid`) is read from the game files of build 1.60.1.70532.

## [0.3.9] - 2026-10-21

### Added
- A button at the top-left of the minimap, the way every other addon in the game is found. It opens
  Everloot's panel, so nothing needs a command typed any more.
- A box at the top of that panel to ask Everloot a question. The question goes into your file, the
  companion answers it with its sources, and `/reload` prints the answer in the chat, exactly as
  `/ask <question>` does.

## [0.3.8] - 2026-10-21

### Fixed
- The player pages record the players you see again. The module asked the client for a name and a realm
  and skipped anyone whose realm was not empty; the beta client answers every unit with its server, so
  every player was dropped and no page ever had anything on it. It compares the realm with ours now, and
  only a realm that is not ours is another realm.

## [0.3.7] - 2026-10-20

### Added
- An Everloot settings page in the game: Esc > Options > AddOns > Everloot, or `/everloot options`. One switch
  per module and for the auction scan prompt, each saying what it records and where it goes, and a Reload now
  button. A switch with a `/everloot` command runs it, so turning the census, players, completion or addon
  list off deletes their rows exactly as in chat. Clients without the options API get it as a window.

## [0.3.6] - 2026-10-20

### Added
- An Everloot tab at the auction house, after Blizzard's tabs. It has a Scan this house button with the
  cooldown, says whether the last scan is in your saved file yet, has a Share now button (a `/reload`, so
  the Desktop App can send the scan) and looks up an item's price with the tooltip's lines. Shift-click an
  item into its box. It never posts, bids or buys, and a scan still starts only from your click.

### Changed
- Auction scans are on in a new addon install, which says once at the first auction house what a scan
  reads. An install where scans were turned off keeps them off.

## [0.3.5] - 2026-10-20

### Changed
- The census starts on in a new addon install and says so once in chat; an install from before keeps it
  off until `/everloot census on`. The Desktop App sends census rows with its uploads when the player leaves
  the census box ticked on its setup screen, or turns it on in Settings; a setup finished before this keeps
  it off. Still never names, guilds, gear or places, and the site shows only totals.

## [desktop-v0.1.17] - 2026-11-03

### Added
- Desktop App: Geist and Geist Mono ship with the app, so the type is the same on every computer instead of
  falling back to the system font where Geist was not installed.
- Desktop App: a title bar above the page says where you are and whether the app is watching a save file, or
  paused.
- Desktop App: Upload, Market and Ask carry a word in the sidebar for what they are doing: Working, OK, Failed,
  Waiting, Off or Paused.
- Desktop App: an empty page says why it is empty and what fills it. Characters, Upload, Market, Ask, Log and
  Changes each name the real cause: no game folder chosen, no `Everloot.lua` under the folder yet, the app paused,
  the job off, or a fetch that failed, with a Retry.
- Desktop App: Upload, Market and Ask open with a strip that says what the job is doing now and the last line it
  wrote, with the time.
- Desktop App: the Overview reads as a thread of what the app did, oldest at the top and the newest step
  highlighted, under a one-line status and a four-cell strip for Upload, Market prices, /ask and the addon.
- Desktop App: Characters with no data draws the profile's outline (money river, week, roster) under the reason it
  is empty. With data, the selected character's gold, gear slots and money by category sit on the page; the drawer
  keeps history and sharing.

### Changed
- Desktop App: the look is that of a developer tool: neutral near-black surfaces, hairline rules, a 13 px type scale
  with 14 px prose, tighter rows and controls, and a narrower sidebar. The lime accent and the mark stay. Light mode
  moves to neutral greys too.

## [desktop-v0.1.16] - 2026-11-03

### Changed
- Desktop App: the app is called Everloot in its window, tray, notifications and dialogs. After this update, the Start
  menu, the desktop shortcut and Apps say Everloot too.
- Desktop App: an update has one small round button beside Settings instead of a second bar above it. It opens what
  changed, fills a ring while the update downloads, and turns into a restart button once it is ready. The restart
  dialog carries the Everloot mark.

## [desktop-v0.1.15] - 2026-11-02

### Added
- Desktop App: Settings has a "Data on this computer" section. It shows how much space the app's data folder takes
  and what uses it (backups, update downloads, chat, upload history, settings and keys), says what goes to
  everloot.app and what stays on your computer, and opens the folder. "Delete my local data" asks first, then empties
  the folder, which the command-line tool uses too, and starts the app over on its setup screen. Your game folder and
  `Everloot.lua` are not touched. The Overview tells you once if the folder passes 500 MB.

### Changed
- Desktop App: Restart to update asks in the app's own dialog instead of a Windows message box, and names the job it
  waits for. While an update downloads, the sidebar and the update panel show a progress bar with the percentage.
- Desktop App: your save file is read on a background thread, so logging out on a large save no longer freezes the
  app. The longest pause on a 14 MB test save went from about 300 ms to about 100 ms. If the background reader cannot
  start, the app reads the file as before and says so once on the Log page.
- Desktop App: the Upload page no longer reads each save file four more times after every write (about 1 s on a large
  save). It shows the same counts and errors as before.
- Desktop App: upload history keeps only the events still in each account's `Everloot.lua`, and cached lists not
  refreshed for a week are deleted, so the data folder stops growing the longer you play.

## [desktop-v0.1.14] - 2026-11-02

### Changed
- Desktop App: opening the Overview or the Market page no longer reads every save file again to suggest your
  characters' realms. The suggestions come from the read the app already makes when the file changes (about 165 ms
  to under 1 ms per open on a large test save).
- Desktop App: the Characters page and the chat's lookup of your characters work the same way (about 170 to 2 ms on
  a large test save). The last seven days, the 30-day chart and the latest receipts still count up to the moment you
  open the page.

## [desktop-v0.1.13] - 2026-11-01

### Fixed
- Desktop App and companion: after an upload, the character-link step skips a save file that has no link rows instead
  of parsing it a second time, so a logout is back to two full parses of the save (the heavy synthetic save's longest
  pause drops from about 620 to 380 ms in the quick benchmark).
- Desktop App: the tray menu is replaced only when one of its lines changes, not on every status update (each percent
  of an update download was one), so a menu the player has open is not swapped out under them.

## [desktop-v0.1.12] - 2026-11-01

### Added
- Desktop App: a new app release shows within the hour instead of the next day. The sidebar shows **Update to X**:
  one click downloads it and checks it against the release's checksum, and the next click restarts into it. The
  Overview offers the same, the tray item opens the update panel, and a notification says so once per version while
  the window is not in front. Where the app cannot install itself (macOS, Linux, the portable exe), the button opens
  the download. If the installer runs but the old version is still there at the next start, the app says so once
  instead of offering the same update again unexplained.

### Changed
- Desktop App: the Market page offers to follow your characters' realms (read from the save file on this computer)
  in one click, and the Overview does too while the game has no prices. Nothing is requested for those realms until
  you press Follow; then they are followed realms like any other, and No thanks keeps the offer away. The Overview says
  what `/ask` does and links to the Ask page.
- Desktop App: Settings and the README say that uninstalling keeps the data folder, with the account and model keys,
  chat and save backups in it, that the keys are plain files protected by the user account, and how to remove it all.
- Desktop App: a logout reads each save file once for its realms, scan ages and pending `/ask` questions, instead of
  once for each, which roughly halves the longest pause after a logout with a large save (722 to 391 ms on a 14 MB
  synthetic save, measured with the new `npm run bench`).

## [desktop-v0.1.11] - 2026-11-01

### Fixed
- Desktop App: the Addon page and the update notice offer the newest addon release, an Alpha included, which is
  what the download page serves. They offered 0.3.10, and installing it failed its checksum.
- Desktop App: WoW: Forever's `_forever_` folder is offered first when the app looks for the game. If the app reads
  another client's folder beside it, such as the closed beta, Overview and Settings offer **Use Forever** in one
  click, or **Keep this folder**. The app never switches on its own.
- Desktop App: an upload that ran out of retries tries again when the network comes back, without waiting for the
  next logout. Pause then Resume starts a fresh round of retries.
- Desktop App: the update check reads past GitHub's first page of releases, so a run of addon releases can no longer
  hide the newest app release.
- Desktop App: the installers that earlier in-app updates left in the data folder's `updates/` are deleted at start
  (about 110 MB each).
- Desktop App: "Start when I sign in" works from the portable exe; it registered a temporary folder before.
- Desktop App: Restore refuses while World of Warcraft is running, since the game would overwrite the restored file
  when it logs out. A damaged `settings.json` is moved aside instead of saved over, and Save names a field it
  refused instead of saying "Saved.".

### Added
- Desktop App: the setup screen says when the chosen game folder has no Everloot addon and offers to install it, with
  the same checksum check as the Addon page.

### Security
- Desktop App: the window grants no browser permission except writing to the clipboard, the main process answers
  only the app's own page, and the packaged app cannot be started as plain Node or with Node debugging flags.

## [desktop-v0.1.10] - 2026-10-31

### Fixed
- Desktop App: rechecks the newest release before downloading or restarting to update, so an older
  offer or downloaded installer does not require installing intermediate versions. If the release check
  fails, the app stays open and offers a retry instead of installing the stale version.

## [desktop-v0.1.9] - 2026-10-30

### Fixed
- A failed in-game `/ask` answer is shown once and stays queued. When the retry succeeds, its answer reaches the
  game instead of being dropped. Use addon 0.3.14 or later to keep retrying questions in the game.

## [desktop-v0.1.8] - 2026-10-30

### Added
- In-game `/ask` answers from the same evidence the site's chat uses: Everloot's own facts first, then the game
  files, then the 2023 wiki, each answer with its source and licence. Without an AI provider the answer is the first
  piece of evidence and its page.
- `/ask` follows up on the question before it: "what does he drop" after "where is Edwin VanCleef" (within 30
  minutes) finds VanCleef.
- `/ask` knows who is asking, for that answer only (with addon 0.3.13): "here" (or "aquí") is your zone and "my class"
  (or "mi clase") your class, and a model you set up is told your class, level and zone. Neither class nor level is
  kept.
- Price questions such as `/ask price 2589` are answered from the recorded market, with no AI provider needed; the
  realm you asked from fills in a missing one.
- Chat, Ask and Settings share one Assistant setup: search works with no key, and an optional model is set up in
  place, each provider linking to its own key page.
- A new home screen: a status headline, the app's jobs, recent activity and the latest changes in one place, and
  Settings grouped by what runs, the AI model, the game, startup, census and player pages.
- Talent plans handed to the addon keep their spend order.

### Changed
- A model writing an `/ask` answer names the zone first for "where" and "how do I get to" questions, and prefers
  players' observations and the game files over the 2023 wiki where they disagree.
- Chat without a model answers from the same evidence, and models are told what it gathers.
- Ollama suggests one small model, `qwen3:4b`, and says what running a model on your own computer means.

### Fixed
- Vendor money counts as income, as the addon and the website's ledger count it, so a character's week and
  categories agree with the site.
- Updates and uploads recover better: an addon install that can be recovered is kept, upload progress advances only
  on rows the site accepted, retries and updates are bounded, and installers are written safely.
- What you have contributed is kept across addon and Desktop App sessions.

## [desktop-v0.1.7] - 2026-10-24

### Added
- A Stop button ends the current chat request and any tool calls still to come. The question and text already
  received stay in the transcript, marked "Stopped", and a screen reader hears "Stopped".
- Chat shares the site's provider and model catalogue, reads model lists from the configured provider, and
  falls back to the catalogue when that provider cannot be reached.
- The prices file includes public drop rates beside market prices, refreshed at most once a day. With that
  file in the game, addon tooltips can show up to three sources under the usual three-install agreement rule.

### Changed
- The app keeps the settled-facts list beside its sent log, refreshes it once a day, skips rows that are already
  settled, and reports how many it skipped.

### Fixed
- A screen reader hears "Copied" or "Copy failed" after Copy. The button keeps its feedback for the full second
  and a half even when the thread redraws. Clear is disabled while an answer is being written.

### Security
- Update Electron to 44.9.1, including its compromised-certificate mitigation.
- Update the locked body-parser and fast-uri dependencies to their patched releases.

## [desktop-v0.1.6] - 2026-10-21

### Added
- The player pages can go with the uploads, on a switch in Settings: "Send the player pages with the
  uploads". It is off by default, so nothing changes until it is turned on, and the rows stay in
  `Everloot.lua` until then — the same rule the named data follows. The privacy policy and the data
  policy say so, in the words the switch uses.

## [desktop-v0.1.5] - 2026-10-20

### Added
- Sign in with everloot.app. The setup screen and Settings open everloot.app's new
  `/desktop/connect` page in the browser; after Battle.net sign-in and Connect, the app has its own key named
  "Everloot Desktop App". The key travels back to `127.0.0.1` sealed to a one-time key only that app holds
  (ECDH P-256, AES-GCM), so it is never in a URL in the clear, and the app never sees a password. Pasting a key
  still works. The setup screen also asks to agree to the Terms of Use and Privacy Policy before Start.

## [desktop-v0.1.4] - 2026-10-20

### Added
- Census switch. The setup screen has a census box, ticked by default, and Settings has a Census switch. With
  it on, census rows (race, class, level and faction, never names) go out with the uploads after logout; with
  it off they wait for the upload page. A setup finished before this keeps it off.
- Saved talent builds reach the game. With an account key that has the "Read my saved builds" permission, the
  app writes your builds from everloot.app into the `EverlootBuilds` slot addon after sign-in, on Sync builds
  and every 15 minutes. The key goes only to the site it was signed in on, and uploads never carry it.

### Fixed
- The account panel links to the keys page (`/docs/api/keys`) instead of the old `/connect` page.
- The builds sync stays quiet when a key is refused, and sends the key only to the site it was signed in on.

## [desktop-v0.1.3] - 2026-10-20

### Fixed
- Browse for the game folder now lands on the product folder. Picking `World of Warcraft` itself chose the
  folder one level above the one that holds `WTF`, so the app found no account files; it now takes the product
  folder with Everloot data (`_classic_era_`, `_anniversary_` and the rest). Picking `WTF` or `Interface`
  steps back up to the product folder too.

## [desktop-v0.1.2] - 2026-10-20

### Fixed
- A nightly addon build (such as 0.3.4-nightly) counts as newer than the release before it. The Addon page and
  the Overview used to offer the older release as an update, and the app sent a "newer addon" notice, so one
  click put back a build without the nightly's features. The page now says the nightly is newer than the latest
  release; putting the release back is the small repair link.

## [desktop-v0.1.1] - 2026-10-20

Everloot Desktop App 0.1.1. From this version, Windows installs download the next update inside the app and
install it on restart. Updating from 0.1.0 is one manual download.

### Added
- An account row at the top of the sidebar footer. Signing in means pasting a free key made on
  everloot.app after Battle.net sign-in; the app checks it with the site and keeps it in a file in the data
  folder. Chat and the in-game `/ask` send it to the site's public MCP server, so their requests count against
  the account instead of the internet address. Uploads and price refreshes never carry it. `/ask` no longer
  needs a private token file: without one it answers from the public server, like Chat.
- On a Windows install, the update downloads inside the app, is checked against the release's
  SHA256SUMS, and installs on restart: a Restart to update button appears in the footer and asks first, waits
  for a running upload, then runs the installer silently and opens the app again. A bug button beside Settings
  opens GitHub's bug form with the app version and its diagnostics filled in (user folder hidden, never the
  token), or copies them. The Addon page says Up to date instead of offering Reinstall as the main button;
  reinstalling is a small repair link.
- Chat answers appear as the model writes them, with the tool it is running shown while
  it looks something up (Anthropic and OpenAI-compatible providers; a server that does not stream
  still answers in one piece). Each answer has a Copy button.
- A model menu under the Chat box, as in other chat apps. It lists the models of every
  provider saved on the page (one key each for Anthropic, OpenRouter, OpenCode Zen, a custom server, plus
  Ollama), and picking one switches Chat and the in-game `/ask`. Keys can be added, replaced or removed one
  provider at a time. When search alone finds nothing, the answer says a model would read the question and
  offers to add one.
- Settings is pinned at the bottom of the sidebar and holds everything the app can be set to: what
  runs (upload, market prices, in-game `/ask`), the AI model keys, the game folder, startup and the app itself.
  The site's tools are no longer shown inside the window; the sidebar links to the database, talent calculator,
  raid builder and auction prices on everloot.app, which open in the browser. The world map and lore archive
  links are gone; Chat answers those questions.
- The Market page looks up an item's price in the prices file the game reads: paste an item link from game
  chat or type its id, and it shows each realm's community value, minimum, historical price and units up, with
  a link to the item's history on everloot.app.
- When a newer release is out, an arrow button sits beside Settings. It opens a panel with the
  new version, its release date, what the release lists as changed (the first eight, then a link to the rest
  on GitHub) and a Download button for this system's installer. Escape or Later closes it.

### Fixed
- An `Everloot.lua` written after the app started (the first logout, a second account) is
  found within 30 seconds and uploaded; before, the app kept saying there was no file until it was
  restarted. Resuming after Pause catches up on a logout that was skipped. A failed upload or `/ask`
  run is tried again after 1, 5 and 15 minutes. On Linux and macOS the file watch is armed again after
  the game replaces the file at logout, so later logouts are not missed.
- Pages keep an open drawer, the focus and what you are typing when the app refreshes them. The Characters
  week bars draw again (the page's security rules had blocked their heights), and a setting the app could not
  save shows why and switches back.
- Network calls time out instead of hanging, backups skip account files that did not change, and the app
  no longer holds up a Windows sign-out.

## [desktop-v0.1.0] - 2026-10-19

The first Everloot Desktop App release. Tagged `desktop-v0.1.0`; the desktop app has its own
version line, separate from the addon. Builds are not code-signed yet.

### Added
- **Everloot Desktop App** (`desktop/`): the companion as a tray app with a sidebar window. First run
  shows what leaves the computer and finds the game folder; then it uploads after every logout,
  refreshes market prices after each upload and hourly, and answers `/ask` when turned on. Pages
  for each thing to manage: what each account file holds, realm picks for the prices file (your
  scans plus the realms you follow), the `/ask` setup and recent answers, addon install and update
  checked against the release's `SHA256SUMS`, the change tracker, the log, a chat over Everloot's
  MCP tools with sources (a tool loop on the player's own key: Anthropic, OpenRouter, OpenCode Zen's
  zero-retention free models, a local Ollama or any OpenAI-compatible server, picked on the page and
  shared with the in-game `/ask`; plain sourced search without one; three local tools let the model
  read the player's own characters, scan ages and the app's own job status, sourced as this
  computer; starter questions on an empty thread and an "ask why" link from a failed job), a
  local characters view (gold history, gear, progress), and the site's tools embedded. A dated
  backup of each account file after every upload, with restore; a tray reminder when a realm's
  scan is older than a day; the window remembers its place. Electron, built on
  `companion/src`, same data folder as the command line. Tagged `desktop-vX.Y.Z`; the first
  release is not code-signed.

## [0.3.4] - 2026-10-20

### Added
- Site: the player pages' disclosure text: the privacy policy, the terms, the data policy, the methodology page and the addon page now say what the player pages collect, that the pages are unverified information reported by other players, how long a row is kept, and how a character is hidden. It goes live with the switch, not before.
- Site: an item's page shows its Source (Drop, Vendor, Crafted, Quest, Object) in the quick facts, each linking to its tab, from the same 3-install index as the item lists. Items nobody has reported show no row.
- Site: database pages for achievements, factions, titles and quest chains (`/database/achievements`,
  `/database/factions`, `/database/titles`, `/database/quest-chains`), with lists you can filter and sort, a page for each entry, and entries in the hub, sitemap and search. An entry
  shows only once three players report it the same way; until then each list says so.
- Addon, protocol and database: NPC lists gain Type and Rank columns and filters (creature type and rank as the game shows them on target), and quest lists gain Category, Side and Group columns, with Category and Side filters. The addon now records a quest when you accept it: title, level, the quest log header, suggested group size and tag, the giver, and your faction (Alliance or Horde, no character name). Every value is public only after 3 installs agree; a side needs 3 installs on that faction and none on the other. Older addons keep working. Needs an addon release to start collecting; the quest-log calls have not been tried in the Forever client yet.
- Player pages, off by default: search a WoW: Forever character by name and open a page with its race, class, level, guild and the day it was last seen, with a hide link on every page that needs no account. Nothing is collected or shown until `EVERLOOT_PLAYER_PAGES=1` is set on the site and a player turns on `/everloot players on` in an addon release that includes it; the design and the open legal questions are in `docs/design/specs/2026-10-20-player-pages-design.md`.
- Site: a game version label in the header ("Beta · 1.60.1") with a menu of Live (at launch), PTR (none running) and Beta, read from one list in `web/src/lib/game-version.ts`; a test checks every game-data layer names the current build. The build is also named on `/methodology`.
- Site: `/docs`, one documentation area for players and developers: Overview, Guides, API Reference, MCP and
  Cookbook tabs, a grouped sidebar, "On this page", "Copy page" as Markdown, and a page per API endpoint and
  per MCP tool generated from the protocol, with cURL, JavaScript and Python examples. "Docs" replaces "Open data"
  in the header, and docs pages are in search, the sitemap and `llms.txt`. `/connect` now redirects to `/docs`, and its old
  `#anchors` land on the matching docs page.
- Addon: gold per hour. `/everloot gph start` opens a small window and counts your own looted items, looted
  money, quest money and vendor sales while the session runs (pause, resume, stop, reset; a reload pauses the
  clock). Items are valued from the Everloot market value, else your own last scan, else the vendor price,
  each marked with its source, with the 5% auction cut on market and scan values unless you turn it off. The
  last 50 sessions stay in your SavedVariables file for the Desktop App; they are never uploaded.
- Addon: each auction scan records your faction and which house it read (Alliance, Horde, or Neutral for a
  goblin house). At the auction house, when a scan can run, a "Scan prices for Everloot" prompt starts one
  with a click, once per visit; `/everloot scanprompt off` hides it. With scans off, the first visit
  prints how to opt in.
- Market: scans that name their house also build that house's own market values, next to the realm-wide
  ones. `GET /api/market/prices?realm=<realm>&house=horde` serves them, and the realm list says which houses
  have values. Older scans and readers keep the realm-wide view.
- Accounts: `/sign-in`, `/sign-up` and `/reset-password` pages, and an `/account` page with your profile,
  sign-in methods and API keys. Under `EVERLOOT_AUTH_V2`, with `RESEND_API_KEY` and `EMAIL_FROM` set,
  anyone can make an account with an email and password; the email has to be confirmed before the first
  sign-in. Without them Battle.net stays the only sign-in. The header's Sign in now opens `/sign-in`.
- Site: embeddable tooltips. Any site can load `https://everloot.app/tooltips.js` so links to Everloot item, NPC, quest and object pages show a hover card (keyboard, touch, no cookies, no tracking), fed by the cached `GET /api/tooltip/<type>/<id>`; see `/connect#tooltips`.
- Site: the world map is now a Leaflet map that fills the screen: click a zone to zoom to it, search for a zone or NPC, flight masters and flight paths from the game files, coordinates on hover with a copyable `/way` line, a bottom card for a tapped pin, and an address that keeps your view; `/map?zone=<id>` opens that zone.
- One search on everloot.app: the header box and `/search` find items, NPCs, quests, zones, lore pages and
  tools by name or id, grouped by type with an exact id or name first. Drop, reward, giver and vendor lists
  show names and icons instead of "Item 1234", NPC, item and quest pages show a Lore section when the lore
  archive has a page of the same name, and those lore pages link back to the database.
- Addon: `/everloot price <item>` prints an item's price in chat, anywhere in the world: a shift-clicked
  link, an item id, or the name of an item the client has seen. It shows the same lines as the tooltip (community
  market value, minimum, historical, units up, reporters, how fresh the file is, and your own last scan) and
  links the full history on everloot.app. Nothing is fetched in game; the prices come from the file the
  Desktop App or companion writes.
- Battle.net sign-in can run on Better Auth behind `EVERLOOT_AUTH_V2`. Existing accounts and API keys
  carry over. No provider tokens, IP addresses or user agents are stored. With the flag off, sign-in
  behaves as before.
- Census in the addon, off until `/everloot census on`. It records the race, class, level and faction of
  your own characters and of players you target, mouse over or group with: one row per character per UTC
  day, at most 2,000 rows of each kind. It never reads another player's name, guild, gear or position.
  `/everloot census off` deletes every census row. The rows go only from the upload page, which counts
  them first; the companion keeps them. `/everloot selftest` prints your race token.
- Census intake: two kinds, `census_self` (your own characters) and `census_seen` (players you target, mouse
  over or group with), holding race, class, level and faction, plus the realm name for your own characters.
  The site replaces each character's GUID with a keyed hash (`EVERLOOT_CHARACTER_KEY`) and keeps only the
  server id from it before anything is stored, and rewrites the event id so nothing from the GUID survives.
  Without the key, census rows are dropped and the rest of the upload is kept. Census rows are kept out of
  the public corpus; only counts will be shown, from 10 characters and 3 installs. The data policy and
  `/privacy` say so. The upload page may send a character's row for the day again with a higher level;
  `mergeCensusRows` (`kb/src/census-rows.ts`) keeps the copy with the latest time, then the higher level,
  and never treats a repeat as a conflict. One install counts at most 500 players seen and 50 own characters
  per UTC day across all of its uploads, at intake and in that fold. Rows dated more than a day ahead or 30 days
  back of the server clock are refused, each row keeps the keyed address hash of its sender (never the address)
  so a count can ask for distinct addresses as well as installs, the key must be 32 characters or more, and
  `uploadStore.loadCensus()` reads the stored keyed rows back for the summary. The addon module and the `/census` page come in later steps.
- Site: zone pages at `/database/zones`, one for every released zone, with its map, the dungeons and raids
  entered there, and the NPCs, vendors and quests players have confirmed in it. Zone links in the database
  now open the zone page instead of the map.
- Site: the item lists have a Source column and a `src` filter (Drop, Vendor, Crafted, Quest reward, Container or object),
  from what players reported: drops, vendor offers, recipes and quest rewards, each once 3 installs agree.

### Changed
- The upload record contract moved from `web/src/lib/intake.ts` into one package, `packages/protocol`
  (`@everloot/protocol`), that the site, the knowledge base and the companion install. Uploads now carry
  `protocol`, the contract version; the server accepts the current major and the previous one. The
  addon's contract tests validate the rows it writes against the package's JSON Schema files. The
  addon's Lua comments still name the old file; they change with the next addon release.
- The package also holds the licence and credit line, the JSON API's response shapes with a route
  catalogue, and the MCP server's tool table (22 tools). The server registers its tools from that table,
  the connect page and `llms.txt` list from it, and each API route's test parses a real response with the
  protocol's schema, so none of the three can drift from the others.
- `/connect` gained a reference of every MCP tool with its arguments and of every JSON endpoint with its
  parameters and responses, rendered from the protocol, plus paging examples in JavaScript and Python. The
  site serves `/api/openapi.json` (OpenAPI 3.1, assembled from the same catalogue) and the protocol's JSON
  Schema files under `/schema/`. `llms.txt` lists both.
- A 23rd MCP tool, `answer_sources`: the evidence behind a question, observed facts first (with install
  counts), then curated facts and the 2023 wiki, every piece with its source URL, licence and date, plus
  search links on other sites (links only). Structured output from the start.
- Two talent tools on the MCP server, answered from the same catalogs and rules as the calculator:
  `talent_tree` (one class's trees from the game files, every node with its talents, ranks, position,
  prerequisites and row gate, with the build) and `talent_plan` (a share code or calculator link read
  against the trees: talents, points per tree, the lowest level, and every problem in plain words).
  The knowledge base now typechecks with bundler resolution so it can import the site's talent modules.
- Structured output for `item_categories`, `ecosystem_projects` and `everloot_plan`, the three tools that
  read no uploads: the same cases as the text (a tree, one item's path, a filtered list with its total;
  a board's ranked rows with GitHub facts flattened, or not connected; every tracker row with its proof).
- Structured output for the five page tools (`item_page`, `npc_page`, `quest_page`, `vendor_page`,
  `object_page`): the same page object the text is written from, under one envelope for answers built on
  uploads (`connected`, `dataAsOf`, `reason`). With no corpus read the page is absent, not empty.
- Structured output for `auction_history`, `collection_gap` and `guild_board`, the same result objects
  their text is written from, under the same envelope.
- Structured output for `profession_path`, `recipe_thresholds`, `entity_relations`, `completion_progress`
  and `market_value`: the path, the ranges with each cost as numbers, the edges the text lists, one
  install's progress, and the market value with its history, under the same envelope.
- Structured output for `gold_ledger` (one ledger per install, never merged, unrecorded as null) and
  `world_map_near` (entrances and pins with distances, or the refused query with its reason). Both
  formatters now write their text from a result object, so every one of the 25 tools answers with
  structured content beside its text.
- Every MCP tool answers a plain `GET /api/tools/{tool}` too, for developers without an MCP client: the
  tool's arguments as query parameters, read with the tool's own schema after the text-to-number coercion a
  URL needs; the answer is the same structured content and the same text an MCP client gets, from the same
  handlers, release and store. A wrong argument is a 400 that names it, an unknown tool a 404 that lists
  them. In the route catalogue, OpenAPI, the `/connect` reference and `llms.txt`.
- The bulk export: `npm run export-bulk` in `web/` writes the published data as files, one NDJSON
  file per dataset (public corpus, drop rates and measured zeros, relations, items) and an `index.json`
  (`bulkIndex` in the protocol) listing each file's rows, bytes, SHA-256, data class and the API response
  whose rows it holds. Rows come through the API's own loaders, so a file can never hold a row the API
  would not. `scripts/upload-bulk.mjs` uploads a folder create-only, index last, and points `latest.json`
  at it. `/connect` and `llms.txt` link the export once `NEXT_PUBLIC_BULK_URL` is set (docs/RELEASING.md).
- The MCP server's implementation info carries a title, a one-line description and the site's icon (64 and
  512 px), so clients that draw a server list show Everloot by name and picture. `/connect` shows a curl
  call of `/api/tools/get_by_name` beside the MCP one.
- `/census` and the MCP tool `population`: who plays what, from the census rows of players who turn it on.
  Each character counts once (the latest report per character key, across both kinds and every install), in
  two windows (the last 7 days and since launch) with a daily trend. A count shows only at 10 characters
  reported by 3 installs, and every count is rounded to the nearest 5 so a hidden one can't be recovered by
  subtraction. Until a window gets there it says it is still collecting, which is the state at launch.
  `/methodology` states the rules. Reads `census_self` and `census_seen` once intake accepts them.
- `/api/items/categories` joins the protocol's route catalogue with its response shape, so it appears in
  `/api/openapi.json`, the endpoint reference on `/connect` and `/schema/api/itemCategoriesResponse.json`,
  and its route test parses a real body with the shape. The endpoint itself is unchanged.
- Completions on the MCP server (`completion/complete`): a client typing the `what_changed` prompt's game
  or the class in `everloot://talents/{class}` is offered the values the protocol knows, by prefix. The
  nine class resources are now listed under `resources/list` beside the three static ones, so a client
  that browses resources finds every class's trees without knowing the slugs.
- `search` and `fetch` on the MCP server, the two tools ChatGPT's connectors, deep research and company
  knowledge call by name, after OpenAI's contract: results with an id, a title and a URL to cite, then one
  record whole with its source, licence and date as metadata. A lore page's URL is its page on the site;
  any other record points at its source. Both answer as structured content with the same JSON as text.
- Resource templates on the MCP server: `everloot://item/{id}`, `npc`, `quest`, `vendor`, `object` and
  `talents/{class}` read as the same JSON the matching tool returns as structured content, so a client that
  prefers resources to tool calls gets the same page. A variable the tool refuses is an error in words.
- The MCP server's first prompts, commands a client offers and fills: `answer_with_sources` (a question,
  answered from `answer_sources` with a source on every piece), `review_talent_plan` (a share code, read
  with `talent_plan` and `talent_tree`) and `what_changed` (`recent_changes`, newest first, excerpts
  only). Listed on `/connect`, in `llms.txt` and in `/schema/mcp/prompts.json`.
- The tool reference on `/connect` shows each tool's answer: the top-level fields of its structured
  content with types and meanings, from the same schema the server validates against.
- The protocol's publish path: `protocol-publish.yml` publishes `@everloot/protocol` to npm with
  provenance on a `protocol-v<version>` tag, after checking the tag, `package.json` and the changelog
  agree; and `scripts/check-semver.ts` holds every pull request to the package's semver rule by comparing
  the committed `schema/` with the latest published tarball (it passes with a notice until the first
  publish). The steps are in `docs/RELEASING.md`, "Protocol".
- The MCP server's first resources, documents an assistant reads whole: `everloot://builds` (the build the
  game-file facts come from and the build registry, JSON), `everloot://methodology` (how uploads become
  facts) and `everloot://data-policy` (the policy in short, with the link to the full one). The two texts
  are held to the methodology page and `docs/DATA_POLICY.md` by tests. Listed on `/connect`, in `llms.txt`
  and in `/schema/mcp/resources.json`.
- Four MCP tools (`search_knowledge`, `get_entity`, `get_by_name`, `recent_changes`) declare an output schema
  and answer with structured content beside the text, so a client can read hits and timeline entries as
  objects instead of parsing prose. The schema files and `/connect` show which tools do.
- `scripts/upload-bulk.mjs` refuses a folder whose `index.json` or any data file carries what looks like a
  machine's own filesystem path (a Windows drive path, `/Users/`, `/home/` or `AppData`) before anything is
  sent, like the sha256 check, so a bug in the export cannot publish a local path alongside the data.
- The header menu brightens to the site's green on hover instead of the body text colour.

### Fixed
- Addon: `/everloot selftest` printed the failure text on two passing lines ("PASS C_Traits exists: no C_Traits
  table: talents cannot be read"). Both now say "present".

## [0.3.3] - 2026-10-18

### Added
- A **completion tracker** module for achievements, reputation, titles and quest chains. It is off until
  `/everloot completion on` (`/everloot completion` reads now, `/everloot completion off` deletes every
  row it wrote). It reads with the calls Forever's own windows use (the achievement globals the Legacy
  Challenges window calls, `C_Reputation`, the title functions, `C_QuestLog.GetAllCompletedQuestIDs`,
  `C_QuestLine`), in chunks across frames, waits out combat and never acts: no tracking, no expanding
  headers, no window changes. A missing call records nothing for that part and `/everloot status` names it.
- Eight intake kinds. Catalog rows (`achievement_catalog`, `reputation_catalog`, `title_catalog`,
  `quest_chain_catalog`) are game facts with no player data, listed on the site after 3 reporters (distinct
  upload addresses) report the same entry. Owned rows (`achievement_owned`, `reputation_owned`, `title_owned`, `quest_owned`) are one
  character's progress under an opaque key, not the name. They are named data in the collection sharing
  category, like `collection_owned`. A changed achievement or standing replaces its earlier row, so the
  file does not grow with each point of reputation, and the module's rows have hard caps reported in
  `/everloot status`. None of the eight kinds is in the public corpus: the site folds them into a separate
  completion rollup, so pages that do not show completion never read them.
- `/tools/collections` shows, per character, what is done and what is closest to done (achievements with
  the most criteria met, reputations nearest the next standing, quest chains with the fewest quests left),
  with an empty state that says when the data is unrecorded rather than zero.
- MCP tool `completion_progress`, read-only, taking an install id and an optional character key.
- [`docs/2026-10-19-addon-0.3.3-beta-checklist.md`](docs/2026-10-19-addon-0.3.3-beta-checklist.md): the
  calls confirmed in the build's own files, and the in-client check to run.

Forever opens achievements as Legacy Challenges, so the catalog is the list the game gives those calls.
The module has passed the automated tests against a mock of the documented calls; it has not run in the
Forever client.

## [0.3.2] - 2026-10-17

### Fixed
- Recipes now read from Forever's own profession window (`C_TradeSkillUI`). The old trade-skill and
  craft calls the addon used are not in the client's API documentation for build 1.60.1.70450, so no
  `recipe_observed` rows could be written. Each row keeps its shape: profession, rank, recipe, colour,
  product item and reagents. The product and reagents come from the recipe schematic; a reagent slot
  that accepts several items is written without reagents instead of a guess. The read is chunked across
  frames and debounced.
- Trainer rows read the trainer window's values in the order Forever returns them. The old addon read
  the texture as a category, and now also skips the window's "next profession step" row.
- Auction buyouts and commodity purchases are read with `C_AuctionHouse` (the item bid at its buyout,
  and the total the house quoted for a commodity), watched from the player's own click and never called.
  The old `GetAuctionItemInfo` and `PlaceAuctionBid` path stays for older clients.
- A pending buyout is dropped after 5 seconds, on `AUCTION_HOUSE_SHOW_ERROR`, on
  `COMMODITY_PURCHASE_FAILED` and on `COMMODITY_PRICE_UNAVAILABLE`, so a rejected bid cannot later
  label a same-sized money change (a repair) as a purchase. Ranks above 500 are not written.
- `/everloot status` names any call this client lacks and says the module records nothing, and reports
  what the last profession window held.

### Added
- [`docs/2026-10-18-addon-0.3.2-beta-checklist.md`](docs/2026-10-18-addon-0.3.2-beta-checklist.md): the
  calls confirmed in the build's own files, and the in-client check to run.

The profession and purchase paths have passed the automated tests against a mock of the documented API;
they have not run in the Forever client. This release also contains everything in 0.3.1.

## [0.3.1] - 2026-10-17

### Fixed
- The TOC declared interface 70058, an old build number, so the client listed the addon as out of
  date. It now declares 16001, derived from build 1.60.1. The companion's `EverlootAnswers` addon
  declares the same number.

## [0.3.0] - 2026-10-17

### Added
- An **Everloot scan** button on the auction house, or `/everloot scan`, reads the full auction
  listing with `C_AuctionHouse.ReplicateItems()`. It runs only when you click, with the auction house
  open, at most once every 15 minutes, and never buys, bids or posts. The result is summarised per
  item and stored as `auction_snapshot` records. The last three scans per realm are kept.
- Item tooltips show your own latest scan and the community prices the companion wrote. The tooltip
  shows the date the prices were fetched and marks them stale after two days.
- The companion's `prices --game` (and `watch --game`) writes the checksummed `EverlootPrices` addon
  the tooltips read, after the next `/reload`.
- `auction_snapshot` records are accepted by the upload intake. They stay out of the public corpus.

### Fixed
- A scan that gets no answer from the game within 30 seconds clears itself and gives the cooldown
  back. Closing the auction house while waiting does the same.

This release also contains everything in 0.2.8. It has passed the automated tests; the in-client
checks are still open.

## [0.2.8] - 2026-10-17

### Added
- `/everloot raid` lists the raid buffs missing in each group of your current group. It is display
  only and records nothing.
- `/everloot raid code` prints a link that opens your raid in the site's raid builder.

### Changed
- The raid builder's buff rules come from a committed file generated from our own game-file
  extract for the current beta build, instead of a hand-written table.

This release also contains everything in 0.2.7.

## [0.2.7] - 2026-10-17

### Added
- Talents module: reads your build through `C_Traits` and `C_ClassTalents` for the active spec
  group, and the second one once dual spec is unlocked. A row is saved only when the build changes.
  Talent rows are not in the public corpus.
- `/everloot selftest` checks each talent API and whether the loadout export and import functions
  exist, and writes the result to chat and the saved variables file.
- `/everloot plan <share code>` shows the next point to spend and where your build differs from a
  plan made in the site's talent calculator. It never spends a point, clicks or imports a loadout.

## [0.2.6] - 2026-10-16

### Added
- An opt-in list of your installed addons (`/everloot addons on`). It leaves the addon only from the
  upload page, after the preview. `/everloot addons off` stops it and deletes the recorded rows.
- The bounds of each zone you enter, recorded as a position, for the world map.
- The game client build is stored with every upload.

## [0.2.5] - 2026-10-10

### Added
- Trainer rows: the required skill rank and cost of each recipe a trainer offers
  (`trainer_seen`), read when the trainer window opens.

## [0.2.4] - 2026-10-10

### Added
- Auction sales taken from the mailbox are recorded in the gold ledger, net of the auction house's
  cut. The buyer's name is never read.
- Buyouts you pay are recorded as auction purchases. Plain bids are not, since they can be refunded.
- Postage for letters the server confirmed sent. The recipient and text are not read.

## [0.2.3] - 2026-10-10

### Added
- Recipe colour observations: one row per profession, recipe, skill rank and colour as the
  profession window shows them (`recipe_observed`). The site infers difficulty ranges from them once
  three installs agree.

## [0.2.2] - 2026-10-09

### Added
- `/ask <question>` stores your question. The companion answers it and the answer shows in chat
  after `/reload`, with its source, once its checksum verifies.
- Quest rewards, vendor sales and flight costs in the gold ledger.
- `/everloot auctions on|off` to switch auction capture in game (it applies after `/reload`).

### Fixed
- Auction rows stored a whole stack's buyout as one item's price. Rows now carry the stack count
  and a per-unit price, and bid-only listings are skipped instead of being saved as free.

## [0.2.1] - 2026-10-08

### Fixed
- Collection repairs in the open-world and guild modules. This is the first addon zip built by
  `scripts/package-addon.py`.

## [Site and knowledge base milestones]

Dated by the pull request or commit that landed them.

### 2026-10-17
- Forever market (#15): scans players start are folded into daily prices. A day is published once
  three reporters agree, and a thin or outlying day is labelled or trimmed instead of averaged in.
  `/tools/auctions` shows a realm table and an item view with a 60-day chart, `/api/market/prices`
  serves the prices without install ids, and the `market_value` MCP tool brings the server to 16 tools.
- Build watch (#34): a scheduled workflow notices a new WoW: Forever build within about half an hour,
  regenerates the talent, raid and map data with the site's own generators, and opens a reviewed pull
  request titled `data(game-data): build <version>` with a list of what changed. Nothing merges itself.
  See `docs/BUILD_WATCH.md`.
- Talent calculator at `/tools/talents` (#27), reading our own catalog extracted from the game
  files (#30).
- Raid group builder at `/tools/raid` (#32).
- World map at `/map`, drawn from zone and entrance positions in the game files (#28).
- Blizzard change tracker at `/changes` with an RSS feed, and the `recent_changes` MCP tool (#37).
- Addon leaderboard at `/addons/popular` (#22) and addon profile pages at `/addons/<name>` (#26).
  Counts, titles and dates appear only when three installs report them.
- `/connect`: how to use the open data from an AI assistant or your own code (#31).
- Opt-in analytics with consent categories (#33).
- Data policy extended to game-file data: talents, the raid buff table and the map (#14, #29, #30).
- CI rejects AI tool credits in commits and pull request descriptions (#38).
- Lore pages are cached instead of running a function per view (#35).

### 2026-10-16
- Open-sourced under AGPL-3.0-only, with the data under CC BY-SA 4.0: contributing guide, code of
  conduct, security policy, issue forms, DCO sign-off check, secret and private-path guards,
  third-party notices, a provenance ledger of every source, and the data and no-spoiler policy.
- New visual identity: colour tokens for light and dark, Geist, outline pill buttons, bracket
  navigation.
- Addons hub and Polestar pages.
- Public corpus no longer carries install ids.
- Client table snapshots and field-level diffs in the knowledge base tooling (#16), and a build
  registry from Blizzard's public version service (#13).

### 2026-10-15
- Lore archive: `/lore` pages, `/search`, browsing by type, letter and facet, a coverage page, and
  sitemaps, built from the Warcraft Wiki dump (CC BY-SA 4.0).

### 2026-10-10
- Public read-only MCP endpoint at `everloot.app/mcp` for AI assistants, rate limited.
- Recipe difficulty ranges (`recipe_thresholds` tool and profession page section), and profession
  paths that price reagents from per-unit auction scans.
- Generated social preview card.

### 2026-10-07 to 2026-10-09
- Replay-safe, resumable uploads with event identity and de-duplication.
- Guild authority, claim tokens, quotas and opt-out.
- Battle.net sign-in.
- Public MCP HTTP server with authentication, rate limiting and CORS.
- Public rollups that state a fact only when three installs agree, with opt-out and suppression.
- Pages show the age of the data.

### 2026-09-29 to 2026-10-04
- everloot.app live (2026-10-03). Upload page and intake contract, drop-rate rollups, database
  pages for items, NPCs, quests and vendors, profession and farming route pages, guild pages.
- Uploads stored in object storage with a Supabase index; pages read one corpus snapshot, extended
  every ten minutes.
- First MCP knowledge server over stdio (3 tools). The server now has 16.
- Knowledge base (`kb/`): lore import from the Warcraft Wiki dump, provenance on every row,
  publishable-only snapshots with a licence manifest.
