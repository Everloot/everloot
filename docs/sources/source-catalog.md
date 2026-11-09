# Source catalogue — WoW knowledge sources

**Researched:** 2026-09-27 (two web-research passes: an ecosystem catalogue and an access/terms check).
**Spec:** `../design/specs/2026-09-27-forever-ai-addon-design.md` §4.

What Everloot actually used, linked or only read is recorded in [`LEDGER.md`](LEDGER.md).
This is the **candidate** list. A source enters the live source map only when its row has an access
type decided from its terms, a last-verified date, and confirmed version coverage.

The armory crawler reads Blizzard's Forever character profiles, equipment, PvP summaries, guilds and rosters through the official API. It keeps these only in the separate Supabase armory for credited, ad-free pages: recheck within 20 days, purge after 30 days, delete on 404 or a hide request. Armory data never enters addon tables, exports, the CC BY-SA corpus or MCP answers.

## Read this first

- **WoW: Forever is in beta** (since 2026-09-17). Full launch is **2026-11-04**. All "Forever: yes"
  below is beta-stage coverage; expect churn at launch. Re-verify every Forever row after 11/04.
- **Blizzard's API has Forever namespaces since launch** (checked 2026-11-06 with the Everloot client, US
  and EU): `static-forever-{region}`, `dynamic-forever-{region}`, `profile-forever-{region}`. Rulesets
  replace realms (`/data/wow/ruleset/index`: 1 PvP, 2 Normal, 3 Roleplay, 15 Roleplay PvP; the realm
  index is 404). Characters by `name-surname`, guilds with rosters, and 15 auction houses per region
  under `/data/wow/ruleset/{id}/auctions/` (the same houses under every ruleset). The terms below still
  apply: local cache only, no redistribution, nothing on ad pages.
- **Blizzard runs no PTR for Forever and hides item stats until drop**, specifically to frustrate
  datamining. Datamined tables will have gaps for balance-sensitive data.
- **Access-type rule:** where the terms check read the source, its verdict wins. Where it didn't,
  the access type is a guess and marked `?`.
- **Blizzard EULA**, verified: no "unauthorized process or software that intercepts, collects,
  reads, or 'mines' information generated or stored by the Platform." Tolerated tools read files
  the client writes (SavedVariables, the combat log) and published APIs — never memory or the
  screen. See spec §2.2.

Access types: `api` official API · `wiki` MediaWiki API · `fetch` occasional cited page read ·
`link` point only · `curated` we maintain it.

## v1 candidates (the spine)

