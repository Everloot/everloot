import { completable } from "@modelcontextprotocol/sdk/server/completable.js";
import { answerCoverage, type CoverageLoader, type SettledSummaryLoader } from "./coverage-tool.js";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CREDIT_LINE, GAME_DATA_CREDIT, LICENCE, MCP_CREDIT, SITE, type EntityKind } from "@everloot/protocol";
import { answerSources, answerSourcesFactsFromRecords, formatAnswerSources, type AnswerSourcesFacts } from "./answer-sources.js";
import type { RecheckScope } from "./coverage.js";
import { auctionHistory, auctionSightingsFromRecords, handleAuctionHistory } from "./auction-history.js";
import { handlePlan, planStructured } from "./bridge-plan.js";
import { handleRecentChanges, recentChangesStructured, type ChangeEntry } from "./changes.js";
import { ecosystemProjectsStructured, handleEcosystemProjects, type EcosystemView } from "./ecosystem.js";
import { collectionFactsFromRecords, collectionGap, handleCollectionGap } from "./collection-gap.js";
import { completionProgress, handleCompletionProgress, type CompletionFacts } from "./completion.js";
import { goldFactsFromRecords, goldLedger, handleGoldLedger } from "./gold-ledger.js";
import { guildBoard, guildFactsFromRecords, handleGuildBoard } from "./guild-board.js";
import { formatGuildPage, formatGuildSearch, formatLadder, guildLadder, guildPageOut, ladderOut, summaryOut, type GuildReader } from "./guilds.js";
import { itemFactsFromRecords } from "./drop-rollup.js";
import { formatItemPage, itemPage } from "./item-page.js";
import { formatItemNumbers, itemToolFactsFromRecords } from "./item-page-tool.js";
import { reportedItemFacts } from "./item-facts.js";
import { formatObjectPage, objectFactsFromRecords, objectPage, type ObjectFacts } from "./object-page.js";
import { handleMarketValue, itemMarket, type MarketState } from "./market.js";
import { loadUploadRecords } from "./load-uploads.js";
import { KNOWLEDGE_KINDS, MCP_PROMPT_NAMES, MCP_PROMPTS, MCP_RESOURCE_TEMPLATE_URIS, MCP_RESOURCE_TEMPLATES, MCP_RESOURCE_URIS, MCP_RESOURCES, MCP_TOOL_NAMES, MCP_TOOLS, parseRecords, type McpToolArgs, type McpToolDef, type McpToolName } from "@everloot/protocol";
import { z } from "zod";
import { formatProfessionPath, professionPath } from "./profession-path.js";
import { promptText } from "./prompts.js";
import { answerPopulation, type CensusLoader } from "./population.js";
import { readResource } from "./resources.js";
import { handleTalentPlan, handleTalentTree } from "./talent-tools.js";
import { handleRecipeThresholds, pathFactsFromRecords, recipeFactsFromRecords, recipeThresholdsStructured } from "./recipe-thresholds.js";
import { formatNpcPage, formatQuestPage, formatVendorPage, npcFactsFromRecords, npcPage, questPage, vendorPage, worldFactsFromRecords } from "./world-pages.js";
import { handleWorldMapNear, mapFactsFromRecords, nearResult, nearZoneSpot } from "./world-map-near.js";
import { WORLD_MAP_DATA } from "./world-map-file.js";
import { CLIENT_EDGES, CLIENT_LAYER, CLIENT_TAXONOMY } from "./client-layer-file.js";
import { categoryOf, handleItemCategories, itemCategoriesStructured } from "./item-taxonomy.js";
import { entityRelationsStructured, handleEntityRelations, observedEdgesFromRecords, type Edge } from "./edges.js";
import type { DB } from "./db.js";
import { recordUrl } from "./lore-slug.js";
import {
  changesUrl, collectionsUrl, ECOSYSTEM_URL, goldLedgerUrl, guildBoardUrl, guildPageUrl, guildsUrl, itemPageUrl, ITEMS_URL, loreUrls, mapSpotUrl, marketItemUrl,
  npcPageUrl, npcUrl, objectPageUrl, professionsUrl, questPageUrl, vendorPageUrl, withMore,
} from "./page-urls.js";
import { getByName, getDocument, getEntity, search, searchSomeWords, SOME_WORDS, type SearchHit } from "./search.js";

export const SERVER_NAME = "everloot-knowledge";
export const SERVER_VERSION = "0.8.0";
/** The source this server runs, offered to every client (AGPL section 13). */
export const SOURCE_URL = "https://github.com/Everloot/everloot";
/** One line a client shows beside the server's name in its list of servers. */
export const SERVER_DESCRIPTION = "WoW: Forever knowledge from player reports and game files, with sources, under CC BY-SA 4.0.";
/** The site's icon, for clients that draw one beside the server. */
export const SERVER_ICONS = [
  { src: `${SITE}/icon-64.png`, mimeType: "image/png", sizes: ["64x64"] },
  { src: `${SITE}/icon-512.png`, mimeType: "image/png", sizes: ["512x512"] },
];

/** Sent to every client on connect: how to credit what the tools return. */
export const SERVER_INSTRUCTIONS =
  `Everloot answers questions about WoW: Forever. Facts built on player uploads are Everloot's data under ${LICENCE}: ` +
  `when you show them, credit "${CREDIT_LINE}" or link ${SITE}. Lore hits carry their own source and licence; keep them with the text. ` +
  "Game-file facts and Blizzard's posts stay Blizzard's.";

export const UPLOADS_UNSET =
  "Uploads are not connected. Neither EVERLOOT_PUBLIC_CORPUS_URL nor EVERLOOT_UPLOADS is set, so this is not a measured zero.";

/** Record kinds each gameplay tool reads. tool-kinds.test.ts checks them against the fact functions. */
export const TOOL_KINDS = {
  answer_sources: ["loot", "item_seen", "npc_sighting", "quest", "vendor", "object_sighting"],
  profession_path: ["recipe_seen", "price_seen", "auction_scan", "item_seen", "recipe_observed", "trainer_seen", "vendor"],
  recipe_thresholds: ["recipe_observed", "price_seen", "auction_scan", "item_seen", "vendor"],
  item_page: ["loot", "item_seen", "npc_sighting", "object_sighting", "item_fact"],
  npc_page: ["npc_sighting", "quest", "vendor", "loot"],
  object_page: ["loot", "item_seen", "object_sighting"],
  quest_page: ["npc_sighting", "quest", "vendor"],
  vendor_page: ["npc_sighting", "quest", "vendor"],
  world_map_near: ["npc_sighting", "vendor", "instance_entrance", "object_sighting"],
  entity_relations: ["loot", "vendor", "quest", "npc_sighting", "object_sighting"],
  collection_gap: ["collection_catalog", "collection_owned"],
  guild_board: ["guild_snapshot", "raid_lockout", "attendance", "loot_award", "gear_snapshot"],
  auction_history: ["auction_scan"],
  gold_ledger: ["gold_snapshot", "money_event"],
} as const satisfies Record<string, readonly string[]>;

