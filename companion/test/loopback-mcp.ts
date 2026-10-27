import { createServer } from "node:http";
import { FIXTURE_STRUCTURED } from "../../web/src/lib/chat/market-fixture";

/** A loopback request the stand-in server saw: its path, the JSON-RPC method (or HTTP verb) and its Authorization header. */
export interface Seen { path: string; method: string; auth: string | null }

const LINEN = [{ type: "item", id: 2589, label: "Linen Cloth", href: "/database/items/2589", quality: 1 }];
const HIT = "[item] Linen Cloth\nA bolt of cloth.\nSource: Everloot uploads (CC BY-SA 4.0)\n";

/**
 * A local stand-in for the site: /mcp and /mcp/public speak enough MCP over JSON for the real client (market_value
 * returns the shared fixture, search_knowledge one sourced hit) and /search/suggest answers item names. It records
 * every request, so a test can say which ones were made, and with which token.
 */
export async function loopbackSite() {
  const seen: Seen[] = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const path = (req.url ?? "").split("?")[0];
    if (path === "/search/suggest") {
      seen.push({ path, method: "GET", auth: null });
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ results: LINEN }));
      return;
    }
    if (req.method !== "POST") { seen.push({ path, method: req.method ?? "?", auth: req.headers.authorization ?? null }); res.writeHead(405).end(); return; }
    const message = JSON.parse(body || "{}") as { id?: number; method?: string; params?: { name?: string } };
    seen.push({ path, method: message.method === "tools/call" ? `tools/call ${message.params?.name}` : String(message.method), auth: req.headers.authorization ?? null });
    if (message.id === undefined) { res.writeHead(202).end(); return; }
    const result = message.method === "initialize" ? { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "loopback", version: "1" } }
      : message.params?.name === "market_value" ? { content: [{ type: "text", text: "long text" }], structuredContent: FIXTURE_STRUCTURED }
      : message.method === "tools/list" ? { tools: [] }
      : { content: [{ type: "text", text: HIT }] };
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    endpoint, seen,
    /** The requests made since `from`, as "path method" lines. */
    since: (from = 0) => seen.slice(from).map((s) => `${s.path} ${s.method}`),
    stop: async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); },
  };
}
