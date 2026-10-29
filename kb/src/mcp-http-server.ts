import { createHash, timingSafeEqual } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { ReleaseSource } from "./release-db.js";
import { createKnowledgeServer, type ChangesLoader, type CompletionLoader, type CorpusLoader, type EcosystemLoader, type ExtraTool, type MarketLoader, type ToolOptions } from "./mcp-server.js";
import type { GuildReader } from "./guilds.js";
import type { CensusLoader } from "./population.js";
import type { RecheckScope } from "./coverage.js";

/**
 * Every loader the knowledge server takes (`ToolOptions`) passes through as given: a hand-picked list here once
 * dropped the game files' facts, the coverage reader and the settled summary from both MCP mounts.
 */
export interface PublicMcpConfig extends ToolOptions {
  db: ReleaseSource;
  /** Null means a public, read-only mount: no bearer, rate-limited by the caller before this handler. */
  bearerToken: string | null;
  /** The path this mount answers; anything else is 404. */
  path?: string;
  maxRequestBodyBytes: number;
  rateLimitPerMinute: number;
  allowedOrigins: string[];
  /** The web route's in-process reader; the standalone server reads the public corpus URL instead. */
  corpus?: CorpusLoader;
  /** The site's curated recheck scopes, so page tools count only reports after a scope's date. */
  recheck?: readonly RecheckScope[];
  /** The web route's market rollup reader; without it market_value says it is not connected. */
  market?: MarketLoader;
  /** The web route's completion rollup reader, owned progress already limited to granted installs. */
  completion?: CompletionLoader;
  /** The merged changes timeline, when the host has one. */
  changes?: ChangesLoader;
  /** The ecosystem tracker's view with install counts joined, when the host has one. */
  ecosystem?: EcosystemLoader;
  /** The web route's census rollup reader, aggregate only; without it population says it is not connected. */
  census?: CensusLoader;
  /** The web route's guild ladder reader; without it guild_search and guild_rankings are not listed. */
  guilds?: GuildReader;
  /**
   * Tools for this caller only, decided per request from its headers and the JSON-RPC body (the site's account
   * tools, for a player's own key). Without it, or when it returns none, the server lists the public tools alone.
   */
  extraTools?: (req: Request, body: string) => readonly ExtraTool[] | Promise<readonly ExtraTool[]>;
}

/**
 * Every `ToolOptions` key, and only those: `satisfies` fails the build when the knowledge server gains a loader this
 * list lacks, and the mount's own settings (its bearer token, origins, limits) never reach the tool layer.
 */
const TOOL_OPTION_KEYS = {
  corpus: true, market: true, gameData: true, completion: true, changes: true, ecosystem: true, census: true,
  coverage: true, settledSummary: true, guilds: true, recheck: true,
} as const satisfies Record<keyof ToolOptions, true>;

/** The loaders a config carries, picked out of the mount's settings. */
export function toolOptionsOf(config: ToolOptions): ToolOptions {
  const picked: Record<string, unknown> = {};
  for (const key of Object.keys(TOOL_OPTION_KEYS) as (keyof ToolOptions)[]) if (config[key] !== undefined) picked[key] = config[key];
  return picked as ToolOptions;
}

export function createPublicMcpServer(config: { db: ReleaseSource } & ToolOptions, extraTools: readonly ExtraTool[] = []) {
  const server = createKnowledgeServer(config.db, toolOptionsOf(config), extraTools);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, enableJsonResponse: true,
  });
  return { server, transport };
}

function bearerOk(header: string | null, token: string): boolean {
  const presented = header?.startsWith("Bearer ") ? header.slice(7) : "";
  return token.length > 0 && presented.length > 0 && timingSafeEqual(
    createHash("sha256").update(presented).digest(),
    createHash("sha256").update(token).digest(),
  );
}

export function createMcpHttpHandler(config: PublicMcpConfig) {
  let hits: number[] = [];
  return async function handleRequest(req: Request): Promise<Response> {
    const origin = req.headers.get("origin");
    const headers = new Headers({ "Vary": "Origin", "Cache-Control": "no-store" });
    const reply = (status: number, error: string) => Response.json({ error }, { status, headers });
    if (origin && !config.allowedOrigins.includes(origin)) return reply(403, "Invalid origin");
    if (origin) headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, MCP-Protocol-Version, MCP-Session-Id");
    if (new URL(req.url).pathname !== (config.path ?? "/mcp")) return reply(404, "Not found");
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (config.bearerToken !== null && !bearerOk(req.headers.get("authorization"), config.bearerToken)) {
      headers.set("WWW-Authenticate", "Bearer");
      return reply(401, "Unauthorized");
    }
    if (req.method !== "POST") {
      headers.set("Allow", "POST, OPTIONS");
      return reply(405, "Method not allowed");
    }
    // The shared token's quota cannot be reset by spoofing a forwarding header.
    const now = Date.now();
    hits = hits.filter((time) => now - time < 60_000);
    if (hits.length >= config.rateLimitPerMinute) {
      headers.set("Retry-After", "60");
      return reply(429, "Rate limited");
    }
    hits.push(now);
    if (Number(req.headers.get("content-length")) > config.maxRequestBodyBytes) return reply(413, "Request body too large");
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    const reader = req.body?.getReader();
    if (reader) {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > config.maxRequestBodyBytes) { await reader.cancel(); return reply(413, "Request body too large"); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
    }
    const body = Buffer.concat(chunks).toString("utf8");
    let extraTools: readonly ExtraTool[] = [];
    try {
      if (config.extraTools) extraTools = await config.extraTools(req, body);
    } catch {
      return reply(500, "Internal server error");
    }
    const { server, transport } = createPublicMcpServer(config, extraTools);
    try {
      await server.connect(transport);
      const response = await transport.handleRequest(new Request(req.url, { method: "POST", headers: req.headers, body }));
      headers.forEach((value, key) => response.headers.set(key, value));
      return response;
    } catch {
      return reply(500, "Internal server error");
    } finally {
      await server.close();
    }
  };
}
