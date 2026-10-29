# Everloot: datamining and community-data architecture audit

**Date:** 2026-10-17
**Answers:** the "WoW Datamining, Community Addon & Multi-Platform Integration Brief" (2026-10-16),
Phase 0. It compares the brief with the repository as it is, and proposes a phased plan.

## 1. What Everloot actually is today

| Area | Implementation |
|---|---|
| Repository | One monorepo, `CDVolvik/everloot` (public, AGPL-3.0-only, DCO). Parts: `addon/`, `web/`, `kb/`, `companion/`, `supabase/` |
| Language and package manager | TypeScript on Node 22 with npm (`kb`, `web`, `companion` each have their own lockfile); Lua 5.1 for the addon; Python for addon contract tests and repository scripts |
| Website and API | Next.js 15 (App Router), React 19, Tailwind, on Vercel (a Cloudflare Worker since 2026-10-29). API routes under `web/src/app/api/*`; JSON bodies, `Cache-Control` set per route, 503 when a dependency is unavailable |
| Databases | **SQLite** (better-sqlite3) for the knowledge base: an offline-built, immutable, sha256-checked release opened read-only in process. **Supabase Postgres** for sessions, the private upload index, publication grants and suppressions, intake quotas, the waitlist (row-level security on every table) |
| Object storage | Cloudflare R2: raw uploads, the public corpus snapshot, knowledge releases |
| Background work | One Vercel cron (`/api/cron/snapshot`, every 10 minutes; Cloudflare Cron Triggers since 2026-10-29). Heavy jobs (wiki import, release build) run on a maintainer's machine through `npm run kb -- …`. No queue service |
| Auth | Battle.net OAuth sessions for named sharing. Uploads are anonymous, keyed by a random install id, protected by quotas |
| MCP | `kb/src/mcp-server.ts`, mounted at `/mcp` (bearer) and `/mcp/public` (no sign-in, per-IP quota) |
| Addon | Exists, 0.2.5: sightings, loot windows, vendors, auctions, gold, recipes, trainers, guild (officer-only publication), `/ask` |
| Desktop companion | Exists as a Node CLI: `upload`, `watch` (SavedVariables after logout or `/reload`), `bridge` (`/ask` file bridge). No installer |
| App | No mobile or desktop app. The iOS placeholder was removed on 2026-10-17; phones use the site |
| CI and deploy | GitHub Actions (`guards`: gitleaks, private-path check, DCO; `verify`: all test suites, lint, build, addon zip check). Merging to `main` deploys production |
| Constraints | Free services only (owner decision, 2026-10-07). Published data is CC BY-SA 4.0. `docs/DATA_POLICY.md` currently **refuses reading the game client's files and publishing spoilers** |

## 2. The brief against the repository

| Brief component | Status | Reuse | Gap |
|---|---|---|---|
| A. Build monitor | Missing | `kb` CLI pattern; R2 helpers in `web/src/lib/upload-store.ts`; the Vercel cron route pattern | A registry of builds from Blizzard's public version service (`https://us.version.battle.net/v2/products/<product>/versions`), new-build detection, a queue state |
| B. Extractor | Missing | `kb` importers as the pattern; `@rhyster/wow-casc-dbc` (MIT, Node/TS) reads CASC from Blizzard's CDN and parses DB2 with WoWDBDefs definitions | Everything; runs on a maintainer machine or a manually triggered GitHub Action, never in a Vercel function |
| C. Normalized, versioned store | Partly exists | The release pattern: immutable SQLite file, `.manifest.json`, sha256, `audit-sources`, the `sources` registry with `publishable` | A per-build snapshot of client tables |
| D. Diff engine | Missing | Test style of `kb/test/snapshot.test.ts` | Field-level diff between two snapshots, noise filters, mass-deletion guard |
| E. Community ingestion | **Exists** | Addon, SavedVariables, companion, `/api/intake` (schema validation, size limits, quotas, event dedupe, replay safety), preview and consent, officer grants, corroboration rollups with denominators (loot windows), public corpus without install ids | `clientBuild` on each upload (addon 0.2.6); authenticated companion uploads are a deliberate non-goal today (anonymous by design) |
| F. API and UX | Partly exists | `/database/items/[id]`, `/database/npcs/[id]`, MCP tools, the existing route and caching conventions | `/builds`, build history per item and spell, evidence badges, spoiler control |
| G. AI analysis | MCP exists | The sourced-answers spec (`docs/design/specs/2026-10-17-sourced-answers-design.md`) | A human review queue before anything is published |
| Data model (§5) | Mapped below | | |

**Data model mapping.** `wow_builds` → a build registry (JSON in R2 for the site; the same shape
locally). `wow_entities` and `wow_entity_snapshots` → one immutable SQLite snapshot per build with
a manifest, like knowledge releases. `wow_entity_changes` → a diff file between two snapshots.
`addon_uploads`, `gameplay_observations`, `community_aggregates` → already exist as R2 uploads,
the Supabase index, the corpus snapshot and the `kb` rollups. `discoveries` → later, with review.

## 3. Proposed tools

