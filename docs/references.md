# Reference sites — product shape (2026-09-29)

Carlos sent these as inspirations. They say what a page should feel like. They are not a scrape list.
Access rules stay in `docs/sources/source-catalog.md`. If this file and that catalogue disagree, the
catalogue wins.

**Character pages:** two of the sites below were read on the maintainer's own character, so those
pages could be opened on a real name. The character links are not kept here. That character is not a
fixture in the app and not the Forever beta character.

Checked the same night. `everloot.app` was on Cloudflare nameservers (`jonah` / `veronica`) and the
apex did not answer HTTP.

## What to take

| Site | What to copy the shape of | Do not take |
|---|---|---|
| [Pengu's Midnight Profession Sheet](https://docs.google.com/spreadsheets/d/1OiEL8gl3v0ccxl-NZjRudOPCO9tcEWryK6ScX4PNnu8/edit?gid=0#gid=0) | One profession bible: leveling path, knowledge points, treasures, first crafts, rep rewards, and a link out to a tree calculator. Cover tabs named Alchemy, Blacksmithing, Enchanting, Engineering, Inscription, Jewelcrafting, Leatherworking, Tailoring, Cooking. | Pengu's numbers or cell text. It is a Midnight retail sheet, still marked in development. |
| [gaming.tools/wow](https://gaming.tools/wow/) | The same profession path, but it recalculates: skip trainer-only recipes, racial bonus, recipes that grant more than one skill point, recursive reagents, a shopping list, and a cost from auction prices. | Retail or Classic AH prices. Forever gold is farmed. Price a path only from our own uploads. |
| [Missing Mounts](https://www.missingmounts.com/) | Start with server + name, or Battle.net login. Then the missing list, grouped by expansion and source, with a separate pile for mounts a vendor will already sell because reputation is high enough. | Their catalog. Forever has no profile namespace yet, so this view waits on the collector. |
| [Simple Armory](https://simplearmory.com/#/) | A character URL with a collectable category, owned versus missing, no account required when the armory is public. | Scraping the armory. Same blocker as above. |
| [Data for Azeroth](https://www.dataforazeroth.com/) | Character page plus a collection leaderboard. The homepage was behind a bot check tonight, so the character page was not read. | Their leaderboard data. Rankings are not the product. forever.raider.io already exists. |
| [WoWAuctions](https://www.wowauctions.net/) | Realm first, then item. Price history, a heatmap of cheap hours, crafting profit, cross-realm compare. Free, ads, no login. | Their price database. Auction history comes from the player's own AH browsing, uploaded on purpose. |
| [tbc.rtw.dev](https://tbc.rtw.dev/) | A calculator-and-guides front door. The title read "TBC Classic Tools". The page body did not render, so the tool list is unread. | Anything from the unread page. Open it in a browser before borrowing a layout. |
| [Icy Veins](https://www.icy-veins.com/) | A class grid as the front door, a news rail, and a weekly to-do. They already run a Forever vertical. | Their guides. Catalogue row is `link`. `/terms` blocked a bot. |
| [Wowhead](https://www.wowhead.com/) | The item page we want once we have our own rows: name, source, drop, map, comments later. | The rows themselves. `link` only. No API. Robots.txt names the AI bots. |
| [Raider.IO search](https://raider.io/search) | One search box that resolves a character or a guild. | A score, a rank, or a Mythic+ copy. |
| [wago.io](https://wago.io/) | A snippet library: search, tags, install copy. This is the WeakAura host, not wago.tools. | Their snippets, and anything on wago.tools. That domain's robots.txt disallows the tables. |
| [wow-pets.com](https://wow-pets.com/) | Unread. Cloudflare returned 522 (origin timeout) on 2026-09-29. | Do not substitute Warcraft Pets. Petopia's catalogue row already says their text may not be copied. |

## How this sits on the current site

Profession hubs and farming routes already exist. The sheet and gaming.tools say the next useful
profession page is a leveling path with a reagent list and a gold cost, not another stub hub.
Collection pages (Missing Mounts, Simple Armory, Data for Azeroth) wait on uploads plus a character
key. Auction pages wait on the same uploads.
Wowhead-shaped item pages are the public face of a drop row we already roll up.

## Forever competitors and how Everloot becomes the #1 source (2026-10-04)

From a research pass in another session. Access rules for each site are in the source catalogue.

| Site | What it has | What we take |
|---|---|---|
| Wowhead `/forever` | The full vertical: database, talent calc, item tooltips | A person opening a page to check that one item exists. No bulk reads, no XML endpoint, no stored rows |
| wowforevertools.com | Talents, racials, builds. No item database | The page shape of a build planner. Their builds stay theirs |
| wowforevertalent.com | About 146 recorded dungeon and quest items, with gaps marked "unrecorded, not zero" | The gap standard. Every count or rate on our pages follows it |
| foreverdiff.com | A claimed client-extracted spell and item diff | Nothing. Blocked |

We will not out-copy Wowhead, and copying is the one thing that would sink us. We win on three
things they cannot match:

1. **Provenance on every row.** Each figure carries its install count and its last-seen date, so a
   reader can see why we believe it. Nobody else in Forever publishes the denominator.
2. **Honest gaps.** "Unrecorded" is a different statement from zero, and we always say which one it
   is (row `site.gap_marking`).
3. **Speed after a patch.** Beta rows change weekly. Collector uploads re-confirm or retire a row
   within days, while a scraped table stays wrong until someone notices.

Other sites still help: we link out to them when we have no row yet, and a person can check one
of our rows against a public page by hand. They never become our data.

## Adopt and bridge (Carlos, 2026-09-29)

Goal (Carlos, same night): one cohesive Everloot that offers these tools, and a bridge in the app
so a ChatGPT subscription — connected directly — and any other MCP client pull the data from our
server. Their model does the reasoning. Our server holds the rows and the tools.

The build list is `kb/src/bridge-plan.ts`, printed as `docs/TRACKER.md` and served by the MCP
tool `everloot_plan`. Spec: `docs/design/specs/2026-09-29-everloot-distribution-openai.md`.
Each new tool joins that same server. Local HTTP is `POST /mcp` on 127.0.0.1. A ChatGPT
subscription needs the public HTTPS row (`mcp.public_https`). Adopting a tool means running it
or reimplementing its job on our server. It does not mean copying another site's text.

### Open source we can actually wire

| Tool | What it is | How it joins Everloot |
|---|---|---|
| [simulationcraft/simc](https://github.com/simulationcraft/simc) | Combat sim. Org also has `simc-addon`, `simc-server`, `simc-profile`, `simc-publish`. Engine and profiles are **GPL-3.0**. The addon is **Unlicense**. Default branch is `midnight` (retail 12.1). An active **`forever` branch** was updated 2026-09-27. That branch is a port in progress: profiles deleted because specializations do not exist, class modules are being reset, trait data is still being stubbed. | Run the `forever` binary as its own process when it can sim a character. Feed the report to `/ask`. Keep it a separate process rather than copying its C++ into this repository. The Unlicense addon is the piece we can fold into our collector: export a sim profile from SavedVariables. |
| [Marlamin/wow.tools.local](https://github.com/Marlamin/wow.tools.local) | MIT. Local replacement for the dead wow.tools website: CASC browser, DB2 diff, model viewer, map viewer, against a WoW install on this machine. The public site was retired in May 2025. Older-build file downloads inside this tool still come from wago.tools. | Dev tool on Carlos's machine only. Public pages keep using the collector. Do not publish extracted tables, and do not turn its wago.tools download path into an importer. |

The wiki page [WoW.tools](https://warcraft.wiki.gg/wiki/WoW.tools) is the history of that site (local tool still updated, website defunct, wago.tools is the hosted replacement). One read of that page. The live wiki stays off the importer.

### Sites that show the product, and stay closed

| Site | Shape to borrow | Leave there |
|---|---|---|
| [WoW-Professions](https://www.wow-professions.com/) | Already has a **WoW Forever** door, then a gold-efficient leveling path and a TomTom pin. Closest match to the profession page above. | Their routes and wording. |
| [Ask Mr. Robot](https://www.askmrrobot.com/) | One optimizer: gear, enchants, gems, what is already in the bags, Best in Slot. Classic, TBC, and WotLK each have a door. | Their sim and their item lists. A Forever door waits on the SimC `forever` branch. |
| [WoWUtils tools](https://wowutils.com/tools) | A hub of many small tools (31 listed): cooldown plan, loot sim, interrupt macros, roster audit, wishlist, and a desktop bridge. One person runs the bridge. The addon reads what the public API does not. They publish an API and say to use it. | Their raid notes, retail vault math, and any scrape of the site. |
| [Liquid Armory](https://liquidarmory.com/) | Trinket ranking per class, a loot table per class, and one seasonal overview. Trinket numbers come from Liquid's sims and from SimulationCraft profiles. | Their tables and the season-pass VODs. Retail Midnight, not Forever. |
| [warcraft.tools](https://warcraft.tools/) | Three questions on the front: is this name free, what is this item worth, and what do all of my alts own (mounts, pets, toys, professions). Battle.net sign-in. Their own note says Forever support is coming soon. | Blizzard API payloads. No Forever namespace yet, which is why their Forever door is not built. |
| [wow.gg/es](https://wow.gg/es) | A guide site that also publishes a markdown twin of each page. Useful as a page shape. | Their guide text. Our bridge is our MCP server, not a copy of their chat. |
| [WoWProgress](https://www.wowprogress.com/) | Guild progress by realm. Homepage was a bot check tonight, so the page was not read. Catalogue row stays `link?`. | Their rankings. |
| [Warcraft Logs](https://www.warcraftlogs.com/human-challenge) | The log site. This URL stopped on the human check. Catalogue row already has the rule: log text is CC BY-NC-SA, ask before republishing, Forever logs are not supported yet. | The reports. An "explain this pull" answer waits on that permission and on Forever support. |
