# kb/: the Everloot knowledge base

A local SQLite database of WoW knowledge in which every row carries its source, licence, retrieval
date and URL. Design: `../docs/design/specs/2026-09-27-forever-ai-addon-design.md` §2 and §4.

## Build it

    npm install
    npm run kb -- import-wiki data/raw/warcraft.wiki.gg-20231113-history.xml.zst
    npm run kb -- import-curated
    npm run kb -- validate

The wiki dump is at https://archive.org/details/wiki-warcraft.wiki.gg-20231113 (637 MB). It is a
WikiTeam export, so each page's history is split across many blocks; the importer reads the file
twice and keeps each page's newest revision. Its zstd frame declares a 2 GB window, so decoding needs
about 2 GB of RAM (handled by `zstd-napi`).

First build (2026-09-27): 257,110 lore pages, 18,713 skipped, 48,341 redirects dropped, 239,941 other-namespace, 0 empty; 1 curated; import took ~16 minutes with peak memory ~2.65 GB. Skipped pages are template-only (item tooltips, TCG cards, disambiguation stubs) and near-empty stubs (under 20 letters); importing item tooltips as structured item rows is the next task.

## Sources and what may be published

| Source | Licence | In the public snapshot |
|---|---|---|
| Warcraft Wiki, Internet Archive dump 2023-11-13 | CC BY-SA 4.0 | yes |
| Curated entries (`curated/*.yaml`) | CC BY-SA 4.0 | yes |
| Blizzard Battle.net API | Blizzard Developer API Terms | no, local cache only |
| pfQuest database, Classic 1.12 (`pfquest-classic`) | addon MIT; data from VMaNGOS (GPL-2.0) and CMaNGOS (GPL-3.0) | no, local baseline only |

wago.tools is not used: its robots.txt disallows everything but its home page.

`npm run kb -- snapshot data/release/<name>.sqlite` writes the publishable copy (outside the
database's own folder) and a `.manifest.json` with its sha256. The file is built and verified in a
work file next to the live database, filtered by the code's source registry, and only then moved
into place.

## Classic baseline (local only)

pfQuest's Classic 1.12 database is a checklist for what Forever players still need to confirm. It is
never published. With a pfQuest download at the pinned commit and a client snapshot for the zone ids:

    git clone https://github.com/shagu/pfQuest <folder> && git -C <folder> checkout 104f3567
    npm run kb -- import-pfquest <folder> --client data/client/<snapshot>.sqlite
    npm run kb -- baseline-report --db data/everloot-kb.sqlite [--out <folder outside the repository>]

The import reads the Lua files as data and never runs them. The report compares the baseline with the
uploads that `EVERLOOT_PUBLIC_CORPUS_URL` or `EVERLOOT_UPLOADS` points at, and writes Markdown and JSON
outside the repository (by default to the system temp folder). Design:
`../docs/design/specs/2026-10-17-classic-baseline-design.md`.

## Serve a public release

The MCP service answers questions; it never builds a database. It takes a **public release** (the
filtered file `snapshot` wrote, together with its `.manifest.json`) and nothing else. A source
database is not a release: it still holds non-publishable sources and API cache rows.

    node ./node_modules/tsx/dist/cli.mjs src/cli.ts snapshot data/release/kb.sqlite --db data/wowvault-kb.sqlite
    node ./node_modules/tsx/dist/cli.mjs src/cli.ts serve-mcp      --db data/release/kb.sqlite
    node ./node_modules/tsx/dist/cli.mjs src/cli.ts serve-mcp-http --db data/release/kb.sqlite --port 8787

Invoke it through `node` directly: some npm and PowerShell combinations swallow the `--db` value.

Before anything listens, the release is opened read-only and checked against its own manifest. The
manifest must exist, carry this build's licence and notice plus a sha256; the file must match that
hash; the database must hold only registry-publishable sources with an empty API cache, exactly the
expected schema, no free pages and at least one row. Any failure exits non-zero with the reason on
stderr and no port is opened. A leftover `-wal`/`-shm`/`-journal` sidecar means the file is still
being written to, so it is refused as well.

`stats` and `search` read an existing knowledge base the same way, create nothing, and both need an
explicit `--db`. The import commands still default to `data/everloot-kb.sqlite`.

`validate` is the one command that writes to the file it opens (it rebuilds the fts5 index), so it
is a diagnostic for a source database and never part of a serving path.

`serve-mcp-http` binds loopback only and takes `--token` or `EVERLOOT_MCP_TOKEN`. A bearer token is
transport authentication; it is not evidence that any particular client can connect.

## Blizzard API

Create a free client at https://develop.battle.net/access/clients and put it in `kb/.env`:

    BLIZZARD_CLIENT_ID=...
    BLIZZARD_CLIENT_SECRET=...

Then, in Git Bash or PowerShell (no leading slash: Git Bash rewrites paths that start with `/`):

    npm run kb -- blizzard-get data/wow/playable-class/index --game classic1x --kind static

WoW: Forever has no API namespace yet; `--game forever` answers "not published yet".

## Test it

    npm test
    npm run typecheck

The tests build small databases in temporary folders; none of them needs the wiki dump.

`npm run kb -- audit-sources <file.sqlite...>` lists the rows per source in any database or release
and exits 1 if it holds anything that may not be published.

## Where things live

| Path | What |
|---|---|
| `src/importers/` | The Warcraft Wiki dump importer (XML, templates, infoboxes, page types), curated entries and the local pfQuest baseline |
| `src/snapshot.ts`, `src/public-snapshot.ts` | Building a public release and checking one before it is served |
| `src/search.ts`, `src/entities.ts`, `src/db.ts` | The database, its full-text search and row writes |
| `src/mcp-server.ts`, `src/mcp-http-*.ts` | The MCP server and its HTTP transport (the site mounts the same handler) |
| `src/*-rollup.ts`, `src/profession-path.ts`, `src/gold-ledger.ts`, … | The gameplay readers behind the MCP tools and site pages, built from player uploads |
| `src/blizzard/` | The Battle.net API client; its cache stays local |
| `curated/` | Facts written in our own words, each with its source URL |
| `wiki/`, `src/wiki/` | The wiki's pages (CC BY-SA 4.0, see [`wiki/README.md`](wiki/README.md)) and their parser and page check, `npm run kb -- wiki-check` |
| `news/`, `src/news/` | The site's news posts (CC BY-SA 4.0, see [`news/README.md`](news/README.md)) and their post check, `npm run kb -- news-check` |
| `guides/`, `src/guides/` | The site's guides (CC BY-SA 4.0, see [`guides/README.md`](guides/README.md)) and their guide check, `npm run kb -- guide-check` |
| `test/` | Vitest tests and fixtures |

## Rules

Read [`../docs/DATA_POLICY.md`](../docs/DATA_POLICY.md) before adding a source, and record it in
[`../docs/sources/LEDGER.md`](../docs/sources/LEDGER.md). Blocked, paid or unlicensed sources go on
the gaps backlog in `../docs/sources/source-catalog.md`, never into an importer.

## Code licence

AGPL-3.0-only, like the rest of Everloot (see `LICENSE` at the repository root). Data licence: CC BY-SA 4.0.