| Tool | Licence | Status | Verdict |
|---|---|---|---|
| [LiangYuxuan/wow-casc-dbc](https://github.com/LiangYuxuan/wow-casc-dbc) | MIT | Active (2026-10-11) | Fits the stack. Use without `loadRemoteTACTKeys()`: those keys decrypt content Blizzard encrypted. Use its partial-decrypt mode, which skips encrypted blocks |
| [wowdev/WoWDBDefs](https://github.com/wowdev/WoWDBDefs) | Definitions CC BY-SA 4.0, code BSD-3 | Active (2026-10-16) | Fits; same licence as our data. Credit in `THIRD_PARTY.md` |
| [wowdev/DBCD](https://github.com/wowdev/DBCD) | MIT | Active | C#; not needed if the Node tool works |
| [wowdev/wow-listfile](https://github.com/wowdev/wow-listfile) | No licence | Active | Do not vendor; look up file ids by name at run time or pin the few ids we need |
| [Marlamin/wow.tools.local](https://github.com/Marlamin/wow.tools.local) | MIT | Active | Reference and manual checking on a maintainer machine; its older-build downloads come from wago.tools |
| [herodope/wow-datamine](https://github.com/herodope/wow-datamine) | No licence | Active | Reference only; no code can be copied |
| [wago.tools](https://wago.tools) | Website | — | robots.txt disallows everything but the home page (read 2026-10-17). Link only; no automated reads |

## 4. Risks

1. **Policy reversal.** `docs/DATA_POLICY.md`, published on 2026-10-16, refuses reading game files
   and publishing spoilers. Client datamining needs that policy changed first, in public.
2. **Blizzard's EULA** forbids "any unauthorized process or software that intercepts, collects,
   reads, or 'mines' information generated or stored by the Platform." Offline study of client
   files is widely practised and has historically been tolerated, but the clause does not say so.
3. **WoW: Forever specifically.** Blizzard said it obfuscates Forever items so stats stay hidden
   until they drop, and players objected to datamined Forever spoilers in September 2026. Encrypted
   content stays out of scope (no decryption keys), which means many Forever items will not appear
   in client data at all.
4. **Licence of extracted data.** Client tables are Blizzard's. They can be shown as facts for
   interoperability (Polestar's practice) but cannot be relicensed as CC BY-SA. They would be a
   separate, clearly labelled layer.
5. **Free services.** Extraction downloads gigabytes per build; it fits a maintainer machine or a
   manually triggered GitHub Action on the public repository, not Vercel.

## 5. Decisions

**Owner decision (2026-10-17): C, a public datamining layer**, to compete with Wowhead. The
guardrails below still hold: no decryption, "unconfirmed" labels, spoilers hidden by default,
review before publication, Blizzard's data kept apart from our CC BY-SA data. `docs/DATA_POLICY.md`
is rewritten first.

**Feasibility (2026-10-17):** `@rhyster/wow-casc-dbc` 2.16.15 read the WoW: Forever beta
(1.60.1.70450) from Blizzard's CDN in 29 seconds with no decryption keys and no listfile:
`ItemSparse` (19,231 rows) and `SpellName` (31,939 rows). Encrypted blocks are skipped, not
decrypted: 31 in `ItemSparse` and 14 in `SpellName` in this build, which matches Blizzard hiding
Forever items. Those rows stay out of Everloot.

The options considered were:

- **A. No client data.** Build monitoring only; new builds trigger re-checks of observed data.
- **B. Local only.** Extract unencrypted tables to check and diff builds on a maintainer machine;
  publish nothing from client files (like the Classic baseline).
- **C. Public datamining layer.** Publish build diffs as "found in game files, unconfirmed",
  spoilers hidden by default, reviewed before publication, never decrypted. Requires rewriting
  `docs/DATA_POLICY.md` first.

**Architecture decisions proposed for Phase 1** (reversible, no new services):

1. The build monitor lives in `kb` (`kb/src/builds.ts`) as pure, tested functions, with a CLI first.
2. A build's identity is product + BuildConfig hash, not the version label (brief §4A). Regions
   that serve the same BuildConfig are one build.
3. The registry is a JSON document. Locally a file; on the site, an object in the existing R2
   bucket written by a Vercel cron, the way the corpus snapshot works. No database migration.
4. "Queued" is a status on the registry entry; extraction (Phase 2) picks queued builds up.

## 6. Phased plan

| Phase | PRs | Acceptance |
|---|---|---|
| 0 | This audit | Reviewed by the owner |
| 1a | Build registry in `kb`: parse Blizzard's version service, detect new builds idempotently, `npm run kb -- builds-check` | Fixture tests: a new build is recorded once and queued; repeat runs add nothing; regions with one BuildConfig collapse; malformed responses are rejected |
| 1b | Site: cron every 6 hours writes the registry to R2; `/api/builds` and `/builds`; MCP tool `builds`; addon 0.2.6 adds `clientBuild` to uploads | A new Forever build appears on `/builds` once; observations carry their build |
| 2 | (B or C) Extractor job: `Item`, `ItemSparse`, `SpellName`, `Spell` for one product, snapshot SQLite + manifest, provenance (build, file id, parser version) | One item and one spell extracted with provenance; `audit-sources` reports the source |
| 3 | (B or C) Diff engine and `npm run kb -- client-diff` | Two snapshots give a reproducible field-level diff; fixture tests |
| 4 | (C only) Policy rewrite; `/builds/[id]` changes, item and spell history on existing pages, evidence badges, spoiler gate, review queue | An item change shows with its build and "found in game files, unconfirmed" |
| 5 | Community aggregates tied to builds; AI drafts behind review | No unreviewed summary is published |

Phases 1a and 1b only read Blizzard's public version list, which tells which builds exist and
nothing about their content. They are useful under all three options.
