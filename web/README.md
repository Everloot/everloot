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
server variables production uses; none are needed to work on most pages. Every name the project reads, and
where each is set, is in [docs/ENVIRONMENT.md](../docs/ENVIRONMENT.md).

## Test it

    npm test          # vitest
    npm run lint
    npm run build     # prebuild skips the knowledge release when none is configured

The tests build their own small lore release and use in-memory stores, so they need no
credentials.

## Build for the Worker

From `web/`, run `npm run cf:build` to build the OpenNext Worker bundle, or
`npm run cf:preview` to build it and preview it locally. The
[deploy workflow](../.github/workflows/deploy-worker.yml) runs `npm run cf:deploy`,
which builds and deploys to production; use the preview command for local work.
Variable names are in [`.env.example`](../.env.example) and the names-only
[environment table](../docs/ENVIRONMENT.md).

## What CI checks

[Release checks](../.github/workflows/checks.yml) runs these commands in `web/`:

- `npm test`, including the [design guard](src/design/guard.test.ts),
  [metadata test](src/app/metadata.test.ts), [site sitemap test](src/app/sitemap.test.ts)
  and [database sitemap test](src/app/database-sitemap.xml/route.test.ts).
- `npm run typecheck` and `npm run lint`, as defined in [`package.json`](package.json).
- `npm run build`, the Next.js build. The Worker build runs in the deploy workflow.

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
