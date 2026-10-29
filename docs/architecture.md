# How Everloot fits together

Four parts share one repository: the **addon** collects what players see, the **site** publishes
only corroborated facts, the **knowledge base** holds the lore and answers questions over MCP, and
the **companion** uploads and runs the `/ask` bridge on the player's computer.

## Where each thing lives

| What | Code | Runs on |
|---|---|---|
| Collector addon | `addon/` | The player's WoW: Forever client; writes `SavedVariables/Everloot.lua` |
| Companion | `companion/` | The player's computer, beside the game |
| Everloot Desktop App | `desktop/` | The same jobs as the companion, as a tray app built on its modules |
| Protocol | `packages/protocol/` | The upload contract, the API response shapes and the MCP tool table. Installed into `web/`, `kb/` and `companion/` from the folder; its `schema/` is read by the addon's contract tests and published for API and MCP clients |
| Site and APIs | `web/` | The Cloudflare Worker `everloot-web` (`web/wrangler.jsonc`), at everloot.app; every merge to `main` that touches the site deploys production through `.github/workflows/deploy-worker.yml` |
| Raw uploads | `web/src/lib/upload-store.ts` | Cloudflare R2 (`uploads/<date>/<id>.json`), indexed in Supabase |
| Public corpus | `web/src/app/api/cron/snapshot` | A Cloudflare Cron Trigger every 10 minutes extends `snapshots/corpus.json` in R2; pages read that one object |
| Sessions, grants, quotas, waitlist | `supabase/` | Supabase Postgres, server-side only, row-level security on every table |
| Knowledge release (lore) | `kb/` | Built offline into a SQLite file plus a hashed manifest, kept in R2, imported into the D1 database `KNOWLEDGE_D1`, served only when it matches the SHA-256 pinned in `web/wrangler.jsonc` |
| MCP server | `kb/src/mcp-server.ts`, mounted by `web/src/app/mcp/` | `/mcp` (bearer token) and `/mcp/public` (no sign-in, per-IP quota) on the site |

## Data paths

```text
Player plays
  -> addon records events into SavedVariables
  -> upload page (preview, sharing choices) or the Desktop App / command-line uploader (anonymous events; the app adds census rows if allowed)
  -> /api/intake: quotas, schema checks, event deduplication
  -> raw upload in R2, index row in Supabase
  -> cron snapshot merges new events into the corpus
  -> public read: named records only with a grant (kb/src/corpus.ts)
  -> anonymous observations are public as records, a per-install pseudonym in place of the install id (/api/corpus/public)
  -> rollups: the site states a fact once at least three installs reported it (kb/src/drop-rollup.ts)
  -> site pages and MCP gameplay tools

Warcraft Wiki dump (CC BY-SA 4.0) + curated entries
  -> kb import -> source database -> validate
  -> snapshot: publishable sources only, sha256 manifest
  -> R2 -> D1 -> /lore, /search, MCP lore answers

/ask in game -> SavedVariables -> companion bridge -> MCP search (and an optional model)
  -> EverlootAnswers addon file -> shown after /reload
```

## Boundaries

Where each kind of data goes, who may write it and how each tier is protected is in
[`DATA_PLACEMENT.md`](DATA_PLACEMENT.md).

- **Raw and named data stay private.** Raw uploads and the index are never served directly. The
  public corpus holds sanitized anonymous observations, plus named records only with a grant.
- **The knowledge release holds publishable sources only.** The build refuses Battle.net API rows
  and any cached API response, and the site refuses a release that does not match its manifest.
- **Credentials stay in the Worker's secrets.** Nothing in the repository holds a key; `.env.example` lists names.
- **The addon and companion never touch the running game.** They use the addon API and the files
  the game writes. See [`DATA_POLICY.md`](DATA_POLICY.md).

## Decisions, and why

- **Little hosting to run (a Cloudflare Worker on the Workers Paid plan, Cloudflare R2, Supabase).**
  One Next.js app holds the pages, the APIs, the crons and the MCP endpoints, so
  there is one deploy and one place to look when something breaks.
- **Lore and MCP read one immutable release.** The knowledge release is built offline as one SQLite
  file, hashed, and imported into D1. No database server of our own to run, and the site and the MCP
  server answer from the same release. A new release is a new import, never an edit.
- **A file bridge, never the game's memory or screen.** The addon writes its save file, and the
  companion reads it and writes answers back as an addon file. That stays inside what Blizzard
  tolerates for addons, and it is why answers appear only after `/reload`.
- **The site states a fact only once three installs reported it.** Each one carries how many
  installs reported it and when. One wrong upload cannot make the site state a fact; the anonymous
  observations behind it stay public so anyone can check the count.

## Known limits

- Three installs are not proof of three people. An install ID cannot show that two installs
  belong to different players.
- Drop figures are shares of the loot windows players opened, not kill-based drop chances. A drop
  rate goes public once three installs have looted its source, even if only one of them saw the
  item drop.
- The lore archive is the Warcraft Wiki as of 2023-11-13, with no Forever-specific lore until a
  newer dump is allowed.
- Blizzard's API has no WoW: Forever namespace yet, so character data comes only from the addon.
- Addon 0.2.6 passes its automated tests but has not yet been checked in the live client.
- The companion is an unsigned command-line tool.
- The standalone MCP server (`kb/src/mcp-http-main.ts`) reads the public corpus URL, which has no
  install ids, so it cannot corroborate on its own. Only the MCP endpoints on the site are deployed.

Every source is recorded in [`sources/LEDGER.md`](sources/LEDGER.md). Design history is in
`design/specs/` and `design/plans/`.
