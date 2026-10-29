# web/: everloot.app

The public site: the WoW: Forever database built from player uploads, the tools (professions,
auctions, gold, collections, guild board), the lore archive, the addons hub, the upload page and
the MCP endpoints (`/mcp`, `/mcp/public`). Next.js 15 (App Router), React 19, TypeScript, Tailwind.
Deployed as the Cloudflare Worker `everloot-web` (OpenNext, `wrangler.jsonc`); every merge to `main` that
touches the site deploys production through `.github/workflows/deploy-worker.yml` (`npm run cf:deploy`).
Rollback: `npx wrangler rollback` from `web/`.

## Run it

    cd web
    npm install
    npm run dev

Open http://localhost:3000. Without a `.env.local` the site still runs: storage-backed pages say
storage is unavailable, and the lore pages say the archive is unavailable. `.env.example` lists the
server variables production uses; none are needed to work on most pages.

## Test it

    npm test          # vitest
    npm run lint
    npm run build     # prebuild skips the knowledge release when none is configured

The tests build their own small lore release and use in-memory stores, so they need no
credentials.

## Where things live

| Path | What |
|---|---|
| `src/app/` | Pages and API routes: `database/`, `tools/`, `lore/`, `search/`, `addons/`, `upload/`, `api/` (intake, corpus, cron, health, auth, sharing, waitlist, rollups), `mcp/` |
| `src/lib/` | The intake contract and parser (`intake.ts`, `sv-parse.ts`), upload storage (`upload-store.ts`), the knowledge release (`release.ts`, `lore.ts`), the MCP mount (`mcp-mount.ts`) |
| `src/components/` | Shared UI |
| `src/data/` | Hand-written facts with their sources (`polestar.ts`, `families.ts`) |
| `scripts/` | Maintainer tools: fetch and upload the knowledge release, R2 backup and restore rehearsal, launch maintenance |
| `public/downloads/` | The addon zips, rebuilt by `scripts/package-addon.py` at the repository root |

The site imports the knowledge base and MCP server from `../kb`, so install `kb` too when you work
on lore or `/mcp`.
