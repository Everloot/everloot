<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/media/everloot-logo-dark.png">
    <img alt="Everloot" src="docs/media/everloot-logo-light.png" width="280">
  </picture>
</h1>

**An open, player-built database for World of Warcraft: Forever. An addon records what you see, and
the site states a fact only once three installs agree.**

[![Checks](https://github.com/Everloot/everloot/actions/workflows/checks.yml/badge.svg)](https://github.com/Everloot/everloot/actions/workflows/checks.yml)
[![Code: AGPL-3.0](https://img.shields.io/badge/code-AGPL--3.0-blue)](LICENSE)
[![Data: CC BY-SA 4.0](https://img.shields.io/badge/data-CC%20BY--SA%204.0-lightgrey)](docs/DATA_POLICY.md)
[![Site: everloot.app](https://img.shields.io/badge/site-everloot.app-2f7a0a)](https://everloot.app)
[![Discord](https://img.shields.io/badge/chat-Discord-5865F2)](https://discord.gg/9CKsbHTRu3)
[![Latest addon release](https://img.shields.io/github/v/release/Everloot/everloot?filter=addon-v*&label=addon)](https://github.com/Everloot/everloot/releases)

![The Everloot home page](docs/media/home.webp)

Everloot is a fan project. WoW: Forever launches on **2026-11-04**, and Everloot is built to have
real answers on day one: drop rates, vendor prices, recipe ranges, spawn points, talent trees, what
changed in the latest build. Players supply the observations. The site shows each fact with the
number of installs that reported it and the date, and anyone can read the anonymous records behind
the count.

It does not scrape other sites and never touches the running game. The addon uses the game's own
addon API and writes its own save file. Everything that comes from the game files is labelled
unconfirmed until players have seen it, and spoilers are hidden by default. The full rules are in
[`docs/DATA_POLICY.md`](docs/DATA_POLICY.md).

## What is live on everloot.app

**Database.** Items, NPCs, quests, vendors, professions and auction history, built from player
uploads. A figure appears once three installs report it, with the count and the data's age beside it.
[everloot.app/database](https://everloot.app/database)

**Talent calculator.** Plan a build for any class: point rules, two talent sets, undo, and a share
link that names the game build. The addon can load that plan and show you the next point to spend.
[everloot.app/tools/talents](https://everloot.app/tools/talents)

![The Mage talent calculator](docs/media/talents.webp)

**Raid builder.** Fill a 10, 20 or 40 player raid with classes and talent trees and see which buffs
and debuffs each group and the raid gets. The plan lives in the link.
[everloot.app/tools/raid](https://everloot.app/tools/raid)

![The raid group builder](docs/media/raid.webp)

**World map.** One map drawn by us from zone and entrance positions in the game files, with no game
art. [everloot.app/map](https://everloot.app/map)

![The world map](docs/media/map.webp)

**Change tracker.** Blizzard staff posts, hotfixes and new game builds, newest first, with a link to
the original and an RSS feed. [everloot.app/changes](https://everloot.app/changes)

![The change tracker](docs/media/changes.webp)

**News.** What is new on Everloot and what it means for Forever players, written by us, with the
sources each post draws on. [everloot.app/news](https://everloot.app/news)

**Lore archive.** The Warcraft Wiki (CC BY-SA 4.0), browsable by type and searchable.
[everloot.app/lore](https://everloot.app/lore)

**Guild ladder.** Guilds ranked by raid progression, one ladder per raid. A kill counts once uploads
from two guild members agree on it, and the addon records the guild, never a character name.
[everloot.app/guilds](https://everloot.app/guilds)

**Census and rankings.** Factions, races, classes and levels from addon uploads. Each character
counts once, and a group appears only once it holds 10 characters. Rankings show the most played
classes and races each week. [everloot.app/census](https://everloot.app/census) ·
[everloot.app/rankings](https://everloot.app/rankings)

**Ask Everloot.** Ask a question in plain words with your own AI provider's API key. The model looks
the answer up in Everloot's data and names its sources. Your key stays in your browser tab and never
reaches Everloot.
[everloot.app/chat](https://everloot.app/chat)

**Addon leaderboard and profiles.** Which addons Forever players run, for the players who opt in to
share their list. A count appears only when three installs report it.
[everloot.app/addons/popular](https://everloot.app/addons/popular)

**Docs.** How to use Everloot in game, and the open data from an AI assistant or your own code.
[everloot.app/docs](https://everloot.app/docs)

**Market prices.** Blizzard has no auction API for Forever, so prices come from full auction scans
that players start with the addon's **Everloot scan** button. The site shows a realm table and a
60-day chart per item, a day is published once three reporters agree, and the same prices appear in
item tooltips in game. [everloot.app/tools/auctions](https://everloot.app/tools/auctions)

**MCP server.** 32 tools that let an AI assistant search the archive and read the same sourced
facts the site shows: items, NPCs, quests, vendors, profession paths, recipe ranges, auction history,
market values, guild progression, recent Blizzard changes and more. The public endpoint is read
only and rate limited: `https://everloot.app/mcp/public`.

## How it fits together

```mermaid
flowchart LR
  subgraph player["Player's computer"]
    game["WoW: Forever"] --> addon["addon/<br/>Lua collector"]
    addon --> sv[("SavedVariables file")]
    sv --> companion["companion/<br/>uploader and /ask bridge"]
  end
  sv --> upload["everloot.app/upload<br/>preview, then send"]
  upload --> intake["web/ /api/intake<br/>quotas, schema checks, dedup"]
  companion --> intake
  intake --> store[("Raw uploads in R2<br/>index in Supabase")]
  store --> corpus["Corpus snapshot<br/>rebuilt every 10 minutes"]
  corpus --> rollups["Rollups<br/>a fact needs 3 installs"]
  store --> market["Market prices<br/>3 reporters a day"]
  market --> site
  market --> companion
  rollups --> site["Site pages and tools"]
  rollups --> mcp["MCP server<br/>32 tools"]
  wiki["Warcraft Wiki dump<br/>CC BY-SA 4.0"] --> kb["kb/<br/>import, provenance, snapshot"]
  files["Game files<br/>maintainer extraction"] --> gamedata["Reviewed game-data files<br/>unconfirmed"]
  kb --> site
  kb --> mcp
  gamedata --> site
  assistant["AI assistants"] --> mcp
```

| Part | What it does |
|---|---|
| [`addon/`](addon/) | The in-game collector (Lua) and the `/ask` command |
| [`web/`](web/) | everloot.app: the database, tools, map, change tracker, lore archive, upload page and MCP endpoints (Next.js on Vercel) |
| [`kb/`](kb/) | The knowledge base: lore import, public releases, the game-file extractor and the MCP server (TypeScript, SQLite) |
| [`companion/`](companion/) | The command-line uploader: sends your file, answers `/ask` in game and writes market prices |
| [`desktop/`](desktop/) | The Everloot Desktop App: the same jobs as a tray app with an installer |
| [`packages/protocol/`](packages/protocol/) | The upload contract: record kinds, envelope, limits and their JSON Schema, shared by the site, the knowledge base, the uploaders and the addon tests |
| [`supabase/`](supabase/) | The site's database schema |

[`docs/architecture.md`](docs/architecture.md) goes into the boundaries and the decisions behind them.

## Quick start

### Players

1. Install the addon from [CurseForge](https://www.curseforge.com/wow/addons/everloot), or download
   it from [everloot.app/addon](https://everloot.app/addon) and extract `Everloot/` into the game's
   `Interface/AddOns/`.
2. Play. Log out, or type `/reload`, to save.
3. Upload `WTF/Account/<account>/SavedVariables/Everloot.lua` at everloot.app/upload. You preview
   everything before it is sent.

Or install the [Everloot Desktop App](desktop/README.md)
([download](https://everloot.app/addon)): it uploads after every logout, writes market prices for
your item tooltips, and can install and update the addon for you.

In a new install, auction capture and the census are on (`/everloot auctions off` and
`/everloot census off` turn them off; the census off command also deletes its rows). Nothing scans
until you click Scan this house at the auction house. The list of your installed addons and the
players module are off until you turn them on (`/everloot addons on`, `/everloot players on`). The
[command-line uploader](companion/README.md) can also write market prices into the game folder
(`prices --game`).

### Developers

You need Node 22 and Python 3.12 (for the addon tests).

```bash
git clone https://github.com/Everloot/everloot.git
cd everloot
(cd kb && npm install)
cd web && npm install
npm run sample-release   # prints a KB_SNAPSHOT_PATH line: put it in web/.env.local
npm run dev              # http://localhost:3000
```

The sample release gives you about 35 lore pages to work with. Pages that need storage say it is
unavailable, which is expected locally. Each part's README has its test commands, and
[`CONTRIBUTING.md`](CONTRIBUTING.md) lists what CI runs.

### AI-assistant users

Point any MCP client at the public endpoint:

```bash
claude mcp add --transport http everloot https://everloot.app/mcp/public
```

or put `{ "mcpServers": { "everloot": { "type": "http", "url": "https://everloot.app/mcp/public" } } }`
in the client's config. The [docs](https://everloot.app/docs) list every tool with its
arguments and every JSON endpoint, the rate limit and how to credit the data. The API is described in
[`/api/openapi.json`](https://everloot.app/api/openapi.json) (OpenAPI 3.1) and the protocol's JSON Schema
files are under [`/schema/`](https://everloot.app/schema/index.json).

## Project status

Pre-launch. The WoW: Forever beta closed on 2026-10-23 and the game launches on 2026-11-04.

The addon passes its automated tests and is published as an Alpha on
[CurseForge](https://www.curseforge.com/wow/addons/everloot) and on
[everloot.app/addon](https://everloot.app/addon). The in-client checks in
[`docs/2026-10-08-beta-client-checklist.md`](docs/2026-10-08-beta-client-checklist.md),
[`docs/2026-10-18-addon-0.3.2-beta-checklist.md`](docs/2026-10-18-addon-0.3.2-beta-checklist.md) and
[`docs/2026-10-19-addon-0.3.3-beta-checklist.md`](docs/2026-10-19-addon-0.3.3-beta-checklist.md) stay
open until the live servers are up. The Everloot Desktop App's builds are not code-signed yet.
Everything read from the game files (talents, raid buffs, the map) stays marked unconfirmed until
players see it in game. A [build watch](docs/BUILD_WATCH.md) checks for new builds every
half hour and opens a reviewed pull request when one appears.

What is next is in [`ROADMAP.md`](ROADMAP.md). What has shipped is in [`CHANGELOG.md`](CHANGELOG.md).
Nightly pre-releases of the addon are on the [releases page](https://github.com/Everloot/everloot/releases).

## How to help

You don't need to write code. Playing with the addon and uploading, or reporting a wrong fact, helps
as much as a pull request.

- Questions and ideas: [GitHub Discussions](https://github.com/Everloot/everloot/discussions)
- Bugs and wrong data: [issues](https://github.com/Everloot/everloot/issues/new/choose)
- A first code contribution: issues labelled
  [`good first issue`](https://github.com/Everloot/everloot/labels/good%20first%20issue)
- Chat: the [Everloot Discord](https://discord.gg/9CKsbHTRu3)
- Security problems: [`SECURITY.md`](SECURITY.md), never a public issue

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) first: it covers sign-off (`git commit -s`), pull request
titles and the data rules.

## Documentation

[`docs/README.md`](docs/README.md) is the index. The ones you will want first:

- [`docs/DATA_POLICY.md`](docs/DATA_POLICY.md): what we publish, what we refuse, and why
- [`docs/architecture.md`](docs/architecture.md): the service and data map
- [`docs/RELEASING.md`](docs/RELEASING.md): stable and nightly releases
- [`docs/sources/LEDGER.md`](docs/sources/LEDGER.md): every source we have used
- [`docs/design/`](docs/design/): design specs and plans, by date

## Licence

Code: [AGPL-3.0-only](LICENSE), © 2026 R21 Media Group, LLC and Everloot contributors.
Published data: CC BY-SA 4.0, credited to Everloot contributors. Third-party material:
[`THIRD_PARTY.md`](THIRD_PARTY.md). The Everloot name and logo are not covered by these licences:
[`TRADEMARKS.md`](TRADEMARKS.md).

World of Warcraft is a trademark of Blizzard Entertainment, Inc. Everloot is a fan project and is
not affiliated with or endorsed by Blizzard.
