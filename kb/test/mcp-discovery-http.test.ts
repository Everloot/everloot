import { afterEach, expect, test, vi } from "vitest";
import { openDb, type DB } from "../src/db.js";
import { createMcpHttpHandler, createPublicMcpServer } from "../src/mcp-http-server.js";
import * as knowledge from "../src/mcp-server.js";

const databases: DB[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const db of databases.splice(0)) db.close(); });
function setup() {
  const db = openDb(":memory:"); databases.push(db);
  const config = { db, bearerToken: null, maxRequestBodyBytes: 4096, rateLimitPerMinute: 1000, allowedOrigins: ["https://chatgpt.com"] };
  return { config, handle: createMcpHttpHandler(config) };
}
function request(method: string, id: string | number, params: unknown = {}) {
  return new Request("https://example.test/mcp", { method: "POST", headers: {
    "content-type": "application/json", accept: "application/json, text/event-stream",
  }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });
}
const init = (protocolVersion = "2025-03-26") => ({ protocolVersion, capabilities: {}, clientInfo: { name: "test", version: "1" } });

test("concurrent public discovery builds one registry and keeps each request id", async () => {
  const { handle } = setup();
  const build = vi.spyOn(knowledge, "createKnowledgeServer");
  const replies = await Promise.all([
    handle(request("initialize", "first", init())),
    handle(request("tools/list", 22)),
    handle(request("tools/list", "third")),
  ]);
  const bodies = await Promise.all(replies.map((r) => r.json()));
  expect(bodies.map((b) => b.id)).toEqual(["first", 22, "third"]);
  expect(bodies[0].result.serverInfo.name).toBe("everloot-knowledge");
  expect(bodies[1].result.tools.length).toBeGreaterThan(20);
  expect(bodies[1].result).toEqual(bodies[2].result);
  expect(build).toHaveBeenCalledTimes(1);
});

test("cached discovery is byte-identical to a fresh full server, including protocol negotiation", async () => {
  const { config, handle } = setup();
  for (const [method, params] of [["tools/list", {}], ["initialize", init()], ["initialize", init("unknown")]] as const) {
    const { server, transport } = createPublicMcpServer(config);
    try {
      await server.connect(transport);
      const baseline = await transport.handleRequest(request(method, "same", params));
      const cached = await handle(request(method, "same", params));
      expect(cached.status).toBe(baseline.status);
      expect(await cached.text()).toBe(await baseline.text());
    } finally { await server.close(); }
  }
});

test("warm discovery still applies authentication, body limits and transport validation", async () => {
  const { config } = setup();
  const handle = createMcpHttpHandler({ ...config, bearerToken: "secret" });
  const authed = (req: Request) => { req.headers.set("authorization", "Bearer secret"); return req; };
  expect((await handle(authed(request("tools/list", 1)))).status).toBe(200);
  expect((await handle(request("tools/list", 2))).status).toBe(401);
  expect((await handle(authed(request("tools/list", 3, { padding: "x".repeat(5000) })))).status).toBe(413);
  const malformed = await (await handle(authed(request("initialize", 4, {})))).json();
  expect(malformed.error.code).toBe(-32603);
  const invalid = authed(request("tools/list", 5)); invalid.headers.set("accept", "text/plain");
  expect((await handle(invalid)).status).toBe(406);
});

test("separate mounts retain their own public tool availability", async () => {
  const { config, handle } = setup();
  const guilds = { search: async () => null, ladder: async () => null, page: async () => null };
  const withGuilds = createMcpHttpHandler({ ...config, guilds });
  const names = async (h: typeof handle) => (await (await h(request("tools/list", 1))).json()).result.tools.map((t: { name: string }) => t.name);
  expect(await names(handle)).not.toContain("guild_search");
  expect(await names(withGuilds)).toContain("guild_search");
  expect(await names(handle)).not.toContain("guild_search");
});
