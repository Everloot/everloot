import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { auditSources } from "./audit-sources.js";
import { compareBaseline, readBaseline, writeBaselineReport } from "./baseline-report.js";
import { buildCoverageReport, readCoverageBaseline, writeCoverageReport } from "./coverage-report.js";
import { BlizzardClient } from "./blizzard/client.js";
import {
  backfillBluePosts, ingestBluePosts, loadFetchState, loadOverrides, loadStore, saveFetchState, saveStore, type BlueGame, type BlueRegion, type IngestResult,
} from "./blue-posts.js";
import { compileWriteups } from "./blue-writeups.js";
import { buildTimeline } from "./changes.js";
import { checkBuilds, loadRegistry, recordBuilds, saveRegistry, versionsUrl } from "./builds.js";
import { clientCoverage, formatCoverage } from "./client-coverage.js";
import { formatScanReport, loadManifest, scanBuild } from "./client-scan.js";
import { writeClientAchievements } from "./client-achievements.js";
import { writeClientEncounters } from "./client-encounters.js";
import { writeClientMounts } from "./client-mounts.js";
import { writeClientLayer } from "./client-layer.js";
import { writeRaceTable } from "./client-races.js";
import { buildQuestionBank, gameDataSubjects, parseQuestionBank, serializeQuestionBank, wikiSubjects } from "./question-bank.js";
import { evaluateBank, formatEvalReport } from "./question-eval.js";
import { readFilesIndex } from "./files-evidence.js";
import { diffSnapshots } from "./client-diff.js";
import { parseRegistry } from "./ecosystem.js";
import { loadSnapshotFile, refreshSnapshot, saveSnapshotFile } from "./ecosystem-fetch.js";
import { CASC_LIBRARY, extractTables, iconIds, NOT_IN_BUILD, openCdn, pinDefinitions, probeFiles } from "./client-extract.js";
import { readTerrainAreas } from "./terrain-area.js";
import { writeCatalogs } from "./client-catalog.js";
import { buildClientAssets } from "./client-assets.js";
import { CLIENT_EDGES, CLIENT_LAYER, CLIENT_TAXONOMY } from "./client-layer-file.js";
import { OPEN_DATA_KINDS } from "./open-data/build.js";
import { readRecordsFile } from "./open-data/read.js";
import { writeOpenData } from "./open-data/write.js";
import { writeWorldMapData } from "./world-map-data.js";
import { WORLD_MAP_DATA } from "./world-map-file.js";
import { worldFactsFromRecords } from "./world-pages.js";
import { clientSnapshotName, readClientMeta, readClientRows, writeClientSnapshot } from "./client-snapshot.js";
import { Curated, diffRaidBuffs, RaidBuffTable } from "./raid-buffs.js";
import { parseItemIds } from "./assets/items.js";
import { runItemNames } from "./item-names.js";
import { runGameNames } from "./game-names.js";
import { baselineNames, formatNameGaps, playerNames, runNameGaps } from "./name-gaps.js";
import { parse as parseYaml } from "yaml";
import { parseArgs } from "./args.js";
import { buildWatchCommand } from "./build-watch/command.js";
import { addRecheckScopes, readRecheck, RECHECK_FILE, scopesFromClientDiff } from "./build-watch/recheck.js";
import { isoWeek, spotCheckConflicts } from "./spot-check.js";
import { foldRecorderInstalls } from "./recorder-installs.js";
import { parseRecords } from "@everloot/protocol";
import type { Game, NsKind, Region } from "./blizzard/namespaces.js";
import { openDb, openExistingReadOnlyDb, type DB } from "./db.js";
import { importCurated } from "./importers/curated.js";
import { importPfquest } from "./importers/pfquest.js";
import { importWikiDump } from "./importers/wiki-dump.js";
import { lootWindowsFromRecords, rollupDrops } from "./drop-rollup.js";
import { startHttpBridge } from "./mcp-http.js";
import { readCorpusRecords, serveStdio } from "./mcp-server.js";
import { answerSourcesFactsFromRecords } from "./answer-sources.js";
import { objectSpawnRowsFromRecords } from "./object-spawns.js";
import { openPublicSnapshot } from "./public-snapshot.js";
import { search } from "./search.js";
import { snapshot } from "./snapshot.js";
import { validate } from "./validate.js";
import { checkGuides } from "./guides/check.js";
import { GUIDES_DIR, loadGuideCheckContext, readGuideFiles } from "./guides/data.js";
import { checkNews } from "./news/check.js";
import { NEWS_DIR, publishedWikiSlugs, readNewsPosts } from "./news/data.js";
import { checkWiki } from "./wiki/check.js";
import { loadCategories, loadKnownData, loadPrivatePathPattern, readWikiPages, WIKI_DIR } from "./wiki/data.js";

/** The committed changes data and the tracked accounts, found from this file so the cwd does not matter. */
const CHANGES_DIR = fileURLToPath(new URL("../changes/", import.meta.url));
const ECOSYSTEM_FILE = fileURLToPath(new URL("../curated/ecosystem.json", import.meta.url));
const ACCOUNTS_FILE = fileURLToPath(new URL("../curated/blue-accounts.json", import.meta.url));
const WRITEUPS_DIR = fileURLToPath(new URL("../curated/blue-writeups/", import.meta.url));
const WRITEUPS_FILE = fileURLToPath(new URL("../curated/blue-writeups.json", import.meta.url));

const GAMES: Game[] = ["retail", "classic", "classic1x", "forever"];
const KINDS: NsKind[] = ["static", "dynamic", "profile"];
const REGIONS: Region[] = ["us", "eu", "kr", "tw"];

