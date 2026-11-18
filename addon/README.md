# addon/: the Everloot collector

The in-game addon for WoW: Forever. It records what you see while you play (sightings, loot
windows, vendors, full auction-house scans you start, recipes, trainers, your own gold, the world
position of each zone you enter) into its SavedVariables file, shows `/ask` answers from the
Everloot Desktop App, and adds auction prices to item tooltips. It uses only the game's addon API and never
plays the character. Records match the upload contract (`packages/protocol`, see its `schema/records/`) field for
field.

**Status:** 0.3.25 release candidate. Automated verification covers the combined auction house, minimap, window resizing, Collection, disenchanting and loot item-level changes. Live Forever acceptance for this candidate is pending; the live check of 0.3.24 does not cover these changes. The published release remains 0.3.24 until this candidate passes its in-game checklist and is released. Use `docs/2026-11-17-auction-ui-checklist.md` plus the minimap, resizing and Collection checks before publication.

## Run it

Download the zip from everloot.app/addon, or build it from the repository root:

    python scripts/package-addon.py

That writes `web/public/downloads/Everloot-<version>.zip`. Extract `Everloot/` into the Forever
client's `Interface/AddOns/`, `/reload`, then run `/everloot status`. Login and `/reload` print one line (the
version, how many modules are on and off, any that could not start and any paused collection); `/everloot status`
lists every module and row count. Auction capture is on in a new
install (`/everloot auctions off` turns it off). At the auction house, open the **Everloot** tab after
Blizzard's tabs and click **Scan prices** (or type `/everloot scan`) for a full scan: at most one every 15 minutes, read in chunks, summarised per item,
and the last three scans per realm kept. Nothing scans without that click. The tab shows the cooldown,
whether the last scan is in your saved file yet, a **Share now** button (a `/reload`, which writes the
file so the Desktop App can send it) and a price lookup with the tooltip's lines. If the tab cannot be
added, a **Scan prices** button takes its place. The list of your
installed addons is off until `/everloot addons on`; it is sent only from the upload page, after
its preview. `/everloot addons off` stops it and deletes every recorded addon row.

A replication scan that cannot start or times out now tries a **partial price sample**, when the client's
search APIs are available. It reads actual item/commodity search rows for at most 20 browse keys and 40
requests, paced at least one second apart and within 90 seconds of starting. It stops when the house closes
or auctions are disabled. Empty attempts refund the cooldown; successful samples retain it. The sample is
not a full-market snapshot and does not populate the full-scan cache. Before a sample stores, only the newest
earlier sample of that realm stays in the file, so samples do not fill the per-kind row cap.

Profession observations retain the API's recipe ID and learned flag when available. A client with a
complete-list reader uses it; otherwise the status explicitly says **filtered recipe list**. The addon never
changes the player's filters. Up to 500 recipes are read in chunks; reaching that cap is reported. Only learned
recipes are written (the status counts the others). For each recipe and colour the file keeps the lowest and the
highest rank it was seen at: the highest is written when the colour changes, or at the first logout or reload on a
new UTC day, so levelling a profession adds a few rows per recipe, not one per skill point or per reload. Disabling professions stops queued chunks.
Tooltip prices show the item's newest public observation day separately from when the price file was built,
and warn when either is old. Community values are one auction house's: the character's faction house, or the open
auctioneer's (a goblin house is the neutral one), named on the line; another house's price is never shown, and an older
price file keyed by realm alone is not read, since its values may mix both factions: with the 0.1.21 Desktop App release
or earlier the tooltip says so instead of showing a price, and the 0.3.22 addon release or earlier finds no community price in a newer
file. Update the addon and the Desktop App together, let the app refresh prices, then `/reload`; drop rates and sources
keep working throughout. They are recorded asking-price
estimates, not live listings or guaranteed sale prices. Your own latest scan of each house is kept per realm and house
(`EverlootDB.houseScans`); a scan whose auctioneer could not be read says its house was not recorded.
Below the prices, the tooltip shows where the item drops when three installs looted the source: each rate as
drops of loot windows, with its installs and the date of the uploads behind it, from the drop rates the Desktop
App writes into the same `EverlootPrices` file. Once that file is in the game, a missing price or drop source is
said in one muted line; nothing is written to your SavedVariables. Without the file, tooltips carry no community line,
and the first item tooltip says once per install, in chat, that community prices come from the Everloot Desktop App
(everloot.app/addon). `addon/tests/drops_contract.py` holds the rules.
Nothing in the addon calls a buy, bid or post API; `addon/tests/market_contract.py` traps them.

Price tooltips use separate label/value rows with native coin icons. Community market, minimum and historical
values stay distinct from your own scan; the vendor sell price appears beside them when the client knows it.
The amounts are per unit. The header names your realm with its ruleset (PvP, PvE, RP, RP-PvP, Hardcore) split off
the name in its own colour, as the realm list shows it; drop rates sit in the value column too, their loot windows
and installs beneath. A source you have met is named as your client showed it ("Drops from Defias Bandit"), read
from your own sightings and loot in the saved file; one you have not met keeps its id ("NPC 116"). Dates, units listed, reporters, all-house scope and stale-data warnings remain visible.
`/everloot price` prints the same amounts as plain text. Disenchant estimates come only from disenchants players
recorded (see the disenchant row below); the addon never guesses them from an item's color or type.

