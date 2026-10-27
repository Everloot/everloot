# addon/: the Everloot collector

The in-game addon for WoW: Forever. It records what you see while you play (sightings, loot
windows, vendors, full auction-house scans you start, recipes, trainers, your own gold, the world
position of each zone you enter) into its SavedVariables file, shows `/ask` answers from the
companion, and adds auction prices to item tooltips. It uses only the game's addon API and never
plays the character. Records match the upload contract (`packages/protocol`, see its `schema/records/`) field for
field.

**Status:** 0.3.10 beta. The automated contract tests pass; the in-client checks in
`docs/2026-10-08-beta-client-checklist.md`, `docs/2026-10-18-addon-0.3.2-beta-checklist.md`,
`docs/2026-10-19-addon-0.3.3-beta-checklist.md` and `docs/2026-10-21-addon-0.3.10-launch-checklist.md` are still open, and the full scan
(`docs/design/specs/2026-10-16-forever-market-design.md`) has not run in the Forever client.

## Run it

Download the zip from everloot.app/addon, or build it from the repository root:

    python scripts/package-addon.py

That writes `web/public/downloads/Everloot-<version>.zip`. Extract `Everloot/` into the Forever
client's `Interface/AddOns/`, `/reload`, then run `/everloot status`. Auction capture is on in a new
install (`/everloot auctions off` turns it off). At the auction house, open the **Everloot** tab after
Blizzard's tabs and click **Scan this house** (or type `/everloot scan`) for a full scan: at most one every 15 minutes, read in chunks, summarised per item,
and the last three scans per realm kept. Nothing scans without that click. The tab shows the cooldown,
whether the last scan is in your saved file yet, a **Share now** button (a `/reload`, which writes the
file so the Desktop App can send it) and a price lookup with the tooltip's lines. If the tab cannot be
added, an **Everloot scan** button takes its place. The list of your
installed addons is off until `/everloot addons on`; it is sent only from the upload page, after
its preview. `/everloot addons off` stops it and deletes every recorded addon row.

A scan that gets no answer from the auction house in 30 seconds stops and gives the cooldown back.
Tooltip prices show the date the companion last fetched them and flag them as stale after two days.
Below the prices, the tooltip shows where the item drops when three installs looted the source: each rate as
drops of loot windows, with its installs and the date of the uploads behind it, from the drop rates the Desktop
App writes into the same `EverlootPrices` file. Once that file is in the game, a missing price or drop source is
said in one grey line; nothing is written to your SavedVariables. `addon/tests/drops_contract.py` holds the rules.
Nothing in the addon calls a buy, bid or post API; `addon/tests/market_contract.py` traps them.

Each scan records your faction (`faction`) and which house it read (`house`): Alliance or Horde from the
auctioneer's faction, Neutral for a goblin house whose auctioneer has none, and nothing when the client
gives no auctioneer to read. The game files list separate Alliance, Horde and Blackwater (neutral) houses
with different cuts, so the site keeps a market per house next to the realm-wide one.

When scans are on, the cooldown is over and no scan is running, opening the auction house shows a small
**Scan prices for Everloot** prompt beside it, once per visit. One click scans; closing it hides it until
the next visit. It never scans by itself. `/everloot scanprompt off` turns it off (the **Everloot scan**
button and `/everloot scan` still work). With scans off, the first visit prints one line saying how to opt in.

## NPC and quest facts

When you target an NPC the addon also notes its creature type and rank, and when you accept a quest it
records the quest's title, level, quest log header (category), suggested group size, tag, giver and your
faction (Alliance or Horde, no name).

