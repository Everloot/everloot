# Data policy

Where Everloot's data comes from, what we refuse to use, and why. It applies to the addon, the
site, the MCP server and every contribution. If a pull request adds data, it follows this page.

This is our reading of the rules, not legal advice.

## What we publish

**What players see in the game.** The Everloot addon records what happens around you while you
play: drops, vendors, auction prices you browse, recipes, trainers, gold in and out. The list of
your installed addons is recorded only if you turn it on with `/everloot addons on`, and it is
sent only from the website's upload page, after the preview names each addon. You choose
when to upload. On the website you preview everything before it is sent. The Desktop App sends
anonymous open-world events, and census rows if you allowed the census on its setup screen; the
command-line uploader sends only the anonymous events. Neither sends named data (guild, gear, gold,
collection) or the installed addon list: those stay on your machine. Player rows are a third case:
the Desktop App sends them only if you turn on "Send the player pages with the uploads" in its
settings, and until you do, they stay on your machine like the named data.

**What a Polestar Recorder file holds.** A player who records with the
[Polestar Recorder](https://github.com/fitzforge/polestar) addon (by fitzforge, GPL-3.0) can upload its
`Polestar_Recorder.lua` from the website's upload page. Everloot reads the file's format with its own
parser and uses none of Polestar's code. The file is converted in the browser, one session at a time,
into Everloot's own kinds: where the player stood while an NPC's window was open (a quest giver,
a quest turn-in, a gossip window offering quests, a vendor, a trainer, a flight master), stored as
`positionKind: "interaction"` like the addon's; NPCs the player killed or saw as a rare on its nameplate,
target or mouseover, where the player stood (`positionKind: "player"`, never a pin); rares the minimap
showed, at the rare's own position from the game's vignette API (`positionKind: "vignette"`); the
dungeons and raids the player zoned into, with the instance's name and type and the last position outside
it (`instance_entrance`); the boss encounters that ended inside, with their result and the bosses' ids
(`encounter`); treasures the minimap showed, at the object's own position (`object_sighting`); the quests
the player accepted with their title, level, giver, turn-in, reward items and the character's faction; and
loot windows with items. Rares and kills keep the level and rank the game showed. The file holds no NPC
level at a window and no reaction, so those fields are left out, never guessed. It does not say whether
the game's loot API named a window's source either, so its loot windows stay out of the public drop rates:
they are counted instead, and the NPC, object and item pages say how many were reported and are not yet in
the rates. Everything else in the file stays on your computer: character
names and realms, session names, notes typed with `/psrec mark`, Polestar's guide step titles, quest
objective text, routes, flight paths, talents and the rest. A character becomes a hash in the browser, keyed
with a random key that stays in that browser, so the name cannot be worked back from it; the server replaces that hash with an install id of its own, keyed with a secret: one half from the
character, one from the address the upload came from. Recorder install ids that share either half count as
one reporter, so a Recorder fact needs three characters uploading from three addresses, and one player's
alts or connections never confirm each other. The upload keeps a keyed hash of the address, as auction
scans do, and it is never published. Corroborated, these are Everloot's own data under CC BY-SA 4.0, like
any player upload.

Uploaded observations are public as individual, anonymous records, with no character names and
without the addon's install id. Each record carries a per-install pseudonym instead (`pub-` and 32 hex
characters, a keyed hash of the install id that cannot be turned back into it), so anyone can count
installs and check our counts. The facts the site states itself, such as drop rates, spawn points and recipe
ranges, appear only once at least three installs have reported them. Addon lists are the
exception to public records: they are never published row by row, only as counts for addons that
at least three installs report. Guild data is published only through an officer's
upload, and named records only with that person's sharing choice; a guild's boss kills (`guild_kill`, below) are
the exception, published through the guild pages once two of its members' installs report them. Player rows are a second
exception, described below: they carry character names, and they are never published as part of
the public records.

The player pages are a separate thing, and they are off until the owner turns them on. When the
players module is on in the game, the addon records one row per character: its name, realm, race,
class, level and guild, and the day it was last seen. It never records where a player was, their
gear, talents, professions, gold, achievements, earlier levels or guilds, which install reported
the row, the character's id, or a time of day. The table holds one row per character, matched
case-insensitively, and a newer sighting replaces the older one. A row is not corroborated: one upload
makes a page, and the page says the data is unchecked. Whether a page should wait for more than one
reporter is a question the lawyer review is answering (the player-pages design, section 13, question 7),
because counting the reporters would mean keeping who reported a row. A row is deleted 90 days after the
character was last seen, and a hidden character is deleted at once and never recorded again. The pages are
unverified information reported by other players, and Everloot makes no statement that a character
belongs to anyone.

The guild pages are off until the owner turns them on, like the player pages (the guild design,
`docs/design/specs/2026-10-24-guild-board-design.md`). While the players module is on, the addon also records
your own guild's boss kills: when `ENCOUNTER_END` reports a kill inside a dungeon or raid and the game shows your
character in a guild, one `guild_kill` row with the guild's name, the realm, your faction, the encounter's id and
name, the instance's map id and difficulty, the group size and the time. It holds no character name, no GUID and
nothing about who else was there; at most 60 are written a UTC day, and `/everloot players off` deletes them with
the player rows. `guild_kill` rows are never published row by row: they are not in the public corpus API or in
`corpus.ndjson`, so one install's report and a hidden guild's rows never leave. A kill is the guild's once two
installs report the same guild and boss, timed at the earliest of their reports; the guild pages, the guild tools and
the open data export's `guild-kills.ndjson` and `guilds.ndjson` hold only those, and only while the guild pages are on. A guild's page lists its agreed kills, its officers'
publication when they made one, and the characters the addon saw in that guild: these are player rows, each
already public on its own page, grouped by the guild the game showed, and the page says they are sightings, not
the game's member list. Anyone can hide a guild with the guild hide form, without an account or proof of office:
the guild leaves the pages, the ladder, the search and the export at once, and its kill rows are dropped at
intake from then on. Its characters keep their own pages, which the character hide form governs.

