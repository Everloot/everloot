import { afterEach, expect, test, vi } from "vitest";
import { publicMcpCache } from "./mcp-response-cache";

const cache = () => {
  const rows = new Map<string, Response>();
  return { match: vi.fn(async (key: Request) => rows.get(key.url)?.clone()), put: vi.fn(async (key: Request, value: Response) => { rows.set(key.url, value); }) };
};
const req = (headers: Record<string, string | undefined> = {}) => new Request("https://everloot.app/mcp/public", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...Object.fromEntries(Object.entries(headers).filter((entry): entry is [string, string] => entry[1] !== undefined)) } });
const body = (id = 1, args = { question: "Thrall", limit: 3 }, name = "answer_sources") => JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
const response = () => Response.json({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "answer" }], structuredContent: { dataAsOf: "date-1" } } });
afterEach(() => vi.unstubAllEnvs());

test("a repeated answer keeps its result and live id, with release and data versions isolated", async () => {
  const store = cache(); let version = "release-1"; let dataAsOf = "date-1";
  const run = publicMcpCache(async () => ({ release: version, dataAsOf }), store);
  const compute = vi.fn(async () => response());
  expect((await (await run(req(), body(), compute)).json()).result).toEqual((await response().json()).result);
  expect(await (await run(req(), body(2), compute)).json()).toEqual({ ...(await response().json()), id: 2 });
  expect(compute).toHaveBeenCalledTimes(1);
  await run(req(), body(3, { question: "Jaina", limit: 3 }), compute);
  version = "release-2"; await run(req(), body(), compute);
  dataAsOf = "date-2"; await run(req(), body(), compute);
  expect(compute).toHaveBeenCalledTimes(4);
  expect(store.put.mock.calls[0][1].headers.get("cache-control")).toBe("public, max-age=600");
});

test.each([{ authorization: "Bearer private" }, { authorization: "" }, { cookie: "session=private" }, { "mcp-session-id": "session" }, { "mcp-protocol-version": "invalid" }])("credentials and session/protocol headers bypass all cache access: %j", async (headers) => {
  const store = cache(); const version = vi.fn(async () => ({ release: "sha", dataAsOf: "date" }));
  await publicMcpCache(version, store)(req(headers), body(), async () => response());
  expect(store.match).not.toHaveBeenCalled(); expect(store.put).not.toHaveBeenCalled(); expect(version).not.toHaveBeenCalled();
});

test.each(["my_builds", "guild_rankings", "guild_search", "gold_ledger", "completion_progress", "collection_gap", "unknown"])("private, hide-sensitive and unknown tools bypass shared storage: %s", async (name) => {
  const store = cache(); await publicMcpCache(async () => ({ release: "sha", dataAsOf: "date" }), store)(req(), body(1, undefined, name), async () => response());
  expect(store.match).not.toHaveBeenCalled(); expect(store.put).not.toHaveBeenCalled();
});

test.each([Response.json({ error: "rate limit" }, { status: 429 }), Response.json({ jsonrpc: "2.0", id: 1, error: { code: -1 } }), Response.json({ jsonrpc: "2.0", id: 1, result: { isError: true } }), Response.json({ result: {} }, { headers: { "set-cookie": "session=secret" } })])("errors and session responses are never stored", async (res) => {
  const store = cache(); await publicMcpCache(async () => ({ release: "sha", dataAsOf: "date" }), store)(req(), body(), async () => res.clone());
  expect(store.put).not.toHaveBeenCalled();
});

test("case and whitespace variants cannot change displayed answers by colliding", async () => {
  const store = cache(); const compute = vi.fn(async () => response()); const run = publicMcpCache(async () => ({ release: "sha", dataAsOf: "date" }), store);
  await run(req(), body(), compute); await run(req(), body(2, { question: "thrall ", limit: 3 }), compute);
  expect(compute).toHaveBeenCalledTimes(2);
});

test("missing data, changed data during computation and cache failures fall back safely", async () => {
  const store = cache(); const compute = vi.fn(async () => response());
  await publicMcpCache(async () => null, store)(req(), body(), compute); expect(store.match).not.toHaveBeenCalled();
  let n = 0; await publicMcpCache(async () => ({ release: "sha", dataAsOf: String(n++) }), store)(req(), body(), compute); expect(store.put).not.toHaveBeenCalled();
  store.match.mockRejectedValueOnce(new Error("cache unavailable"));
  expect((await publicMcpCache(async () => ({ release: "sha", dataAsOf: "date" }), store)(req(), body(), compute)).status).toBe(200);
});

test("real transport: cached answers preserve output, each id, CORS, origin and per-instance quota", async () => {
  const { createMcpHttpHandler } = await import("../../../kb/src/mcp-http-server");
  const { openDb } = await import("../../../kb/src/db");
  const db = openDb(":memory:");
  try {
    const store = cache();
    const read = vi.fn(async () => ({ facts: { items: { rates: [], names: [], npcs: [] }, world: { npcs: [], quests: [], vendors: [] } }, dataAsOf: "date-1" }));
    const handle = createMcpHttpHandler({ db, bearerToken: null, path: "/mcp/public", maxRequestBodyBytes: 4096,
      rateLimitPerMinute: 2, allowedOrigins: ["https://chatgpt.com", "https://claude.ai"], answerSources: read,
      cacheResponse: publicMcpCache(async () => ({ release: "sha", dataAsOf: "date-1" }), store) });
    const call = (id: number, origin: string) => new Request(req({ origin }), { body: body(id) });
    const first = await handle(call(1, "https://chatgpt.com")); const initial = await first.json();
    expect(initial.result.isError).not.toBe(true);
    expect(initial.result.structuredContent.dataAsOf).toBe("date-1");
    const second = await handle(call(2, "https://claude.ai"));
    expect(await second.json()).toEqual({ ...initial, id: 2 });
    expect(second.headers.get("access-control-allow-origin")).toBe("https://claude.ai");
    expect(second.headers.get("cache-control")).toBe("no-store");
    expect(read).toHaveBeenCalledTimes(1);
    expect(store.put).toHaveBeenCalledTimes(1);
    expect((await handle(call(3, "https://chatgpt.com"))).status).toBe(429);
    expect((await handle(call(4, "https://bad.example"))).status).toBe(403);
    expect(store.match).toHaveBeenCalledTimes(2);
  } finally { db.close(); }
});

test("invalid SDK requests and stale/degraded observations cannot populate a result", async () => {
  const store = cache(); const run = publicMcpCache(async () => ({ release: "sha", dataAsOf: "new-date" }), store);
  await run(req(), body(), async () => response());
  expect(store.put).not.toHaveBeenCalled();
  for (const headers of [{ accept: "bad/application/json, bad/text/event-stream" }, { "content-type": "application/json-invalid" }]) {
    await run(req(headers), body(), async () => response());
  }
  expect(store.match).toHaveBeenCalledTimes(1);
});