export type ToolName = keyof typeof TOOL_KINDS;

/**
 * Facts each gameplay tool aggregates from its kinds. tool-kinds.test.ts keeps an
 * independent copy of this mapping and checks the kinds against the fact functions,
 * so a wrong entry here still fails there.
 */
const TOOL_FACT_BUILDERS: Record<ToolName, (records: unknown[], recheck: readonly RecheckScope[]) => unknown> = {
  answer_sources: answerSourcesFactsFromRecords,
  profession_path: pathFactsFromRecords,
  recipe_thresholds: recipeFactsFromRecords,
  item_page: itemToolFactsFromRecords,
  npc_page: npcFactsFromRecords,
  object_page: objectFactsFromRecords,
  quest_page: worldFactsFromRecords,
  vendor_page: worldFactsFromRecords,
  world_map_near: mapFactsFromRecords,
  entity_relations: observedEdgesFromRecords,
  collection_gap: collectionFactsFromRecords,
  guild_board: guildFactsFromRecords,
  auction_history: auctionSightingsFromRecords,
  gold_ledger: goldFactsFromRecords,
};

interface TooledMemo {
  key: string;
  byTool: Map<string, unknown>;
}

/**
 * One fact set per tool per corpus version, shared by every answer. Each gameplay
 * tool used to filter and aggregate the whole corpus on every call; beta traffic
 * would pay that scan ten times over. The shared references are read-only: handlers
 * filter, map and copy over them, never sort or push in place.
 */
let tooledMemo: TooledMemo | null = null;

/**
 * Corpus version marker with its source. Snapshot time plus record count move
 * whenever the store reloads, so a matching key means these facts are for this
 * exact corpus. The source stays in the key so a remote corpus can never share a
 * local one's facts at the same version marker.
 */
function tooledKey(
  source: string,
  corpus: { records: readonly unknown[]; dataAsOf?: string | null },
  recheck: readonly RecheckScope[],
): string {
  const scopes = recheck
    .map((s) => `${s.since}|${s.type ?? ""}|${s.zones?.join(",") ?? ""}|${s.ids?.join(",") ?? ""}`)
    .sort()
    .join(";");
  return `${source}|${corpus.dataAsOf ?? ""}|${corpus.records.length}|${scopes}`;
}

function tooledFacts<T>(
  source: string,
  corpus: { records: readonly unknown[]; dataAsOf?: string | null },
  tool: ToolName,
  recheck: readonly RecheckScope[] = [],
): T {
  const key = tooledKey(source, corpus, recheck);
  if (!tooledMemo || tooledMemo.key !== key) tooledMemo = { key, byTool: new Map() };
  let facts = tooledMemo.byTool.get(tool) as T | undefined;
  if (facts === undefined) {
    const wanted = new Set<string>(TOOL_KINDS[tool]);
    const build = TOOL_FACT_BUILDERS[tool] as (records: unknown[], scopes: readonly RecheckScope[]) => T;
    facts = build(corpus.records.filter((r) => wanted.has((r as { kind?: string }).kind ?? "")), recheck);
    tooledMemo.byTool.set(tool, facts);
  }
  return facts;
}

/**
 * The site's own public records, read in process. The /mcp route on the web deployment passes one, so
 * gameplay answers skip the HTTP self-fetch and its byte ceiling. Null means the store was unreadable.
 */
export type CorpusLoader = () => Promise<{ records: unknown[]; dataAsOf?: string | null } | null>;

const UNAVAILABLE = "Public corpus unavailable. These figures are unrecorded, not zero.";

/** The site's market rollup, read in process by the web /mcp routes. Null means it was unreadable. */
export type MarketLoader = () => Promise<{ state: MarketState; dataAsOf: string | null } | null>;

export const MARKET_UNSET =
  "Market values are not connected to this server, so this is not a measured zero. They are on everloot.app/tools/auctions and its MCP.";

/** The site's completion rollup with owned progress already limited to granted installs. Null means it was unreadable. */
export type CompletionLoader = (ownerInstallId: string) => Promise<{ facts: CompletionFacts; dataAsOf: string | null } | null>;

export const COMPLETION_UNSET =
  "Completion progress is not connected to this server, so this is not a measured zero. It is on everloot.app/tools/collections and its MCP.";

/** The structured answer when nothing was read: not connected or unavailable, never an empty page. */
const notRead = (reason: string): StructuredAnswer => ({ text: reason, structured: { connected: false, dataAsOf: null, reason } });

/** completion_progress: the agreed lists and one install's own progress (kb/src/completion-rollup.ts). */
export async function completionProgressAnswer(args: { ownerInstallId: string; characterKey?: string }, loader?: CompletionLoader): Promise<StructuredAnswer> {
  if (!loader) return notRead(COMPLETION_UNSET);
  let loaded: Awaited<ReturnType<CompletionLoader>>;
  try {
    loaded = await loader(args.ownerInstallId.trim());
  } catch {
    loaded = null;
  }
  if (!loaded) return notRead("Completion progress unavailable. It is unrecorded, not zero.");
  const page = completionProgress(args.ownerInstallId, args.characterKey, loaded.facts);
  const shown = page.ownedRecorded && page.characters.length > 0 && !page.unknownCharacter;
  const url = shown ? collectionsUrl({ install: args.ownerInstallId, character: args.characterKey }) : undefined;
  return {
    text: `${withMore(handleCompletionProgress(args, loaded.facts), url)}\n${dataAgeLine(loaded.dataAsOf)}`,
    structured: { connected: true, dataAsOf: loaded.dataAsOf, ...(url ? { url } : {}), page },
  };
}

export async function answerCompletionProgress(args: { ownerInstallId: string; characterKey?: string }, loader?: CompletionLoader): Promise<string> {
  return (await completionProgressAnswer(args, loader)).text;
}