For the world map, an NPC window (merchant, gossip, quest, trainer, flight map, bank, auction house, stable,
innkeeper) records where you stand as that NPC's place (`positionKind = "interaction"`) with a `role` for the
service, once per NPC, role and zone. Targeting still records `positionKind = "player"`, which never becomes a
pin. Looting an object adds where you stand (`mapId`, `x`, `y`), a `gatherKind` (herb, ore, chest, fishing,
other) from the spell you cast just before (`UNIT_SPELLCAST_SENT`) and the object's name from that cast's
target (`sourceObjectName`). Trainer rows carry `trainerNpcId`. Targeting rows are kept once per NPC, zone and
spot (rounded to 1 on the 0..100 scale). Window rows and object loot rows each have their own 2,000-row cap,
apart from targeting rows and creature loot, so `/everloot status` can show `npc_sighting (targeting)` paused
while windows still record. A rare or a treasure the minimap shows (`C_VignetteInfo`) is recorded at its own
position, as the vignette API gives it: a creature as an `npc_sighting` with `positionKind = "vignette"` (its own
share and cap), a game object as an `object_sighting`, once per vignette, zone and spot. Zoning into a dungeon or
raid records an `instance_entrance`: the instance from `GetInstanceInfo` and where you stood outdoors when the
loading screen started (`PLAYER_LEAVING_WORLD`), once per instance and zone; a dungeon finder teleport records
none. A boss fight's end inside one (`ENCOUNTER_END`) records an `encounter`: kill or wipe, difficulty, group size
and the bosses' creature ids when the client sends them. None of these has run in the Forever client yet. The quest-log calls (`GetQuestLogTitle`, `C_QuestLog.GetQuestTagInfo`)
have not been tried in the Forever client; a call that is missing or returns something unexpected records
nothing for that field. The site shows each value only after 3 installs agree.

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
- Each item is valued from the Everloot market value on your realm (the file the Desktop App or companion
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

Off until `/everloot completion on` (then `/reload`). It reads your achievements, reputation, titles and
completed quests with the calls Forever's own windows use, in chunks across frames, and waits out combat.
`/everloot completion` reads now; `/everloot completion off` deletes every row it wrote. It never tracks,
expands, clicks or changes anything.

- **Catalog rows** (`achievement_catalog`, `reputation_catalog`, `title_catalog`, `quest_chain_catalog`):
  ids, names, criteria text, standing headers and quest ids. No player data. The site lists an entry after 3
  installs report it identically.
- **Owned rows** (`achievement_owned`, `reputation_owned`, `title_owned`, `quest_owned`): your character's
  progress under an 8-digit key made from your install id and the character's GUID, never the name. They
  leave this file only from the upload page, with the collection choice ticked and a verified grant.
- A changed achievement or standing replaces its earlier row. Titles and completed quests are additions.
- The file stays bounded: at most 1500 achievements read, 600 progress rows per character, and about 3 MB
  of completion rows and remembered ids in all. A limit reached stops recording, says so once in chat that
  session, and `/everloot status` says which one.
- Combat (`PLAYER_REGEN_DISABLED` or `InCombatLockdown`) pauses a read between frames; it picks up when
  combat ends. `/everloot completion off` also stops a read that is under way.
- The reputation list is the rows the reputation window shows now; a collapsed header hides its factions
  and the module never expands one. `/everloot status` says how many headers were collapsed.

## Settings

Esc > Options > AddOns > **Everloot**, or `/everloot options`, lists every module with a switch: what it
records and where it goes. A switch that has a `/everloot` command runs that command, so the page and chat
always agree. Changes apply after a reload; the page has a **Reload now** button. A client without the
game's options API shows the page as a window instead.

## Census

On in a new install, which says so once in chat; an install from before the census keeps it off until
`/everloot census on` (then `/reload`). It counts who plays what: race, class, level and faction,
never a name. It leaves your computer from the upload page, or from the Desktop App if you allowed the
census there. `/everloot census` says whether it is on and how many rows it holds; `/everloot census off`
stops it at once and deletes every row it wrote.

- **Your own characters** (`census_self`): at login and at each level-up, your character's game id
  (GUID), race and class tokens (`UnitRace` and `UnitClass` second return, e.g. `Scourge`, `HUNTER`),
  level, faction and realm.
- **Players you see** (`census_seen`): the same fields, without the realm, for players you target, mouse
  over or group with, plus how you first saw them that day (`target`, `mouseover` or `group`). Units
  with a hidden level, no race, class or faction, or a GUID that is not a player's are skipped, and so
  are you.
- Nothing else is read about another player: no name, guild, gear or position.
  `addon/tests/census_contract.py` fails if `census.lua` names a call that could read them, and lists
  every call the module may make.
- One row per character per UTC day, with the latest level that day. At most 2,000 rows of each kind;
  the oldest days go first. A player already recorded today at the same level costs no new memory, so
  mouseover in a busy city stays cheap.
- The rows are sent from the upload page, which counts them first ("312 characters seen, 2 of your
  own"), or by the Desktop App if you allowed the census on its setup screen or in its settings. The
  command-line uploader never sends them. The server replaces each GUID with a keyed hash before it
  stores anything, and the site publishes only counts that cover at least 10 characters from at least
  3 installs (`docs/design/specs/2026-10-18-census-design.md`).

## Players

Off until `/everloot players on` (then `/reload`), and meant to stay off until the player pages on the site are
switched on (`docs/design/specs/2026-10-20-player-pages-design.md`). This is the one module that reads other
players' names and guilds, so it is separate from the census, which never does. `/everloot players` says
whether it is on and how many characters it holds; `/everloot players off` stops it at once and deletes every row.

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
- **Sending**: only from the upload page, which counts the rows first. The Desktop App and the command-line
  uploader never send them. The site
  drops them until the owner has turned the player pages on.

## Talents, selftest and the plan panel

### Bring a website plan into the game

Open `/everloot` or left-click its minimap button for the **Talents / Raid** workspace.
Right-click the minimap button, or use `/everloot options`, for collection settings.
`/everloot status` still prints the collector status.

1. Make a build on everloot.app's talent calculator or raid planner and choose **Copy for addon**.
2. Open the matching tab in the addon, paste the code or link, and click **Import** (or press Enter).
   Website links go here; `/everloot plan` takes a share code only.
3. Talents shows your progress. With the plan's point order it names the next point of that order;
   without one it lists the points you can spend now, in no order (see "Point order" below). Raid
   compares class counts per group and checks buffs on the current roster. Apply points and arrange
   players yourself.

Talent export copies the selected set only. Talent links with two sets import the first; a second-set-only
link imports that set. A set's point order comes only from its own key, `order` with `plan` and `order2`
with `plan2`, so an order the link carries for the other set is not used. For saved short links, open the
website and use **Copy for addon** to choose the set.
Raid codes preserve planned talent trees for the website. The addon cannot verify another player's talent
choices or identify players from a class-only code.
Differences in game build remain visible. Imports stay in your local SavedVariables file; roster names
are never saved by this workspace. **Copy plan link** returns an imported plan to the website under its
own set's keys (`#plan=` and `&order=`, or `#plan2=` and `&order2=`), with its point order when the addon
read one; an order it could not read is left out. **Copy current raid** opens your actual roster there.
Use Ctrl+C in the selected field.

The window is created when opened, refreshes on relevant character/group changes while visible, and
uses no polling loop. Escape closes it. This workspace still needs a live-client layout and behavior
check; a passing Lua contract is not an in-game test.
Drag its header beside the game's talent window to keep the next-point highlights visible.

- **Talents** (on by default). Reads your build through `C_Traits` and `C_ClassTalents`: the active spec
  group and, once dual spec is unlocked at level 40, the second one. Each build is one
  `talent_snapshot` record: class, level, spec group, config id, tree id, every spent node with its ranks
  and choice, and Blizzard's own loadout string from `C_Traits.GenerateImportString` when the client
  returns one (`exportStatus` says `ok`, `unavailable`, `failed`, `empty` or `unexpected`). A row is
  written only when the build changes. The rows hold no character name. They are not in the public corpus
  until the data policy says how talent builds are published. `/everloot talents` prints each group and a share code.
- **Selftest.** `/everloot selftest` checks each talent API, that it returns sane data, and that the
  loadout export and import functions exist (`ImportLoadout` and `ViewLoadout` are never called). It
  prints `PASS`, `FAIL`, `SKIP` and `INFO` lines and saves them under `selftest` in the SavedVariables file.
  Run it once with the talent window closed and once open. It also prints your race token (`INFO player
  race`), the value the census stores.
- **Plan panel (display only).** `/everloot plan <share code>` loads an Everloot talent plan and shows,
  beside the talent window, your progress and where your build differs. A share code alone has no point
  order, so the panel lists the points you can spend now; a website link pasted into the Talents tab's
  Import brings the plan's order. `/everloot plan` reopens it (it also has a paste box), `plan hide` closes
  it, `plan clear` forgets it. When the talent window is open it also puts a green overlay on the next
  talent of an ordered plan and red ones on mismatches. It never spends a point, clicks, imports a loadout
  or acts for you. The plan and its order are kept in your SavedVariables file.
- **Saved builds.** When the Desktop App has synced your everloot.app builds into the `EverlootBuilds`
  slot addon, `/everloot plan` also lists them in chat, this character's first (the label's name, and its realm when it has one), then the rest of your class,
  and `/everloot plan <number>` loads one as if you pasted its code (`/everloot plan <number> 2` loads its second talent set, marked `[2 sets]` in the list). Nothing is saved or uploaded for it.

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
the zero-based entry of a choice node. A node absent from the list is planned at zero. The site writes the
items in ascending node id order and the addon reads any order; item order is not a spend order. Example:
`EL1-mage-1482-1.60.1.70450-OTAwMDE6Miw5MDAwMjoxOjEsOTAwMDQ6Mg` carries `90001:2,90002:1:1,90004:2`.

### Point order

A plan can carry the order its points are spent in, as a token of its own next to the code: `O1p-...`
when it was planned in the talent calculator, `O1g-...` when a tool made a provisional one (see "Spend
order" in `docs/2026-10-17-talent-share-code.md`). The addon reads it from a pasted link, checks it
against the code and keeps it with the plan.

- With an order, the panel says who made it and names the next point of that order as point N of M. A
  next point the game does not offer yet stays next, marked not available; the panel never skips to a point
  the order spends later. Points spent ahead of the order are counted. A provisional order is labelled as
  one until the plan is replaced or cleared.
- Without one (a share code alone, a link made before orders, a saved build), the panel says the point
  order is unavailable and lists the points the game shows as open now, by name and unranked. Item order
  and node ids are never taken for a leveling order.
- A token that is damaged, newer, of a kind the addon does not read, over 64 points, or not matching the
  code's points leaves the order unknown: the talents still load, and the panel says why.

Addon 0.3.12 and earlier read the talents from these links and ignore the order: their next point follows
the code's item order, which is not a spend order. The point order reader has passed its Lua contract
tests only; it has not run in the Forever client yet.

## Test it

The contract tests run the Lua in real Lua 5.1 through `lupa`:

    python -m pip install lupa==2.6
    python addon/tests/event_identity.py
    python addon/tests/collection_contract.py
    python addon/tests/map_positions_contract.py
    python addon/tests/item_facts_contract.py
    python addon/tests/auction_contract.py
    python addon/tests/auction_tab_contract.py
    python addon/tests/options_contract.py
    python addon/tests/gold_contract.py
    python addon/tests/ask_contract.py
    python addon/tests/recipes_contract.py
    python addon/tests/answers_contract.py
    python addon/tests/addons_contract.py
    python addon/tests/mapbounds_contract.py
    python addon/tests/market_contract.py
    python addon/tests/scan_prompt_contract.py
    python addon/tests/gph_contract.py
    python addon/tests/talents_contract.py
    python addon/tests/plan_contract.py
    python addon/tests/raid_contract.py
    python addon/tests/completion_contract.py
    python addon/tests/census_contract.py
    python addon/tests/players_contract.py
    python addon/tests/conveniences_contract.py

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
│   ├── gear.lua        equipped item level sample, at most once an hour
│   ├── auctions.lua    full auction-house scans you start (Forever); listed buyouts on older clients; on in a new install
│   ├── gold.lua        your own gold: loot, quests, vendors, flights, mailed auction sales, postage, buyouts
│   ├── professions.lua recipe colours at your rank (C_TradeSkillUI); required rank and cost from trainer windows
│   ├── ask.lua         /ask stores a question; the companion's answers show after /reload
│   ├── addons.lua      your installed addons' names, titles and versions; off until enabled
│   ├── mapbounds.lua   each zone's corners in world coordinates, once per zone per build
│   ├── talents.lua     your talent build per spec group, plus the game's own loadout string
│   ├── completion.lua  achievements, reputation, titles, quest chains: catalogs and your progress; off until enabled
│   ├── census.lua      race, class, level and faction of your characters and players you see; on in a new install
│   ├── players.lua     name, realm, race, class, level and guild of your characters and players you see; off until enabled
│   ├── selftest.lua    /everloot selftest and /everloot talents
│   ├── plan.lua        share code and point order reader, plan links, the display-only plan panel
│   ├── raid_data.lua   raid buff list generated from web/src/data/game-data/raid-*.json
│   ├── raid.lua        /everloot raid: buffs missing per group, and a raid share code; display only
│   ├── prices.lua      item tooltips: your latest scan and the companion's community prices
│   ├── drops.lua       item tooltips: where an item drops, from the public rates in the same file
│   ├── gph.lua         gold per hour sessions, kept in your file only
│   └── conveniences.lua  sell greys and repair at a merchant, Collect all at the mailbox; each off until enabled, no records
└── tests/              Lua 5.1 contract tests and their fixtures
```

Every Blizzard call is guarded, so a system missing from the client disables its module instead
of raising an error.
