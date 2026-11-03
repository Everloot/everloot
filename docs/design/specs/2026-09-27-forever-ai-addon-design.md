# WoW: Forever AI Addon + Open Knowledge Base — Design

**Date:** 2026-09-27 · **Status:** approved in brainstorm, awaiting spec review · **Owner:** Carlos
**Supersedes:** the Retail collection-tracker MVP in `_STATUS.md` / `BUILD_PLAN.md` (parked, not deleted).
**Sources:** `docs/sources/source-catalog.md` (candidates, access checks, gaps backlog).

## 1. What it is

Ask anything about WoW from inside the game — lore, items, quests, Forever rules — and get a short,
sourced answer. Answers come from **our own open knowledge base**, built only from data we are
allowed to use. The player brings their own AI access (API key or an existing subscription).

The knowledge base is the core asset. The addon, the MCP server and a public website are three ways
of reading it.

## 2. Legal charter

The goal is a project that can keep growing because nothing in it can be taken down. These rules
override convenience everywhere in this spec.

1. **Robots.txt and content signals are obeyed**, even where a licence would allow more. If a site
   disallows a path or a bot, we don't automate against it.
2. **Every record carries its provenance:** source, licence, retrieval date, URL. No record without it.
3. **We never train or fine-tune models** on collected data (several sources reserve `ai-train=no`).
4. **Attribution travels with the data** into every answer and every web page.
5. **Blocked, paid or unlicensed sources are never copied.** They go on the gaps backlog and are
   filled only by our own collection or by written permission.
6. **Blizzard:** no reading game memory or the screen in any public build; we never unpack the game
   client ourselves; Blizzard API data is never redistributed, resold or shown on ad-supported pages.
7. **Player-collected data is opt-in and anonymised**, and comes only from the addon's own saved file.
8. **When unsure, ask the owner.** A permission email beats our own reading of the terms.
9. **It answers; it never acts.** No input to the game client, no automation of play (see
   `_STATUS.md` 2026-09-17).

## 3. Four parts, built in order

| # | Part | What it is | Depends on |
|---|---|---|---|
| 1 | **Knowledge base + ingestion** | SQLite database, importers, curated files, gaps backlog | — |
| 2 | **wow-knowledge MCP server** | Tools over the knowledge base, usable by any MCP client | 1 |
| 3 | **Addon + companion** | In-game `/ask`, agent harness, opt-in data collector | 1, 2 |
| 4 | **Public website** | Pages over the knowledge base, AdSense, in `web/` | 1 |

Each part gets its own implementation plan. Part 1 is planned first.

## 4. Part 1 — Knowledge base + ingestion

### 4.1 Storage

- **SQLite**, one file. One `entities` table with a `kind` column (`item`, `npc`, `quest`, `zone`,
  `spell`, `lore_page`, `creator`, `realm`), a `sources` table, and an `api_cache` table for local
  Blizzard API responses.
- Provenance sits on every row: `source_id`, `licence`, `retrieved_at`, `source_url`,
  `game_version` (`forever` / `classic` / `retail` / `lore`).
- Full-text search index over names and page text; a case-insensitive index on names.

### 4.2 Importers

| Importer | Input | Licence / basis | Notes |
|---|---|---|---|
| Wiki dump | Internet Archive dump of warcraft.wiki.gg, 2023-11-13 (`history.xml.zst`, 637 MB) | CC BY-SA 4.0 | Lore baseline. Pre-dates Forever. A WikiTeam export: each page's history is split across many non-adjacent blocks, so the importer reads it twice and keeps the newest revision per page; text redirects are dropped |
| Wiki sync (fresh) | warcraft.wiki.gg | CC BY-SA 4.0 — **blocked on permission** | Its robots.txt disallows `/api.php` and names `ClaudeBot`/`GPTBot`; content signal `ai-train=no, use=reference`. We email wiki.gg for permission or a current dump before any sync |
| Blizzard API | Battle.net Game Data + Profile APIs (§4.5) | Blizzard Developer API Terms | **Local only**: cached per user, never in the published snapshot, never on ad pages |
| Curated | YAML/Markdown files in this repo | Ours | Forever rules we write, creators, realms, quest notes |
| Player collection | Uploads from the addon collector (Part 3) | Ours, opt-in | Drops, NPC positions, quest givers — the original Thottbot model |

