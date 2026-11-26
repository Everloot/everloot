# Source ledger

Every external source Everloot has used, linked to or read while building it, and what we did with
each one. Complete as of 2026-10-16. A source joins this file before its data, link or code joins
the project. The rules behind it are in the [data policy](../DATA_POLICY.md).

`docs/sources/source-catalog.md` is the research list of candidates and their terms. This ledger
records what actually happened.

**Use** is one of:

- **published data**: some of it is on everloot.app, in a knowledge release or in the MCP answers.
- **local only**: read on a maintainer's machine; never published.
- **link only**: we link to it; nothing from it is stored.
- **research only**: read while designing; nothing from it is stored or linked from the product.

## Published data

| Source | Terms | Evidence | In releases |
|---|---|---|---|
| [Warcraft Wiki dump, 2023-11-13](https://archive.org/details/wiki-warcraft.wiki.gg-20231113) (Internet Archive) | CC BY-SA 4.0 | `kb/src/importers/wiki-*.ts`; source id `warcraft-wiki-2023` | Yes: 257,110 pages (2026-10-05 release), 260,572 (2026-10-16 build) |
| Curated entries, our own words | CC BY-SA 4.0 | `kb/curated/forever.yaml`; one entry, citing [Blizzard's announcement](https://news.blizzard.com/en-us/article/24302498/updated-9-24-pre-purchase-the-world-of-warcraft-forever-collectors-edition) | Yes: 1 row |
| Players' Everloot uploads | CC BY-SA 4.0, stated on the upload page and by the companion before it sends anything | Written only by `web/src/app/api/intake/route.ts`, through `putUpload` in `web/src/lib/upload-store.ts`. A [Polestar Recorder](https://github.com/fitzforge/polestar) file a player chooses on the upload page is converted in the browser by `web/src/lib/polestar-recorder.ts` into NPC positions, quests, loot, dungeon entrances, boss encounters and treasures and sent the same way; we read its file format and use none of its code | Public corpus only, after corroboration |
| Guild-family facts: [olympus-viii.org](https://olympus-viii.org/), [olympus-viii.com](https://olympus-viii.com/), [Blizzard forums](https://us.forums.blizzard.com/en/wow/t/olympus-is-recruiting/2355270), [X / Prism](https://x.com/fwprism/status/2101809316382847172), [WoW Forever Outpost](https://wofwforever.com/en/guides/wow-forever-olympus-guild/), [Olympus Guild addon](https://github.com/dnl-gentile/olympus-addon), [YouTube](https://www.youtube.com/watch?v=fihRIfTwd5k), [Dexerto](https://www.dexerto.com/gaming/wow-forever-player-creates-mod-that-hides-asmongolds-entire-guild-3412321/) | Facts in our own words, each with its page and date; no text copied | `web/src/data/families.ts`; each page read once by hand | Site only |
| Legacy perk Talented: [Warcraft Tavern's Legacy guide](https://www.warcrafttavern.com/forever/guides/legacy/) and [talentsforever.com/questions](https://talentsforever.com/questions), read 2026-10-19 | One fact in our own words, no text copied: Talented has 5 ranks and moves the first talent point earlier, to level 5 at rank 5, with 51 points either way. Not in our game files, so it is stated beside the game-file level and not computed. Audited 2026-10-27: the game files hold rows that match it (read from column names, unconfirmed in game), unencrypted trait rows of builds 70450 and 70532 that the talent catalog filters out or does not read ([audit](2026-10-27-class-legacy-dungeon-source-audit.md#talented)); the exception stands until a reviewed change re-sources it | `firstPointLine` in `web/src/lib/talents/facts.ts`; the `talent_tree` answer text in `kb/src/talent-tools.ts` | Site and MCP only (`/tools/talents` answers, `talent_tree`) |
| [Polestar](https://github.com/fitzforge/polestar) facts | GPL-3.0-only with a pack exception; we state facts and link, and copy no code or guide text | `web/src/data/polestar.ts`, read from the repository at `06c1c41` (v0.2.4) | Site only |
| [Blizzard News World of Warcraft feed](https://news.blizzard.com/en-us/feed/world-of-warcraft) and its linked English Forever/Classic articles | Blizzard announcement metadata only: title, publisher, original URL and structured publication/modification times; no article body or excerpt. Read robots.txt first (404 means no rules), no redirects, shared 40-request/time budget, one article per pass, at most hourly | `kb/src/blue-news.ts` through the existing blue reader; stable article ids keep rolling hotfix updates as one announcement | Site and MCP only (`/changes`, `recent_changes`) |
| [Blizzard WoW forums](https://us.forums.blizzard.com/en/wow), US and [EU English](https://eu.forums.blizzard.com/en/wow), staff posts, read from the public Discourse JSON: the staff list (`about.json`, at most daily), the Forever and Classic topic lists (`/c/<category>/l/latest.json`) and the topics among them that carry a staff post (`/t/<id>.json`, `/t/<id>/posts.json`). Staff means the forum's staff list or the forum's own Blizzard post marker (group tracker, MVP groups excluded); `kb/curated/blue-accounts.json` holds hand corrections | Blizzard's text stays Blizzard's: title, author, role, time, category, thread and an excerpt of at most two sentences (quotes of other posts removed), always with a link to the original. Players' posts are read with a topic and never kept. robots.txt is read before every run on each host; the `.rss`, search and `/g/` routes it disallows are never used; redirects are not followed; at most 40 requests a run, topic lists read only back to what the last run saw. Forum posts are kept only from Forever and Classic categories. The forum's terms page that can be fetched is a stale template with no automation clause (research note 2026-10-18) | `kb/src/blue-posts.ts`, `npm run kb -- blue-check`, every 30 minutes (since 2026-10-17). The scheduled workflow opens one rolling data pull request; it merges itself only when the pull request touches nothing but `kb/changes/blue-posts.json` and `kb/changes/builds.json` and every check on its head commit passed. Every merge deploys, so at most one deploy per 30 minutes | Site and MCP only (`/changes`, `recent_changes`) |
| [World of Warcraft on Bluesky](https://bsky.app/profile/worldofwarcraft.blizzard.com) (verified official account), read from Bluesky's public API | Public posts of an official account: title, time and an excerpt of at most two sentences, with a link | Same file, same run | Site and MCP only |
| GitHub REST API (`api.github.com`): Polestar's public releases and open issues | GitHub API terms; public metadata, shown with links | `web/src/lib/polestar-github.ts`, hourly, anonymous unless a read-only token is set | Site only |
| GitHub REST API (`api.github.com`): the projects in `kb/curated/ecosystem.json` (Everloot, Polestar, Olympus, forever-ref): stars, latest release, last commit, commits in 4 weeks, contributor count, open and closed issue counts, median first-reply time, and the `## Interface` line of the project's `.toc` | GitHub Terms of Service section H and the REST rate limits (research note 2026-10-18, kept outside this repository). Public metadata only, shown with a link to each repository. No usernames, emails or contributor lists are kept; a count only. GITHUB_TOKEN is optional | `kb/src/ecosystem-fetch.ts`, `npm run kb -- ecosystem-check`, at most every 3 hours per project, serial requests, stops on a long rate limit. The scheduled workflow opens a pull request for `kb/changes/ecosystem.json` and never merges it | Site and MCP only (`/addons/ecosystem`, `ecosystem_projects`) |
| GitHub REST API (`api.github.com`): the repositories `web/src/data/addon-repos.ts` names for an addon players run (checked by hand): stars and newest release for the `/addons/popular` leaderboard, and the profile facts on `/addons/<name>` | GitHub Terms of Service section H and the REST rate limits. Public metadata only, shown with a link to each repository. A tracked project takes its numbers from `kb/changes/ecosystem.json` instead, so no request is made for it. GITHUB_TOKEN is optional | `web/src/lib/addon-github.ts`, cached an hour per request, a failure remembered 5 minutes; the leaderboard reads at most 10 repositories a view, 2 requests each, and says when the hourly limit was the reason | Site only |
| [AH Ledger API](https://ahledger.com/developers) (`api.ahledger.com`): `/v1/tooltip/{market}` latest prices, `/v1/prices/{market}/{itemId}?range=30d` history and sales estimates, `/v1/crafting/{market}` crafting margins, `/v1/deals/{market}` discounted listings and `/v1/economy` listed value now versus a week ago | Read 2026-11-15: free with a key for personal use and community tools given to players without charge, with a credit link; a product earning from the data through ads, subscriptions, sales or sponsorship needs a commercial licence; answers may be kept no longer than their Cache-Control allows. Everloot shows no ads since 2026-11-15 (the AdSense variable is unset), so it uses the free key, `AHLEDGER_API_KEY` | `web/src/lib/ahledger.ts`, `web/src/lib/ahledger-proxy.ts` and allow-listed routes in `web/src/app/api/ahledger/`; browser panels show a "Prices from AHledger" link using the response's checked attribution URL. Browser max-age is preserved; only public answers with s-maxage get an edge lifetime, private answers stay in the browser or are no-store. `web/src/lib/ahledger.test.ts` enforces the exact reader list | Site only, read live on auction and profession pages. Never stored, and not in the API's data, MCP, Chat, exports, open data, sitemaps, the addon, Desktop App or knowledge release |
| [InFlight](https://github.com/LudiusMaximus/InFlight) `Defaults.lua` at commit `4b2b3baed78b13c129405330e5abbdc0c0d6b8fd` (2026-11-15): measured flight times, its Classic Era table with its WoW Forever corrections on top, as InFlight applies them on Forever | MIT; the copyright and permission notice ship in the file. Times only, keyed by the game files' TaxiNodes ids; no InFlight code | `scripts/build-flight-times.py` writes `addon/modules/flight_times.lua` (880 routes). The same times set the flight speed of the game-file estimate, `F.SPEED` = 30 yards a second (266 direct flights, median difference half a second) | Addon only: the flight bar and the flight map's tooltips, until a character times a route itself |
| Blizzard Developer API: Forever auction house item and commodity summaries | Blizzard Developer API terms; ad-free pages only, credited, retained at most 30 days, no shared cache | Hourly `.github/workflows/blizzard-auctions.yml`; separate Supabase tables and service-role-only readers. `/blizzard-auctions` browses current snapshots by house; `/blizzard-auctions/<id>` shows current and daily history, with Blizzard publish times. Missing readers and failed reads have distinct states | Site pages only; never mixed with player prices or included in API answers, MCP, chat, sitemaps, open data, addon price files or exports |

The census resolves class and race icon URLs through Blizzard's [Game Data media endpoints](https://develop.battle.net/documentation/world-of-warcraft/game-data-apis), `/data/wow/media/playable-class/{id}` and `/data/wow/media/playable-race/{id}`, in `static-forever-us`. `web/src/lib/census-media.ts` keeps the returned `icon` URLs for one day; images load directly from `render.worldofwarcraft.com`. Blizzard's API terms apply, and the artwork remains Blizzard's. No artwork is bundled in this repository or included in the CC BY-SA dataset. Missing media leaves the name alone. Live endpoint responses and the Skyborne media id remain unverified.

## Local only

| Source | Terms | Evidence | In releases |
|---|---|---|---|
| [Blizzard Battle.net API](https://develop.battle.net/) (`us.api.blizzard.com`) | Blizzard Developer API terms: no redistribution, no monetising the data | `kb/src/blizzard/client.ts`; source id `blizzard-api`, `publishable: false` | No. The release build refuses it, and `audit-sources` found it in no file |
| [pfQuest](https://github.com/shagu/pfQuest) database, Classic 1.12, at commit `104f3567`: the vanilla `db/units.lua`, `objects.lua`, `items.lua`, `quests.lua`, `refloot.lua`, `zones.lua` and the enUS names and quest titles (no quest objective or description text) | Addon MIT; its database was built from VMaNGOS (GPL-2.0) and CMaNGOS classic-db (GPL-3.0), so it is never mixed into the CC BY-SA data. Read from a local download as data, its Lua never run | `kb/src/importers/pfquest.ts`, `npm run kb -- import-pfquest`; source id `pfquest-classic`, `publishable: false`. `npm run kb -- baseline-report` writes a report outside the repository of what Forever uploads confirm, change, add or have not seen yet. Design: `docs/design/specs/2026-10-17-classic-baseline-design.md` | No. The release build drops it and `audit-sources` reports it. Only facts Forever players confirm are published, from their uploads |
| [Blizzard version service](https://us.version.battle.net/v2/products/wow_classic_beta/versions) (`us.version.battle.net`) | Public build metadata the game launcher reads: build numbers and config hashes, no game files | `kb/src/builds.ts`, `npm run kb -- builds-check` (since 2026-10-17). The maintainer's `data/builds.json` stays local; the `/changes` page shows a separate public copy, `kb/changes/builds.json` | Build numbers and the time Everloot first saw them appear on `/changes`; nothing else |
| Blizzard game files from its CDN (tables `ItemSparse`, `Item`, `SpellName`, `Spell`, the `Trait*` talent tables, `SpellEffect`, the map tables `Map`, `UiMap` and `UiMapAssignment`, since 2026-10-25 the level tables `MapDifficulty`, `ContentTuning` and `LFGDungeons`, and since 2026-10-18 the coverage tables `ItemClass`, `ItemSubClass`, `ItemSet`, `SkillLineAbility`, `SpellItemEnchantment`, `SpellReagents`, `AreaTable`, `ChrRaces`, `Faction`, `CharTitles`, `Languages`, `CurrencyTypes`, `CreatureFamily`, `CreatureType`, `Holidays`, `Toy`, `BattlePetSpecies`, `Creature`, `GameObjects` and `QuestV2`; listed in `CLIENT_TABLES`; and since 2026-10-22 the continents' WDT and ADT terrain files, of which only each chunk's area id under a dungeon entrance or taxi node is kept, as `TerrainArea`, `kb/src/terrain-area.ts`) | Game data © Blizzard; read as facts, encrypted blocks skipped, never decrypted. Publication only through review, under `docs/DATA_POLICY.md` | `kb/src/client-extract.ts`, `npm run kb -- client-extract`, `client-diff` (since 2026-10-17) and `client-coverage` (since 2026-10-18) | Under `docs/DATA_POLICY.md`, in `web/src/data/game-data/`: the talent catalog (`talents/`, for `/tools/talents`), the raid buff table (`raid-<build>.json`, for `/tools/raid` and the addon), the map layer (`map.json`, for `/map`) and, decided 2026-10-18 by the maintainer, the client layer (`client-layer.json`: item relations from `SpellEffect`, `SpellReagents`, `ItemSet` and `Item`, the spell → profession relation from `SkillLineAbility` and `SkillLine` (since 2026-10-18), for the item pages, the MCP tool `entity_relations`, `/api/edges` and `/api/edges/client-layer`; item categories from `ItemClass`, `ItemSubClass`, `Item` and `ItemSparse`, for `/database/items`, the MCP tool `item_categories`, `/api/items` and `/api/items/categories`), and, decided 2026-10-27 by Carlos, the race table (`races.json`: race and class pairs from `CharBaseInfo`, factions from `ChrRaces` and racial traits from `ChrRaceRacialAbility`, for `/classes/<class>`, `/wow-forever` and the MCP tool `class_races`; trait descriptions on pages only), and, decided 2026-11-01 by Carlos, the class gear table (`client-class-gear.json`: each class's weapon and armor proficiencies and the level it gets each at, from `SkillLine`, `SkillLineAbility`, `SpellEffect`, `SpellEquippedItems`, `SkillRaceClassInfo` and `ChrClasses`, and the items whose `ItemSparse` class mask leaves a class out; ids and masks only, for the class filter on `/database/items`), and, decided 2026-11-02 by Carlos, the Legacy perk catalog (`legacy-perks.json`: the Legacy trait trees with their node and entry ids, ranks, prerequisites, spend gates, cost and cap, spell ids and perk names, no descriptions or icons, for the read-only page `/tools/legacy`; not in the dataset or the API; since 2026-11-03 its perk names and ids reach the MCP knowledge search through the catalog index, see the amendment below the table), and, decided 2026-11-02 by Carlos, the class spell table (`client-class-spells.json`: the spells on each class's class skill lines, from `SkillLine` (category 7), `SkillLineAbility` and `SkillRaceClassInfo`, with the class-wide Mounts, Companions, Engraving and Runes lines counted only where a spell's own class mask names the class; spell ids only, for the class context on `/database/spells`), and, decided 2026-11-02 by Carlos, the recipe table (`client-recipes.json`: each profession's recipes from `SkillLine`, `SkillLineAbility` (with its skill rank columns), `SpellEffect` and `SpellReagents`; spell and item ids, reagent counts and skill ranks, for `/tools/professions` and the profession pages), and, decided 2026-11-03 by Carlos, the faction, title and quest line tables (`client-factions.json`, `client-titles.json`, `client-quest-lines.json`: ids and names, a faction's parent and whether it shows in the reputation pane, a quest line's quest ids in order, from `Faction`, `CharTitles`, `QuestLine` and `QuestLineXQuest`; for `/database/factions`, `/database/titles`, `/database/quest-chains` and the knowledge search), and, proposed 2026-11-13 in the pull request that adds it (the maintainer review), the bag table (`client-bags.json`: every container's slot count from `ItemSparse.ContainerSlots`, its quality and its subclass from `Item`, and the container subclass words from `ItemSubClass`; item ids and numbers only, no names, binding or required level, for `/tools/bags` and the "N Slot Bag" tooltip line), and, proposed 2026-11-17 in the pull request that adds it (the maintainer review), the terrain table (`client-terrain.json`: the area groups item effects need from `SpellCastingRequirements` and `AreaGroupMember`, resolved to zones and instances through `AreaTable`, `Map`, `UiMap` and `UiMapAssignment`, each named by the words its spells' text uses ("Desert", "Strongholds and Cities"), and each item effect, enchant and set bonus that needs a named terrain or changes speed, from `ItemEffect`, `ItemXItemEffect`, `SpellItemEnchantment`, `ItemSetSpell`, `ItemSet` and `SpellEffect`; ids, numbers, area names and the terrain words only, for the Terrain section of the zone and instance pages and `/database/terrain`), and, proposed 2026-11-25 in the pull request that adds it (the maintainer review), the collections table (`client-collections.json`: currencies from `CurrencyTypes` and `CurrencyCategory` with their category, cap and description (pages only), companion pets from `BattlePetSpecies` named by their own `Creature` row with the summon spell, and toys from `Toy` as item ids only; for `/database/currencies`, `/database/pets` and `/database/toys`, with the mount pages reading `client-mounts.json`), and, proposed 2026-11-25 in the pull request that adds them (the maintainer review), the holiday and hunter pet family tables (`client-holidays.json`: holiday names, descriptions (pages only), durations and packed start dates from `Holidays`, `HolidayNames` and `HolidayDescriptions`; `client-pet-families.json`: the families that eat, with their icon file, skill line and the spell ids on it, from `CreatureFamily`, `SkillLineAbility` and `SpellName`; for `/database/holidays` and `/database/pet-families`). Everything else stays in per-build snapshots on a maintainer machine until the reviewed layer ships |
| Blizzard game files from its CDN: spell icons, spell text and talent window art (tables `SpellMisc`, `SpellEffect`, `SpellDuration`, `SpellAuraOptions`, `Spell`, `SpellName`, `UiTextureAtlas`, `UiTextureAtlasElement`, `UiTextureAtlasMember`, and for loading screens and emblems `Map`, `LoadingScreens`, `ChrRaces`, read by file data id; the icon, atlas and loading screen BLP files they point to) | Icons, tooltip text and interface art © Blizzard. Decision B, 2026-10-18: shown on pages only, with the credit line, from unencrypted files only; no key and no listfile. Loading screens, race and faction emblems and the game's own logo added the same day (DATA_POLICY, "Second extension") | `kb/src/client-assets.ts`, `npm run kb -- client-assets <snapshot>`; upload by a maintainer with `web/scripts/upload-game-assets.mjs`; steps in `docs/ASSETS.md` | No. Asset storage with a build-stamped manifest, read by the talent calculator at `/tools/talents` and the pages listed in `docs/ASSETS.md` when `NEXT_PUBLIC_GAME_ASSETS_URL` is set. Never in git, the API, the MCP server or the data downloads |
| [WoWDBDefs](https://github.com/wowdev/WoWDBDefs) table definitions | CC BY-SA 4.0 (definitions), BSD-3-Clause (code) | Fetched by the extraction library to read each table; the commit is recorded in each snapshot manifest | No; definitions are not stored |
| Blizzard's own `.toc` and Lua files in the client, read once on 2026-10-18 from the CDN by name hash (no listfile, nothing decrypted) to look for an `## Interface` line | Game files, read as facts; nothing stored or published | A one-off probe, not committed: none of the `.toc` files read carries an `## Interface` line, so the Forever interface number is derived from the build version instead (`kb/src/ecosystem.ts`) | No |
| Wowhead facts (not built) | Gated: Wowhead's Terms of Use must allow it first | [`docs/DATA_POLICY.md`](../DATA_POLICY.md), "Wowhead" | No |

*Amendment, decided 2026-11-03 by Carlos: the catalog kinds (achievements, factions, titles, quest lines, mounts,
legacy perks, races, instances) reach the MCP knowledge search through the catalog index (`kb/src/catalog-index.ts`),
as names, ids and the listed fields, each labelled found in game files, unconfirmed with its build; achievement
descriptions and criteria text stay on pages.* This applies to the Blizzard game files row above and to the Legacy
perk catalog named in it. See [`docs/DATA_POLICY.md`](../DATA_POLICY.md), "Game-file facts in answers".

## Link only

The site links to these and stores nothing from them: [warcraft.wiki.gg](https://warcraft.wiki.gg)
(each lore page links its live article), [CurseForge](https://www.curseforge.com/wow/addons/polestar-guides)
and the [Polestar Discord](https://discord.gg/vMbee6F2e9) from the addons pages,
[Wago Addons](https://addons.wago.io) and [WoWInterface](https://www.wowinterface.com) (checked 2026-10-18 for the ecosystem tracker: Wago documents no read API for listings and WoWInterface's terms forbid automated access, so neither is read; CurseForge's API terms forbid caching, so it is not called either; rechecked 2026-11-02 for the `/addons/popular` leaderboard: the [3rd Party API Terms](https://support.curseforge.com/en/support/solutions/articles/9000207405-curse-forge-3rd-party-api-terms-and-conditions) §3.1(e) forbid saving or caching any API data and §2.3 lets Overwolf require a paid licence past a quota it sets, and the [Wago Addons docs](https://docs.wago.io/) cover only uploading releases and a game-version list),
[Blizzard news](https://news.blizzard.com) (article bodies remain link only; announcement metadata is listed above) and Blizzard forum threads as citations.
Guides (`kb/guides/`) cite the same way: Blizzard's posts on worldofwarcraft.blizzard.com, news.blizzard.com and the
US and EU forums, link only, and no other site ([guide contract](../GUIDES.md#sources-and-links)).

## Research only

Every other site in `docs/sources/source-catalog.md` and `docs/references.md` was read during the
research passes of 2026-09-27, 2026-09-29 and 2026-10-04, to check its terms, robots.txt and page
shape. Nothing from them is stored, imported or linked from the product. These include Wowhead,
Icy Veins, Method, Raider.IO, Warcraft Logs, Petopia, the Forever fan sites, the economy sites and
the product inspirations in `references.md`.

Two community spreadsheets, a WoW: Forever biome list (zones and instances against nine terrain types) and a
speed item list, shared with the maintainer on 2026-11-16 with no author or licence named. Read only as a checklist
of what to look for in the game files; no row, word or value was copied. The terrain table (`client-terrain.json`)
comes from the game files alone, and where it and the biome list disagree, the site shows the files.

Open-source projects read as references, none of their code in this repository:

| Project | Licence | What we took |
|---|---|---|
| [Gethe/wow-ui-source](https://github.com/Gethe/wow-ui-source) | © Blizzard | API reference while writing the addon |
| [chelinho139/wow-ai](https://github.com/chelinho139/wow-ai) | MIT | The idea of a file bridge between the game and a local helper. See "History" for the live bridge |
| [simulationcraft/simc](https://github.com/simulationcraft/simc) | GPL-3.0 (addon: Unlicense) | Nothing yet; a possible separate process once its `forever` branch sims |
| [Marlamin/wow.tools.local](https://github.com/Marlamin/wow.tools.local) | MIT | Nothing; noted as a local tool, never an importer |
| [alcaras/forever-ref](https://github.com/alcaras/forever-ref) | None published | Nothing; an example of a wago.tools consumer |

## Infrastructure and placeholders, not data sources

Services the site runs on or signs in with: Cloudflare (the Worker that serves everloot.app), Supabase (`<project-ref>.supabase.co`), Cloudflare R2 (`<account>.r2.cloudflarestorage.com`,
`acct.r2.cloudflarestorage.com` in tests), Battle.net OAuth (`oauth.battle.net`, sign-in identity only), Google AdSense (`pagead2.googlesyndication.com`), the MCP client origins
(`chatgpt.com`, `chat.openai.com`, `claude.ai`, `perplexity.ai`). Placeholders in tests and examples:
`example.test`, `example.supabase.co`, `everloot.example`, `api.example`, `sb.example`, `sb.test`,
`db.test`, `evil.test`, `localhost`, `127.0.0.1`. Standards and docs links:
`schema.org`, `www.w3.org`, `www.sitemaps.org`, `www.mediawiki.org`, `webpack.js.org`,
`developers.cloudflare.com`, `policies.google.com`, `www.google.com`, `registry.npmjs.org`.

## Release evidence

`npm run kb -- audit-sources` on every database built so far, 2026-10-16:

```
wowvault-kb.sqlite (working database): curated=1 warcraft-wiki-2023=257110 api_cache=0
wowvault-kb-2026-10-16.sqlite: curated=1 warcraft-wiki-2023=260572 api_cache=0
recovery-script-check.sqlite: curated=1 warcraft-wiki-2023=257110 api_cache=0
release/2026-10-05-everloot-public.sqlite: curated=1 warcraft-wiki-2023=257110 api_cache=0
release/2026-10-16-everloot-public.sqlite: curated=1 warcraft-wiki-2023=260572 api_cache=0
release/wowvault-kb-2026-09-27.sqlite: curated=1 warcraft-wiki-2023=257110 api_cache=0
```

Every file also has `api_cache=0`: no cached Battle.net responses. The raw input folder holds one
file, the Warcraft Wiki dump `warcraft.wiki.gg-20231113-history.xml.zst`.

**Public corpus writers.** Uploads are stored by one function, `putUpload` in
`web/src/lib/upload-store.ts`, and it has one caller, `web/src/app/api/intake/route.ts`. The cron
snapshot (`writeSnapshot`) only re-reads stored uploads. No script seeds the corpus:
`web/scripts/corpus-load.mts` works on synthetic rows in memory and writes to no store.

**Addon downloads.** Every zip in `web/public/downloads` contains only `Everloot/*.toc` and
`Everloot/*.lua`, built from `addon/` by `scripts/package-addon.py`.

**Secrets in history.** `gitleaks git --log-opts=--all` (8.30.1) over 250 commits on every branch,
2026-10-16: no leaks.

## Audits

- **Class, Legacy and dungeon sources, 2026-10-27** ([audit](2026-10-27-class-legacy-dungeon-source-audit.md)).
  Read only sources already listed here: Blizzard's CDN through the pinned extraction library and WoWDBDefs (rows
  of read-set tables; for any other table only the build's root listing and its layout), the Blizzard version
  service, and the Blizzard staff posts the blue tracker had stored. The CDN and the version service were also read
  once for product `wowf`, which the version service lists at 1.60.1.70630 beside `wow_classic_beta`. No key,
  listfile, hotfix cache or decryption; nothing added to the read set and nothing published.

## History

- **wago.tools importer, 2026-09-27.** An importer for wago.tools' DB2 tables was written that
  morning. A robots.txt check then showed `/db2` is disallowed, and it was removed the same day in
  `ca185a6`, before the first real build. robots.txt then read `Allow: /$` and `Disallow: /`, which
  blocks everything but the home page. There is no record of the importer being run, and no
  wago.tools data exists in any database (see "Release evidence").
- **Live bridge, designed and dropped, 2026-09-27.** The first design
  (`docs/design/specs/2026-09-27-forever-ai-addon-design.md`) described a private "live bridge"
  that would read pixels from the game window, built on wow-ai. It was never built: no screen- or
  memory-reading code exists in this repository or its history. Everloot uses only the file bridge,
  which reads the SavedVariables file the game writes.
- **Uploads sent before the licence was stated.** Until the open-source licensing change reached
  everloot.app, neither the upload page nor the companion said under what licence uploads are
  published. Uploads received before then were sent without that statement.