const USAGE = `usage: npm run kb -- <command> --db <path>
  import-wiki <dump.xml|dump.xml.zst> [--limit N]   (reads the dump twice; --limit still costs one full pass;
    a limited import REPLACES all wiki rows in the target DB — use --db <scratch> for trials)
  import-curated [dir=curated]
  blizzard-get <data/wow/...|profile/wow/...> --game retail|classic|classic1x|forever --kind static|dynamic|profile [--region us]
    (path has no leading slash; works unchanged in Git Bash and PowerShell)
  search <words...> --db <existing knowledge base>
  serve-mcp --db <public release>        (stdio MCP: everloot-knowledge)
  serve-mcp-http --db <public release> [--port N]   (loopback HTTP MCP on 127.0.0.1:8787, POST /mcp;
    --token or EVERLOOT_MCP_TOKEN; a bearer token is transport auth, not proof of client compatibility)
  stats --db <existing knowledge base>
  validate --db <existing knowledge base>   (documented diagnostic: it WRITES the fts5 index, so never
    run it against a public release you are serving)
  snapshot <out.sqlite> --db <source knowledge base>   (writes a filtered public release + manifest,
    outside the database's own folder, e.g. data/release/kb.sqlite)
  builds-check [--product wowf,wow_classic_beta,wow_classic_era] [--registry data/builds.json]
    (asks Blizzard's public version service which builds exist; records new ones as queued.
    Reads build identifiers only, never game files)
  blue-check [--store <kb>/changes/blue-posts.json] [--accounts <kb>/curated/blue-accounts.json]
    [--state data/blue-fetch-state.json] [--min-minutes 25] [--max-requests 40] [--regions us,eu]
    (the blue post tracker: reads the US and EU English WoW forums and the official WoW Bluesky feed,
    politely: robots.txt first, 1.5 s apart, the forum's staff list at most once a day, then the Forever
    and Classic topic lists by last activity back to what the last run handled, opening only changed
    topics that carry a staff post. At most --max-requests requests a run; skips a list asked less than
    25 minutes ago, never follows a redirect, stops on 429 or a server error. Keeps title, author, role,
    time, thread, link and a two-sentence excerpt per post, never the full text. The posts file is public
    and committed under kb/changes (the same folder holds builds.json, written by the scheduled workflow
    with: builds-check --registry changes/builds.json). The politeness state (last asked, Retry-After,
    validators, the staff list) is a separate file that stays out of git)
  blue-backfill [--store <kb>/changes/blue-posts.json] [--accounts <kb>/curated/blue-accounts.json]
    [--games forever|classic|forever,classic] [--regions us,eu] [--since 2026-01-01] [--max-requests 3000]
    [--max-pages N]
    (one-off history for the blue tracker, not for the schedule: walks every page of the Forever topic
    lists, and the Classic ones back to --since, at the same pace and rules as blue-check, and keeps the
    staff posts of every topic that has one. Prints request counts by kind)
  blue-writeups [--dir <kb>/curated/blue-writeups] [--out <kb>/curated/blue-writeups.json]
    (checks the hand-written write-ups of blue posts, one Markdown file per post, and writes the JSON the
    site bundles. Fails on a file that breaks a rule or names a post the store does not hold)
  ecosystem-check [--registry <kb>/curated/ecosystem.json] [--snapshot <kb>/changes/ecosystem.json]
    [--min-hours 3] [--force]
    (the ecosystem tracker: reads GitHub's public REST API for every project in the registry, one request at
    a time, and writes the committed snapshot. GITHUB_TOKEN is optional: without it GitHub allows 60
    requests an hour and the first-reply time is skipped; with it, 5,000. Honours retry-after and the
    reset time, and stops instead of waiting more than 2 minutes. A project read less than 3 hours ago
    is skipped unless --force. A project that fails keeps its last answer)
  client-extract [--product wowf] [--registry data/builds.json] [--out data/client] [--refresh]
    (reads items, spells, talent (Trait) and spell effect tables of the product's current build from Blizzard's CDN into a snapshot
    <out>/<product>-<build>-<buildconfig, 8 chars>.sqlite + manifest, and marks the build processed.
    It also reads the terrain tiles under each dungeon entrance and taxi node and keeps each chunk's area id
    (TerrainArea), so client-map can say which zone a spot is in.
    A table that fails to read is reported, the rest are still written, the build stays queued and
    the exit is 1. Encrypted blocks are skipped, never decrypted. A build already extracted is skipped
    unless --refresh is given. Table layouts come from one pinned WoWDBDefs commit, recorded in the
    snapshot. Not for publication without review: see docs/DATA_POLICY.md)
  client-catalog <snapshot.sqlite> [--out data/catalog] [--list lists/raid-buffs.yaml]
    (writes <out>/<product>-<build>-<config>/talents/<class>.json, talents/index.json and raid-buffs.json
    from a snapshot, stamped with the build and labelled "found in game files, unconfirmed". See
    docs/TALENT_CATALOG.md. Not for publication)
  raid-buffs-diff <old/raid-buffs.json> <new/raid-buffs.json>   (entries whose scope changed between builds)
  client-assets <snapshot.sqlite> [--out data/assets] [--list lists/raid-buffs.yaml] [--items <id list>]
    (everything the site shows from the game files, from unencrypted files of the snapshot's build: talent icons,
    resolved tooltip text and talent-frame art; item icons and item tooltip facts (all named items, or only the ids
    in --items); class, talent tree, raid buff and profession icons; continent and zone map pictures. Into
    <out>/<product>-<build>-<config>/ with manifest.json and checksums.json (public bucket), and the item tooltip
    facts into <out>/<product>-<build>-<config>-private/ (private bucket only). Needs Python with Pillow. Never
    commit the output; see docs/ASSETS.md)
  client-diff <old.sqlite> <new.sqlite> [--out diff.json]   (field-level diff of two snapshots)
  recheck-scopes <diff.json> --since <ISO time> --source <build or post url> [--root ..]
    (adds recheck scopes to kb/curated/recheck.json from a client-diff: changed QuestV2 rows put their quests to
    recheck, changed UiMap rows the pins on those maps; a scope already there is not added twice)
  client-coverage <snapshot.sqlite> [--out coverage.md]   (rows, encrypted blocks and needed fields per client table)
  client-scan [--product wowf] [--manifest <path|url>] [--out data/client-scan]
    (measures the product's current CDN build against every table WoWDBDefs knows: which exist in the
    build, which the knowledge base already reads and which candidates remain, grouped by site domain.
    Root-listing lookups only, no file content and no keys. Writes <out>/<product>-<build>-<config>-scan.json
    and -scan.md; the report feeds the coverage backlog in docs/2026-10-18-database-taxonomy-research.md)
  question-bank --db <public release> [--game-data ../web/src/data/game-data] [--per-kind 60] [--out data/question-bank/bank.jsonl]
    (the questions players are likely to ask, generated from the game-data files, the release's page titles and a
    hand-written long tail; one JSON line each. Nothing is fetched. See docs/design/specs/2026-10-27-question-bank-design.md)
  question-eval <bank.jsonl> --db <public release> [--game-data ../web/src/data/game-data] [--out docs/evals/question-eval-<date>.md] [--json <path>]
    (runs every question through get_by_name, search and answer_sources with no model, and writes the markdown report:
    what resolves, what has evidence, and the gap lists. Player observations join when EVERLOOT_PUBLIC_CORPUS_URL or
    EVERLOOT_UPLOADS is set, else the observed layer reads as unrecorded)
  client-layer <snapshot.sqlite> [--out ../web/src/data/game-data/client-layer.json]
    (relation edges derived from the game files, one build-stamped file for the database pages. Game file data,
    labelled found in game files, unconfirmed. See docs/DATA_POLICY.md)
  client-races <snapshot.sqlite> [--out ../web/src/data/game-data/races.json]
    (each playable race with its faction, the classes it can be and its racial traits, one build-stamped file
    for the class pages and the class_races tool. Game file data, labelled found in game files, unconfirmed;
    trait descriptions are for pages only. See docs/DATA_POLICY.md)
  client-achievements <snapshot.sqlite> [--out ../web/src/data/game-data/client-achievements.json]
    (every achievement the game files carry with its criteria walked from CriteriaTree, one build-stamped file the
    achievement pages merge with player reports player-first. Pages only: the API, MCP and bulk exports stay clean. See docs/DATA_POLICY.md)
  client-encounters <snapshot.sqlite> [--out ../web/src/data/game-data/client-encounters.json]
    (every boss encounter the game files list per instance, from DungeonEncounter, one build-stamped file the
    instance pages merge with player reports player-first. Pages only, as above)
  client-mounts <snapshot.sqlite> [--out ../web/src/data/game-data/client-mounts.json]
    (every mount the game files list with its spell and riding skill, one build-stamped file the collections tool
    shows beside player uploads player-first. Pages only, as above)
  item-names <snapshot.sqlite> --wiki <knowledge base or release .sqlite> [--ledger data/item-names/ledger.json] [--out data/assets]
    (adds the snapshot's item names and the Warcraft Wiki dump's item names to the name ledger, which only
    grows, and writes the name the site shows for every item a source names (the game files' first, with the wiki
    page where the wiki agrees) to <out>/<product>-<build>-<config>-names/item-names.json for the private bucket. Prints the count per tier and the mismatches. The ledger holds every
    name in the build, so it stays on this machine; never commit either file. See docs/DATA_POLICY.md)
  game-names <snapshot.sqlite> --wiki <knowledge base or release .sqlite> [--out data/assets]
    (writes, beside item-names.json, the quest titles where the build's QuestV2 lists the quest id and the
    Warcraft Wiki dump's quest infoboxes give it a title (quest-names.json), and the game files' names of every
    item set and spell in the build (item-set-names.json, spell-names.json). For the private bucket only; never
    commit them. See docs/DATA_POLICY.md)
  name-gaps <snapshot.sqlite> --wiki <knowledge base or release .sqlite> [--baseline-db <source db>] [--out name-gaps.md] [--json name-gaps.json]
    (for items, quests, item sets and spells: how many ids each source names (the game files, the wiki, the local
    baseline, and the names 3 installs agree on from EVERLOOT_PUBLIC_CORPUS_URL or EVERLOOT_UPLOADS), out of the ids
    the game files and the baseline list; then where each id's name comes from, and for every id without one what
    would fill it: the addon's uploads, or no source yet. Without --baseline-db or uploads those columns print [?].
    Reads the same sources as item-names and game-names and writes no name file. Ids and counts only, never names; keep it local)
  client-map <snapshot.sqlite> [--out ../web/src/data/game-data/map.json]
    (zone rectangles in world coordinates, continents, dungeon and raid entrances and flight masters, each with
    the zone the ground under it belongs to, from a client snapshot, for the world map page. Game file data,
    stamped with the build. See docs/DATA_POLICY.md)
  build-watch [--product id] [--dry-run] [--check] [--redo] [--force] [--root ..] [--out data/build-watch/out]
    (notices a new game build, regenerates the committed game data and prepares a pull request body and
    a changelog entry; the scheduled workflow opens the PR. --dry-run writes only under --out and changes
    nothing else. --check only says whether there is work. See docs/BUILD_WATCH.md)
  audit-sources <file.sqlite...>   (rows per source and cached API rows in each file; exits 1 if anything
    is not publishable)
  import-pfquest <pfQuest checkout> [--client <snapshot.sqlite>] [--unpinned]
    (the Classic 1.12 baseline: reads the vanilla db/*.lua of a local pfQuest download as data, never running
    it, into pfquest-classic rows, which are never published. Only names and quest titles from enUS, no quest
    text. Refuses a checkout not at the pinned commit unless --unpinned. --client maps each spawn's AreaTable
    zone to the UiMap id uploads use. See docs/design/specs/2026-10-17-classic-baseline-design.md)
  baseline-report --db <source db> [--out <folder outside the repository>]
    (the baseline against the corroborated uploads from EVERLOOT_PUBLIC_CORPUS_URL or EVERLOOT_UPLOADS:
    confirmed, changed, new in Forever and not seen yet, by zone and level. Writes baseline-report.md and
    .json, by default to <temp>/everloot-baseline-report; never inside the repository, never published)
  coverage-report --db <source db> --out <folder outside the repository> [--client <snapshot.sqlite>]
    [--recheck-since <ISO timestamp>] [--root ..]
    (local per-field missing, reported, contested, spread and recheck detail by zone and level, baseline
    names included, and the plateau per type over the released zones. Also writes coverage-expected.json:
    zone/type/field counts only, no entity ids. Uses the same upload sources as baseline-report. The recheck
    scopes in kb/curated/recheck.json apply per fact; --recheck-since adds one cutoff for every fact.
    --client adds QuestV2 and boss candidates; without it those game-file-only facts are unknown. Never
    publishes or uploads either artifact)
  spot-check [--week <YYYY-Www>] [--root ..] [--dry-run]
    (the weekly spot check over the uploads: how many settled NPCs, pins, quests and vendors the week leaves
    out of the settled list, and the spot-checked facts that got a conflicting report since their week began,
    added to kb/curated/recheck.json as scopes that raise their zone's rate. The week defaults to the current
    UTC week; the pick is a hash of each fact's key and the week, so a rerun picks the same facts)
  open-data <folder> [--records <file>]
    (the open data export: the published data as NDJSON files under CC BY-SA 4.0, plus the game-file layer
    as Blizzard's, with a manifest, a README, the licence and a JSON Schema per file. Only facts that 3
    installs agree on leave the records; it refuses a row under that and an install id in any row. The
    records come from EVERLOOT_PUBLIC_CORPUS_URL (EVERLOOT_API_KEY for the whole feed) or EVERLOOT_UPLOADS,
    or from --records, a saved corpus answer. The folder must be new or empty. See docs/OPEN_DATA.md)
  wiki-check [--dir <kb>/wiki]
    (the wiki's page check: front matter, ids and slugs, categories, bindings and tokens against the committed
    game data and the shown id ranges, [[links]], hand-typed gameplay numbers, section order, credit fields,
    the index bar for published pages, private paths and AI credits. Exits 1 on any problem. See wiki/README.md)
  news-check [--dir <kb>/news]
    (the news posts' check: front matter, slugs, dates, [[links]] against the published wiki pages, tokens, the
    prose bar for published posts, private paths and AI credits. Exits 1 on any problem. See news/README.md)
  guide-check [--dir <kb>/guides] [--previous <folder>]
    (the guides' check: front matter, review and history, codes and spend orders against the site's talent
    trees, sections, sources, links and tokens. --previous is a copy of kb/guides from before the change, such
    as a pull request's base: published versions are then held to it. A --previous that is not a folder fails;
    an empty one means there were no guides. Exits 1 on any problem. See ../docs/GUIDES.md)

  A source database and a public release are different artifacts. The serve commands accept only a
  release: an existing file plus its <release>.manifest.json, opened read-only and checked against
  that manifest. Importers may still default to data/everloot-kb.sqlite; the read, validate,
  snapshot and serve commands above never guess a path, and validate/snapshot refuse a missing file.

  Run through node directly if a wrapper eats the flag:
    node ./node_modules/tsx/dist/cli.mjs src/cli.ts stats --db data/wowvault-kb.sqlite`;