Between the prices and the sources, the tooltip shows your own history with the item, read from the gold ledger
in your saved file for your characters on this realm: the day and price per unit of your last sale, the average
sale price per unit and the units sold over the ledger's last 90 days, and sales from the last two days whose
mailbox letter you have not taken yet (sold, no price until the letter). The average paid shows only for a
purchase whose ledger entry names the item and its count: a buyout keeps the item's name from the listing's link
(or the auction house's name for it) and the count from the search results you bought from, and a commodity
purchase keeps the item and quantity you confirmed. An item you never sold or bought gets no history line,
never a zero. The ledger is indexed by item once and again only after it changes, so a hover reads one entry.
Nothing new is recorded or uploaded for it.

### Ask about an item's price

- For an immediate answer from the files already in game, type `/everloot price` followed by a
  shift-clicked item link or item id. This works away from the auction house too. Your own scan can
  supply a value before the community has enough observations.
- For an online recorded-market answer, type `/ask price` followed by an item link or id. New questions
  include your current realm; you can name another explicitly, for example `/ask price 2589 on Nightslayer`.
  An item name works when Everloot can resolve it uniquely. Otherwise, the answer asks for an item id.
- Keep the Desktop App running with Ask enabled. `/reload` or log out to write the question; after the
  app processes it, `/reload` again to load the answer. This is a file bridge, not live in-game internet access.
  If a later load still has no answer for a question, the addon says once that no answer arrived and to open the
  Desktop App with Ask turned on (everloot.app/addon), then `/reload`. The question stays saved until it is answered.
- Price questions need no AI model key. Answers identify the realm, all-house scope, recorded values,
  observation day and missing data. A missing local cache row does not prove the website lacks a price;
  the local community file holds at most 2,000 items. Full history is on everloot.app/tools/auctions.

Each scan records your faction (`faction`) and which house it read (`house`): Alliance or Horde from the
auctioneer's faction, Neutral for a goblin house whose auctioneer has none, and nothing when the client
gives no auctioneer to read. The game files list separate Alliance, Horde and Blackwater (neutral) houses
with different cuts, so the site keeps a market per house next to the realm-wide one.

The first visit prints one introduction in chat explaining scanning; there is no floating popup or recurring
reminder. `/everloot scanprompt off` hides that introduction (the tab and `/everloot scan` still work).
With scans off, the first visit instead explains how to opt in. The scan action shows **Scan prices**,
**Scanning...** or **Ready in M:SS**, and is disabled while busy or cooling down. Last-scan age and saved-file
status remain in the tab. The tab and settings use native WoW fonts, gold headings and standard controls.

### Shopping lists

**Shopping list**, at the top right of the Everloot tab at the auction house, swaps the scan controls and the price
lookup for your shopping lists; **Price lookup** swaps back. A list holds items with how many you want and, if you
like, the most you will pay per unit. Add an item by name, id or shift-click with **Add or update** (click a row to
change it), or from the Everloot window: **Professions**, **Crafting costs**, choose a recipe and a count, then
**Add to shopping list** adds its reagents to the active list (a reagent name seen with two item ids is skipped and
said). Each row shows the price file's market value with how old that item's value is (red past two days), and a line
above the rows says when the file was built and which auction house its values are for. **Search** sends one
auction-house search for that item, only when you press it and only when the client's search throttle is ready, and
never while a scan or another search is waiting; the lowest buyout found and how many are listed show in the row,
lit when within your max. Blizzard's Buy tab shows the same results for you to buy there yourself: nothing is bought,
bid on or posted for you. Lists are kept in your saved file only, never uploaded: up to 10 lists of 50 items, and
the page says so. Wanted counts are your own numbers; your bags and bank are not read.

## Commands

Every command the addon answers. This table is the source for the in-game help line (`core.lua`) and the
guide at everloot.app/docs/guides/addon; `addon/tests/commands_contract.py` fails when the three drift.
`/everloot` on its own opens the planner workspace.

| Command | What it does |
|---|---|
| `/everloot window` | Opens or closes the Everloot window (left-click on the minimap button does the same). |
| `/everloot options` | Opens the settings (right-click on the minimap button does the same): an Everloot overview with five pages under it in the game's AddOns list: General, Tooltips, Auction House, Helpers and Data Sharing, one switch per module. |
| `/everloot setup` | Asks again which features to use: Everything, Collect data only or Choose myself (see Choosing features). |
| `/everloot planner [talents\|raid]` | Opens the planner workspace on the named tab, where a website plan is pasted and imported. |
| `/everloot buttons on\|off` | Gathers other addons' minimap buttons into the Everloot button, or leaves them on the minimap; `/reload` to apply. |
| `/everloot status` | Prints the version, each module and how many rows it holds, and any paused collection. |
| `/everloot version` | Prints the addon version. |
| `/everloot auctions on\|off` | Auction scans, on in a new install; `/reload` to apply. |
| `/everloot scan` | At the auction house, starts a full scan, like the **Scan prices** button; at most one every 15 minutes. |
| `/everloot scanprompt on\|off` | The once-per-install chat introduction at the auction house; the button and `/everloot scan` still work with it off. |
| `/everloot vendor on\|off` | At a merchant, sell grey items and repair with your own gold; never the guild bank. |
| `/everloot mail on\|off` | The **Collect all** button at the mailbox, for auction letters only. |
| `/everloot where [item link\|item id\|NPC name]` | Lists drops, vendors and NPC locations from your own saved sightings only. Shift-click an item link, give its id, or an exact NPC name (case-insensitive). Counts are recorded loot windows, not item quantities or drop rates. |
| `/everloot price [item]` | Prints the price of an item from the files already in the game: shift-click the item into the command, or give its id. |
| `/everloot gph [start\|pause\|stop\|reset\|show\|hide\|cut on\|off\|history]` | Gold per hour: start, pause or stop a session, reset it, show or hide its window, take the 5% auction cut or not, or list the last five. The sessions stay in your file. |
| `/everloot addons on\|off` | The installed addon list, off until enabled; off deletes every recorded addon row. |
| `/everloot completion [on\|off]` | The completion tracker, off until enabled; bare reads now, off deletes every row it wrote. |
| `/everloot census [on\|off]` | The census, on in a new install; bare says whether it is on and how many rows it holds, off deletes them. |
| `/everloot players [on\|off]` | The players module, on in a new install; bare says whether it is on and how many characters it holds, off deletes them. |
| `/everloot pulls [on\|off]` | Boss pull summaries, in the builds that carry them; bare says whether it is on, off deletes every pull. |
| `/everloot link [code\|clear]` | Links this character to your everloot.app account with the code the site shows; bare counts the links, clear deletes them. |
| `/everloot selftest` | Checks the talent calls the addon relies on and prints PASS, FAIL, SKIP and INFO lines. |
| `/everloot talents` | Prints your talent build per spec group, with a share code. |
| `/everloot plan [share code\|number\|hide\|clear]` | Loads a talent plan from a share code or from your saved list by number and shows it beside the talent window; bare reopens the panel, hide closes it, clear forgets it. |
| `/everloot raid [code]` | Lists the raid buffs missing from each group; code gives a link that opens the raid in the site's raid builder. |
| `/ask <question>` | Stores a question of up to 500 characters; the answer shows in chat after `/reload`, once the Desktop App has fetched it. |

## NPC and quest facts

When you target an NPC the addon also notes its creature type and rank, and when you accept a quest it
records the quest's title, level, quest log header (category), suggested group size, tag, giver and your
faction (Alliance or Horde, no name).

For the world map, an NPC window (merchant, gossip, quest, trainer, flight map, bank, auction house, stable,
innkeeper) records where you stand as that NPC's place (`positionKind = "interaction"`) with a `role` for the
service, once per NPC, role and zone. Targeting still records `positionKind = "player"`, which never becomes a
pin. Looting an object adds where you stand (`mapId`, `x`, `y`), a `gatherKind` (herb, ore, chest, fishing,
other) from the spell you cast just before (`UNIT_SPELLCAST_SENT`) and the object's name from that cast's
target (`sourceObjectName`). A kill's loot window with nothing in it is recorded too, so drop rates count the
corpses that dropped nothing: the game names no source for an empty window, so the addon takes the one dead
creature you could loot among the units you interacted with, pointed at or targeted, and writes a loot row with no
items and no coin (`sourceEvidence = "empty-window"`), once per corpse. Two different dead creatures there, a
corpse tapped by someone else, an empty container, fishing or a skinning or pick-pocket cast record nothing.
Trainer rows carry `trainerNpcId`. Targeting rows are kept once per NPC, zone and
spot (rounded to 1 on the 0..100 scale). Window rows and object loot rows each have their own 2,000-row cap,
apart from targeting rows and creature loot, so `/everloot status` can show `npc_sighting (targeting)` paused
while windows still record. A rare or a treasure the minimap shows (`C_VignetteInfo`) is recorded at its own
position, as the vignette API gives it: a creature as an `npc_sighting` with `positionKind = "vignette"` (its own
share and cap), a game object as an `object_sighting`, once per vignette, zone and spot. Zoning into a dungeon or
raid records an `instance_entrance`: the instance from `GetInstanceInfo` and where you stood outdoors when the
loading screen started (`PLAYER_LEAVING_WORLD`), once per instance and zone; a dungeon finder teleport records
none. A boss fight's end inside one (`ENCOUNTER_END`) records an `encounter`: kill or wipe, difficulty, group size
and the bosses' creature ids when the client sends them, and with `ENCOUNTER_START` seen, when the pull started and how
many seconds it took. Each dungeon or raid run with a boss pull is one `instance_run` row: when you entered and left,
the first pull, the last kill, pulls, kills and wipes, and the bosses killed. A run survives a reload, a corpse run or a
trip out; it ends after 30 minutes outside, in another instance, at the game's reset line, or when a boss it already
killed is pulled again; only time outside counts toward the 30 minutes. No names
(`docs/design/specs/2026-11-02-pull-and-run-records-design.md`). The start, length and runs, like the boss pulls below,
wait on `E.RUN_RECORDS` in `core.lua`: off until the release that ships them, so a nightly writes encounter rows as
before. None of these has run in the Forever client yet. Forever's client uses the modern UI: on launch night 0.3.16
recorded no quests and no vendors, because `QUEST_ACCEPTED` carries only the quest id there and the old
`GetQuestLogTitle` and `GetMerchantItemInfo` are missing. Quests are now read with `C_QuestLog.GetLogIndexForQuestID`
and `C_QuestLog.GetInfo`, and vendor prices with `C_MerchantFrame.GetItemInfo`, as the build's API documentation and
its own merchant window do; clients with the old calls keep them. A call that is missing or returns something
unexpected records nothing for that field. The site shows each value only after 3 installs agree.

When the game shows you an item's tooltip, `modules/itemfacts.lua` records the numbers the game files do not
hold: armor, block, damage per second, each stat and each resistance, one `item_fact` row per line with the item
id, the number and the client build. It reads them with `GetItemStats` on the plain item from `GetItemInfo`, so
an enchant or a random suffix on your copy never counts, and a tooltip whose GUID is not an item's records
nothing. Each item is read once per client build; an item with no numbers is read once per session and not kept.
It follows the open-world toggle and shares the 2,000-row cap. Not yet run in the Forever client.

## Gold per hour

`/everloot gph start` begins a session and opens a small window you can drag; `gph pause` stops the clock
(`gph start` resumes), `gph stop` saves the session, `gph reset` throws it away, `gph show` and `gph hide`
open and close the window, `gph history` prints the last five, `gph cut on|off` sets the auction cut.

- It counts, while running: items you loot (the game's "You receive loot" lines, so other players' loot,
  quest rewards, purchases and crafts are left out), money you loot or get as your share of group loot,
  quest money (`QUEST_TURNED_IN`), and what you sell at a vendor. A reload or logout pauses the clock and
  the session resumes when you are back; after a crash it waits, paused.
- Each item is valued from the Everloot market value on your realm (the file the Everloot Desktop App
  writes), else your own last full scan, else the vendor price, and the window says which. With the cut on
  (the default) 5% is taken from market and scan values, as the faction houses take it.
- Total = item values + looted money + quest money. Vendor sales are shown apart and not added: the items
  sold are already in the item values.
- The window shows the clock, total, gold per hour, the value by source, the top five items and the zone.

Sessions are personal. They live in `EverlootDB.gph`, not in `EverlootDB.records`, so no uploader reads them
and nothing is sent. The last 50 finished sessions are kept in `EverlootDB.gph.sessions`, oldest first, each:

| Field | Meaning |
|---|---|
| `v` | Shape version, 1. |
| `character`, `realm` | The character that ran it (kept in your file only). |
| `startedAt`, `endedAt` | UTC, `YYYY-MM-DDTHH:MM:SSZ`. |
| `seconds` | Time the session ran, pauses left out. |
| `zone`, `zones` | The zone it started in, and every zone entered, in order (at most 10). |
| `money` | `{ loot, quest, vendor }` in copper. |
| `items` | `{ itemId, count, unit, source }` per item, most valuable first. `unit` is copper per item after the cut; `source` is `market`, `scan`, `vendor` or `none`. At most 200 items. |
| `itemValue`, `total`, `perHour` | Copper. `total` is `itemValue` + `money.loot` + `money.quest`. |
| `cut` | The auction cut taken from market and scan values: 0.05, or 0 when off. |

The running session is `EverlootDB.gph.current` (item counts in `counts`, by item id); `EverlootDB.gph.cut`
holds the cut setting.

## Completion tracker

Off until `/everloot completion on` (then `/reload`). It reads the game's achievement, reputation, title and quest
chain lists with the calls Forever's own windows use, in chunks across frames, and waits out combat.
`/everloot completion` reads now; `/everloot completion off` deletes every row it wrote. It never tracks,
expands, clicks or changes anything.

Your own achievements, reputation, completed quests, professions, talent build, character sheet stats, PvP standing
and gear are not recorded. Blizzard's character API supplies them to everloot.app
(`docs/design/specs/2026-11-17-blizzard-api-first.md`), and the window's Collection and Home read achievements,
reputation and completed quests from the game as they draw. The first load of this release deletes any rows of those
kinds an older version left in the saved file (`gear_snapshot`, `talent_snapshot`, `achievement_owned`,
`reputation_owned`, `quest_owned`, `profession_owned`, `talent_owned`, `stats_owned`, `pvp_owned`).

- **Catalog rows** (`achievement_catalog`, `reputation_catalog`, `title_catalog`, `quest_chain_catalog`):
  ids, names, criteria text, standing headers and quest ids. No player data. The site lists an entry after 3
  installs report it identically. Completed quests are read only to find the chains they belong to.
- **Titles** (`title_owned`): the titles your character holds, under an 8-digit key made from your install id and the
  character's GUID, never the name. Blizzard's API returns no titles. They leave this file from the upload page, with
  the collection choice ticked and a verified grant, or through the Desktop App's private sync described below.
- **Raid lockouts** (`lockout_owned`, owned.lua): this week's saved instances, under the same key. Blizzard's API
  returns no encounters. They are never part of an upload file. The Everloot Desktop App's private sync sends them
  only for a character you linked, and everloot.app keeps only the categories you switched on. Each read replaces this
  character's rows, and `/everloot completion off` deletes them with the rest. Your boss kills (`boss_kill_owned`,
  boss_kills.lua) stay on this computer too, and are deleted the same way.