/** market_value: Forever market values from full scans (kb/src/market.ts). */
export async function marketValueAnswer(args: { realm: string; itemId: number }, loader?: MarketLoader): Promise<StructuredAnswer> {
  if (!loader) return notRead(MARKET_UNSET);
  let market: Awaited<ReturnType<MarketLoader>>;
  try {
    market = await loader();
  } catch {
    market = null;
  }
  if (!market) return notRead("Market values unavailable. They are unrecorded, not zero.");
  const now = new Date();
  const { value, points } = itemMarket(market.state, args.realm, args.itemId, now);
  const url = value || points.length ? marketItemUrl(args.realm, args.itemId) : undefined;
  return {
    text: `${withMore(handleMarketValue(args, market.state, now), url)}\n${answerFooter(market.dataAsOf)}`,
    structured: { connected: true, dataAsOf: market.dataAsOf, ...(url ? { url } : {}), page: { realm: args.realm.trim(), itemId: args.itemId, value, history: points } },
  };
}

export async function answerMarketValue(args: { realm: string; itemId: number }, loader?: MarketLoader): Promise<string> {
  return (await marketValueAnswer(args, loader)).text;
}

/** Prefer the web's sanitized current view; raw local files can supply anonymous facts only. */
export function fromUploads(
  render: (records: unknown[]) => string, kinds?: readonly string[], loader?: CorpusLoader,
): string | Promise<string> {
  if (loader) return fromLoader(loader, render, kinds);
  const base = process.env.EVERLOOT_PUBLIC_CORPUS_URL?.trim();
  // Asking for only the kinds a tool reads keeps the body under the byte ceiling for longer.
  const url = base && kinds ? `${base}${base.includes("?") ? "&" : "?"}kinds=${kinds.join(",")}` : base;
  if (url) return fromPublicCorpus(url, render);
  const dir = process.env.EVERLOOT_UPLOADS?.trim();
  if (!dir) return UPLOADS_UNSET;
  return render(loadUploadRecords(dir));
}

async function fromLoader(loader: CorpusLoader, render: (records: unknown[]) => string, kinds?: readonly string[]): Promise<string> {
  let corpus;
  try {
    corpus = await loader();
  } catch {
    return UNAVAILABLE;
  }
  if (!corpus) return UNAVAILABLE;
  const wanted = kinds ? new Set<string>(kinds) : null;
  const records = wanted ? corpus.records.filter((r) => wanted.has((r as { kind?: string }).kind ?? "")) : corpus.records;
  return `${render(records)}\n${answerFooter(corpus.dataAsOf)}`;
}

/** Pages a self-hosted server follows at most; with a key (EVERLOOT_API_KEY) a page holds far more records. */
const MAX_CORPUS_PAGES = 50;

/** A page from a newer snapshot than the first page: start again, the corpus moved on mid-read. */
class SnapshotMoved extends Error {}

/**
 * Every page of the feed at `url`. The site pages it when its data guard is on: follow `next`
 * within one byte ceiling. A `next` that cannot be followed (another origin, a bad URL), or a page
 * that fails, fails the whole read, so an answer is never built on part of the corpus.
 */
async function readCorpusPages(url: string, key: string | undefined): Promise<{ records: unknown[]; dataAsOf: unknown }> {
  const init: RequestInit = { cache: "no-store", ...(key ? { headers: { authorization: `Bearer ${key}` } } : {}) };
  const origin = new URL(url).origin;
  const records: unknown[] = [];
  let dataAsOf: unknown;
  let size = 0;
  let next: string | null = url;
  for (let page = 0; next; page++) {
    if (page >= MAX_CORPUS_PAGES) throw new Error("Public corpus has too many pages");
    const response = await fetch(next, { ...init, signal: AbortSignal.timeout(10_000) });
    if (!response.ok || Number(response.headers.get("content-length")) > 2_000_000) throw new Error("Public corpus too large or unavailable");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Public corpus has no body");
    const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 2_000_000) { await reader.cancel(); throw new Error("Public corpus too large"); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const corpus = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { ok?: boolean; records?: unknown; dataAsOf?: unknown; next?: unknown };
    if (corpus.ok !== true || !Array.isArray(corpus.records)) throw new Error("Invalid public corpus");
    if (page === 0) dataAsOf = corpus.dataAsOf;
    else if (corpus.dataAsOf !== dataAsOf) throw new SnapshotMoved("Public corpus changed while paging");
    records.push(...corpus.records);
    if (corpus.next === null || corpus.next === undefined) next = null;
    else if (typeof corpus.next === "string" && URL.canParse(corpus.next) && new URL(corpus.next).origin === origin) next = corpus.next;
    else throw new Error("Public corpus next link cannot be followed");
  }
  return { records, dataAsOf };
}

/** How long a read of the public corpus is reused. Zero (the default) reads it on every answer. */
let corpusCacheMs = 0;
const corpusCache = new Map<string, { at: number; corpus: { records: unknown[]; dataAsOf: unknown } }>();

/**
 * Reuse each public corpus read for `ms`. The stdio server sets this to the site's snapshot interval,
 * so a local server without a key does not page through the whole feed on every tool call.
 */
export function cachePublicCorpus(ms: number): void {
  corpusCacheMs = ms;
  corpusCache.clear();
}

async function fetchPublicCorpus(url: string): Promise<{ records: unknown[]; dataAsOf: unknown } | null> {
  const key = process.env.EVERLOOT_API_KEY?.trim();
  const cacheKey = `${key ? "key" : "anon"} ${url}`;
  const cached = corpusCache.get(cacheKey);
  if (cached && Date.now() - cached.at < corpusCacheMs) return cached.corpus;
  try {
    let read: { records: unknown[]; dataAsOf: unknown } | null = null;
    // One retry when the snapshot moved on mid-read; a second move fails rather than mixing snapshots.
    for (let attempt = 0; !read; attempt++) {
      try {
        read = await readCorpusPages(url, key);
      } catch (err) {
        if (!(err instanceof SnapshotMoved) || attempt >= 1) throw err;
      }
    }
    const parsed = parseRecords(read.records);
    if (parsed.receipt.rejected.length) throw new Error("Invalid public records");
    const corpus = { records: parsed.records, dataAsOf: read.dataAsOf };
    if (corpusCacheMs > 0) corpusCache.set(cacheKey, { at: Date.now(), corpus });
    return corpus;
  } catch { return null; }
}