The addon also reads a few game facts about the NPC you target and the quest you accept, as the game
shows them to you. For an NPC: its creature type (Beast, Undead, Humanoid) and its rank (normal, elite,
rare, rare elite, boss). For a quest: the quest log header it sits under (a zone or a category), the
suggested group size and tag (group, dungeon, raid, PvP) when the game gives one, the NPC who gave it, and
the faction of the character that accepted it, Alliance or Horde, never the character's name. These are
facts about the NPC or the quest, not about the player, and the site never shows a faction next to a
person. Each is published only when three installs report the same value. A quest's side is shown as
Alliance or Horde when three installs on that faction report it and none on the other; it is shown as
Both when three installs on each faction report it; otherwise it stays blank, and it is never guessed from a
title, a giver or a zone. Nothing is read from the game's Creature or quest tables for these columns.

Places on the map come from where players stood, at two moments (addon 0.3.10). When an NPC's window
opens (merchant, gossip, quest, trainer, flight map, bank, auction house, stable, innkeeper), the
player is within a few yards of that NPC, so the addon records the player's position as the NPC's
(`positionKind: "interaction"`) with the service the window offered (vendor, trainer, quest giver and so
on), once per NPC, service and zone. When the player opens a herb, ore vein, chest or other object, its
loot row carries the player's position, how it was opened (from the spell cast on it) and the object's
name as the game showed it, taken only from a herb, ore or chest cast, so the target of any other spell (a
player you healed, say) never becomes a name. Where you stand when you only target or mouse over an NPC
(`positionKind: "player"`) is never used as the NPC's place. A Polestar Recorder file's NPC windows become
the same `interaction` positions, and its kills and rares seen on the unit become `player` ones. A rare or
treasure the minimap showed is at its own position, as the game's vignette API gives it (`vignette` for a
rare, an `object_sighting` for a treasure), so it can make a pin. An NPC pin needs three installs on the same
map; a treasure's, three installs within one cluster, as below; a dungeon entrance players zoned in from,
three installs on the same map, and it confirms the entrance the game files place rather than adding a
second one. A boss is listed for an instance once three installs report its encounter there. Instance,
encounter and object names arrive in the player's client language, so each is shown only when three
installs report the same one; an object's spawn point needs three installs within one cluster (positions closer than 1 on the
0 to 100 map scale), and a place seen by one or two installs is only counted, never drawn. An object's
name is shown only when three installs report the same one; otherwise it is "Object" and its id. Fishing
gives the zone only, never a pin. Object places come from play only: nothing is read from the game's
files for them.

**Item numbers players report.** *Proposed 2026-10-21, in the pull request that adds the `item_fact` kind
(the maintainer review).* The numbers on an item's tooltip that the game files do not hold (armour, block,
damage per second, each stat and each resistance) come from players' own tooltips (addon 0.3.10). When the
game shows the player an item's tooltip, the addon reads those numbers for the plain item, never an enchant or
a random suffix on the player's copy, and records the item id, which line, the number and the client build.
Nothing about the character is recorded, and nothing is read from a tooltip about anything other than an item.
These are player data like any other upload: public as anonymous records, under CC BY-SA 4.0, and stated on a
page only when three installs report the same number for the same line. A patch can change an item, so the
number is decided within the newest build that three installs reported. Each number shown says how many
installs reported it, from which build and when it was last seen. A line installs disagree on is not shown;
it stays `[?]`, and the tooltip says the installs disagree. The game files' tooltip carries these numbers only
where it is already shown (the item tooltip rule below).

Item pages may show how many distinct installs reported each tooltip line in its newest reported build
when fewer than three have reported it (for example, "1 of 3 installs reported"). These progress counts
are omitted for a line already agreed or contested in any build, include no reported value or install
identity, and do not lower the confirmation threshold.

Full auction scans are not public records either. They feed market values only, and a value is
published when three distinct reporters scanned the item. For that count, an upload containing a scan
is stored with a keyed hash of the address it came from (never the address itself). The hash stays in
private storage and is never published. A scan also records the scanning character's faction (Alliance
or Horde) and which auction house it read (Alliance, Horde or neutral), so each house can have its own
market values, published under the same three-reporter rule; no character, seller or buyer is recorded.

The addon's gold-per-hour sessions (`/everloot gph`) are personal: they stay in your SavedVariables
file, outside the records an upload reads, and are never sent to the site.

Completion tracking (addon 0.3.3, off until `/everloot completion on`) follows the same split.
Four catalog kinds (`achievement_catalog`, `reputation_catalog`, `title_catalog`,
`quest_chain_catalog`) hold only game facts the addon read from the game's own calls: ids, names,
criteria text, standing headers and quest ids, with no player data. They reflect what one character's
windows list, so they are not on the public allowlist and never leave the site raw: the pages (the
collections tool, and the database's achievement, faction, title and quest chain lists and pages with
their sitemap and search entries) and the MCP tool list an entry only after three reporters (distinct upload addresses, an IPv6 address counted by its /64 block, as the market counts them)
report it identically; there is no copied catalog, and flavour text is not collected. An achievement's
criteria wording is agreed separately: its page shows the list only when three reporters sent the identical
complete list (a cut-off or blank list is never counted), and the list never appears on the lists or in search. For that count an
upload containing a catalog row is stored with the same keyed address hash as a scan, kept private and
never published. Four owned kinds (`achievement_owned`, `reputation_owned`,
`title_owned`, `quest_owned`) hold one character's own progress under an opaque 8-digit key derived
from the install id and the character's GUID, never the name. They are named data in the `collection`
sharing category, like `collection_owned`, and are shown only while a verified install grant for that
category is live. All eight kinds are kept out of the public corpus and folded into a separate
completion rollup (latest row per character and entry). That rollup is private storage, but it records
which address hash and install created each catalog entry, so it links an address hash to an install
id. The link lasts until the rollup is rebuilt (`?rebuild=1`), which drops everything from uploads that
were deleted; deleting a player's uploads therefore takes a rebuild to remove the link. Turning the
module off deletes every one of these rows from the file.