- A changed catalog entry replaces its earlier row. Titles are additions.
- The file stays bounded: at most 1500 achievements read and about 3 MB of completion rows and remembered ids in
  all. A limit reached stops recording, says so once in chat that session, and `/everloot status` says which one.
- Combat (`PLAYER_REGEN_DISABLED` or `InCombatLockdown`) pauses a read between frames; it picks up when
  combat ends. `/everloot completion off` also stops a read that is under way.
- The reputation list is the rows the reputation window shows now; a collapsed header hides its factions
  and the module never expands one. `/everloot status` says how many headers were collapsed.

## Settings

Esc > Options > AddOns > **Everloot**, or `/everloot options`, lists every module with a switch: what it
records and where it goes. A switch that has a `/everloot` command runs that command, so the page and chat
always agree. Changes apply after a reload; the page has a **Reload now** button. A client without the
game's options API shows the page as a window instead.

Four switches on the Tooltips page choose what item tooltips show: **prices** (community market, your scan,
vendor), **your history** (your sales and purchases from the gold ledger), **sources** (drops, vendors,
reagents, zones) and **disenchant estimate** (observed yields and their estimated value). All four are on for a new
install, are saved in your SavedVariables, record nothing and apply at once, without a reload.

The disenchant row applies to eligible armor and weapons in Forever's game-file bands, excluding items the files
flag as not disenchantable. Observed yields need three contributing installs. The Desktop App writes them into
EverlootPrices, refreshed daily; reload to read an update. A band the file holds no results for shows a quiet "not enough data yet" line; a file without the block (no Desktop App, or an older one) adds nothing to the tooltip.
The tooltip shows each material's icon, runtime name, observed chance and units range, plus an expected gross
value using mean units across all disenchants and prices for your current realm and auction house. Missing prices
make it "at least"; missing, stale or thin prices prevent a comparison. Estimates are before auction fees and do
not promise a sale, profit, eligibility of an individual bound copy, or the character's enchanting skill.