async function fromPublicCorpus(url: string, render: (records: unknown[]) => string): Promise<string> {
  const corpus = await fetchPublicCorpus(url);
  if (!corpus) return UNAVAILABLE;
  return `${render(corpus.records)}\n${answerFooter(corpus.dataAsOf)}`;
}

async function answerFromTooledLoader<T>(
  loader: CorpusLoader, tool: ToolName, render: (facts: T) => string, recheck: readonly RecheckScope[] = [],
): Promise<string> {
  let corpus;
  try {
    corpus = await loader();
  } catch {
    return UNAVAILABLE;
  }
  if (!corpus) return UNAVAILABLE;
  return `${render(tooledFacts<T>("loader", corpus, tool, recheck))}\n${answerFooter(corpus.dataAsOf)}`;
}

async function answerFromTooledPublicCorpus<T>(
  url: string, tool: ToolName, render: (facts: T) => string, recheck: readonly RecheckScope[] = [],
): Promise<string> {
  const corpus = await fetchPublicCorpus(url);
  if (!corpus) return UNAVAILABLE;
  const dataAsOf = typeof corpus.dataAsOf === "string" ? corpus.dataAsOf : null;
  return `${render(tooledFacts<T>("url", { records: corpus.records, dataAsOf }, tool, recheck))}\n${answerFooter(corpus.dataAsOf)}`;
}

/**
 * Gameplay answers from pre-aggregated per-tool facts. Same sources as fromUploads
 * (in-process loader first, then the public URL with the tool's kinds, then local
 * files), but the facts build once per corpus version instead of on every call.
 * The local-files path is a version-less dev fallback and stays unmemoized.
 */
export function fromTooledUploads<T>(
  tool: ToolName, render: (facts: T) => string, loader?: CorpusLoader, recheck: readonly RecheckScope[] = [],
): string | Promise<string> {
  const kinds = TOOL_KINDS[tool];
  const build = TOOL_FACT_BUILDERS[tool] as (records: unknown[], scopes: readonly RecheckScope[]) => T;
  if (loader) return answerFromTooledLoader(loader, tool, render, recheck);
  const base = process.env.EVERLOOT_PUBLIC_CORPUS_URL?.trim();
  // Asking for only the kinds a tool reads keeps the body under the byte ceiling for longer.
  const url = base ? `${base}${base.includes("?") ? "&" : "?"}kinds=${kinds.join(",")}` : undefined;
  if (url) return answerFromTooledPublicCorpus(url, tool, render, recheck);
  const dir = process.env.EVERLOOT_UPLOADS?.trim();
  if (!dir) return UPLOADS_UNSET;
  return render(build(loadUploadRecords(dir), recheck));
}

/**
 * The facts one tool reads, with the corpus time, for a handler that renders more than text. Same
 * sources and memo as fromTooledUploads; null when no source is connected or readable.
 */
export async function readTooledFacts<T>(
  tool: ToolName, loader?: CorpusLoader, recheck: readonly RecheckScope[] = [],
): Promise<{ facts: T; dataAsOf: string | null } | null> {
  const build = TOOL_FACT_BUILDERS[tool] as (records: unknown[], scopes: readonly RecheckScope[]) => T;
  if (loader) {
    let corpus;
    try { corpus = await loader(); } catch { return null; }
    if (!corpus) return null;
    return { facts: tooledFacts<T>("loader", corpus, tool, recheck), dataAsOf: typeof corpus.dataAsOf === "string" ? corpus.dataAsOf : null };
  }
  const base = process.env.EVERLOOT_PUBLIC_CORPUS_URL?.trim();
  const url = base ? `${base}${base.includes("?") ? "&" : "?"}kinds=${TOOL_KINDS[tool].join(",")}` : undefined;
  if (url) {
    const corpus = await fetchPublicCorpus(url);
    if (!corpus) return null;
    const dataAsOf = typeof corpus.dataAsOf === "string" ? corpus.dataAsOf : null;
    return { facts: tooledFacts<T>("url", { records: corpus.records, dataAsOf }, tool, recheck), dataAsOf };
  }
  const dir = process.env.EVERLOOT_UPLOADS?.trim();
  if (!dir) return null;
  return { facts: build(loadUploadRecords(dir), recheck), dataAsOf: null };
}

/**
 * The public records of `kinds` and the corpus time, from the same sources as the tools (the public URL, then
 * local files), for a maintainer report. Null when no source is connected or the read failed.
 */
export async function readCorpusRecords(kinds: readonly string[]): Promise<{ records: unknown[]; dataAsOf: string | null } | null> {
  const base = process.env.EVERLOOT_PUBLIC_CORPUS_URL?.trim();
  if (base) {
    const corpus = await fetchPublicCorpus(`${base}${base.includes("?") ? "&" : "?"}kinds=${kinds.join(",")}`);
    return corpus ? { records: corpus.records, dataAsOf: typeof corpus.dataAsOf === "string" ? corpus.dataAsOf : null } : null;
  }
  const dir = process.env.EVERLOOT_UPLOADS?.trim();
  if (!dir) return null;
  const wanted = new Set(kinds);
  return { records: loadUploadRecords(dir).filter((r) => wanted.has((r as { kind?: string }).kind ?? "")), dataAsOf: null };
}

/** What ends every answer built on player data: how old the data is, and the credit line it carries. */
function answerFooter(dataAsOf: unknown): string {
  return `${dataAgeLine(dataAsOf)}\n${MCP_CREDIT}`;
}

/** The web's snapshot time; a stalled snapshot must not read as current. */
function dataAgeLine(dataAsOf: unknown): string {
  if (typeof dataAsOf !== "string" || !Number.isFinite(Date.parse(dataAsOf))) return "Data age unrecorded.";
  const iso = new Date(dataAsOf).toISOString();
  return `Data as of ${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC.`;
}

type SearchArgs = McpToolArgs<"search_knowledge">;

/** The hits, each with its page on the site when it has one the site indexes. */
function withPages(db: DB, hits: SearchHit[]): (SearchHit & { url?: string })[] {
  const urls = loreUrls(db, hits);
  return hits.map((h) => (urls.has(h.id) ? { ...h, url: urls.get(h.id)! } : h));
}

/** The hits as text, each with its page on the site when it has one. */
function formatHits(db: DB, hits: SearchHit[]): string {
  return withPages(db, hits).map((h) => withMore(`[${h.kind}/${h.gameVersion}] ${h.name}\n${h.snippet}\nSource: ${h.sourceUrl} (${h.licence}, retrieved ${h.retrievedAt})`, h.url)).join("\n\n");
}