The census counts who plays what. It is on in a new install of the addon, which says so once in chat; an
install from before the census keeps it off until `/everloot census on`. It leaves the player's computer
only from the upload page or from the Desktop App, if the player allowed the census there. It
records race, class, level and faction for your own characters as you log in, plus the realm name, and
for players you target, mouse over or group with. For other players it reads those four things only,
never their name, guild, gear or position. The addon keeps one row per character per day. Each row
carries the character's GUID, the game's id for it, only on the way to us: before anything is stored,
the site replaces it with a keyed hash (HMAC-SHA256 under a server secret) and keeps the server id, the
number inside the GUID that says which server the character is on. Without the secret nobody can turn a
GUID seen in game into our hash. If the secret is not set, census rows are dropped and nothing from them
is stored. So what is kept per character is the hash, the server id, race, class, level, faction, and
the realm name for your own characters, stored with the upload's install id like every other row.
Census rows (`census_self`, `census_seen`) are never published row by row and are kept out of the public
corpus, like addon lists. One install counts at most 500 players seen and 50 own characters a day, so
no one install can invent a crowd. Only counts are shown, and a count appears only when it covers at least 10
characters reported by at least 3 installs. Below that it reads "fewer than 10".

Blizzard hides some WoW: Forever item details until an item drops, and runs no public test realm.
Game files show what exists; play shows what is real. Everloot keeps the two apart and says which
is which.

**What the game files contain.** *Status: the table data is not published yet, except the talent catalog, the map layer, the
raid buff table, the client layer and the build changes described below.* A maintainer can read tables of a game's current build from the files Blizzard's
launcher downloads from its public CDN, the same files every player receives, and compare two
builds field by field. The [source ledger](sources/LEDGER.md) lists the tables we read. Those
snapshots and comparisons stay on the maintainer's machine. Encrypted blocks are skipped, never
decrypted: no decryption keys are loaded. Nothing else read from the game files is in the dataset, the
API or the MCP server; the client layer below is the one game-file layer they carry. On the site, only the talent catalog, the map layer, the raid buff table, the client layer, the build changes,
the icons, tooltip text and frame art covered further down, and the item names, quest titles and item set and spell names covered further down may appear.

Publishing the table data comes later, as a separate step. Once it ships, every entry from game
files will:

- be labelled **found in game files, unconfirmed**: a record there does not mean it is, or will be,
  in the game;
- be **hidden by default** when it could spoil content that has not been released, behind a
  spoiler switch;
- be **reviewed by a maintainer** before it is shown as a discovery; nothing will be published
  automatically;
- come only from **unencrypted** data. Content Blizzard encrypts stays out;
- stay **Blizzard's data**: shown as facts with the build it came from, kept apart from our
  CC BY-SA data and not under our licence;
- credit **WoWDBDefs**. The column names come from the
  [WoWDBDefs](https://github.com/wowdev/WoWDBDefs) table definitions by the WoWDBDefs contributors,
  which are under CC BY-SA 4.0, so every file that shows them names WoWDBDefs and links its
  licence. On the site, the credits section of `/methodology` (`/methodology#credits`) does, and
  every page links to it from the footer.

When players later see the same thing in the game, the entry will show both: found in the files
and observed in play.

**Blizzard's icons, tooltip text and window frame.** Decided 2026-10-18: our tools may show
Blizzard's own talent and spell icons, the spell and talent tooltip text, and interface frame
textures that make a tool look like the in-game window. Wowhead and most calculators do the same.
Neither this decision nor the extensions below cover Blizzard's marketing art (key art, marketing
logos, press kit, wallpapers), which the site does not use. The game's own logo, read from its
interface files, is a different thing and is covered by the second extension. The rules:

- **Only from unencrypted files** in the public client, read the same way as above. Nothing that
  needs a key.
- **Extracted by a maintainer, kept out of git.** A maintainer extracts them from the local game
  client and uploads them to Everloot's asset storage with a build-stamped manifest. They are
  never committed to the git repository.
- **Stamped with the build** they came from, in the file name or manifest and in the credits
  section of `/methodology`.
- **Still Blizzard's.** We do not relicense them. They sit outside our CC BY-SA 4.0 data and our
  AGPL-3.0 code, and the site says so on every page, in the footer credit line below. The licence
  notes of every release file that includes them say so too.
- **Credited site-wide**: every page's footer carries one line, "Game data and art © Blizzard
  Entertainment · Everloot data CC BY-SA 4.0 · Item and quest names from the Warcraft Wiki (CC BY-SA 4.0) ·
  Credits", whose last part links to `/methodology#credits`. That section carries the full credit,
  with the build: "Icons, tooltip text and interface art are
  © Blizzard Entertainment, Inc. Everloot is a fan project and is not affiliated with or
  endorsed by Blizzard." Together they stand in for a credit line on each page.
- **Pages only.** The data downloads, the API and the MCP server carry ids and facts, plus a link
  to the page where the icon and text are shown. They do not carry icon files, tooltip text or
  frame textures in bulk. If you want Blizzard's art in your own project, take it from the game
  client yourself.