Open **Disenchanting** in the main Everloot window for today's (UTC) and the last seven days' disenchants,
materials, estimated gross value, known cost and estimated difference, followed by recent entries. Up and Down
page through the list. Disenchant with Everloot's open-world collection on to start. The last 500 entries per
character stay only in `EverlootDB.disenchantLog`, outside uploaded records. When the local ledger knows a purchase,
the entry saves that item's average paid per unit on this realm at capture time; this is a cost estimate, not proof
of what that particular copy cost. Unknown costs stay unknown, and a period with any unknown cost shows no total
difference. Materials are valued at current house prices when viewed, so their estimates can change after a reload.

### Choosing features

A few seconds after the first loading screen, every install (new or updated) is asked once which parts of Everloot
to use, before the player-names question. `/everloot setup` asks again at any time. There are three answers:

- **Everything** turns on the item tooltip lines, the auction house tab and its first-visit introduction, the Everloot window
  and minimap button, and the character switches in Data Sharing (gold, characters, guild).
- **Collect data only** keeps World, Recipes and trainers, Zone map corners and Auction scans on, so the Everloot
  tab at the auction house still sends the scans you start. It turns off the tooltip lines, the first-visit introduction, the
  window, the minimap button and its button drawer, the merchant and mailbox helpers and the character
  switches. For players who keep Auctionator or other addons for those jobs.
- **Choose myself** changes nothing and opens the settings.

No answer changes the census, player names, the installed addon list, the completion tracker or local inventory snapshots. Those keep their
own switches, since turning them off deletes their rows. Tooltip lines change at once; the rest changes after a
reload, which the window offers. It also says where the Desktop App is (everloot.app/addon), which uploads after
logout or `/reload`, and that player names are on in a new install, with `/everloot players off` to turn them off
and everloot.app/players/opt-out to hide a character.

## The Everloot window

Left-click the minimap button, or `/everloot window`, for the Everloot window. Its sidebar has five items. Drag the
grip in its bottom-right corner to make the whole window bigger or smaller (from three quarters to one and a half times,
never larger than the screen); right-click the grip for the normal size. The size is kept for the next session.