Importers are idempotent: re-running replaces rows from that source, never duplicates them, and
an import that yields no rows never replaces existing ones.

**Removed 2026-09-27: game tables from wago.tools.** Its robots.txt is `Allow: /$`, `Disallow: /`
for every user agent, so the DB2 CSV exports are off-limits (charter rule 1). Forever items, spells
and zones now come from the player collector (Part 3) until a permitted source exists; the gap is on
the backlog.

### 4.3 Gaps backlog

`docs/sources/source-catalog.md` § Gaps backlog lists every blocked, paid or unlicensed source, what
data it would have given, and how we fill that gap ourselves. It is the to-do list for growing the
knowledge base.

### 4.4 Replicable and open

- **Code:** MIT (matches wow-ai, which Part 3 builds on).
- **Data we publish:** CC BY-SA 4.0 — required by the wiki's share-alike terms, allows commercial
  use. Our curated and player-collected data use the same licence, so the whole dataset has one.
- **Release:** a versioned SQLite snapshot of the publishable data on GitHub Releases, plus the
  scripts that rebuild everything (including the local-only Blizzard API cache) from scratch.

### 4.5 Blizzard API — everything free

Blizzard's Battle.net APIs are free with a developer client (client ID + secret from
develop.battle.net). We cover every group they offer, through one adapter that takes the
namespace as a parameter.

- **Game Data** (client credentials): achievements, auction house (per connected realm) and
  commodities, connected realms / realms / regions, creatures and families, guild crests,
  heirlooms, items / item sets / appearances, journal (expansions, instances, encounters), media,
  mounts, Mythic+ affixes / dungeons / leaderboards, Mythic raid leaderboards, battle pets and
  abilities, playable classes / races / specs, power types, professions and recipes, PvP seasons
  and tiers, quests (categories, areas, types), reputations, spells, talents, titles, toys, WoW
  Token.
- **Profile** — public character data (client credentials): summary, status, achievements and
  statistics, appearance, collections, dungeon and raid encounters, equipment, hunter pets, media,
  Mythic+ profile, professions, PvP, quests, reputations, specialisations, titles; guild, roster,
  activity.
- **Profile** — account data (player signs in with Battle.net OAuth): the player's own account-wide
  collections (mounts, pets, toys, heirlooms, transmog).
- **Namespaces:** retail (`static|dynamic|profile-{region}`), Classic progression
  (`*-classic-{region}`) and Classic Era (`*-classic1x-{region}`). Classic exposes fewer groups
  (auction house, character profile, creatures, guilds, items, playable content, realms, PvP,
  media). **Forever has no namespace yet**; the adapter gets one line added the day it ships, and
  Forever questions answer "not available yet" until then.

Rules (Blizzard Developer API Terms, verified 2026-09-27):

- **Each user brings their own free Blizzard client** in the companion config. We never ship our
  own secret in open-source code.
- Responses are cached **locally** for that user. They never enter the published CC BY-SA snapshot
  (no redistribution) and never appear on ad-supported pages (no monetising the data).
- Attribution to Blizzard wherever the data is shown. Stay under 36,000 calls per hour.

## 5. Part 2 — wow-knowledge MCP server

- **Tools:** `search`, `get_item`, `get_quest`, `get_npc`, `get_zone`, `get_lore`,
  `get_character_context`, plus Blizzard-backed `get_character_profile`, `get_collections`,
  `get_encounters`, `get_realm`, `get_auction_prices`. Each returns facts with provenance (source
  name + URL).
- **Knowledge base first.** Live sources are a fallback only where their terms allow it (§2.1).
- **Link-outs:** when we lack data, the answer points to where to look (e.g. `wowhead.com/forever`)
  instead of fetching it.
- Usable from Claude Desktop, Codex, Hermes or any MCP client, not only the game.

## 6. Part 3 — Addon + companion

```
┌─ Addon (CurseForge) ───────────────┐
│ /ask window · character context    │
│ offline answers · opt-in collector │
└──────────────┬─────────────────────┘
               │ bridge (file bridge in public builds)
┌─ Companion (GitHub release) ───────▼──────────────────────┐
│ agent loop · provider adapters · fallback chain · memory  │
└──────────────┬────────────────────────────────────────────┘
               │ MCP
        wow-knowledge MCP server (Part 2) → knowledge base (Part 1)
```