- **Taken down on request.** If Blizzard asks us to remove any of it, a maintainer removes it
  promptly, from the site first and from later releases after that. Blizzard, or anyone speaking
  for it, can write to us at hello@everloot.app or through
  [everloot.app/contact](https://everloot.app/contact).
- **Same labels and spoiler rules as other game file data.** Presentation does not change them:
  an entry found only in the files still says *found in game files, unconfirmed*, and anything
  that could spoil unreleased content stays hidden, icon and text included, until the reader turns
  spoilers on.

**Extension: item, class and profession art, item tooltip facts and map pictures.** Decided
2026-10-18 (Carlos: "Approved, ship it"). The rules above also cover:

- **Icons beyond talents and spells**: item icons, and class, talent tree, raid buff and profession
  icons, read from the client's tables the same way.
- **Item tooltip facts**: what the item tables (`ItemSparse`, `Item`) give for an item: name,
  quality, item level, required level, binding, slot, armour or weapon kind, weapon speed, stat kinds
  (not amounts), flavour text and sell price. Shown on a page only for an item that 3 installs have
  reported (a drop, a vendor offer, an auction scan), never in bulk and never for an id someone types
  into a URL. The one exception is an item the item name rule below names: its name, quality, icon and these facts. The extracted facts cover every named item in the build, released or not, so they are
  kept in private storage that only the site's server reads, never in the public asset bucket.
  *Proposed 2026-10-22, in the pull request that adds them (the maintainer review):* the same rules cover
  the lines the game prints from the ids those tables hold: the item set's name (`ItemSet`), the
  Unique-Equipped category (`ItemLimitCategory`), the classes and races that may use the item
  (`ChrClasses`, `ChrRaces`, announced races only), the skill, spell and reputation it requires
  (`SkillLine`, `SpellName`, `Faction`), and its Use, Equip and Chance on hit lines (`ItemEffect`, with the
  spell's description resolved like the talents'). Stat amounts, armour and weapon damage stay `[?]`, and
  the tooltip says why in plain words.
- **Map pictures**: the game's own continent and zone map art from the map art tables, laid under
  our zone outlines. A held-back zone's picture shows only with spoilers on. A continent's own
  picture always shows (decided 2026-10-19): it is the original world's parchment map, with no names
  and no new land painted in.
- **The `/database` pages** (decided 2026-10-18 by the maintainer): the icons of the spells an item is
  created by or used in (from the client layer's relations) beside those relations, and pet family
  icons (`CreatureFamily.IconFileID`) in the manifest. Item icons and names on these pages follow the
  item tooltip rule above: only for items 3 installs reported, never in bulk and never for every id,
  except where the item name rule below allows them.
- **Dungeon and raid levels** (*proposed 2026-10-25, in the pull request that adds them (the maintainer review)*): the level
  range the files give each instance, read like the entrance points beside it from the unencrypted tables
  `MapDifficulty`, `ContentTuning` and `LFGDungeons`, published in the map layer's file and shown on `/database/instances`
  and each instance's page as a fact from the game files. The files give one level for most instances, not a range, and
  none for some; an instance they give none for shows a dash. Nothing is filled in from memory or another site.

**Second extension: loading screens, race and faction emblems, spell tooltips and the game's logo.**
Decided 2026-10-18. Carlos: "Approved next: (1) loading-screen art as page banners (zones, dungeons,
raids; e.g. map zone panels, raid builder, patch notes header), (2) race and faction emblems (the
race x class table on /wow-forever, census later), (3) spell/ability icons with hover tooltips where
spells are named (patch notes /changes, raid builder buffs, talent pages already have them), (4) a
launch banner at the top of the home page: the game's WoW: Forever logo from the game's own files
plus our existing countdown plus loading-screen art, with 'Not affiliated with or endorsed by
Blizzard Entertainment' visible on the banner itself." And: "Glint (mascot) is NOT part of this
batch." The rules above also cover:

- **Loading screens**: the picture each continent, dungeon and raid shows while it loads (`Map`,
  `LoadingScreens`), as page banners and beside dungeon and raid entrances on the map. A dungeon or
  raid added after the original world (a later map id) has its picture shown only with spoilers on.
- **Race and faction emblems**: the client's race icons and the Alliance and Horde emblems, named
  pieces of its interface atlases. Only the races Blizzard has announced for WoW: Forever are
  extracted.
- **Spell tooltips where a spell is named**: the raid builder's buffs, and the talents and raid buffs
  a patch note names, with the same icon and tooltip text as the talent calculator.
- **The game's own WoW: Forever logo**: the logo piece in the client's interface atlas
  (`logo-wow-forever`), read like the other pieces. It appears only on the home page's launch
  banner, and only with "Not affiliated with or endorsed by Blizzard Entertainment" visible on the
  banner itself; the game's name beside it is plain text. It is never used to suggest that Blizzard
  made, approves or supports Everloot. No logo in the files means no banner: Blizzard's marketing
  logos and art are still never used, not even as a stand-in.

**Item names from the game files and the Warcraft Wiki.** Decided 2026-10-19 by Carlos ("Wiki match
only") and widened 2026-10-21 by Carlos: "the goal is to name all the items that exist". Every item the
current build lists (`Item`) is named when a source names it, before players confirm it, on the item page
and the category lists, with its quality and icon and, where the game files hold them, its tooltip facts (item
level, required level, binding, sell price, weapon speed, stat kinds and flavour text). The name comes from:

- the game files of the current build (`ItemSparse`), wherever they name the item. Where the item's page in the
  Warcraft Wiki dump of 2023-11-13 gives the same name, apart from case, spacing and the kind of apostrophe,
  the name also carries the wiki's credit; where the two differ, the game files' name shows, as this build has it;
- else the Warcraft Wiki dump's name, where only the wiki names the item.

The rules:

- Each name says where it comes from in a tooltip on the name (and in words for screen readers; on a link, the
  tooltip is the link's hover card). A name the wiki gives reads *Name from the Warcraft Wiki*; the site-wide
  footer credits the Warcraft Wiki under CC BY-SA 4.0 beside Blizzard's credit, and `/methodology#credits`
  names the Warcraft Wiki contributors. A name from the game files alone carries the quiet unconfirmed marker,
  *From the game files, not yet confirmed by players*. A name 3 installs agree on comes first, with the tooltip
  *Name confirmed by players*. No source label is printed beside a name.
- There is no id range: an item from a later version, an unreleased one, or one the files call "Deprecated" or
  "[PH]" is named as the files name it. The marker and the build stamp say what the name is: found in game files,
  unconfirmed. Items whose name marks them as development leftovers (test, placeholder and retired items, decided
  by `kb/src/dev-item-names.ts`, added 2026-10-26) are left out of the category lists and their counts unless the
  reader asks for them, and their pages stay out of search and the sitemap; their pages, names and id lookups stay
  as before.
- The tooltip facts follow the name (added 2026-10-20, at Carlos's request that the database show the game file
  data it already holds, as Wowhead does). Until players confirm the item, its page keeps the quiet unconfirmed
  marker on the icon, whose tooltip says so, and prints no source line. The lists sort and filter by item level,
  required level and binding; an item whose facts are not shown matches none of those filters.
- An item no source names keeps "Item N". The game server sends those names while the game runs, so they come
  from the addon's uploads, after 3 installs agree. A category page where fewer than half the rows have a name
  stays out of search.
- Pages only. The data downloads, the API and the MCP server carry no item names and no tooltip facts for these
  items, as before; a test checks that their code does not read the names. The embeddable cards keep the
  three-install rule.
- The names come from a ledger a maintainer builds with `npm run kb -- item-names`. It records every name
  each source gives for each item id, mismatches and single-source names included, and it only grows: a
  new build, dump or source adds to it and removes nothing. It stays on the maintainer's machine like the
  snapshots. The names the site shows go to the private storage the site's server reads, never to git or the
  public asset bucket. In build 1.60.1.70450: 31,849 items, 23,096 named (9,305 where the files and the wiki
  agree, 228 where they differ, 9,698 from the files alone, 3,865 from the wiki alone) and 8,753 left to players.
- The maintainer review is the pull request that sets or changes the rule or adds a source. A file for a new
  build is checked against the last run's counts (`npm run kb -- name-gaps`) before it is uploaded.

**Third extension: game icons and tooltip text in embeddable cards.** Decided 2026-10-19 (Carlos
approved it with the site structure plan). The hover card any site can show through
`https://everloot.app/tooltips.js` and `GET /api/tooltip/<type>/<id>` may carry one item's game icon
and tooltip facts, the same ones its page shows:

- **One item per request**, and only for an item its page would show them for (3 installs reported
  it). Never in bulk, never for an id nobody reported.
- **Labelled and credited in the card**: *found in game files, unconfirmed*, the build, and the
  Blizzard credit above. The icon is a link to our asset storage, not a copy in the response.
- **Same spoiler and takedown rules** as the pages. The downloads, the rest of the API and the MCP
  server still carry no icons or tooltip text.

**Quest titles from the game files and the Warcraft Wiki.** *Proposed 2026-10-20; decided 2026-10-21
by Carlos, and widened the same day to every quest the wiki titles.* The game files list quests by id
(`QuestV2`) but carry no titles. A quest's title may be shown on its page, in the quest lists and where an item
page names the quest as a reward, before players confirm it, when the quest id is in the current build's
`QuestV2` table and the quest's page in the Warcraft Wiki dump of 2023-11-13 gives that id in its quest infobox.
The title is the infobox's name, or the page title where the infobox has none, kept as the wiki writes it; a
few carry the wiki's own note, such as "(Alliance, 55)". The rules:

- As with item names, a title 3 installs agree on comes first. A wiki title says where it comes from in
  a tooltip on the title, *Name from the Warcraft Wiki* (and in words for screen readers; on a link, in the link's hover card); on the quest
  page it also carries the quiet unconfirmed marker. No source label is printed beside it. The
  footer credit reads "Item and quest names from the Warcraft Wiki (CC BY-SA 4.0)".
- Any quest id the build lists, with no id range. Where wiki pages give one id different titles (a quest
  renamed in a later version, say), the first page's title shows and the run lists the id for review. A quest
  the wiki lacks keeps "Quest N" until players title it, and a wiki title for an id the build does not list is
  never shown.
- Where a Forever-era source names a quest differently from the wiki, the wiki title is held
  (`CONTESTED_QUEST_IDS`, 9 quests found on 2026-10-21 against Polestar's guides) until players confirm
  one. The other source's title is never shown.
- `QuestV2` lists only quests with a completion bit (every row has a `UniqueBitFlag`), so repeatable
  quests such as Additional Runecloth or the Scourgestone turn-ins are not in it and never get a wiki
  title. Their pages and titles come from player uploads alone.
- Pages only. The data downloads, the API and the MCP server carry no quest titles from this file; a
  test checks that their code does not read it.
- A maintainer makes the file with `npm run kb -- game-names`, into the same private storage as the item
  names, never git or the public asset bucket. Unlike the item names it keeps no ledger: it is rebuilt
  from the snapshot and the dump each run. In build 1.60.1.70450: 6,614 quest ids, 3,229 titled (47 of them
  where the pages disagree), 9 held as contested and 3,376 the wiki lacks.

**Item set and spell names from the game files.** *Proposed 2026-10-20; decided 2026-10-21
by Carlos, and widened the same day to every set and spell the files name.* The names of item sets
(`ItemSet.Name_lang`) and spells (`SpellName.Name_lang`) may be shown on their pages and beside the relations on
the item pages. They come from the game files alone, so:

- Each carries the quiet unconfirmed marker, with *From the game files, not yet confirmed by players*
  as its tooltip. No source label is printed.
- Every set and spell of the build with a name, with no id range and no placeholder filter, as with items.
  One without a name keeps "item set N" or "spell N".
- Pages only, in the same private storage, made by the same command. In build 1.60.1.70450: 536 sets, all
  named; 31,939 spells, 31,926 named.

**The talent catalog.** The talent calculator at `/tools/talents` uses our own catalog, read from
the public client by a maintainer, not taken from any other site. The catalog is the trait node
ids, positions, ranks, gates, prerequisites, spell ids, talent names and the build stamp. This is
one of three table data exceptions to the status above, with the map layer and the raid buff
table below. It may
be published on the site, and it may be committed to the git repository as a clearly marked
game-data file with a README that says it is Blizzard's and outside our licence. It is labelled
*found in game files, unconfirmed* until someone has checked it in the game, and the spoiler rules
above apply. Tooltip text, icons and frame art shown with it keep the rules above: asset storage,
not git.

**The map layer.** From the map tables we publish zone rectangles (`UiMapAssignment`), continents
and instances (`Map`, `UiMap`), dungeon and raid entrance points (`Map.Corpse`) and, for each entrance
and flight master, the zone the files put it in (for an entrance, the outdoor `AreaTable` area named
after the instance when there is one, else the terrain chunk's area in the ADT files; either way up
`AreaTable` to the area a zone's `UiMapAssignment` names; only the zone id is published), each stamped
with the build it came from. Like the talent catalog, it may be shown on the site and committed as
a clearly marked game-data file in `web/src/data/game-data/`, with a README that says it is
Blizzard's and outside our licence. It is labelled *found in game files, unconfirmed* until
checked in game. General rule: new zones or other content found only in the game files stay hidden
unless the reader turns spoilers on. A zone that looks unreleased is held back until it is live: the file keeps it apart (`heldBackZones`), and `/map` draws it, dashed and labelled *found in game files, unconfirmed*, only when the reader turns the spoiler switch on (off by default). The public MCP tool leaves held-back zones out altogether.
The map layer itself carries no art. The game's map pictures are part of the extension above: never
committed, and kept in asset storage like the other Blizzard art.

**The raid buff table.** The raid builder at `/tools/raid` and its in-game view use our own table of
group buffs and debuffs, read from the spell tables in the public client. For each effect it holds
the effect id, its name, the class, the spell ids, who it reaches (party, raid, target), per rank
where ranks differ, and the talent tree it needs where the game files prove that link, each with
the build stamp. It holds no tooltip text. Like the talent catalog, it may be shown on the site
and committed as a clearly marked game-data file in `web/src/data/game-data/`, with a README that
says it is Blizzard's and outside our licence, and the addon may carry the same facts. It is
labelled *found in game files, unconfirmed* until checked in game, and the spoiler rules apply.

**The client layer.** Decided 2026-10-18 by the maintainer: item categories (class, subclass,
slot and quality) and relations read from the game files may be published on the site and through
the MCP server, the API and the bulk download. The relations are *created by* (a spell's create-item
effect, `SpellEffect`), *reagent for* (`SpellReagents`), *part of set* (`ItemSet`), *same icon*
(items that share an icon file, `Item.IconFileDataID`) and, since 2026-10-18, *profession* (the
skill line that teaches a spell, `SkillLineAbility` and `SkillLine`, with the profession's name).
They are facts: ids and the relation between them, with no Blizzard text and no art. The rules:

- Every entry is labelled *found in game files, unconfirmed* and stamped with the build it came from,
  on the page and in every answer. On a page the label is written once per section, not on every
  row; in an answer it travels with the rows.
- It is Blizzard's data, kept apart from our CC BY-SA data: an API answer gives it its own notice
  (`gameData`) beside our `attribution`, and the file carries its own credit, WoWDBDefs included.
- It is committed as one game-data file, `web/src/data/game-data/client-layer.json`, regenerated by
  the build watch with each build, so every change to it goes through a reviewed pull request.
- Relations players see in the game (dropped by, sold by, reward from, located in) keep the
  three-install rule. Where both exist, a page shows both, each with its evidence.
- Forever has no live build yet, so every entry comes from a pre-release build. Entries are not
  marked one by one as spoilers: the layer holds ids and relations only, no names, text or art. The
  item names a page may show beside it follow the item name rule above and are not part of the layer.
- How it sits with the item tooltip facts above: class, subclass, slot and quality are public for
  every item through this layer. The rest of an item's tooltip (name, item level, required level,
  binding, weapon speed, stat kinds, flavour text, sell price) and its icon stay in private storage
  and appear only for items 3 installs reported, as the extension says, or under the item name rule above.

**Build changes, beta builds included.** Decided 2026-10-18, the same way Wowhead and other
datamining sites work: when Blizzard ships a new build, a reviewed pull request records what
changed in the tables we read, and that change list may be public in the PR text and committed in
`web/src/data/game-data/changes/`. This includes builds that are not live yet, such as the beta,
and the numbers in the files: spell effect values, durations and the like. Every entry carries
its build and is labelled *found in game files, unconfirmed*. Anything that could spoil
unreleased content is marked as a spoiler and hidden on the site unless the reader turns spoilers
on; the repository itself is public, so the marking is a warning, not a lock. Encrypted content
stays out, because we never decrypt. Description and tooltip text is not part of these files.

**Blizzard's own posts.** The "what changed" page at `/changes` lists posts by Blizzard staff on
the WoW forum and by the official World of Warcraft account on Bluesky, and the game builds
Blizzard's version service reports.

- *Excerpts only.* For each post we keep the title, the author and role, the time, the category,
  an excerpt of at most two sentences (300 characters) and a link to the original. The text is
  Blizzard's, so we never copy a post in full. Each post has its own page on Everloot
  (`/changes/<id>-<slug>`) with those fields, the excerpt marked as Blizzard's words, and the link.
  A maintainer may add a write-up in our own words on that page (`kb/curated/blue-writeups/`),
  reviewed before it is published; it never repeats more of the post than the excerpt, and nothing
  writes one automatically. A page without a write-up is not indexed by search engines.
- *Sources.* Forum posts come from the US and EU English WoW forums, only from the WoW: Forever and
  WoW Classic categories, and only from Blizzard staff: people on each forum's published staff list
  (`about.json`) or posts the forum itself marks as Blizzard's (its group tracker; the green MVP
  groups are players and are left out). `kb/curated/blue-accounts.json` holds hand corrections.
  Players' posts are read with a topic but never kept. Bluesky posts come only from the verified
  official World of Warcraft account, and only when they are about Forever or Classic. No
  third-party tracker is read or copied.
- *Robots and manners.* The reader checks robots.txt before every run and uses public JSON only.
  Blizzard's forum `.rss` routes are disallowed by its robots.txt, so we never use them. It names
  itself (`Everloot/1.0`, with a contact address), never follows a redirect, and stops when a
  server answers 429 or a server error, honouring Retry-After.
- *Polling cap.* At most once every 30 minutes and at most 40 requests a run in all: the staff list
  at most once a day, the Forever and Classic topic lists only back to what the last run saw, and
  only topics that changed and carry a staff post. A source asked less than 25 minutes ago is
  skipped. A one-off history import (`blue-backfill`) uses the same rules and pace with a larger budget.
- *Build times.* A build's time on that page is when Everloot first saw it, not when Blizzard
  released it.

*Fan permissions are narrower than this.* As we read Blizzard's
[video policy](https://www.blizzard.com/en-us/legal/dd76b654-f2c4-4aaa-ba49-ca3122de2376/blizzard-video-policy),
its permissions for fan use of game material are non-commercial and Blizzard can revoke them. The
older Blizzard fan-site FAQ is only quoted secondhand to us, so we treat what it says as
unverified and rely on nothing from it. Since PR #62 (2026-10-17) Everloot shows clearly labelled
Google ads on the tools, the patch notes, the home page and database pages that have content, and
none on the upload page, the privacy page, account pages or the lore archive; the privacy policy and
the terms describe them. Some of those pages show Blizzard's icons and tooltip text. Whether that
sits within Blizzard's current terms is the operator's call to review; if the review says no, the
ad slots come off those pages, not the assets.

**The addon and project tracker.** `/addons/ecosystem` lists WoW: Forever addons and tools that a
maintainer has checked and added to `kb/curated/ecosystem.json`.

- *GitHub facts only.* For each project we read public repository facts from GitHub's REST API: stars,
  latest release, last commit, commit and issue counts, a contributor count, and the `## Interface` line
  of the project's `.toc`. No usernames, emails or contributor lists are kept or shown, and no person is
  ranked. The boards rank projects.
- *Polite and slow.* Serial requests, at most every three hours per project, an optional token, and a stop
  (never a retry storm) when GitHub says to wait.
- *Installs.* A project's install count comes from our own addon-list uploads and appears from three
  installs up, like `/addons/popular`. A project with fewer shows "not counted", never zero.
- *Other hosts are link only.* CurseForge's API terms forbid caching its data, Wago documents no read API
  for listings and WoWInterface's terms forbid automated access, so we read none of them.
- *Opt-out.* An author can ask to be removed with the ecosystem issue form or at hello@everloot.app.

**Open sources.** The lore archive is built from the Warcraft Wiki dump of 2023-11-13
(CC BY-SA 4.0). We may add other openly licensed datasets later. Each one goes in the
[source ledger](sources/LEDGER.md) with its licence and exact version before any of it ships.
A Classic 1.12 baseline, pfQuest's database (built from the VMaNGOS and CMaNGOS emulator databases,
GPL-2.0 and GPL-3.0), is used on a maintainer's machine to check what Forever players have confirmed and
where they have not looked yet. It is never published and never mixed into the CC BY-SA data: only what
players' uploads confirm is published. Decided 2026-10-21 by Carlos: the coverage page, the API and the MCP tool may
show counts and percentages whose denominator comes from the baseline (how many facts of a kind a zone is expected
to hold), but never a baseline name, id or row.

**Facts we write ourselves**, in our own words, each with the page it came from and the date.

Game file data, and the icons, text and art shown on our pages, stay Blizzard's and are not under
our licence. Everything else Everloot publishes is
under CC BY-SA 4.0: anyone may reuse it with credit, and what they build from it must stay under the
same licence.

## What we refuse

- **Bulk scraping of any site.** No crawlers, no copying another database's rows, guides or text.
  If a site's terms or robots.txt say no, the answer is no.
- **Touching the running game.** No reading or changing the game's memory, no automation, no
  bypassing protections. The addon uses only the game's own addon API. The Desktop App and the command-line uploader read the
  SavedVariables file the game writes, and writes `/ask` answers into a file the addon loads after
  `/reload`. The upload page reads only the file a player chooses: Everloot's own, or a Polestar
  Recorder file the player recorded and chose to upload.
- **Decrypting game data.** Content Blizzard encrypts stays encrypted.
- **Bulk exports of Blizzard's art or text.** Icons, tooltip text and frame textures appear on
  pages only, never in the downloads, API or MCP server.
- **Unreviewed spoilers.** No game file entry is shown as a discovery without review, and anything
  that could spoil unreleased content stays hidden, icons and text included, unless the reader
  turns spoilers on.

Blizzard's EULA forbids unauthorized software that "intercepts, collects, reads, or 'mines'
information generated or stored by the Platform." Studying released game files offline is a long
community practice that Blizzard has tolerated, and we read only what its CDN serves to every
player. If Blizzard asks us to stop, we will.

## Wowhead

We link to Wowhead and never copy it. Looking up single facts there is allowed only if every one
of these holds:

1. **Nothing is built until the terms allow it.** A maintainer reads Wowhead's Terms of Use and
   confirms that automated lookups of single pages are not prohibited, or Wowhead gives permission.
   If the terms forbid it, the feature is dropped. As of this writing, it has not been built.
2. **Facts only:** ids, levels, coordinates and looted counts. No text, images or guides.
3. **Gaps only:** a lookup runs for an entity our own data lacks or disputes. No crawling, and never
   Wowhead's list or random pages.
4. **Honest and slow:** the user agent is `EverlootFacts/1.0 (+https://everloot.app/contact)`, never
   a browser string or a bot name Wowhead blocks. At most one request every few seconds, and every
   response is cached so a page is fetched once.
5. **Local only.** The facts are kept apart, marked not publishable, and used only to check and fill
   gaps in our own observations. They are never republished on the site, in the dataset or by the
   MCP server unless Wowhead gives written permission.
6. **Run by a maintainer**, never by an automated agent. The script lives in this repository, so
   anyone can read exactly what it does.

## Contributing data

- Name the source in your pull request and add it to the [source ledger](sources/LEDGER.md).
- Only sources whose licence allows republishing under CC BY-SA 4.0 can reach a release. Anything
  else stays local and is marked not publishable; the release build refuses it.
- The one exception is the game file layer described above. That data is Blizzard's, so it never
  enters the CC BY-SA release; once publishing ships, it reaches the site only as its own labelled
  layer, after a maintainer has reviewed it. Icons, tooltip text and frame textures are never
  committed to the git repository, so a pull request must not include them. A maintainer extracts
  them from the local game client and uploads them to Everloot's asset storage with a
  build-stamped manifest.
- If you are unsure whether a source is allowed, open an issue first.

## Using our data: credit, limits and keys

Everloot's data stays open. Anyone may read it, copy it and build on it under CC BY-SA 4.0. Two
things are asked in return: credit it, and use a free key when you copy all of it.

- **Credit.** Show this line, with the link, wherever the data appears: "Data from Everloot
  (https://everloot.app), CC BY-SA 4.0." What you build from it stays under the same licence. Every
  answer carries it so it is hard to lose by accident: the JSON APIs return it in an `attribution`
  field (licence, credit line, the page the data comes from) and in the `X-Everloot-Licence`,
  `X-Everloot-Credit` and `Link` headers, and MCP answers built on player data end with the licence
  and credit. Republishing the data without credit breaks the licence.
- **Asking questions is free and needs no key.** The MCP server and the market prices keep a
  per-address limit that a person or an AI assistant answering questions does not reach.
- **Copying in bulk takes a free key.** Once the limits are switched on, the corpus API and the drop
  list answer a few requests an hour per address without a key, one page of records at a time. An
  IPv6 address counts by its /64 block. A free key, made on
  [/docs/api/keys](https://everloot.app/docs/api/keys) after signing in with Battle.net, raises the limits
  far enough to copy everything. The allowance belongs to the account, across all its keys, and an
  account can make only a few keys a day, so new keys do not bring new allowances. Requests are
  counted per key, so we know who copies the data in bulk and can ask what they are building. Keys
  can be revoked or deleted by their owner at any time, and revoked by us when a key is used to
  republish the data without credit. The exact numbers are on /docs/api/keys.
- **Pages are not limited.** Search engines and AI assistants may read and quote the site's pages.
  These limits apply only to the machine-readable endpoints.
- **Not covered.** Game-file data and Blizzard's posts are Blizzard's, not ours; the credit line and
  the licence above do not apply to them. The code is AGPL-3.0 and has its own terms.

**What we keep about keys, and for how long.** For each key: a one-way hash of it, its last four
characters, its name, what its owner says it is for, its permissions, its account, when it was
made, when it expires, when it was last used and revoked, and a count of its requests per day and
endpoint. Not what was asked. The purpose is asked when a key is made so we know what keys are used
for; it is not published. A key made on /account expires on the date its owner picks (7, 30, 90 or
365 days, or a date up to a year ahead); past it, every endpoint refuses the key, as it does a
revoked one. Keys made before expiry existed, and the Desktop App's key, have no end date. Daily
counts are kept 90 days. A revoked key and its counts are deleted 30 days after it was revoked, or
at once when its owner deletes it on /account; an expired key stays until its owner deletes it. Deleting an account (write to hello@everloot.app) deletes its keys and counts. Anonymous
requests are counted per hour against a keyed hash of the address, which is deleted after about a
day; the address itself is never stored.

## Saved builds

A signed-in player can save builds from the talent calculator to their account. This is the
player's own data, not game data and not an observation, and none of it is published as a dataset.

- **What a saved build holds.** The calculator's share codes for one or two talent sets (the same
  `EL1-...` code a link carries), the game build they were made on, a name, optional notes, an
  optional character label, and whether its short link is on. Nothing from the game files and
  nothing the addon observed.
- **Character labels are typed, not checked.** A label is a name, a class, an optional realm and an
  optional note that the player types. It is not looked up in the game, the census or the player
  pages, and it is never shown to anyone else unless the player shows their characters on a public
  profile (below).
- **A shared link is public to anyone who has it.** Each build has a short link, `/b/<code>`, on by
  default. While it is on, anyone with the link sees the build's name, notes and talents, but not
  the character label. The owner's name shows only if the owner chooses to show it. The page is
  not indexed by search engines. Turning sharing off or deleting the build stops the link at once.
- **Keys.** A free key made with "Read my saved builds" (`read:own`) can read its owner's builds
  and labels, for the Desktop App, MCP clients and scripts. A key without it cannot.
- **Limits.** 200 builds and 30 character labels per account, and 300 saves a day.
- **Deletion.** The owner deletes a build or a label on /me at any time. Deleting a label keeps its
  builds, with no character. Deleting the account (write to hello@everloot.app) deletes every
  saved build and label with it.

## Profiles

A signed-in player can set up a profile on /settings. Like saved builds, this is the player's own
data, not game data and not an observation.

- **What a profile holds.** A handle (3 to 24 letters, numbers and hyphens, unique), an optional
  display name, an optional status (one emoji and up to 80 characters, with an optional time after
  which it stops showing), a main character and the character the player is on now (both chosen
  from their own character labels), and the public profile switch with what it shows. Nothing is
  looked up in the game, and no picture is stored: the avatar is drawn from the name's initials.
- **Private by default.** Until the player turns the public profile on, only they see any of it.
  On, `/u/<handle>` shows the handle, the display name and only what the player ticks: characters
  (name, class, realm), shared builds (their short links) and the status. It never shows the
  BattleTag, the email, a label's note or a build that is not shared. It is indexed by search
  engines only while it is public; off, unknown or without a handle, the address is a 404.
- **Limits.** A handle changes at most 5 times a day. Reserved handles (admin, everloot, support
  and a few more) cannot be taken.
- **Deletion.** The player changes or clears any of it, or turns the public profile off, on
  /settings at any time. Deleting the account (write to hello@everloot.app) deletes the profile.