- **Home** lists every character this install has seen: gold, level, professions, raid lockouts (shown only while the completion tracker is on) and when it was last
  seen, with totals for each realm and for the account and a "This week" line (gold in and out for this character over
  seven days). Below it, the gold per hour session with a Pause button.
- **Gold** has four tabs. **Overview** shows every character's gold by realm and the last 30 days as bars. **Ledger**
  lists the money events by category, by day or by receipt. **Sales** lists auction sales one by one or by item.
  **Session** is the gold per hour session. Ledger and Sales can be set to today, 7 days, 30 days or all; Overview always
  shows the last 30 days. Overview, Ledger and Sales can be set to this character or the account; Session has neither.
- **Collection** shows achievements, reputation, titles, raid lockouts and quest chains (quests done of each chain's
  total) from the rows the completion tracker wrote, so it needs `/everloot completion on`; with it off the tab says so
  and has a button that runs that command. It shows this character, or the account: every character in the roster, each
  item done when any of them has it, with the name of the character that does. It is drawn as completionist addons
  draw their lists: headings in the game's gold that open and close with a click, each with how many of the marked
  items under it are done ("3 / 8 (37%)"), an icon on each row, a green check for done and a red cross for missing,
  and the game's tooltip on hover. The mouse wheel scrolls the list.
  - **Dungeons & raids** lists the instances players agreed on, their bosses with your kills and this week's
    lockouts. A boss opens on its drops: the public drop rates (three installs) the Desktop App wrote into the price
    file, from the creatures this install saw in that fight or, failing that, from the NPCs the file names as the
    boss is named (the boss's tooltip says which). Each drop shows its rate and loot windows; a drop that is a mount,
    battle pet, toy or appearance is marked with whether this character has it, read from the game. Without the
    price file's drops block the bosses stay plain rows and the summary says why.
  - **Mounts** lists every mount the game lists for this character (the other faction's only once collected), with
    its source. **Pets** (one row per species) and **Toys** list what the Pet Journal and the Toy Box list under their
    own filters; clear those filters in the Collections window to see everything. These three are read from the game
    and never recorded.
- **Professions** shows each profession in the profession book with its rank and the recipes recorded for it by
  difficulty colour. **Crafting costs**, the button at its bottom, lists the recipes this install recorded under this
  character's profession names (recipe rows carry no character, so an alt's recipes in the same profession show too)
  with what their reagents cost at the price file's market value (a vendor's price instead when a vendor you visited
  sells the reagent for less), what one product item sells for and an estimated profit, sorted by that estimate or by
  name, and says how old the price file is. How many items a craft makes is not recorded, so the estimate assumes one
  item per craft. A reagent without a price makes the cost unknown, never zero; so does a reagent name this install
  has seen with two item ids. Choose a recipe and a count for what to buy: each reagent, how many and what they cost,
  with Up and Down past five reagents. **Add to shopping list** adds those reagents to your active shopping list (see
  Shopping lists). Your bags and bank are not read.
- **Settings** opens this page. "What you've added", the row counts in your saved file, is on that page now.

Ask, Build plan and Auctions are no longer in the sidebar. `/ask` and `/everloot plan` (the planner workspace) still work.

The Gold tab and the character list on Home read two tables that exist only in your SavedVariables file.
`EverlootDB.roster` holds one row per character you log in with (name, realm, class, level, faction, gold while the
gold module is on, professions); the **Your characters** row in the options turns it off. `EverlootDB.ledger` holds
your money events, your auction sales and each character's closing gold for each day, kept per character: up to 5,000
events and 90 days, 2,000 sales and 400 daily closes, the oldest dropped first. For days before the ledger existed, the
Gold tab also reads the older `money_event` rows from the file, without copying them. Neither table is a record, neither is
read by an upload, and nothing in the window uploads anything. An auction sale is recorded when you collect its
letter at the mailbox, from the invoice: item name, count, the price after the auction house's cut and the deposit.
The buyer's name is never read.

When the game says a buyer was found, Sales lists the item at once as "sold, gold pending". Collecting the letter
turns that row "paid" with the price; a row with no letter after 48 hours reads "unmatched", and a letter collected
later still fills it. The ledger also records repairs and vendor purchases at an open merchant (a repair paid from the
guild bank costs you nothing and is left out), gold traded with another player (Trades in, Trades out), gold sent with
a letter (Mail out) and gold in a letter from one of your own characters (Mail in). A letter from anyone else, or the
auction house's own letter, adds no Mail in row. Gold that goes from one of your characters to another is marked as
such: with the account selected it leaves the totals and shows on its own line, "Moved between your characters";
with one character selected it counts as that character's gold in or out. The trade partner's and the letter's names
are compared with your own characters' names and then dropped. These categories are local only and never uploaded.
Today, 7 days and 30 days start at UTC midnight (today, today and the 6 days before it, today and the 29 days before
it).

The window is built the first time it opens and registers no events, so recording never depends on it. An error
inside it closes it until `/reload` and `/everloot status` names the error. The **Everloot window** switch on the
settings page turns it off; the minimap button then opens the plan workspace as before. The crest it uses is
`media/crest.tga`, which the release zip carries beside the code.

The minimap button sits on the minimap's edge like other addons' buttons, at the top-left at first; drag it around the edge to move it, and it stays there. Hovering it shows what its clicks do. The Minimap button switch on the settings page hides it after a `/reload`; `/everloot window` still opens the window.

The minimap button also holds other addons' minimap buttons. Buttons made with LibDBIcon (most addons' round
minimap buttons) move into it at login when the drawer is enabled. It starts off for new installs; existing
players keep their saved setting, and upgrades without a saved toggle keep it on. Use `/everloot buttons on`
to enable it. Hover the button and they show in a small panel beside it, on the side away from the map, which closes
when the mouse leaves. Its clicks stay the same. Blizzard's own minimap buttons and any other button are left
where they are. The first time it gathers a button, chat says how many. `/everloot buttons off`, or the **Addon
buttons in the Everloot button** switch on the settings page, turns it off; the buttons go back around the
minimap after a `/reload`.

## Census