### 6.1 Addon

- `/ask <question>` opens a small answer window.
- **Offline answers** first: game API data (quest log, zone, gear, spec, level) and a small bundled
  knowledge pack.
- **Collector (opt-in, off by default):** records what the player observes — NPC positions, loot,
  quest givers — into the addon's SavedVariables. Character and realm names are stripped before
  upload.

### 6.2 Bridge

- **Public builds: file bridge only (decided 2026-09-27).** The addon stores the question in
  SavedVariables; the companion reads the file, answers, and writes the reply into a slot addon that
  shows after `/reload`. This stays inside what Blizzard tolerates: reading files the client writes.
- **v1 private: live bridge** (never built; dropped. See `docs/sources/LEDGER.md`, "History") on Carlos's test account, built on
  [chelinho139/wow-ai](https://github.com/chelinho139/wow-ai) (MIT, credited): pixel strip out, slot
  addons in. It runs against the Blizzard EULA clause barring "any unauthorized process or software
  that intercepts, collects, reads, or 'mines' information generated or stored by the Platform", so
  it never ships publicly.
- Every message carries a checksum; a bad checksum is retried once, then reported.

### 6.3 Companion

- **Agent loop** runs the chosen provider with the MCP tools, character context and memory.
- **Answer shaping:** short in-game reply ending with sources and the model used
  (`Source: warcraft.wiki.gg · answered by DeepSeek`). The full answer goes to the log.
- **Uploader:** sends opted-in collector data to the knowledge base intake (format and hosting in
  Part 3's plan).
- Built as a library with the game as its first front end (§10).

### 6.4 Provider adapters

| # | Adapter | Covers | Notes |
|---|---|---|---|
| 1 | OpenAI-compatible key | DeepSeek, OpenRouter, Ollama, any compatible endpoint | Reliable path |
| 2 | Anthropic API key | Claude via API | Reliable path |
| 3 | ChatGPT subscription | "Sign in with ChatGPT" OAuth → `chatgpt.com/backend-api/codex` | Same mechanism Hermes uses. Codex's public client, undocumented endpoint — **best effort** |
| 4 | Claude subscription | Claude Agent SDK / `claude -p` | Since 2026-06-15 draws on the monthly Agent SDK credit, then API rates. Never extract Claude OAuth tokens — **best effort** |

Re-read both vendors' current terms before public release.

### 6.5 Fallback chain

- The user orders their enabled providers. Fall through on failure only (auth, rate limit, credit
  exhausted, timeout, 5xx), never on answer quality.
- Only providers the user enabled are tried — no silent paid fallback.
- Every answer names its model; if all fail, say so plainly.

### 6.6 Memory

Markdown in the companion's data folder (`%APPDATA%\<app>\memory\`), never the addon folder (the
CurseForge app replaces it on update):

- `characters/<realm>-<name>.md` — class, goals, things to remember.
- `conversations/YYYY-MM.md` — one line per exchange.
- `sessions/YYYY-MM-DD-HHMM.md` — one summary per play session: zones visited, questions asked,
  what it couldn't answer, what the collector recorded.

**Session loop.** A session opens when the companion first hears from the addon and closes after
30 minutes of silence or on logout. At close:

1. The session summary is written.
2. Questions it couldn't answer become **candidate** entries in the gaps backlog
   (`gaps/candidates.md`), for review before they join the catalogue.
3. Opted-in collector data from the session is queued for knowledge-base import.

The next session starts by reading the character file and the last session summary, so it picks up
where the player left off. Files stay small: monthly conversation files, one short summary per
session.

### 6.7 Auction house (v2)

- **Blizzard auction house API** — per connected realm plus region-wide commodities; retail and
  Classic today, Forever when its namespace ships. Local use for the player only (§4.5 rules).
- **Our own scans (opt-in)** — when the player opens the auction house, the collector records the
  listings their own browsing shows. Over time this builds our own per-realm price history, which we
  may publish.
- **TSM public price feeds** — only if TSM's terms allow our use; to be checked. We never read TSM's
  addon files: that data comes from TSM's servers under TSM's terms.
- Tools: `get_auction_prices` (current + history for an item on the player's realm).
- Forever's auction house rules (cross-realm or not) are not published yet; design for per-realm
  and adjust at launch.

## 7. Part 4 — Public website

- Next.js in `web/` (the existing GoldGoblin scaffold, already set up for AdSense).
- Pages generated from the knowledge base: items, quests, NPCs, zones, lore, creators.
- Every page shows attribution and the CC BY-SA notice for the data on it.
- **No Blizzard API data on ad-supported pages** (Blizzard Developer API terms: no monetising the
  data). Whether player-collected game facts may appear on an ad-supported page is checked
  against Blizzard's fan-content rules before Part 4 starts.

## 8. One question, end to end

1. Player: `/ask what drops Thunderfury's bindings?`
2. Addon tries offline. No match → sends question + character context over the bridge.
3. Companion loads memory, runs the first provider with MCP tools.
4. Model calls `get_item` / `get_lore`; the tools read the knowledge base and return facts with
   provenance.
5. Short answer with sources and model name goes back to the addon; the exchange is appended to
   `conversations/YYYY-MM.md`.

| Failure | Behaviour |
|---|---|
| Companion off | Offline answer or "not in the local pack" + a link-out |
| Provider fails | Next enabled provider; all fail → plain error |
| Not in the knowledge base | Allowed live fallback if any, else a link-out; logged to the gaps backlog |
| Nothing found | "I don't know." Lore and item answers need a cited record |
| Bridge checksum fails | Retry once, then error |

## 9. Testing and accuracy

- **Golden set:** ~50 questions with known answers (lore, items, quests, Forever rules), run against
  each provider; track accuracy, citation present, latency, cost. Thresholds come from these runs.
- **Provenance check:** fails any record without source, licence, date and URL.
- **Importers:** tested against small fixture files; re-running must not duplicate rows.
- **MCP tools:** tested against a fixture database — no network in tests.
- **Bridge:** encode/decode round-trip tests; manual in-game pass on a test account.
- **Addon:** offline mode verified with the companion stopped; collector off by default.
- **Fallback:** each failure type simulated.

## 10. Phases

| Phase | Scope | Audience |
|---|---|---|
| **v1** | Part 1 (wiki dump + curated + Blizzard Game Data adapter) · Part 2 · Part 3 with the live bridge, memory and session loop · golden set | Carlos |
| **v2** | Collector + intake · auction house (§6.7) · Blizzard Profile incl. Battle.net sign-in · fresh wiki sync if permitted · more sources per the catalogue · creator registry with Twitch live status | Carlos + testers |
| **v3** | Public: addon on CurseForge (file bridge), companion + data snapshot on GitHub · public-release review | Everyone |
| **v4** | Part 4 website with AdSense | Everyone |

**Not planned:** a general coding/terminal assistant on the game path (a separate front end on the
harness library, later, never reachable from game text); model training; a Retail addon build
(the Blizzard adapter reads retail and Classic data, but the addon targets Forever); mobile.

## 11. Open questions

- **wiki.gg permission:** asked 2026-09-27 (email from the maintainer to
  `support@indie.io`, wiki.gg's operator — no public wiki.gg address exists; its own channel is a
  Jira service-desk portal). Asked for a low-rate registered API bot or a current XML dump. Until
  answered, lore comes from the 2023 dump and Forever lore is a gap.
- Product name and domain for the addon, MCP server and site (repo stays `wowvault`). Checked
  2026-09-27: no wowvault domain is owned; `wowvault.com` is held by another party since 2003,
  parked on GoDaddy/NameFind; `wowvault.app` and `wowvault.gg` are available. Before buying anything
  with "WoW" in it, check Blizzard's trademark / fan-content rules, since the site carries ads.
- Which Forever fan wiki (three sites use the name — see the catalogue).
- Blizzard fan-content rules for game data on an ad-supported site (before Part 4).
- Warcraft Logs API redistribution terms — ask `support@rpglogs.com` before using it.
- TSM public data terms — read before using its price feeds.
- Whether Forever will use its own namespace or a Classic/retail one — watch at launch (11/04).
- Where the collector intake is hosted (Part 3 plan).
