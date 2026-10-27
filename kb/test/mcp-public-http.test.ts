import { MCP_TOOL_NAMES, MCP_TOOLS } from "@everloot/protocol";
import { afterEach, expect, test } from "vitest";
import { z } from "zod";
import { encodeBuild } from "../../web/src/lib/talents/share";
import { openDb, type DB } from "../src/db.js";
import { replaceSourceRows } from "../src/entities.js";
import { createMcpHttpHandler } from "../src/mcp-http-server.js";
import { siteCatalog } from "../src/talents/site-catalogs.js";

const databases: DB[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

async function handler(overrides = {}) {
  const db = openDb(":memory:");
  databases.push(db);
  await replaceSourceRows(db, "curated", ["lore_page"], [{
    kind: "lore_page", extId: "1", name: "Thrall", body: "Warchief",
    gameVersion: "lore", sourceUrl: "https://example.test/thrall", retrievedAt: "2023-11-13",
  }]);
  return createMcpHttpHandler({ db, bearerToken: "test-token", maxRequestBodyBytes: 1024,
    rateLimitPerMinute: 20, allowedOrigins: ["https://chatgpt.com"], ...overrides });
}

function request(method: string, params?: unknown, headers = {}) {
  return new Request("http://localhost/mcp", { method: "POST", headers: {
    authorization: "Bearer test-token", "content-type": "application/json",
    accept: "application/json, text/event-stream", ...headers,
  }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
}

test("the server info links the source code (AGPL section 13)", async () => {
  const handle = await handler();
  const init = await handle(request("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } }));
  const info = (await init.json()).result.serverInfo;
  expect(info.websiteUrl).toBe("https://github.com/Everloot/everloot");
  expect(info.title).toBe("Everloot");
  expect(info.description).toContain("CC BY-SA 4.0");
  expect(info.icons.map((i: { src: string }) => i.src)).toEqual(["https://everloot.app/icon-64.png", "https://everloot.app/icon-512.png"]);
});

test("independent clients initialize and receive sourced knowledge plus the tracker", async () => {
  const handle = await handler();
  for (let i = 0; i < 2; i++) {
    const init = await handle(request("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } }));
    expect(init.status).toBe(200);
    expect((await init.json()).result.serverInfo.name).toBe("everloot-knowledge");
  }
  const search = await handle(request("tools/call", { name: "search_knowledge", arguments: { query: "Thrall" } }));
  const answer = await search.json();
  expect(answer.result.isError).not.toBe(true);
  expect(answer.result.content[0].text).toContain("https://example.test/thrall");
  expect(answer.result.content[0].text).toContain("CC-BY-SA-4.0");
  const plan = await handle(request("tools/call", { name: "everloot_plan", arguments: {} }));
  expect((await plan.json()).result.isError).not.toBe(true);
});

test("talent_plan refuses a link's value that is not a whole code, escaped or raw, even with a code inside it", async () => {
  const handle = await handler();
  const warrior = siteCatalog("warrior");
  const node = warrior.nodes.find((n) => !n.unlock && n.prereqs.length === 0 && !n.anyOf)!;
  const code = encodeBuild({ classSlug: "warrior", specId: warrior.specId, build: warrior.build, ranks: { [node.id]: { rank: 1 } } });
  for (const link of [`https://everloot.app/tools/talents/warrior#plan=junk%23plan%3D${code}`, `https://everloot.app/tools/talents/warrior#plan=junk#plan=${code}`]) {
    const answer = await (await handle(request("tools/call", { name: "talent_plan", arguments: { code: link } }))).json();
    expect(answer.result.isError, link).not.toBe(true);
    expect(z.object(MCP_TOOLS.talent_plan.outputSchema).parse(answer.result.structuredContent), link)
      .toMatchObject({ ok: false, message: "That share code is damaged or cut short." });
  }
});

test("rejects an untrusted Origin even with valid authorization", async () => {
  const handle = await handler();
  expect((await handle(request("tools/list", {}, { origin: "https://evil.test" }))).status).toBe(403);
});

test("checks actual body bytes without trusting Content-Length", async () => {
  const handle = await handler({ maxRequestBodyBytes: 100 });
  expect((await handle(request("tools/call", { name: "search_knowledge", arguments: { query: "x".repeat(500) } }))).status).toBe(413);
});

test("missing authorization is rejected and token quota cannot be bypassed with spoofed IPs", async () => {
  const handle = await handler({ rateLimitPerMinute: 1 });
  expect((await handle(request("tools/list", {}, { authorization: "" }))).status).toBe(401);
  await handle(request("tools/list", {}, { "x-forwarded-for": "1.2.3.4" }));
  expect((await handle(request("tools/list", {}, { "x-forwarded-for": "5.6.7.8" }))).status).toBe(429);
});

test("preflight permits MCP headers and GET is explicitly unsupported", async () => {
  const handle = await handler();
  const preflight = await handle(new Request("http://localhost/mcp", { method: "OPTIONS", headers: { origin: "https://chatgpt.com" } }));
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get("access-control-allow-headers")).toContain("MCP-Session-Id");
  expect((await handle(new Request("http://localhost/mcp", { headers: { authorization: "Bearer test-token" } }))).status).toBe(405);
});

test("a public mount serves its own path with no bearer, and only that path", async () => {
  const handle = await handler({ bearerToken: null, path: "/mcp/public" });
  const init = (url: string) => new Request(url, { method: "POST", headers: {
    "content-type": "application/json", accept: "application/json, text/event-stream",
  }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "chatgpt", version: "1" } } }) });
  const ok = await handle(init("http://localhost/mcp/public"));
  expect(ok.status).toBe(200);
  expect((await ok.json()).result.serverInfo.name).toBe("everloot-knowledge");
  expect((await handle(init("http://localhost/mcp"))).status).toBe(404);
});

test("a host's extra tool is listed and answers only for the requests it is given to", async () => {
  const extra = {
    name: "my_test_tool",
    def: { title: "Test", description: "Test tool", inputSchema: { slug: z.string().optional() }, annotations: { readOnlyHint: true, openWorldHint: false } } as const,
    handler: (args: unknown) => `got ${JSON.stringify(args)}`,
  };
  const handle = await handler({ extraTools: (req: Request, body: string) => (req.headers.get("x-test") === "yes" && body.includes("tools/") ? [extra] : []) });
  const names = async (headers = {}) => ((await (await handle(request("tools/list", {}, headers))).json()).result.tools as { name: string }[]).map((t) => t.name);
  const listed = MCP_TOOL_NAMES.filter((name) => name !== "guild_search" && name !== "guild_rankings");
  expect(await names()).toEqual(listed);
  expect(await names({ "x-test": "yes" })).toEqual([...listed, "my_test_tool"]);
  const called = await (await handle(request("tools/call", { name: "my_test_tool", arguments: { slug: "a" } }, { "x-test": "yes" }))).json();
  expect(called.result.content[0].text).toBe('got {"slug":"a"}');
  const refused = await (await handle(request("tools/call", { name: "my_test_tool", arguments: {} }))).json();
  expect(refused.result.isError).toBe(true);
});

test("an extra tool cannot take a public tool's name, and a failing hook is a 500", async () => {
  const clash = { name: "search", def: MCP_TOOLS.search, handler: () => "replaced" };
  await expect((await handler({ extraTools: () => [clash] }))(request("tools/list", {}))).rejects.toThrow(/already registered/);
  expect((await (await handler({ extraTools: () => { throw new Error("down"); } }))(request("tools/list", {}))).status).toBe(500);
});

test("the bearer mount still refuses a request without the token", async () => {
  const handle = await handler();
  const res = await handle(new Request("http://localhost/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
  expect(res.status).toBe(401);
});