/** Commands that answer questions require an explicit path: there is no default knowledge base. */
function requireDbPath(flags: Map<string, string>, command: string): string {
  const path = flags.get("db")?.trim();
  if (!path) throw new Error(`${command} needs an explicit --db path; no default knowledge database is used`);
  return path;
}

/** Diagnostic and export commands read a source database; opening a typo would create an empty one. */
function requireExistingDbPath(flags: Map<string, string>, command: string): string {
  const path = requireDbPath(flags, command);
  if (!existsSync(path)) throw new Error(`${command}: ${path} does not exist; nothing was created`);
  return path;
}

/** Release handles are opened before anything listens, and closed when the process is stopped. */
function closeOnExit(db: DB): void {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      try {
        db.close();
      } catch {
        // already closed
      }
      process.exit(0);
    });
  }
}

/** Redirects are not followed: robots.txt was read for the host we asked, not for wherever it points. */
const politeFetch = (url: string, init: { headers: Record<string, string> }) =>
  fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(15_000) });

function blueRegions(value: string | undefined): BlueRegion[] | undefined {
  if (!value) return undefined;
  const regions = value.split(",").filter(Boolean);
  if (regions.some((r) => r !== "us" && r !== "eu")) throw new Error("--regions takes us, eu or both");
  return regions as BlueRegion[];
}