export { SOME_WORDS };

/** The hits for every asked word, or, when no page has them all, the pages with some of them. */
function searchResult(db: DB, args: SearchArgs): { hits: SearchHit[]; some: boolean } {
  const opts = { kinds: args.kind ? [args.kind] : undefined, versions: args.version ? [args.version] : undefined };
  const hits = search(db, args.query, args.limit, opts);
  return hits.length ? { hits, some: false } : { hits: searchSomeWords(db, args.query, args.limit, opts), some: true };
}

/** Pure handlers — tested directly; the MCP registration below is a thin wrapper. */
export function searchHits(db: DB, args: SearchArgs): SearchHit[] {
  return searchResult(db, args).hits;
}

export function handleSearch(db: DB, args: SearchArgs): string {
  const { hits, some } = searchResult(db, args);
  if (hits.length === 0) return "No matches. Try fewer or different words.";
  return some ? `${SOME_WORDS}\n\n${formatHits(db, hits)}` : formatHits(db, hits);
}

/** A tool answer: the text every client gets, plus structured content for tools with an output schema. */
type Answer = string | StructuredAnswer;
type StructuredAnswer = { text: string; structured: object };

/** The values that begin with what the user typed so far, case-insensitive, in the table's order. */
function startingWith(values: readonly string[], typed: string): string[] {
  const prefix = typed.trim().toLowerCase();
  return values.filter((v) => v.startsWith(prefix));
}

/** The answer of a connector-contract tool (search, fetch): the structure, with the same JSON as the text block. */
function jsonAnswer(structured: object): StructuredAnswer {
  return { text: JSON.stringify(structured), structured };
}

export function handleGetEntity(db: DB, args: { id: number }): string {
  const hit = getEntity(db, args.id);
  return hit ? formatHits(db, [hit]) : `No record with id ${args.id}.`;
}

export function handleGetByName(db: DB, args: { name: string; kind?: (typeof KNOWLEDGE_KINDS)[number] }): string {
  const hits = getByName(db, args.name, args.kind);
  if (hits.length === 0) return `No record named exactly "${args.name}". Try search_knowledge for close matches.`;
  return formatHits(db, hits);
}

/** The merged blue-post and build timeline. Null means it is not connected, which is not the same as empty. */
export type ChangesLoader = () => ChangeEntry[] | null | Promise<ChangeEntry[] | null>;

/** The ecosystem tracker with install counts joined. Null means it is not connected, which is not the same as empty. */
export type EcosystemLoader = () => EcosystemView | null | Promise<EcosystemView | null>;

/** Whether any upload source is set at all: the difference between not connected and unavailable. */
function uploadsConfigured(loader?: CorpusLoader): boolean {
  return Boolean(loader || process.env.EVERLOOT_PUBLIC_CORPUS_URL?.trim() || process.env.EVERLOOT_UPLOADS?.trim());
}

/**
 * A page tool's answer: the text the tool always gave, with the data's age and the credit, plus the page
 * as structured content under the protocol's uploadsAnswer envelope. With no corpus read, the text says
 * so as before and the structure carries connected false and the reason, never an empty page.
 */
export async function readPage<T>(
  tool: ToolName, loader: CorpusLoader | undefined,
  page: (facts: T, dataAsOf: string | null) => { text: string; page: object; url?: string },
  recheck: readonly RecheckScope[] = [],
): Promise<StructuredAnswer> {
  const read = await readTooledFacts<T>(tool, loader, recheck);
  if (!read) {
    const reason = uploadsConfigured(loader) ? UNAVAILABLE : UPLOADS_UNSET;
    return { text: reason, structured: { connected: false, dataAsOf: null, reason } };
  }
  const built = page(read.facts, read.dataAsOf);
  return {
    text: `${withMore(built.text, built.url)}\n${answerFooter(read.dataAsOf)}`,
    structured: { connected: true, dataAsOf: read.dataAsOf, ...(built.url ? { url: built.url } : {}), page: built.page },
  };
}

/** Whether the committed game-file layer lists the item: its page then shows the item's class, type, slot and quality. */
const inGameFiles = (itemId: number): boolean => categoryOf(CLIENT_TAXONOMY, itemId) !== null;

/** The page of an entity entity_relations was asked about, when the site has one with something on it. */
async function entityPageUrl(
  kind: EntityKind, id: number, loader?: CorpusLoader, recheck: readonly RecheckScope[] = [],
): Promise<string | undefined> {
  if (kind === "item") {
    const read = await readTooledFacts<ReturnType<typeof itemFactsFromRecords>>("item_page", loader, recheck);
    return read ? itemPageUrl(itemPage(id, read.facts), inGameFiles(id)) : undefined;
  }
  if (kind === "object") {
    const read = await readTooledFacts<ObjectFacts>("object_page", loader, recheck);
    return read ? objectPageUrl(objectPage(id, read.facts)) : undefined;
  }
  if (kind === "npc" || kind === "quest") {
    const read = await readTooledFacts<ReturnType<typeof worldFactsFromRecords>>(kind === "npc" ? "npc_page" : "quest_page", loader, recheck);
    if (!read) return undefined;
    return kind === "npc" ? npcPageUrl(npcPage(id, read.facts)) : questPageUrl(questPage(id, read.facts));
  }
  return undefined;
}

/** A blank profession is refused before any read: an error, not a connected page about no profession. */
function professionArg(profession: string): string {
  const trimmed = profession.trim();
  if (!trimmed) throw new Error("Name a profession.");
  return trimmed;
}

/** The readers a host lends the tools: the site's store in process, or nothing for a standalone server. */
export interface ToolOptions { corpus?: CorpusLoader; market?: MarketLoader; completion?: CompletionLoader; changes?: ChangesLoader; ecosystem?: EcosystemLoader; census?: CensusLoader; coverage?: CoverageLoader; settledSummary?: SettledSummaryLoader; guilds?: GuildReader; recheck?: readonly RecheckScope[] }

/** The guild ladder's tools: registered only when the host lends a guild reader (EVERLOOT_GUILDS on the site). */
export const GUILD_TOOLS: readonly McpToolName[] = ["guild_search", "guild_rankings"];

/** The protocol's tools this host answers: every one, less the guild ladder's without a guild reader. */
export function registeredToolNames(options: Pick<ToolOptions, "guilds"> = {}): McpToolName[] {
  return MCP_TOOL_NAMES.filter((name) => options.guilds || !GUILD_TOOLS.includes(name));
}