On in a new install, which says so once in chat; an install from before the census keeps it off until
`/everloot census on` (then `/reload`). It counts who plays what: race, class, level and faction,
never a name. It leaves your computer from the upload page, or from the Desktop App if you allowed the
census there. `/everloot census` says whether it is on and how many rows it holds; `/everloot census off`
stops it at once and deletes every row it wrote.

- **Your own characters** (`census_self`): at login and at each level-up, your character's game id
  (GUID), race and class tokens (`UnitRace` and `UnitClass` second return, e.g. `Scourge`, `HUNTER`),
  level, faction and realm.
- **Players you see** (`census_seen`): the same fields, without the realm, for players near you: ones you
  target, mouse over or group with, and ones the game shows a nameplate for (`NAME_PLATE_UNIT_ADDED`; your
  own nameplate settings decide which players get one). Each row says how you first saw the player that day
  (`target`, `mouseover`, `group` or `nameplate`). Units
  with a hidden level, no race, class or faction, or a GUID that is not a player's are skipped, and so
  are you.
- Nothing else is read about another player: no name, guild, gear or position.
  `addon/tests/census_contract.py` fails if `census.lua` names a call that could read them, and lists
  every call the module may make.
- One row per character per UTC day, with the latest level that day. At most 2,000 rows of each kind;
  the oldest days go first. A player already recorded today at the same level costs no new memory, so
  mouseover and nameplates in a busy city stay cheap. New players are read from nameplates at most 10 a
  second; the rest are read when their nameplate shows again.