function reportBlue(result: IngestResult, path: string): number {
  for (const p of result.added) console.log(`new post: [${p.game}${p.region ? ` ${p.region}` : ""}] ${p.title} (${p.author}) ${p.url}`);
  for (const s of result.skipped) console.log(`skipped ${s}`);
  for (const e of result.errors) console.error(`${e.source}: ${e.error}`);
  const spent = Object.entries(result.requests).map(([k, n]) => `${k} ${n}`).join(", ");
  console.log(`${result.added.length} new, ${result.store.posts.length} kept; requests: ${spent || "none"}; store ${path}`);
  return result.errors.length ? 1 : 0;
}

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2);
  const { flags, args } = parseArgs(rest);
  if (existsSync(".env")) process.loadEnvFile(".env");
  let opened: DB | undefined;
  const db = () => (opened ??= openDb(flags.get("db") ?? "data/everloot-kb.sqlite"));

  switch (cmd) {
    case "import-wiki": {
      if (!args[0]) break;
      let limit: number | undefined;
      if (flags.has("limit")) {
        const raw = flags.get("limit")!;
        const n = Number(raw);
        if (!Number.isInteger(n) || n <= 0) {
          console.error(`invalid --limit "${raw}"; expected a positive whole number`);
          return 1;
        }
        limit = n;
      }
      const { stored, skipped, dropped } = await importWikiDump(db(), args[0], {
        limit,
        onProgress: ({ pass, blocks }) => console.error(`pass ${pass}: ${blocks.toLocaleString("en-US")} blocks…`),
      });
      db().pragma("wal_checkpoint(TRUNCATE)");
      console.log(
        `imported ${stored} lore pages (${skipped} skipped: wikitext unreadable or empty after conversion; ` +
          `dropped ${dropped.redirect} redirects, ${dropped.namespace} other-namespace, ${dropped.empty} empty)`,
      );
      return 0;
    }
    case "import-curated":
      console.log(`imported ${await importCurated(db(), args[0] ?? "curated")} curated entries`);
      return 0;
    case "blizzard-get": {
      if (!args[0]) break;
      const game = flags.get("game") ?? "retail";
      const kind = flags.get("kind") ?? "static";
      const region = flags.get("region") ?? "us";
      if (!GAMES.includes(game as Game)) {
        console.error(`invalid --game "${game}"; expected one of: ${GAMES.join(", ")}`);
        return 1;
      }
      if (!KINDS.includes(kind as NsKind)) {
        console.error(`invalid --kind "${kind}"; expected one of: ${KINDS.join(", ")}`);
        return 1;
      }
      if (!REGIONS.includes(region as Region)) {
        console.error(`invalid --region "${region}"; expected one of: ${REGIONS.join(", ")}`);
        return 1;
      }
      let path = args[0];
      if (!path.startsWith("/")) path = `/${path}`;
      if (!path.startsWith("/data/wow/") && !path.startsWith("/profile/wow/")) {
        console.error(`invalid path "${path}": must start with data/wow/ or profile/wow/ (omit the leading slash in Git Bash)`);
        return 1;
      }
      const { BLIZZARD_CLIENT_ID: id, BLIZZARD_CLIENT_SECRET: secret } = process.env;
      if (!id || !secret) {
        console.error("needs BLIZZARD_CLIENT_ID and BLIZZARD_CLIENT_SECRET in kb/.env");
        return 1;
      }
      const client = new BlizzardClient(db(), { clientId: id, clientSecret: secret, region: region as Region });
      const body = await client.get(path, game as Game, kind as NsKind);
      console.log(JSON.stringify(body, null, 2));
      return 0;
    }
    case "search":
      for (const h of search(openExistingReadOnlyDb(requireDbPath(flags, "search")), args.join(" ")))
        console.log(`${h.kind}  ${h.name}\n  ${h.snippet}\n  ${h.sourceUrl} (${h.licence})`);
      return 0;
    case "serve-mcp": {
      const release = openPublicSnapshot(requireDbPath(flags, "serve-mcp"));
      closeOnExit(release.db);
      await serveStdio(release.db, () => {
        // The same files blue-check and builds-check write; absent files mean "not connected".
        const posts = join(CHANGES_DIR, "blue-posts.json");
        const builds = join(CHANGES_DIR, "builds.json");
        return existsSync(posts) || existsSync(builds) ? buildTimeline(loadStore(posts).posts, loadRegistry(builds).builds) : null;
      });
      return 0;
    }
    case "serve-mcp-http": {
      const release = openPublicSnapshot(requireDbPath(flags, "serve-mcp-http"));
      const port = Number(flags.get("port") ?? 8787);
      const token = flags.get("token") || process.env.EVERLOOT_MCP_TOKEN;
      const http = await startHttpBridge(release.db, port, token ? { token } : {});
      closeOnExit(release.db);
      const addr = http.address();
      const bound = typeof addr === "object" && addr ? addr.port : port;
      console.log(
        `everloot-knowledge HTTP MCP on http://127.0.0.1:${bound}/mcp (${token ? "bearer required" : "open on loopback"})`,
      );
      await new Promise<never>(() => {});
    }
    case "stats":
      console.table(
        openExistingReadOnlyDb(requireDbPath(flags, "stats")).prepare(
          "SELECT source_id, kind, count(*) AS rows FROM entities GROUP BY source_id, kind",
        ).all(),
      );
      return 0;
    case "validate": {
      // Documented diagnostic, deliberately writable: validate rebuilds the fts5 index, so it must
      // never be pointed at a public release.
      const source = openDb(requireExistingDbPath(flags, "validate"));
      const { rows } = source.prepare("SELECT count(*) AS rows FROM entities").get() as { rows: number };
      // A structurally valid empty file is not a ready knowledge base.
      const problems = rows === 0 ? ["no entities: the knowledge base is empty"] : validate(source);
      console.log(problems.length === 0 ? "ok" : problems.join("\n"));
      return problems.length === 0 ? 0 : 1;
    }
    case "builds-check": {
      const products = (flags.get("product") || "wowf,wow_classic_beta,wow_classic_era").split(",").map((p) => p.trim()).filter(Boolean);
      const path = flags.get("registry") || "data/builds.json";
      const result = await checkBuilds(loadRegistry(path), products, async (product) => {
        const res = await fetch(versionsUrl(product), { signal: AbortSignal.timeout(15_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      }, new Date());
      saveRegistry(path, result.registry);
      for (const b of result.added) console.log(`new build: ${b.product} ${b.version} (${b.buildConfig}) [${b.regions.join(" ")}]`);
      for (const e of result.errors) console.error(`${e.product}: ${e.error}`);
      console.log(`${result.added.length} new, ${result.registry.builds.length} known; registry ${path}`);
      return result.errors.length ? 1 : 0;
    }
    case "blue-check": {
      const path = flags.get("store") || join(CHANGES_DIR, "blue-posts.json");
      const statePath = flags.get("state") || "data/blue-fetch-state.json";
      const result = await ingestBluePosts({
        store: { ...loadStore(path), fetched: loadFetchState(statePath) },
        overrides: loadOverrides(flags.get("accounts") || ACCOUNTS_FILE),
        fetcher: politeFetch,
        now: new Date(),
        minIntervalMs: Number(flags.get("min-minutes") ?? 25) * 60_000,
        maxRequests: Number(flags.get("max-requests") || 40),
        regions: blueRegions(flags.get("regions")),
      });
      saveStore(path, result.store);
      saveFetchState(statePath, result.store.fetched);
      return reportBlue(result, path);
    }
    case "blue-backfill": {
      const path = flags.get("store") || join(CHANGES_DIR, "blue-posts.json");
      const games = (flags.get("games") || "forever").split(",").filter(Boolean) as BlueGame[];
      if (games.some((g) => g !== "forever" && g !== "classic")) throw new Error("--games takes forever, classic or both");
      const result = await backfillBluePosts({
        store: loadStore(path),
        overrides: loadOverrides(flags.get("accounts") || ACCOUNTS_FILE),
        fetcher: politeFetch,
        now: new Date(),
        games,
        regions: blueRegions(flags.get("regions")),
        since: flags.get("since") || undefined,
        maxRequests: Number(flags.get("max-requests") || 3000),
        maxListPages: flags.get("max-pages") ? Number(flags.get("max-pages")) : undefined,
      });
      saveStore(path, result.store);
      console.log(`${result.pages} list pages, ${result.topics} topics opened`);
      return reportBlue(result, path);
    }
    case "blue-writeups": {
      const dir = flags.get("dir") || WRITEUPS_DIR;
      const out = flags.get("out") || WRITEUPS_FILE;
      const files = existsSync(dir) ? readdirSync(dir).map((name) => ({ name, text: readFileSync(join(dir, name), "utf8") })) : [];
      const known = new Set(loadStore(join(CHANGES_DIR, "blue-posts.json")).posts.map((p) => p.id));
      const writeups = compileWriteups(files, known);
      const note = (JSON.parse(readFileSync(out, "utf8")) as { note?: string }).note;
      writeFileSync(out, `${JSON.stringify({ note, writeups }, null, 2)}\n`);
      console.log(`${writeups.length} write-ups written to ${out}`);
      return 0;
    }
    case "ecosystem-check": {
      const registry = parseRegistry(JSON.parse(readFileSync(flags.get("registry") || ECOSYSTEM_FILE, "utf8")));
      const path = flags.get("snapshot") || join(CHANGES_DIR, "ecosystem.json");
      const report = await refreshSnapshot(registry, loadSnapshotFile(path), {
        fetcher: (url, init) => fetch(url, init),
        now: () => new Date(),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        token: process.env.GITHUB_TOKEN?.trim() || undefined,
        minIntervalMs: Number(flags.get("min-hours") ?? 3) * 3_600_000,
        force: flags.has("force"),
      });
      saveSnapshotFile(path, report.snapshot);
      for (const id of report.refreshed) console.log(`refreshed ${id}`);
      for (const id of report.skipped) console.log(`skipped ${id}`);
      for (const e of report.errors) console.error(`${e.id}: ${e.error}`);
      console.log(`${report.refreshed.length} refreshed, ${report.skipped.length} skipped; snapshot ${path}`);
      return report.errors.length ? 1 : 0;
    }
    case "client-extract": {
      const product = flags.get("product") || "wowf";
      const path = flags.get("registry") || "data/builds.json";
      const outDir = flags.get("out") || "data/client";
      const now = new Date();
      const { build, source } = await openCdn(product);
      const out = join(outDir, clientSnapshotName(build));
      let registry = loadRegistry(path);
      const key = `${product}:${build.buildConfig}`;
      if (!registry.builds.some((b) => b.key === key)) {
        registry = recordBuilds(registry, product, { seqn: null, rows: [{ region: "us", buildConfig: build.buildConfig, cdnConfig: "", buildId: build.buildId, version: build.version, productConfig: "" }] }, now).registry;
      }
      if (!["", "yes", "true"].includes(flags.get("refresh") ?? "no") &&registry.builds.find((b) => b.key === key)?.status === "processed" && existsSync(out)) {
        console.log(`${product} ${build.version} is already extracted: ${out}`);
        return 0;
      }
      // Every layout the library reads for this run comes from this one WoWDBDefs commit (null: GitHub was unreachable, so it reads master).
      const definitions = await pinDefinitions();
      const { tables, missing } = await extractTables(source);
      const fileStatus = probeFiles(source, iconIds(tables));
      if (fileStatus) tables.push(fileStatus);
      const terrain = source.readFile && await readTerrainAreas(source.readFile, tables);
      if (terrain) tables.push(terrain);
      mkdirSync(outDir, { recursive: true });
      const manifest = writeClientSnapshot(out, { ...build, extractedAt: now.toISOString(), library: CASC_LIBRARY, definitions }, tables, missing);
      // A table that failed to read leaves the build queued, so the next run tries it again.
      const failed = missing.filter((m) => m.reason !== NOT_IN_BUILD);
      if (!failed.length) {
        registry = { builds: registry.builds.map((b) => (b.key === key ? { ...b, status: "processed" as const } : b)) };
      }
      saveRegistry(path, registry);
      for (const t of manifest.tables) console.log(`${t.table}: ${t.rows} rows${t.encryptedBlocks ? `, ${t.encryptedBlocks} encrypted blocks skipped` : ""}`);
      for (const m of missing) (m.reason === NOT_IN_BUILD ? console.log : console.error)(`${m.table}: ${m.reason}`);
      console.log(`${product} ${build.version} -> ${out} (sha256 ${manifest.sha256.slice(0, 12)})`);
      return failed.length ? 1 : 0;
    }
    case "client-coverage": {
      if (!args[0]) break;
      const md = formatCoverage(clientCoverage(args[0]));
      const out = flags.get("out");
      if (out) writeFileSync(out, md);
      process.stdout.write(md);
      return 0;
    }
    case "client-scan": {
      const product = flags.get("product") || "wowf";
      const outDir = flags.get("out") || "data/client-scan";
      const { build, source } = await openCdn(product);
      if (!source.fileStatus) throw new Error("this source cannot look up file data ids");
      const statusOf = source.fileStatus.bind(source);
      // The manifest default URL goes through the pinned fetch, so the reported sha is the one measured.
      const definitions = await pinDefinitions();
      const { entries, source: manifestSource } = await loadManifest(flags.get("manifest"));
      const report = scanBuild({ build, definitions, manifest: manifestSource }, entries, statusOf);
      const base = clientSnapshotName(build).replace(/\.sqlite$/, "");
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, `${base}-scan.json`), `${JSON.stringify(report, null, 2)}\n`);
      const md = formatScanReport(report);
      writeFileSync(join(outDir, `${base}-scan.md`), md);
      process.stdout.write(md);
      console.log(`${report.totals.present}/${report.totals.known} tables in build, ${report.candidates.length} unread candidates, ${report.totals.neverListed} never-list; -> ${outDir}`);
      return 0;
    }
    case "question-bank": {
      const release = openExistingReadOnlyDb(requireExistingDbPath(flags, "question-bank"));
      const gameData = flags.get("game-data") || "../web/src/data/game-data";
      const perKind = Number(flags.get("per-kind") || 60);
      const out = flags.get("out") || "data/question-bank/bank.jsonl";
      const subjects = [...gameDataSubjects(gameData), ...wikiSubjects(release, perKind)];
      const bank = buildQuestionBank(subjects);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, serializeQuestionBank(bank));
      const kinds = new Map<string, number>();
      for (const s of subjects) kinds.set(s.kind, (kinds.get(s.kind) ?? 0) + 1);
      console.log(`${subjects.length} subjects (${[...kinds].map(([k, n]) => `${k} ${n}`).join(", ")}) -> ${bank.length} questions -> ${out}`);
      return 0;
    }
    case "question-eval": {
      if (!args[0]) break;
      const releasePath = requireExistingDbPath(flags, "question-eval");
      const release = openExistingReadOnlyDb(releasePath);
      const bank = parseQuestionBank(readFileSync(args[0], "utf8"));
      const corpus = await readCorpusRecords(["item_seen", "item_fact", "loot", "npc_sighting", "vendor", "quest", "object_sighting", "instance_entrance", "encounter"]);
      const facts = corpus ? answerSourcesFactsFromRecords(corpus.records) : null;
      const ranAt = new Date().toISOString();
      const files = readFilesIndex(flags.get("game-data") || "../web/src/data/game-data");
      const report = evaluateBank(release, bank, facts, { release: basename(releasePath), dataAsOf: corpus?.dataAsOf ?? null, ranAt, files: files.facts.length ? files : null });
      const out = flags.get("out") || `../docs/evals/question-eval-${ranAt.slice(0, 10)}.md`;
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, formatEvalReport(report));
      const json = flags.get("json");
      if (json) { mkdirSync(dirname(json), { recursive: true }); writeFileSync(json, `${JSON.stringify(report, null, 1)}\n`); }
      const t = report.totals;
      console.log(`${t.questions} questions: ${t.exact} exact, ${t.search} by search, ${t.none} unresolved; ${t.withEvidence} with evidence, ${t.withObserved} with observed facts, ${t.withFiles} with the files' facts, ${t.withPage} with a page -> ${out}`);
      return 0;
    }
    case "client-layer": {
      if (!args[0]) break;
      const path = flags.get("out") || "../web/src/data/game-data/client-layer.json";
      const layer = writeClientLayer(args[0], path);
      for (const [rel, n] of Object.entries(layer.counts)) console.log(`${rel}: ${n} edges`);
      console.log(`-> ${path}`);
      return 0;
    }
    case "client-races": {
      if (!args[0]) break;
      const path = flags.get("out") || "../web/src/data/game-data/races.json";
      const table = writeRaceTable(args[0], path);
      for (const r of table.races) console.log(`${r.faction} ${r.name}: ${r.classes.length} classes, ${r.traits.length} traits`);
      console.log(`-> ${path}`);
      return 0;
    }
    case "client-achievements": {
      if (!args[0]) break;
      const path = flags.get("out") || "../web/src/data/game-data/client-achievements.json";
      const table = writeClientAchievements(args[0], path);
      const listed = Object.keys(table.achievements).length;
      const withCriteria = Object.values(table.achievements).filter((a) => a.criteria.length > 0).length;
      console.log(`${table.build.product} ${table.build.version}: ${listed} achievements, ${withCriteria} with criteria -> ${path}`);
      return 0;
    }
    case "client-encounters": {
      if (!args[0]) break;
      const path = flags.get("out") || "../web/src/data/game-data/client-encounters.json";
      const table = writeClientEncounters(args[0], path);
      const instances = Object.keys(table.instances).length;
      const encounters = Object.values(table.instances).reduce((n, list) => n + list.length, 0);
      console.log(`${table.build.product} ${table.build.version}: ${encounters} encounters in ${instances} instances -> ${path}`);
      return 0;
    }
    case "client-mounts": {
      if (!args[0]) break;
      const path = flags.get("out") || "../web/src/data/game-data/client-mounts.json";
      const table = writeClientMounts(args[0], path);
      console.log(`${table.build.product} ${table.build.version}: ${Object.keys(table.mounts).length} mounts -> ${path}`);
      return 0;
    }
    case "client-diff": {
      if (args.length < 2) break;
      const diff = diffSnapshots(args[0], args[1]);
      const out = flags.get("out");
      if (out) writeFileSync(out, `${JSON.stringify(diff, null, 2)}
`);
      console.log(`${diff.from.product} ${diff.from.version} -> ${diff.to.product} ${diff.to.version}${diff.crossProduct ? " (different products)" : ""}`);
      for (const t of diff.tables) console.log(`${t.table}: ${t.added.length} added, ${t.removed.length} removed, ${t.changed.length} changed`);
      for (const w of diff.warnings) console.log(`warning: ${w}`);
      return 0;
    }
    case "recheck-scopes": {
      const since = flags.get("since"), source = flags.get("source");
      if (args.length < 1 || !since || !source || !Number.isFinite(Date.parse(since))) break;
      const root = flags.get("root") || "..";
      const scopes = scopesFromClientDiff(JSON.parse(readFileSync(args[0], "utf8")), { since, source });
      const added = addRecheckScopes(root, root, scopes);
      for (const s of scopes) console.log(`${s.type}: ${(s.ids ?? s.zones ?? []).length} ${s.ids ? "ids" : "zones"} since ${s.since}`);
      console.log(added ? `-> ${RECHECK_FILE}` : `${RECHECK_FILE} already holds these scopes`);
      return 0;
    }
    case "client-catalog": {
      if (!args[0]) break;
      const run = writeCatalogs(args[0], flags.get("out") || "data/catalog", flags.get("list") || "lists/raid-buffs.yaml");
      for (const c of run.index.classes) console.log(`${c.className ?? c.classId}: ${c.trees} trees, ${c.nodes} nodes`);
      for (const t of run.index.tables) console.log(`${t.table}: ${t.rows} rows${t.encryptedBlocks ? `, ${t.encryptedBlocks} encrypted blocks skipped` : ""}`);
      for (const w of run.index.warnings) console.log(`warning: ${w}`);
      if (run.raidBuffs.notFound.length) console.log(`raid buffs not found: ${run.raidBuffs.notFound.join(", ")}`);
      console.log(`-> ${run.dir}`);
      return 0;
    }
    case "client-assets": {
      if (!args[0]) break;
      const meta = readClientMeta(args[0]);
      const { build, source } = await openCdn(meta.product);
      if (build.buildConfig !== meta.buildConfig) {
        console.error(`the snapshot is build ${meta.version} but the CDN now serves ${build.version}; run client-extract first, or the assets would not match the snapshot`);
        return 1;
      }
      await pinDefinitions();
      // The raid buff list names the spells whose icons the raid builder shows.
      const list = flags.get("list") || "lists/raid-buffs.yaml";
      const buffSpells = existsSync(list) ? Curated.parse(parseYaml(readFileSync(list, "utf8"))).flatMap((c) => c.spells) : [];
      const itemsFile = flags.get("items");
      const items = itemsFile ? parseItemIds(readFileSync(itemsFile, "utf8")) : undefined;
      // The spells the committed client layer says items are created by or used in, for the /database pages.
      const relationSpells = CLIENT_EDGES.filter((e) => e.toKind === "spell").map((e) => e.toId);
      const run = await buildClientAssets({ snapshotPath: args[0], outDir: flags.get("out") || "data/assets", source, buffSpells, relationSpells, items });
      for (const n of run.notes) console.log(n);
      for (const s of run.manifest.skippedMaps.slice(0, 10)) console.log(`map skipped: ${s}`);
      for (const s of run.manifest.skippedBanners.slice(0, 10)) console.log(`banner art skipped: ${s}`);
      // Printed before the public folder line: the upload script reads both.
      if (run.privateDir) console.log(`private -> ${run.privateDir}`);
      if (run.manifest.missingFrames.length) console.log(`frame pieces not available: ${run.manifest.missingFrames.join(", ")}`);
      console.log(`-> ${run.dir}`);
      return 0;
    }
    case "item-names": {
      const kbPath = flags.get("wiki");
      if (!args[0] || !kbPath) break;
      const run = runItemNames({ snapshotPath: args[0], kbPath, ledgerPath: flags.get("ledger") || "data/item-names/ledger.json", outDir: flags.get("out") || "data/assets" });
      console.log(`build ${run.build}: ${run.items} items`);
      for (const [tier, n] of Object.entries(run.counts)) console.log(`  ${tier}: ${n}`);
      console.log(`shown: ${run.shownCount} of ${run.items}`);
      console.log(`mismatches (the game files' name is shown), first 25 of ${run.mismatches.length}:`);
      for (const m of run.mismatches.slice(0, 25)) console.log(`  ${m.id}: files "${m.files}", wiki "${m.wiki.join('" | "')}"`);
      console.log(`ledger: ${run.ledger.runs.length} runs, ${Object.keys(run.ledger.items).length} items; this run added ${run.ledger.runs.at(-1)!.added.files} game file and ${run.ledger.runs.at(-1)!.added.wiki} wiki names`);
      console.log(`shown -> ${run.shownPath} (${run.shown.count} names)`);
      return 0;
    }
    case "game-names": {
      const kbPath = flags.get("wiki");
      if (!args[0] || !kbPath) break;
      const run = runGameNames({ snapshotPath: args[0], kbPath, outDir: flags.get("out") || "data/assets" });
      const q = run.quests.counts;
      console.log(`build ${run.build}, wiki dump ${run.wikiDump} (${run.wikiQuestIds} quest ids with a title)`);
      console.log(`quests: ${q.quests} in QuestV2; ${q.match} with one wiki title, ${q.mismatch} where wiki pages disagree, ${q.files} the wiki lacks; held back ${q.held} a Forever source contradicts`);
      console.log(`wiki pages that disagree (the first page's title is shown), first 15 of ${run.quests.mismatches.length}:`);
      for (const m of run.quests.mismatches.slice(0, 15)) console.log(`  ${m.id}: "${m.wiki.join('" | "')}"`);
      for (const [label, r] of [["item sets", run.sets], ["spells", run.spells]] as const) console.log(`${label}: ${r.counts.ids} in the files, ${r.counts.named} named`);
      for (const r of [run.quests, run.sets, run.spells]) console.log(`shown -> ${r.path} (${r.file.count} names)`);
      return 0;
    }
    case "name-gaps": {
      const kbPath = flags.get("wiki");
      if (!args[0] || !kbPath) break;
      const baselineDb = flags.get("baseline-db");
      let baseline = null;
      if (baselineDb) {
        const source = openExistingReadOnlyDb(baselineDb);
        baseline = baselineNames(source);
        source.close();
        if (!baseline.items.size && !baseline.quests.size) throw new Error("name-gaps: no pfquest-classic rows in --baseline-db; run import-pfquest first");
      }
      const corpus = await readCorpusRecords(["item_seen", "quest"]);
      if (!corpus) console.error("uploads not connected or unreadable (EVERLOOT_PUBLIC_CORPUS_URL, EVERLOOT_UPLOADS): the Players column prints [?]");
      const report = runNameGaps({ snapshotPath: args[0], kbPath, baseline, players: corpus && playerNames(corpus.records, corpus.dataAsOf) });
      const md = formatNameGaps(report);
      const out = flags.get("out"), json = flags.get("json");
      if (out) writeFileSync(out, md);
      if (json) writeFileSync(json, `${JSON.stringify(report, null, 2)}
`);
      process.stdout.write(md);
      return 0;
    }
    case "client-map": {
      if (!args[0]) break;
      const data = writeWorldMapData(args[0]);
      const out = flags.get("out") || "../web/src/data/game-data/map.json";
      mkdirSync(dirname(out), { recursive: true });
      // A flight line's points stay one pair per line, not three lines each.
      writeFileSync(out, `${JSON.stringify(data, null, 2).replace(/\[\s+(-?\d+),\s+(-?\d+)\s+\]/g, "[$1, $2]")}
`);
      for (const t of data.source.tables) console.log(`${t.table}: ${t.rows} rows${t.encryptedBlocks ? `, ${t.encryptedBlocks} encrypted blocks skipped` : ""}`);
      for (const w of data.warnings) console.log(`warning: ${w}`);
      console.log(`${data.continents.length} continents, ${data.zones.length} zones, ${data.entrances.length} entrances -> ${out}`);
      return 0;
    }
    case "raid-buffs-diff": {
      if (args.length < 2) break;
      const [a, b] = args.map((p) => RaidBuffTable.parse(JSON.parse(readFileSync(p, "utf8"))));
      console.log(`${a.build.product} ${a.build.version} -> ${b.build.product} ${b.build.version}`);
      const changes = diffRaidBuffs(a, b);
      for (const c of changes) {
        console.log(`${c.label}: ${c.before ?? "none"} -> ${c.after ?? "none"}`);
        if (c.before === c.after) console.log(`  by rank: ${c.beforeRanks} -> ${c.afterRanks}`);
      }
      console.log(`${changes.length} changed`);
      return 0;
    }
    case "build-watch":
      return buildWatchCommand(flags);
    case "audit-sources": {
      if (!args.length) break;
      let clean = true;
      for (const path of args) {
        const audit = auditSources(path);
        const counts = [...Object.entries(audit.sources), ["api_cache", audit.cachedApiRows] as const]
          .map(([id, n]) => `${id}=${n}`)
          .join(" ");
        console.log(`${path}: ${counts}${audit.unexpected.length ? `  NOT PUBLISHABLE: ${audit.unexpected.join(", ")}` : ""}`);
        if (audit.unexpected.length) clean = false;
      }
      return clean ? 0 : 1;
    }
    case "import-pfquest": {
      if (!args[0]) break;
      const snapshotPath = flags.get("client") || undefined;
      if (!snapshotPath) console.error("no --client snapshot: spawns keep only their AreaTable zone id, so the report cannot place them on upload maps");
      const run = await importPfquest(db(), args[0], { snapshotPath, allowOtherCommit: flags.has("unpinned") });
      db().pragma("wal_checkpoint(TRUNCATE)");
      const { units, objects, items, quests } = run.rows;
      console.log(`pfQuest ${run.commit.slice(0, 8)}: ${units} units, ${objects} objects, ${items} items, ${quests} quests as pfquest-classic (local only)`);
      console.log(`skipped ${run.skipped.junk} GM, test or placeholder entries and ${run.skipped.unnamed} without an English name`);
      const unmapped = Object.entries(run.spawns.unmappedAreas).sort((a, b) => b[1] - a[1]);
      console.log(`spawns: ${run.spawns.mapped} of ${run.spawns.total} placed on a UiMap; ${run.spawns.total - run.spawns.mapped} in ${unmapped.length} areas keep only their area id`);
      if (unmapped.length) console.log(`  most unplaced: ${unmapped.slice(0, 10).map(([area, n]) => `area ${area} (${n})`).join(", ")}`);
      return 0;
    }
    case "coverage-report": {
      const out = flags.get("out");
      if (!out) throw new Error("coverage-report: --out must name a folder outside the repository");
      const recheckSince = flags.get("recheck-since") || undefined;
      if (recheckSince && !Number.isFinite(Date.parse(recheckSince))) throw new Error("coverage-report: --recheck-since must be an ISO timestamp");
      const source = openExistingReadOnlyDb(requireDbPath(flags, "coverage-report"));
      let local: ReturnType<typeof readCoverageBaseline>;
      try { local = readCoverageBaseline(source); } finally { source.close(); }
      if (!local.baseline.units.size && !local.baseline.quests.size) throw new Error("coverage-report: no pfquest-classic rows in this database; run import-pfquest first");
      const client = flags.get("client");
      const questIds = client ? readClientRows(client, "QuestV2").keys() : undefined;
      const bosses: { encounterId: number; instanceMapId?: number }[] = [];
      if (client) {
        for (const [encounterId, row] of readClientRows(client, "DungeonEncounter")) {
          bosses.push({ encounterId, ...(typeof row.MapID === "number" ? { instanceMapId: row.MapID } : {}) });
        }
        const instances = readClientRows(client, "JournalInstance");
        for (const row of readClientRows(client, "JournalEncounter").values()) {
          // The encounter API reports DungeonEncounter ids; journal-only ids cannot be matched to it.
          if (typeof row.DungeonEncounterID !== "number" || row.DungeonEncounterID <= 0) continue;
          const instance = instances.get(Number(row.JournalInstanceID));
          bosses.push({ encounterId: row.DungeonEncounterID, ...(typeof instance?.MapID === "number" ? { instanceMapId: instance.MapID } : {}) });
        }
      }
      const corpus = await readCorpusRecords(["npc_sighting", "quest", "vendor", "loot", "instance_entrance", "encounter", "object_sighting"]);
      const recheck = readRecheck(flags.get("root") || "..").scopes;
      const report = buildCoverageReport({ ...local, records: corpus?.records ?? [], dataAsOf: corpus?.dataAsOf ?? null,
        connected: corpus !== null, clientConnected: Boolean(client), questIds, bosses, recheckSince, recheck });
      const paths = writeCoverageReport(report, out);
      console.log(`${report.rows.length} local fact fields, ${report.rows.filter((r) => r.state === "recheck").length} in recheck (${recheck.length} scopes); uploads ${report.connected ? "connected" : "disconnected ([?])"}`);
      const plateau = report.plateau;
      console.log(`plateau: ${plateau?.site === true ? "yes" : plateau?.site === false ? "no" : "[?]"}${plateau ? ` (${plateau.types.map((t) => `${t.type} ${t.atPlateau === null ? "[?]" : t.atPlateau ? "yes" : "no"}`).join(", ")})` : ""}`);
      console.log(`-> ${paths.markdown}\n-> ${paths.json}\n-> ${paths.expected}`);
      return 0;
    }
    case "spot-check": {
      const root = flags.get("root") || "..";
      const corpus = await readCorpusRecords(["npc_sighting", "quest", "vendor"]);
      if (!corpus) throw new Error("spot-check: uploads not connected or unreadable (EVERLOOT_PUBLIC_CORPUS_URL, EVERLOOT_UPLOADS)");
      // The week this runs in, as the settled list's own pick: an idle corpus must not hold one week's pick forever.
      const week = flags.get("week") || isoWeek(new Date());
      if (!/^\d{4}-W\d{2}$/.test(week)) throw new Error("spot-check: --week must read YYYY-Www");
      const records = foldRecorderInstalls(parseRecords(corpus.records).records);
      const run = spotCheckConflicts(records, week, readRecheck(root).scopes);
      console.log(`${week}: ${run.checked} of ${run.settled} settled NPCs, pins, quests and vendors left out of the settled list`);
      for (const c of run.conflicts) console.log(`conflict: ${c.key} (zone ${c.zone ?? "[?]"}), spot-checked in ${c.checkedIn}`);
      if (!run.conflicts.length) console.log("no spot-checked fact got a conflicting report");
      else if (flags.has("dry-run")) console.log(`dry run: ${run.conflicts.length} scopes not written`);
      else console.log(addRecheckScopes(root, root, run.conflicts.map((c) => c.scope)) ? `-> ${RECHECK_FILE}` : `${RECHECK_FILE} already holds these scopes`);
      return 0;
    }
    case "baseline-report": {
      const source = openExistingReadOnlyDb(requireDbPath(flags, "baseline-report"));
      const baseline = readBaseline(source);
      source.close();
      if (!baseline.units.size && !baseline.quests.size) throw new Error("baseline-report: no pfquest-classic rows in this database; run import-pfquest first");
      const corpus = await readCorpusRecords(["npc_sighting", "quest", "vendor", "loot"]);
      if (!corpus) console.error("uploads not connected or unreadable (EVERLOOT_PUBLIC_CORPUS_URL, EVERLOOT_UPLOADS): comparing against no uploads");
      const records = corpus?.records ?? [];
      const zoneNames = new Map([...WORLD_MAP_DATA.zones, ...WORLD_MAP_DATA.heldBackZones].map((z) => [z.uiMapId, z.name]));
      const report = compareBaseline(baseline, {
        world: worldFactsFromRecords(records), drops: rollupDrops(lootWindowsFromRecords(records)).rates,
        objects: objectSpawnRowsFromRecords(records), dataAsOf: corpus?.dataAsOf ?? null, connected: corpus !== null,
      }, zoneNames);
      const paths = writeBaselineReport(report, flags.get("out") || join(tmpdir(), "everloot-baseline-report"));
      console.log(`${records.length} upload records read`);
      for (const [subject, c] of Object.entries(report.counts)) {
        console.log(`${subject}: ${c.confirmed} confirmed, ${c.changed} changed, ${c.new} new in Forever, ${c.not_seen} not seen yet`);
      }
      console.log(`-> ${paths.markdown}\n-> ${paths.json}`);
      return 0;
    }
    case "open-data": {
      if (!args[0]) break;
      const file = flags.get("records");
      const corpus = file ? readRecordsFile(file) : await readCorpusRecords(OPEN_DATA_KINDS);
      // No records is not an empty export: a folder that says nothing was confirmed would be a false statement.
      if (!corpus) throw new Error("open-data: no records. Set EVERLOOT_PUBLIC_CORPUS_URL (and EVERLOOT_API_KEY for the whole feed) or EVERLOOT_UPLOADS, or pass --records <file>");
      const { manifest, paths } = writeOpenData(args[0], {
        records: corpus.records, dataAsOf: corpus.dataAsOf, generatedAt: new Date().toISOString(),
        gameFiles: { build: CLIENT_LAYER.build, edges: CLIENT_EDGES, taxonomy: CLIENT_TAXONOMY, map: WORLD_MAP_DATA },
      });
      for (const f of manifest.files) console.log(`${f.path}: ${f.rows} rows${f.candidates === null ? "" : ` of ${f.candidates} (${f.candidatesAre})`}`);
      console.log(`${manifest.source.records} records from ${manifest.source.installs} installs; data as of ${manifest.dataAsOf ?? "[?]"}; game build ${manifest.gameFiles.version}`);
      console.log(`${paths.length} files -> ${args[0]}`);
      return 0;
    }
    case "wiki-check": {
      const dir = flags.get("dir") || WIKI_DIR;
      const result = checkWiki(readWikiPages(dir), { categories: loadCategories(dir), known: loadKnownData(), privatePaths: loadPrivatePathPattern() });
      for (const p of result.problems) console.error(`${p.file}${p.line ? `:${p.line}` : ""}: ${p.message}`);
      const published = result.pages.filter((p) => p.fm.status === "published").length;
      console.log(`${result.pages.length} pages (${published} published, ${result.pages.length - published} draft), ${result.problems.length} problems`);
      console.log("checked against the game files: items, zones, entrances, item sets, /changes entries; npc, quest, faction, race, class, event and LFG dungeon ids by shape and shown range only");
      return result.problems.length ? 1 : 0;
    }
    case "news-check": {
      const dir = flags.get("dir") || NEWS_DIR;
      const result = checkNews(readNewsPosts(dir), { wikiPages: publishedWikiSlugs(), privatePaths: loadPrivatePathPattern(), today: new Date().toISOString().slice(0, 10) });
      for (const p of result.problems) console.error(`${p.file}${p.line ? `:${p.line}` : ""}: ${p.message}`);
      const published = result.posts.filter((p) => p.fm.status === "published").length;
      console.log(`${result.posts.length} posts (${published} published, ${result.posts.length - published} draft), ${result.problems.length} problems`);
      return result.problems.length ? 1 : 0;
    }
    case "guide-check": {
      const dir = flags.get("dir") || GUIDES_DIR;
      const previousDir = flags.get("previous");
      // Comparing with a folder that is not there would let any change to a published guide through.
      if (previousDir !== undefined && !(previousDir && statSync(previousDir, { throwIfNoEntry: false })?.isDirectory())) {
        throw new Error(`guide-check: --previous ${previousDir ? `${previousDir} is not a folder` : "needs a folder"}; nothing was checked`);
      }
      const previous = previousDir === undefined ? undefined : readGuideFiles(previousDir);
      const result = checkGuides(readGuideFiles(dir), { ...loadGuideCheckContext(), ...(previous ? { previous } : {}) });
      for (const p of result.problems) console.error(`${p.file}${p.line ? `:${p.line}` : ""}: ${p.message}`);
      const published = result.guides.filter((g) => g.fm.status === "published").length;
      console.log(`${result.guides.length} guides (${published} published, ${result.guides.length - published} draft), ${result.problems.length} problems`);
      console.log(previous ? `compared with ${previous.length} guides from before the change` : "not compared with the guides from before the change; pass --previous for that");
      return result.problems.length ? 1 : 0;
    }
    case "snapshot":
      if (!args[0]) break;
      console.log(JSON.stringify(snapshot(openDb(requireExistingDbPath(flags, "snapshot")), args[0]), null, 2));
      return 0;
  }
  console.error(USAGE);
  return 1;
}

main().then(
  (code) => process.exit(code),
  (e: Error) => {
    console.error(e.message);
    process.exit(1);
  },
);