const GUILDS_OFF = "Guild pages are not on for this server.";
const GUILDS_UNREAD = "Guild data unavailable. It is unrecorded, not zero.";
const GUILD_HIDDEN = "This guild asked to be hidden. Nothing about it is shown.";

/** A tool's answer: the text every client gets, and the structured content of the tool's output schema. */
export type ToolAnswer = Answer;
export type ToolHandlers = { [K in McpToolName]: (args: McpToolArgs<K>) => ToolAnswer | Promise<ToolAnswer> };

/**
 * One handler per tool, typed by the protocol's input shape. The MCP registration in
 * createKnowledgeServer and the site's GET /api/tools/{tool} are both thin wrappers over these, so
 * a tool answers the same over MCP and over plain HTTP.
 */
export function createToolHandlers(db: DB, options: ToolOptions = {}): ToolHandlers {
  const recheck = options.recheck ?? [];
  const readPageIn = <T>(tool: ToolName, page: (facts: T, dataAsOf: string | null) => { text: string; page: object; url?: string }) =>
    readPage<T>(tool, options.corpus, page, recheck);
  const readFacts = <T>(tool: ToolName, render: (facts: T) => string) => fromTooledUploads(tool, render, options.corpus, recheck);
  const handlers: ToolHandlers = {
    search_knowledge: (args) => ({ text: handleSearch(db, args), structured: { hits: withPages(db, searchHits(db, args)) } }),
    get_entity: (args) => {
      const hit = getEntity(db, args.id);
      return { text: handleGetEntity(db, args), structured: { hit: hit ? withPages(db, [hit])[0]! : null } };
    },
    get_by_name: (args) => ({ text: handleGetByName(db, args), structured: { hits: withPages(db, getByName(db, args.name, args.kind)) } }),
    search: (args) => jsonAnswer({
      results: searchHits(db, { query: args.query, limit: 10 }).map((h) => ({ id: String(h.id), title: h.name, url: recordUrl(h, SITE) })),
    }),
    fetch: (args) => {
      const doc = /^\d{1,15}$/.test(args.id) ? getDocument(db, Number(args.id)) : undefined;
      if (!doc) throw new Error(`No record with id "${args.id}". Ids come from search results.`);
      return jsonAnswer({
        id: String(doc.id), title: doc.name, text: doc.body, url: recordUrl(doc, SITE),
        metadata: { kind: doc.kind, gameVersion: doc.gameVersion, sourceUrl: doc.sourceUrl, sourceId: doc.sourceId, licence: doc.licence, retrievedAt: doc.retrievedAt, credit: CREDIT_LINE },
      });
    },
    answer_sources: async (args) => {
      const read = await readTooledFacts<AnswerSourcesFacts>("answer_sources", options.corpus, recheck);
      const result = answerSources(db, args, read?.facts ?? null, read?.dataAsOf ?? null);
      // The fallback is said in the text; the structured answer keeps its published shape.
      const { someWords: _someWords, ...structured } = result;
      return { text: `${formatAnswerSources(result, read !== null)}\n${read ? answerFooter(read.dataAsOf) : MCP_CREDIT}`, structured };
    },
    profession_path: (args) => {
      // The same defaults the text handler applies: from 1, to the start when no end is given.
      const query = { profession: professionArg(args.profession), fromSkill: args.fromSkill ?? 1, toSkill: args.toSkill ?? args.fromSkill ?? 1 };
      return readPageIn("profession_path", (facts: ReturnType<typeof pathFactsFromRecords>) => {
        const page = professionPath(facts.sightings, facts.prices, query, facts.derived, facts.vendorPrices);
        const url = page.steps.length ? professionsUrl(query.profession, query.fromSkill, query.toSkill) : undefined;
        return { text: formatProfessionPath(page), page, url };
      });
    },
    recipe_thresholds: (args) => {
      const profession = professionArg(args.profession);
      return readPageIn("recipe_thresholds", (facts: ReturnType<typeof recipeFactsFromRecords>) => {
        const page = recipeThresholdsStructured(args, facts.observations, facts.prices, facts.vendorPrices);
        return {
          text: handleRecipeThresholds(args, facts.observations, facts.prices, facts.vendorPrices),
          page,
          url: page.ranges.length ? professionsUrl(profession) : undefined,
        };
      });
    },
    item_page: async (args) => {
      const answer = await readPageIn("item_page", (facts: ReturnType<typeof itemToolFactsFromRecords>, dataAsOf) => {
        const reported = reportedItemFacts(facts.numbers.get(args.itemId), new Date(dataAsOf ?? NaN));
        const page = { ...itemPage(args.itemId, facts), reported };
        return { text: `${formatItemPage(page)}\n${formatItemNumbers(reported)}\nItem-number data as of ${dataAsOf ?? "[?]"}.`, page, url: itemPageUrl(page, inGameFiles(page.itemId)) };
      });
      if ("connected" in answer.structured && !answer.structured.connected) answer.text += "\nItem numbers: [?]; no corpus read. Agreeing installs [?], last seen [?], build [?], data as of [?].";
      return answer;
    },
    npc_page: (args) => readPageIn("npc_page", (facts: ReturnType<typeof worldFactsFromRecords>) => {
      const page = npcPage(args.npcId, facts);
      return { text: formatNpcPage(page), page, url: npcPageUrl(page) };
    }),
    object_page: (args) => readPageIn("object_page", (facts: ObjectFacts) => {
      const page = objectPage(args.objectId, facts);
      return { text: formatObjectPage(page), page, url: objectPageUrl(page) };
    }),
    quest_page: (args) => readPageIn("quest_page", (facts: ReturnType<typeof worldFactsFromRecords>) => {
      const page = questPage(args.questId, facts);
      return { text: formatQuestPage(page), page, url: questPageUrl(page) };
    }),
    vendor_page: (args) => readPageIn("vendor_page", (facts: ReturnType<typeof worldFactsFromRecords>) => {
      const page = vendorPage(args.vendorNpcId, facts);
      return { text: formatVendorPage(page), page, url: vendorPageUrl(page) };
    }),
    world_map_near: (args) => readPageIn("world_map_near", (facts: ReturnType<typeof mapFactsFromRecords>) => {
      const page = nearResult(args, WORLD_MAP_DATA, facts);
      // An answer from an NPC links that NPC's page (it has an agreed pin); one from a spot, the map there.
      const spot = page.ok && args.npcId === undefined ? nearZoneSpot(args, WORLD_MAP_DATA) : null;
      const url = !page.ok ? undefined : args.npcId !== undefined ? npcUrl(args.npcId) : spot ? mapSpotUrl(spot.mapId, spot.x, spot.y) : undefined;
      return { text: handleWorldMapNear(args, WORLD_MAP_DATA, facts), page, url };
    }),
    entity_relations: async (args) => {
      const url = await entityPageUrl(args.kind, args.id, options.corpus, recheck);
      return readPageIn("entity_relations", (observed: Edge[]) => ({
        text: handleEntityRelations(args, observed, CLIENT_EDGES),
        page: entityRelationsStructured(args, observed, CLIENT_EDGES),
        url,
      }));
    },
    item_categories: (args) => {
      const structured = itemCategoriesStructured(args, CLIENT_TAXONOMY, CLIENT_LAYER.build.version) as { error?: string; item?: unknown };
      // The database's item index, unless the class or item asked for is not in the build.
      const url = structured.error || structured.item === null ? undefined : ITEMS_URL;
      return {
        text: withMore(handleItemCategories(args, CLIENT_TAXONOMY, CLIENT_LAYER.build.version), url, GAME_DATA_CREDIT),
        structured: { ...structured, ...(url ? { url } : {}) },
      };
    },
    talent_tree: (args) => handleTalentTree(args),
    talent_plan: (args) => handleTalentPlan(args),
    collection_gap: (args) => readPageIn("collection_gap", (facts: ReturnType<typeof collectionFactsFromRecords>) => {
      const page = collectionGap(args.collection, args.ownerInstallId, facts);
      const url = page.groups.length ? collectionsUrl({ collection: args.collection, install: args.ownerInstallId }) : undefined;
      return { text: handleCollectionGap(args, facts), page, url };
    }),
    completion_progress: (args) => completionProgressAnswer(args, options.completion),
    guild_board: async (args) => {
      // The ladder side (members' kills, sightings, ranks) only when the host lends a guild reader. With one, the hide
      // list is authoritative: a hidden guild answers nothing, the officers' board included, and a reader that cannot
      // tell (the hide list unreadable) withholds the answer rather than show a guild that may be hidden.
      let ladder: Awaited<ReturnType<GuildReader["page"]>> = null;
      if (options.guilds) {
        try { ladder = await options.guilds.page(args.guildName, args.realm); } catch { ladder = null; }
        if (!ladder) return notRead(GUILDS_UNREAD);
        if (ladder.hidden) return { text: GUILD_HIDDEN, structured: { connected: true, dataAsOf: ladder.dataAsOf } };
      }
      const guildPage = ladder?.page ?? null;
      return readPageIn("guild_board", (facts: ReturnType<typeof guildFactsFromRecords>) => {
        const page = guildBoard(args.guildName, args.realm, facts);
        const published = page.roster.length || page.progression.length || page.loot.length;
        const text = handleGuildBoard(args, facts);
        if (!guildPage) {
          return { text, page, url: published ? guildBoardUrl(page.guildName, page.realm) : undefined };
        }
        return {
          text: `${text}\n\n${formatGuildPage(guildPage)}`,
          page: { ...page, ...guildPageOut(guildPage) },
          url: guildPageUrl(guildPage.summary.realm, guildPage.summary.guildName),
        };
      });
    },
    guild_search: async (args) => {
      if (!options.guilds) return notRead(GUILDS_OFF);
      let read: Awaited<ReturnType<GuildReader["search"]>>;
      try { read = await options.guilds.search(args.query, args.limit ?? 10); } catch { read = null; }
      if (!read) return notRead(GUILDS_UNREAD);
      const url = read.guilds.length ? guildsUrl({ q: args.query }) : undefined;
      return {
        text: `${withMore(formatGuildSearch(read.guilds, args.query), url)}\n${answerFooter(read.dataAsOf)}`,
        structured: { connected: true, dataAsOf: read.dataAsOf, ...(url ? { url } : {}), page: { guilds: read.guilds.map(summaryOut) } },
      };
    },
    guild_rankings: async (args) => {
      if (!options.guilds) return notRead(GUILDS_OFF);
      let read: Awaited<ReturnType<GuildReader["ladder"]>>;
      try { read = await options.guilds.ladder(); } catch { read = null; }
      if (!read) return notRead(GUILDS_UNREAD);
      const ranked = new Set(read.progress.filter((p) => p.killed > 0).map((p) => p.instanceMapId));
      const candidates = read.instances.filter((i) => ranked.has(i.instanceMapId));
      // Without an instance, the newest raid with a kill; a dungeon only when no raid has one.
      const instance = args.instanceMapId !== undefined
        ? candidates.find((i) => i.instanceMapId === args.instanceMapId) ?? null
        : [...candidates].sort((a, b) => b.tier - a.tier)[0] ?? null;
      const filter = { ...(args.realm?.trim() ? { realm: args.realm.trim() } : {}), ...(args.faction ? { faction: args.faction } : {}) };
      const rows = instance ? guildLadder(read.progress, instance.instanceMapId, filter).slice(0, args.limit ?? 20) : [];
      const url = instance ? guildsUrl({ instance: instance.instanceMapId, realm: filter.realm, faction: filter.faction }) : undefined;
      const text = args.instanceMapId !== undefined && !instance
        ? `No agreed kill in instance ${args.instanceMapId} yet.`
        : formatLadder(rows, instance, filter);
      return {
        text: `${withMore(text, url)}\n${answerFooter(read.dataAsOf)}`,
        structured: {
          connected: true, dataAsOf: read.dataAsOf, ...(url ? { url } : {}),
          page: { instance: instance ? { instanceMapId: instance.instanceMapId, name: instance.name } : null, rows: rows.map(ladderOut) },
        },
      };
    },
    auction_history: (args) => readPageIn("auction_history", (facts: ReturnType<typeof auctionSightingsFromRecords>) => {
      const page = auctionHistory(args.realm, args.itemId, facts);
      return { text: handleAuctionHistory(args, facts), page, url: page.points.length ? marketItemUrl(args.realm, args.itemId) : undefined };
    }),
    market_value: (args) => marketValueAnswer(args, options.market),
    gold_ledger: (args) => readPageIn("gold_ledger", (facts: ReturnType<typeof goldFactsFromRecords>) => {
      const page = goldLedger(args.character, args.realm, facts.snapshots, facts.events);
      return {
        text: handleGoldLedger(args, facts.snapshots, facts.events),
        page,
        url: page.recorded ? goldLedgerUrl(page.character, page.realm) : undefined,
      };
    }),
    recent_changes: async (args) => {
      let entries: ChangeEntry[] | null = null;
      try { entries = (await options.changes?.()) ?? null; } catch { entries = null; }
      const structured = recentChangesStructured(entries, args);
      const url = structured.entries.length ? changesUrl(args.filter ?? "all", args.game) : undefined;
      return { text: withMore(handleRecentChanges(entries, args), url), structured: { ...structured, ...(url ? { url } : {}) } };
    },
    ecosystem_projects: async (args) => {
      let view: EcosystemView | null = null;
      try { view = (await options.ecosystem?.()) ?? null; } catch { view = null; }
      const now = new Date();
      const url = view ? ECOSYSTEM_URL : undefined;
      return { text: withMore(handleEcosystemProjects(view, args, now), url), structured: { ...ecosystemProjectsStructured(view, args, now), ...(url ? { url } : {}) } };
    },
    coverage: (args) => answerCoverage(args, options.coverage, options.settledSummary),
    population: (args) => answerPopulation(args, options.census, answerFooter),
    everloot_plan: () => ({ text: handlePlan(), structured: planStructured() }),
  };
  void readFacts;
  return handlers;
}