- The rows are sent from the upload page, which counts them first ("312 characters seen, 2 of your
  own"), or by the Desktop App if you allowed the census on its setup screen or in its settings. The
  command-line uploader never sends them. The server replaces each GUID with a keyed hash before it
  stores anything, and the site publishes only counts that cover at least 10 characters from at least
  3 installs (`docs/design/specs/2026-10-18-census-design.md`).

## Players

On in a new install; an install from before 17 November 2026 keeps its choice, off unless the player turned it on
(`docs/design/specs/2026-11-17-blizzard-api-first.md`). The names feed the armory's discovery of characters on
Blizzard's API (`docs/design/specs/2026-10-20-player-pages-design.md` for the player pages). This is the one module
that reads other players' names and guilds, so it is separate from the census, which never does. A new install says
once in chat, and in the feature chooser, what it records and how to turn it off. `/everloot players` says
whether it is on and how many characters it holds; `/everloot players off` stops it at once and deletes every row.
An install from before with it off is asked once, in an Everloot window a few seconds after the first loading screen
and never in combat: **Turn on** runs `/everloot players on`, **Leave off** keeps it off. A new install, already on,
is never asked. The window says what is recorded and points to `/everloot players off` and the hide form
(everloot.app/players/opt-out). Either answer, or `/everloot players on|off` typed or set on the settings page, is
saved as `playersAsked`, and the question never comes back. `addon/tests/options_contract.py` holds the rules.

- **What a row holds** (`player_seen`): name (`UnitName`), realm (`GetRealmName`), race and class tokens
  (`UnitRace`, `UnitClass`), level (`UnitLevel`) and the guild name when the game shows one (`GetGuildInfo`).
  The date is the row's `capturedAt`; the site keeps the day, not the time.
- **A second row** (`guild_kill`): when `ENCOUNTER_END` reports a kill inside a dungeon or raid and the game
  shows your character in a guild, the guild name, realm, your faction (`UnitFactionGroup`), the encounter, the
  instance map id and difficulty (`GetInstanceInfo`) and the time. No character name. At most 60 a UTC day; written
  only while the module is on, and `/everloot players off` deletes these rows with the others. The guild page
  counts a kill once two installs report it.
- **Whom it reads**: your own characters at login and at each level-up, and players you target, mouse over or
  group with (`PLAYER_TARGET_CHANGED`, `UPDATE_MOUSEOVER_UNIT`, `GROUP_ROSTER_UPDATE`). Not nameplates, not the
  guild roster, not the who list, not inspection. Players from another realm are skipped.
- **Nothing else**: no position, gear, GUID, chat or history. `addon/tests/players_contract.py` fails if
  `players.lua` names a call that could read them, and lists every call the module may make.
- **Load**: a player already read is left alone for 10 minutes, target and mouseover reads are at least a
  quarter of a second apart, at most 300 new characters a UTC day, at most 1,000 rows in the file (the oldest
  go first, about 200 KB). One row per character, kept in place.
- **Sending**: from the upload page, which counts the rows first, and from the Desktop App while its "Send the player
  pages with the uploads" setting is on (on in a new Desktop App install). The command-line uploader never sends them.
  The site drops them until the owner has turned the player pages on.

## Boss pulls

Not in any build until `E.RUN_RECORDS` is on (`docs/RELEASING.md`, "Release gates"). Then it is on by default, new
install or upgraded, and says so once in chat. After each boss pull in a dungeon or raid it writes one `pull_summary`
row: the boss, kill or wipe, how long it took, and for each member of your group their name, class, role and the
damage done, healing done, damage taken and deaths that the game's own damage meter (`C_DamageMeter`) shows.
`/everloot pulls` says whether it is on and how many pulls it holds; `/everloot pulls off` stops it at once and deletes
every row.

- **No combat log.** Forever restricts `COMBAT_LOG_EVENT_UNFILTERED`, and the module never registers it. It reads the
  meter's totals once per pull, after combat ends, when the client stops hiding them. A total the client still hides,
  or a member with no meter line, is left out of the row, never written as zero. A client without the meter gets rows
  with the group and assigned roles only, and `/everloot status` says so.
- **Role**: the group role the game shows (`UnitGroupRolesAssigned`), marked `assigned`; without one, healer when
  healing done was larger than damage done, else damage, marked `inferred`. A tank is never inferred.
- **Nothing else** about another player: no gear, talents, guild, position or chat. `addon/tests/pulls_contract.py`
  lists every call the module may make.
- **Size**: about 150 bytes a member. At most 200 pulls and 2,000 member entries in the file (about 300 KB); then it
  pauses like every other kind.
- **Matching**: a meter line goes to a member by `isLocalPlayer`, then GUID. A line whose GUID is readable but not in
  the group (a pet, a creature, a stranger) is ignored; the name is used only when the GUID is hidden and the class
  agrees, and two lines for one member leave that total out.
- **Sending**: from the upload page, which counts the rows first, or the Desktop App; the command-line uploader never
  sends them. The site keeps them privately for a year in their own tables, shows them nowhere, and deletes any
  character someone hides on the site's hide form. None of this has run in the Forever client yet.

## Linking a character

`/everloot link <code>` links the character you are playing to your everloot.app account. The site shows the
code (`EL-7K3Q-9P`) to a signed-in player; it works once, for 15 minutes. Nothing happens without the command.

- **What a row holds** (`character_link`): the code, your character's name, realm, race, class, level, faction
  and GUID, and the completion key for it. Only your own character is read.
- **Sending**: after `/reload` or logout, the Everloot Desktop App, signed in with permission to link
  characters, sends the row to your account's link endpoint and nowhere else. Uploads never carry it. The site
  keeps a keyed hash in place of the GUID.
- **What a link is**: a claim made from this file, not proof that you own the character. If another account
  links the same character, both links are frozen.
- A new code on the same character replaces its row; at most 10 rows are kept. `/everloot link` says how many
  there are and `/everloot link clear` deletes them.
  `addon/tests/link_contract.py` lists every call the command may make.

## Talents, selftest and the plan panel

### Bring a website plan into the game

Open `/everloot` for the **Talents / Raid** workspace, or load a plan straight into the plan panel with
`/everloot plan <share code>`.
Right-click the minimap button, or use `/everloot options`, for collection settings.
`/everloot status` still prints the collector status.

1. Make a build on everloot.app's talent calculator or raid planner and choose **Copy for addon**.
2. Open the matching tab in the addon, paste the link or code, and click **Import** (or press Enter).
3. Talents shows your progress, and the next point when the plan carries a spend order (see
   [Spend order](#spend-order)). Raid compares class counts per group and checks buffs on the current
   roster. Apply points and arrange players yourself.

Talent export copies the selected set only. Talent links with two sets import the first; a second-set-only
link imports that set. A link carries each set's spend order beside its code, `#plan=<code>&order=<order>`
for the first set and `#plan2=<code>&order2=<order>` for the second, and the set that loads takes its own
order only. Paste links into this Import box: `/everloot plan` takes a bare share code, not a link. For
saved short links, open the website and use **Copy for addon** to choose the set.
Raid codes preserve planned talent trees for the website. The addon cannot verify another player's talent
choices or identify players from a class-only code.
Differences in game build remain visible. Imports stay in your local SavedVariables file; roster names
are never saved by this workspace. **Copy plan link** returns the loaded set to the website under the same
keys, with the order it came with when the addon could read it; an order it could not read is left out,
never made up. **Copy current raid** opens your actual roster there. Use Ctrl+C in the selected field.

The window is created when opened, refreshes on relevant character/group changes while visible, and
uses no polling loop. Escape closes it. This workspace still needs a live-client layout and behavior
check; a passing Lua contract is not an in-game test.
Drag its header beside the game's talent window to keep the next-point highlights visible.

- **Talents** (read live, never recorded). Reads your build through `C_Traits` and `C_ClassTalents` when a
  command or the plan panel needs it: the active spec group and, once dual spec is unlocked at level 40, the second
  one, with every spent node, its ranks and choice, and Blizzard's own loadout string from
  `C_Traits.GenerateImportString` when the client returns one (`exportStatus` says `ok`, `unavailable`, `failed`,
  `empty` or `unexpected`). No `talent_snapshot` row is written: Blizzard's API supplies talents to the site.
  `/everloot talents` prints each group and a share code.
- **Selftest.** `/everloot selftest` checks each talent API, that it returns sane data, and that the
  loadout export and import functions exist (`ImportLoadout` and `ViewLoadout` are never called). It
  prints `PASS`, `FAIL`, `SKIP` and `INFO` lines and saves them under `selftest` in the SavedVariables file.
  Run it once with the talent window closed and once open. It also prints your race token (`INFO player
  race`), the value the census stores.
- **Plan panel (display only).** `/everloot plan <share code>` loads an Everloot talent plan and shows,
  beside the talent window, where your build differs and, for a plan with a spend order, the next point to
  spend. A pasted code has no order; a link brings its own through the workspace's Import box.
  `/everloot plan` reopens it (it also has a paste box), `plan hide` closes it, `plan clear` forgets it.
  When the talent window is open it also puts a green overlay on the next talent, when there is one, and
  red ones on mismatches. It never spends a point, clicks, imports a loadout or acts for you. The plan and
  its order are kept in your SavedVariables file.
- **Saved builds.** When the Desktop App has synced your everloot.app builds into the `EverlootBuilds`
  slot addon, `/everloot plan` also lists them in chat, this character's first (the label's name, and its realm when it has one), then the rest of your class,
  and `/everloot plan <number>` loads one (`/everloot plan <number> 2` loads its second talent set, marked `[2 sets]` in the list).
  Each set keeps its own planned or provisional spend order when available; its code, validated order and set
  are kept in SavedVariables and in Copy plan link. Missing or unusable metadata leaves ranks readable with
  unknown order. Older version 1 slot files still load. Addon 0.3.12 ignores the new order fields and keeps
  ranks only; update the addon to follow spend order. Nothing is uploaded by selecting a build.

### Share code, version 1

One line of text, safe to paste into chat or a URL fragment. The web calculator and the addon use the
same format (see `docs/2026-10-17-talent-share-code.md`):

    EL1-<class>-<spec>-<build>-<payload>

| Field | Meaning |
|---|---|
| `EL1` | Format version 1. A reader refuses a version it does not know. |
| `class` | Lowercase class token, as `UnitClass` gives it, e.g. `mage`. |
| `spec` | The client's spec id for the class (Forever has one per class; the builders study reads 1482 and 1484 to 1491 from Blizzard's files, pending `/everloot selftest`), or `0` when unknown. A plan with a spec id that differs from yours loads with a warning. |
| `build` | Client build the plan was made on, e.g. `1.60.1.70450`. A different build shows a warning because node ids can move. |
| `payload` | base64url (RFC 4648 section 5, no `=` padding) of the ASCII text `node:rank,node:rank:choice,...`. |

`node` is the client's trait node id, `rank` is the target rank (1 to 50), and an optional third number is
the zero-based entry of a choice node. A node absent from the list is planned at zero. The site lists the
items by node id, and their order is not a spend order. Example:
`EL1-mage-1482-1.60.1.70450-OTAwMDE6Miw5MDAwMjoxOjEsOTAwMDQ6Mg` carries `90001:2,90002:1:1,90004:2`.

### Spend order

A plan can carry the order its points are spent in, as a token of its own beside the code:
`O1p-<sequence>` when a player planned it, `O1g-<sequence>` when a tool generated it. The format, its
64-point limit and its test vectors are in `docs/2026-10-17-talent-share-code.md` under "Spend order".
For the example code above, `O1p-AABCC` is both points in 90001, then 90002, then 90004 twice.

- With an order, Talents names the next point: the first point in the order you have not spent, even
  when the game says it cannot be bought yet. A generated order is labelled provisional, which is neither
  a recommendation nor a record of anyone's play. The addon does not check that each point could be spent
  at its place in the order; the game says whether the next one can be bought now.
- Without one, the order is unknown and no point is named next. Talents lists the missing points the
  game says you can add now, none of them first, and apart from them any the game says nothing about.
  Item order and node ids are never used as an order.
- An order the addon cannot read (damaged, made by a newer version, of a kind it does not know, over 64
  points, or not matching the code's points) leaves the talents loaded, and Talents says why the order is
  unknown. An order that names a talent your tree does not have is not followed either.
- Addon 0.3.12 loads the talents from these links but not their order: it stops at `&`, and still names
  a next point from the code's item order.

## Test it

The contract tests run the Lua in real Lua 5.1 through `lupa`:

    python -m pip install lupa==2.6 jsonschema==4.25.1
    python addon/tests/run_all.py

`run_all.py` holds the one list of tests that pull-request checks, releases and nightlies all run, and fails
if a test script in `addon/tests/` is missing from it. Run one test on its own with
`python addon/tests/<name>.py`. The two planner tests, `raid_plan_contract.py` and `planner_contract.py`, run as their
own CI step.

Run them from the repository root. CI also rebuilds the zip. For a version that is not released yet it
fails if the zip differs from the one committed in `web/public/downloads/`, so commit the rebuilt zip
with the change. For a version that is already tagged, the published zip stays as it is and the next
release builds a new one.

## Where things live

```
addon/
├── Everloot.toc        Interface 16001 (Forever 1.60.1), SavedVariables: EverlootDB
├── core.lua            event dispatch, module registry, toggles, rolling store, /everloot
├── modules/
│   ├── openworld.lua   target/mouseover sightings, NPC window places, loot windows, merchant windows
│   ├── itemfacts.lua   armor, stats and resistances from the item tooltips you see, once per item and build
│   ├── guild.lua       roster, attendance, saved lockouts (published only through an officer)
│   ├── roster.lua      your own characters for the window's Home: name, realm, class, level, gold, professions; local only
│   ├── ledger.lua      the gold ledger's local store for the window's Gold tab; never uploaded
│   ├── auctions.lua    full auction-house scans you start (Forever); listed buyouts on older clients; on in a new install
│   ├── gold.lua        your own gold: loot, quests, vendors, flights, mailed auction sales, postage, buyouts
│   ├── professions.lua recipe colours at your rank (C_TradeSkillUI); required rank and cost from trainer windows
│   ├── ask.lua         /ask stores a question; the Everloot Desktop App's answers show after /reload
│   ├── link.lua        /everloot link: ties the character you play to your everloot.app account
│   ├── options.lua     the settings page (Esc > Options > AddOns > Everloot, or /everloot options)
│   ├── minimap.lua     the minimap button: left-click the window, right-click the settings
│   ├── drawer.lua      the button drawer: other addons' minimap buttons gathered into the Everloot button
│   ├── shopping.lua    shopping lists saved in your file: items, wanted counts, max prices; one search per press
│   ├── auctiontab.lua  the Everloot tab at the auction house: scan, cooldown, Share now, price lookup, shopping lists
│   ├── addons.lua      your installed addons' names, titles and versions; off until enabled
│   ├── mapbounds.lua   each zone's corners in world coordinates, once per zone per build
│   ├── talents.lua     your talent build per spec group, read live, plus the game's own loadout string
│   ├── completion.lua  achievements, reputation, titles, quest chains: catalogs and your titles; off until enabled
│   ├── owned.lua       this character's raid lockouts; runs with the completion tracker
│   ├── census.lua      race, class, level and faction of your characters and players you see; on in a new install
│   ├── players.lua     name, realm, race, class, level and guild of your characters and players you see; on in a new install
│   ├── pulls.lua       each boss pull: your group's names, classes, roles and damage meter totals; on once released
│   ├── selftest.lua    /everloot selftest and /everloot talents
│   ├── plan.lua        share code reader and the display-only plan panel
│   ├── planner.lua     the planner workspace: website talent and raid plans beside your character; /everloot planner
│   ├── raid_data.lua   raid buff list generated from web/src/data/game-data/raid-*.json
│   ├── raid.lua        /everloot raid: buffs missing per group, and a raid share code; display only
│   ├── prices.lua      item tooltips: your latest scan, the Everloot Desktop App's community prices and your sale history
│   ├── drops.lua       item tooltips: where an item drops, from the public rates in the same file
│   ├── gph.lua         gold per hour sessions, kept in your file only
│   ├── conveniences.lua  sell greys and repair at a merchant, Collect all at the mailbox; each off until enabled, no records
│   ├── window.lua      the Everloot window: Home from what the file holds; built on first open, no records
│   ├── view_gold.lua   the window's Gold tab: gold by realm, the ledger, auction sales, the gph session; display only
│   ├── view_collection.lua  the window's Collection tab: achievements, reputation, titles, lockouts, quest chains; display only
│   └── view_professions.lua  the window's Professions tab: each profession, its rank and recorded recipes, crafting costs; display only
├── media/crest.tga     the crest, 128 px, packaged beside the code
└── tests/              Lua 5.1 contract tests and their fixtures
```

Every Blizzard call is guarded, so a system missing from the client disables its module instead
of raising an error.