| Source | URL | Why | Forever | Access | Terms evidence |
|---|---|---|---|---|---|
| Warcraft Wiki — 2023 dump | [archive.org/details/wiki-warcraft.wiki.gg-20231113](https://archive.org/details/wiki-warcraft.wiki.gg-20231113) | Lore baseline (`history.xml.zst`, 637 MB) | no — predates Forever | import | CC BY-SA 4.0 — attribute, share-alike |
| Warcraft Wiki — live | warcraft.wiki.gg | Current lore, Forever article | yes — [Forever article](https://warcraft.wiki.gg/wiki/World_of_Warcraft:_Forever) | **blocked on permission** | CC BY-SA 4.0, but robots.txt (read 2026-09-27): `Disallow: /api.php` and `/wiki/Special:` for all bots; `ClaudeBot`, `GPTBot`, `anthropic-ai` disallowed entirely; `Content-Signal: search=yes,ai-train=no,use=reference`, declared a reservation of rights under EU DSM Art. 4. No automated sync until wiki.gg grants it |
| Forever fan wiki | **domain to pick** — see conflict below | Forever rules, races, zones | yes | `fetch` | ToS unverified |
| Wowhead Forever | wowhead.com/forever | Items, NPCs, quests, guides — richest Forever coverage | yes | **`link`** | No API; robots.txt disallows `ClaudeBot`, `anthropic-ai`, `GPTBot` by name; history of enforcement against scrapers. Point users here; never fetch |
| ~~wago.tools~~ | wago.tools/db2/`<Table>`/csv | Item/quest/NPC tables | yes (builds 1.60.1.x) | **blocked** | robots.txt (read 2026-09-27): `User-agent: *` `Allow: /$` `Disallow: /`. Importer removed; see Gaps backlog |
| Character context | the addon (game API) | Name, class, level, zone, quests | yes | local | — |

⚠️ **Three different sites call themselves the Forever wiki:** `world-of-warcraft-forever.wiki`
(robots.txt allows pages, blocks `/api/`; ToS 404), `wowforeverwiki.org` (GitHub-backed,
`limbuilder/wow-forever-wiki`), and `wowforevergame.wiki`. Pick one by content quality and terms;
name the exact domain in the map.

## Databases

| Source | URL | Good for | Forever | Access |
|---|---|---|---|---|
| Wowhead (retail / classic / forever) | wowhead.com | Standard item/NPC/quest DB. `/forever` is a full vertical: database, talent calc, item tooltips. Other catalogues read its XML tooltip endpoints; we do not | yes (/forever) | `link`. A person may open a page in a browser to confirm an item exists or to check one of our rows by hand. No bulk reads, no XML endpoint, no stored rows (terms, robots.txt, beta churn). Research pass 2026-10-04 |
| Warcraft DB — Forever | forever.warcraftdb.com | Forever items/quests/dungeons; 21 entity types in its sitemap | yes | **research only**. Checked 2026-10-18: robots.txt `Allow: /` for all agents, but no terms page, "© 2026 Lexicon Gaming, LLC. All Rights Reserved.", no API or licence. Not a data source without written permission. Notes in `docs/2026-10-18-database-taxonomy-research.md` |
| WoW Eternity | woweternity.com/forever | Loot, sets, BiS, build planner | yes | `fetch?` |
| Warcraft Tavern | warcrafttavern.com/forever | Guide-style reference pages | yes | **research only**. Checked 2026-10-18: robots.txt allows `/forever/`, but the [terms](https://www.warcrafttavern.com/terms-of-use/) grant "personal, non-commercial transitory viewing only" and forbid copying, modifying, public display and mirroring (Michigan law). Same Lexicon Gaming network as forever.warcraftdb.com |
| WoW Classic DB | wowclassicdb.com | Classic-era DB | unknown | `fetch?` |
| EVOWOW | evowow.com | Private-server-era DB | no evidence | skip |
| ClassicDB / WoWDB (legacy) | classicdb.ch, wowdb.com | Stale (expired cert / frozen ~2022) | no | skip. wowdb.com robots.txt (read 2026-10-18): `ai-train=no,use=reference`; `ClaudeBot`, `GPTBot`, `anthropic-ai` and other AI agents disallowed entirely. Structure notes in `docs/2026-10-18-database-taxonomy-research.md` |

## Wikis & lore

| Source | URL | Good for | Forever | Access |
|---|---|---|---|---|
| Warcraft Wiki | warcraft.wiki.gg | Lore, mechanics, WoW API docs | yes | 2023 dump now; live sync blocked on permission (see v1 table) |
| Wowpedia (Fandom) | wowpedia.fandom.com | Frozen since 2023 | no | skip — Fandom ToS bars scraping/AI use without written consent (quote secondhand) |
| WoWWiki archive | wowwiki-archive.fandom.com | Frozen original wiki | no | skip |
| Blizzard official | worldofwarcraft.blizzard.com/en-us/forever, news.blizzard.com | Canonical announcements | yes | `link` |
| Blizzard forums (Forever category) | us.forums.blizzard.com | Blue posts, beta discussion | yes | `link` |

## Guides & theorycraft

| Source | URL | Good for | Forever | Access |
|---|---|---|---|---|
| Icy Veins | icy-veins.com/wow-forever | Class, leveling, Legacy System guides | yes | `link` — `/terms` 403s to bots; active bot management |
| Method.gg | method.gg/wow-forever | Talent + Legacy calculators, news | yes | `link?` |
| Wowhead guides | wowhead.com/forever/guides/classes | Per-class guides | yes | `link` |
| MythicSim | mythicsim.com/wow-forever | Forever DPS/gear sim (wowsims fork) | yes (beta) | `link?` |
| Maxroll | maxroll.gg/wow | Retail guides | no (yet) | `link?` |
| Raidbots / SimulationCraft / Bloodmallet | raidbots.com, simulationcraft.org, bloodmallet.com | Combat sims | **`forever` branch exists** on [simulationcraft/simc](https://github.com/simulationcraft/simc), updated 2026-09-27, still a port (profiles deleted, class modules resetting). Default branch is retail `midnight`. GPL-3.0. Addon is Unlicense. | Run as a separate binary once it sims. Do not vendor into this tree. See `docs/references.md`. |
| Archon.gg | archon.gg/wow | WCL-driven tier lists | unknown | `link?` |
| Class Discords | wowhead.com/discord-servers (directory) | Live theorycraft | unknown | `link` |

## Stats, logs, rankings

| Source | URL | Good for | Forever | Access | Terms evidence |
|---|---|---|---|---|---|
| Raider.IO | raider.io/api | Character/guild profiles | unknown (no M+ in Forever) | `fetch?` until ToS read firsthand | Keyless 200 req/min; ToS pages JS-only to bots |
| Warcraft Logs v2 | warcraftlogs.com/api/docs | Combat log rankings (GraphQL, OAuth2) | not yet — third-party parser `Emyrk/chronicle#694` handles beta logs | `api` (retail/classic); gate Forever | Log content CC BY-NC-SA 3.0; no clause on API redistribution — ask `support@rpglogs.com` before public |
| WoWProgress | wowprogress.com | Guild progress | unknown | `link?` |
| Check-PvP | check-pvp.fr | Arena history | unlikely (Forever uses Honor/Rank) | skip |
| Murlok.io | murlok.io | Top-parse builds | no (retail only) | skip |
| Data for Azeroth | dataforazeroth.com | Collection leaderboards | unknown | `link?` |

## Collections & pets

| Source | URL | Good for | Forever | Access | Terms evidence |
|---|---|---|---|---|---|
| Petopia | wow-petopia.com | Hunter pet families, taming | yes (active Forever taming forum, 9/25) | `link` | "may not be copied or reprinted without our express written approval"; no robots.txt |
| Wowhead collections | wowhead.com/forever/guide/collections/... | Mounts, pets | yes | `link` | see Wowhead |
| WarcraftPets | warcraftpets.com | Battle pets | unknown | `link` (403s bots) |
| Simple Armory / aotc.gg/forever | simplearmory.com, aotc.gg/forever | Armory, collections | unknown / yes | `link?` |

## Game data & datamining

| Source | URL | Good for | Forever | Access |
|---|---|---|---|---|
| wago.tools | wago.tools | DB2 tables, build monitor | yes | **blocked** — robots.txt disallows everything but the home page (see v1 table) |
| Gethe/wow-ui-source | github.com/Gethe/wow-ui-source (branch `forever`, updated 2026-09-24) | Blizzard UI/Lua source mirror — ground truth for **building the addon** | yes | `fetch` (git) |
| Warcraft Wiki — WoW API | warcraft.wiki.gg/wiki/World_of_Warcraft_API | Addon API reference | unconfirmed for Forever | 2023 dump (import); live pages: link only — /api.php disallowed |
| Blizzard Game Data / Profile API | community.developer.battle.net | Official data — **all free groups adopted**, see spec §4.5 | **Forever namespaces answer (2026-11-06)** | `api` — one adapter, all namespaces (retail, `classic`, `classic1x`, `forever`). Each user brings their own free client. Terms: attribution required, no redistribution/resale, no monetising the data, 36,000 calls/hr → local cache only |
| WoWDev wiki | wowdev.wiki | File formats | no | skip |
| wow.tools | wow.tools (site retired May 2025) | Public site dead. Local app [Marlamin/wow.tools.local](https://github.com/Marlamin/wow.tools.local) is MIT and still updated. It downloads older builds from wago.tools. | dev machine only | Do not publish extracted tables. Do not import via its wago.tools path. |
| Community Forever datasets | github.com/alcaras/forever-ref | Example consumer of wago.tools Forever exports | yes | reference only |
| foreverdiff.com | foreverdiff.com | Claims a full client-extracted spell/item diff | yes | **blocked**. Client extraction is their liability and beta rows change weekly. Never fetch, import, or check our rows against it: one foreign row would contaminate a pack. Research pass 2026-10-04 |

## Addons & UI ecosystem

| Source | URL | Notes | Forever | Access |
|---|---|---|---|---|
| CurseForge | curseforge.com/wow | Forever filter `gameVersionTypeId=88568`; **our v3 home** | yes | `link`; API forbids caching its data — only matters if we query addon metadata |
| Wago Addons / wago.io / WoWInterface | addons.wago.io, wago.io, wowinterface.com | Other hosts; Wago API is publish-only | uncertain | `link` |
| wow-ai | github.com/chelinho139/wow-ai | Bridge we build on (MIT) | yes | reference |

## Economy

| Source | URL | Forever | Notes |
|---|---|---|---|
| TSM public data | public-data.tradeskillmaster.com | unknown | Free CSV feeds, retail/classic |
| Undermine Exchange (= old Oribos Exchange) | undermine.exchange | unknown | Key via Patreon |
| Saddlebag Exchange | saddlebagexchange.com/wow | unknown | Separate project |
| Token trackers | wowtokenprices.com, wowtoken.app | **no** | Forever has **no WoW Token** and no paid boosts — gold is farmed. Don't wire token logic into Forever answers. wowtoken.info is dead |

## News & community

| Source | URL | Forever | Access |
|---|---|---|---|
| Wowhead news | wowhead.com/forever | yes | `link` |
| MMO-Champion | mmo-champion.com | active; depth unverified | `link?` |
| Warcraft Tavern | warcrafttavern.com/forever | yes (tracks beta window 9/17–10/22) | `link`; terms forbid copying (see v2 row) |
| wowforevertools.com | wowforevertools.com | yes (talents, racials, builds, map, checklist; no item database) | `link?` |
| wowforevertalent.com | wowforevertalent.com | yes (~146 recorded dungeon and quest items) | `link`. Copy the standard, not the rows: an item nobody recorded reads "unrecorded", never zero. Research pass 2026-10-04 |
| Reddit r/wow, r/classicwow | reddit.com | partial | `api` is **paid** since 2023 (~$0.24/1,000 calls) — `link` for v1 |
| r/wowforever | — | unconfirmed it exists | — |

Lower-confidence SEO-tier Forever sites (corroboration only, never a primary source):
classicwowforever.com, wowforeverbuilds.com, zockify.com/forever, expcarry.com, accountshark.net,
mmoexp.com, wow4ever.quest, wowforeverarmory.com, wowforevertalents.com, aroged.com.

## Creators (`curated`, v2)

Live status comes from the Twitch API (`api`: Client ID + app token, 800 points/min; Twitch marks only
to attribute). Handles below are from the catalogue pass — **each gets a manual check before it
enters the registry.**

| Creator | Twitch | YouTube | Forever content |
|---|---|---|---|
| Xaryu | xaryu | youtube.com/xaryu | **yes** |
| Asmongold | zackrawrr | @AsmonTV | unknown |
| Preach | preachlfw | @preachgaming | unknown |
| Esfand | esfandtv | youtube.com/esfandtv | unknown |
| Sodapoppin | sodapoppin | youtube.com/c/sodapoppin | unknown |
| Taliesin & Evitel | taliesinandevitel | tande.tv | unknown |
| Nixxiom | nixxiom | channel UCfMb2S7Aqnr4zQDJkYwgkgw | unknown |
| Hazelnuttygames | hazelnuttygames | channel UCMGVp_GnkhHZROIfRdXpo4Q | unknown |
| Pikaboo | pikabooirl | @PikabooirlVODs | unknown |
| Naguura | naguura | channel UC9hQOoOtN-xaUjPn1jWzsWQ | unknown |
| Towelliee | towelliee | @Towelliee | unknown |
| Quin69 | quin69 | @Quin69TV | unknown — now mostly variety |
| Bellular | **unresolved** (bellular vs BellularGaming) | 3 channels (News / Gaming / Warcraft) | unknown |
| WoW at Night | — | mobalytics.gg/wow-forever/profile/wowatnight | yes |
| TheClaneTV | theclanetv | — | yes (single source) |

Unresolved: "Max (Echo)" — the Max found is Limit/Team Liquid, not Echo; don't add until confirmed.
Discovery feeds for Forever streams: forever-guides.com, wowforeverstreams.com.

## Gaps backlog

Sources we can't use (blocked, paid, unlicensed, or no Forever data yet), what they would have
given us, and how we fill that gap ourselves. Never filled by copying the blocked source.

| Gap | Blocked source | Why | How we fill it | Part |
|---|---|---|---|---|
| Forever item/NPC/quest details, drop rates, spawn points | Wowhead | robots.txt bans AI bots; no API | Addon collector (opt-in) | 3 |
| Current lore and Forever pages | warcraft.wiki.gg (live) | `/api.php` disallowed, AI bots disallowed | 2023 dump now; email wiki.gg for permission / a current dump | 1 |
| Class and leveling guides | Icy Veins, Method, Wowhead guides | No API; bot blocking | Curated guides we write, drawing on player-collected data | 1 (curated) |
| Hunter pet families and taming | Petopia | "may not be copied or reprinted" | Collector records tameable beasts | 3 |
| Balance-sensitive item stats | datamined tables | Blizzard hides stats until drop | Collector records item tooltips players see | 3 |
| Character / guild profiles | Blizzard API, Raider.IO | Forever profiles answer (2026-11-06): from level 10, after logout | Addon character context now; a Blizzard mirror is the showcase plan's section 5 | 3 |
| Combat rankings | Warcraft Logs | No Forever support; redistribution terms silent | Ask `support@rpglogs.com`; revisit after launch | later |
| Lore from the old wiki | Wowpedia (Fandom) | ToS bars AI use without consent | Covered by the warcraft.wiki.gg dump (same history pre-2023) | 1 |
| Community discussion | Reddit | Paid API | Link-out only | — |
| Auction prices | TSM, Undermine Exchange | No Forever data; TSM terms unread; Undermine needs Patreon key | Blizzard AH API (local, retail/Classic now) + collector records the player's own AH browsing → our own price history. TSM feeds only if terms allow; never TSM's addon files | 3 (v2) |
| Forever game tables — wago.tools robots.txt disallows /db2 | wago.tools | robots.txt (read 2026-09-27) for `User-agent: *`: `Allow: /$`, `Disallow: /` — everything except the home page, `/db2/` CSVs included. The importer was never run against the site and was removed from `kb/` the same day | Addon collector (opt-in) records items, spells and zones players see; ask wago.tools for permission or a bulk export | 3 |

## Still to verify by hand (browser, before v3)

Terms pages that blocked automated reads: Wowhead `/tos`, Icy Veins `/terms`, Raider.IO ToS,
Fandom ToS, Wago developer agreement, world-of-warcraft-forever.wiki ToS. Plus: wiki.gg's own terms
for bots and dumps, Raider.IO registered-app rate limit, WCL point limits.