/**
 * A tool the host adds for one request only, outside the protocol's table: the site's account tools, which read a
 * player's own data with their key. A server made without any lists exactly MCP_TOOL_NAMES.
 */
export interface ExtraTool { name: string; def: McpToolDef; handler: (args: unknown) => ToolAnswer | Promise<ToolAnswer> }

export function createKnowledgeServer(db: DB, options: ToolOptions = {}, extraTools: readonly ExtraTool[] = []): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, title: "Everloot", version: SERVER_VERSION, description: SERVER_DESCRIPTION, websiteUrl: SOURCE_URL, icons: SERVER_ICONS },
    { instructions: SERVER_INSTRUCTIONS },
  );
  const handlers = createToolHandlers(db, options);
  const register = (name: string, def: McpToolDef, handler: (args: unknown) => Answer | Promise<Answer>) => server.registerTool(
    name,
    { title: def.title, description: def.description, inputSchema: def.inputSchema, ...(def.outputSchema ? { outputSchema: def.outputSchema } : {}), annotations: { ...def.annotations, title: def.title, destructiveHint: false } },
    async (args: unknown) => {
      const answer = await handler(args);
      const text = typeof answer === "string" ? answer : answer.text;
      // Structured content goes only with a declared schema; a text-only tool never sends an unvalidated object.
      const structuredContent = typeof answer === "string" || !def.outputSchema ? undefined : (answer.structured as Record<string, unknown>);
      return { content: [{ type: "text" as const, text }], ...(structuredContent ? { structuredContent } : {}) };
    },
  );
  for (const name of registeredToolNames(options)) register(name, MCP_TOOLS[name], handlers[name] as (a: unknown) => Answer | Promise<Answer>);
  // After the public tools, so a clash with one of their names throws instead of replacing it.
  for (const extra of extraTools) register(extra.name, extra.def, extra.handler);
  for (const uri of MCP_RESOURCE_URIS) {
    const def = MCP_RESOURCES[uri];
    server.registerResource(def.name, uri, { title: def.title, description: def.description, mimeType: def.mimeType }, () => {
      const { mimeType, text } = readResource(uri, SOURCE_URL);
      return { contents: [{ uri, mimeType, text }] };
    });
  }
  for (const uriTemplate of MCP_RESOURCE_TEMPLATE_URIS) {
    const def = MCP_RESOURCE_TEMPLATES[uriTemplate];
    const input = z.object(MCP_TOOLS[def.tool].inputSchema);
    // A variable with a known set of values gets one listed resource per value, and completion from that set.
    const values = "values" in def ? def.values : undefined;
    const template = new ResourceTemplate(uriTemplate, {
      list: values
        ? () => ({ resources: values.map((v) => ({ uri: uriTemplate.replace(`{${def.variable}}`, v), name: `${def.name}/${v}`, title: `${def.title}: ${v}`, mimeType: def.mimeType })) })
        : undefined,
      ...(values ? { complete: { [def.variable]: (typed: string) => startingWith(values, typed) } } : {}),
    });
    server.registerResource(def.name, template, { title: def.title, description: def.description, mimeType: def.mimeType }, async (uri, variables) => {
      const raw = String(variables[def.variable] ?? "");
      // The tool's own input schema decides what the variable may be: a positive id, or a class slug.
      const parsed = input.safeParse({ [def.argument]: /^\d+$/.test(raw) ? Number(raw) : raw });
      if (!parsed.success) throw new Error(`${uri.href}: ${def.variable} must be ${def.argument === "class" ? "a class slug" : "a positive id"}, not "${raw}".`);
      const answer = await (handlers[def.tool] as (a: unknown) => Answer | Promise<Answer>)(parsed.data);
      const structured = typeof answer === "string" ? { text: answer } : answer.structured;
      return { contents: [{ uri: uri.href, mimeType: def.mimeType, text: JSON.stringify(structured, null, 2) }] };
    });
  }
  for (const name of MCP_PROMPT_NAMES) {
    const def = MCP_PROMPTS[name];
    const argsSchema = Object.fromEntries(Object.entries(def.arguments).map(([arg, a]) => {
      const schema = a.required ? z.string().describe(a.description) : z.string().optional().describe(a.description);
      // An argument with a known set of values is completed from that set.
      return [arg, "values" in a && a.values ? completable(schema, (typed) => startingWith(a.values!, String(typed ?? ""))) : schema];
    }));
    server.registerPrompt(name, { title: def.title, description: def.description, argsSchema }, (args) => ({
      description: def.title,
      messages: [{ role: "user" as const, content: { type: "text" as const, text: promptText(name, args as Record<string, string | undefined>) } }],
    }));
  }
  return server;
}

/** stdio transport: Claude, ChatGPT dev mode, and the Everloot companion all speak this. Never returns. */
export async function serveStdio(db: DB, changes?: ChangesLoader): Promise<never> {
  // The site's snapshot changes about every ten minutes; reading it more often gains nothing.
  cachePublicCorpus(10 * 60_000);
  const server = createKnowledgeServer(db, { changes });
  await server.connect(new StdioServerTransport());
  return new Promise<never>(() => {});
}
