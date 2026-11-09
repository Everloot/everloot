import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { MCP_TOOL_NAMES, MCP_TOOLS, toolAnswerResponse } from "@everloot/protocol";
import { z } from "zod";
import { openDb } from "../../../../../../kb/src/db";
import { replaceSourceRows } from "../../../../../../kb/src/entities";

const store = vi.hoisted(() => ({ fail: null as Error | null, api: vi.fn(), mcp: vi.fn(), loadCorpus: vi.fn(), loadMarket: vi.fn(), release: { db: null as unknown } }));
vi.mock("@/lib/intake-quota", () => ({ intakeQuota: { api: store.api, mcp: store.mcp } }));
vi.mock("@/lib/upload-store", () => ({ uploadStore: { loadCorpus: store.loadCorpus, loadMarket: store.loadMarket } }));
vi.mock("@/lib/release", () => ({ getRelease: () => (store.release.db ? store.release : null) }));
// A handler whose store read throws (the real handlers degrade most of those to "unrecorded"), set per test.
vi.mock("../../../../../../kb/src/mcp-server", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../../../../kb/src/mcp-server")>();
  return {
    ...real,
    createToolHandlers: (...args: Parameters<typeof real.createToolHandlers>) => {
      const handlers = real.createToolHandlers(...args);
      return new Proxy(handlers, { get: (target, key) => (store.fail ? async () => { throw store.fail; } : Reflect.get(target, key)) });
    },
  };
});
const auth = vi.hoisted(() => ({ getUser: vi.fn(), authQuery: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getUser: auth.getUser, authQuery: auth.authQuery, siteUrl: () => "https://everloot.app" }));

import { GET } from "./route";
import { MY_BUILDS_REFUSAL } from "@/lib/saved-builds";
import { argumentsFromQuery } from "@/lib/tool-query";

const AS_OF = "2026-10-18T10:00:00.000Z";
const records: unknown[] = [];
for (const [i, installId] of ["a", "b", "c"].entries()) {
  const base = { installId, capturedAt: "2026-10-09T00:00:00Z", sourceEvidence: "loot-api" };
  records.push({ ...base, eventId: `name-${i}`, kind: "item_seen", itemId: 1234, name: "Peacebloom", quality: "common" });
  records.push({ ...base, eventId: `loot-${i}`, kind: "loot", sourceNpcId: 456, items: [{ itemId: 1234, count: 1 }] });
}

const get = (tool: string, query = "") => GET(new Request(`https://everloot.app/api/tools/${tool}${query}`), { params: Promise.resolve({ tool }) });

beforeEach(async () => {
  store.fail = null;
  store.api.mockReset().mockResolvedValue({ allowed: true, retryAfter: 0 });
  store.mcp.mockReset().mockResolvedValue({ allowed: true, retryAfter: 0 });
  store.loadCorpus.mockResolvedValue({ uploads: 3, records, dataAsOf: AS_OF, unreachable: false });
  store.loadMarket.mockResolvedValue({ state: null, dataAsOf: null });
  const db = openDb(":memory:");
  await replaceSourceRows(db, "curated", ["lore_page"], [{ kind: "lore_page", extId: "291323", name: "Thrall", body: "Warchief of the Horde.", gameVersion: "lore", sourceUrl: "https://warcraft.wiki.gg/wiki/Thrall", retrievedAt: "2023-11-13" }]);
  store.release.db = db;
});
afterEach(() => vi.unstubAllEnvs());

test("a knowledge tool answers with its structured content, the text and the schema link, under the protocol's shape", async () => {
  const res = await get("search_knowledge", "?query=Thrall&limit=3");
  expect(res.status).toBe(200);
  expect(res.headers.get("x-everloot-licence")).toBe("CC BY-SA 4.0");
  const body = toolAnswerResponse.parse(await res.json());
  expect(body.tool).toBe("search_knowledge");
  expect(body.arguments).toEqual({ query: "Thrall", limit: 3 });
  const answer = z.object(MCP_TOOLS.search_knowledge.outputSchema).parse(body.answer);
  expect(answer.hits[0].name).toBe("Thrall");
  expect(body.text).toContain("https://warcraft.wiki.gg/wiki/Thrall");
  expect(body.schema).toBe("https://everloot.app/schema/mcp/search_knowledge.json");
});

test("an upload tool reads the site's store in process and answers under the uploads envelope", async () => {
  const body = toolAnswerResponse.parse(await (await get("item_page", "?itemId=1234")).json());
  const answer = z.object(MCP_TOOLS.item_page.outputSchema).parse(body.answer);
  expect(answer).toMatchObject({ connected: true, dataAsOf: AS_OF });
  expect(answer.page!.name).toBe("Peacebloom");
  expect(body.text).toContain("Data as of 2026-10-18");
});

test("numbers and booleans are read from their text; strings stay strings", () => {
  expect(argumentsFromQuery("item_page", new URLSearchParams("itemId=19019"))).toEqual({ itemId: 19019 });
  expect(argumentsFromQuery("search_knowledge", new URLSearchParams("query=19019&limit=5"))).toEqual({ query: "19019", limit: 5 });
  expect(argumentsFromQuery("item_page", new URLSearchParams("itemId=abc"))).toEqual({ itemId: "abc" });
});

test("a choice from a fixed list matches without regard to case; anything off the list stays as written", () => {
  expect(argumentsFromQuery("search_knowledge", new URLSearchParams("query=x&version=Classic"))).toEqual({ query: "x", version: "classic" });
  expect(argumentsFromQuery("search_knowledge", new URLSearchParams("query=x&version=+FOREVER+"))).toEqual({ query: "x", version: "forever" });
  expect(argumentsFromQuery("search_knowledge", new URLSearchParams("query=x&version=World+of+Warcraft"))).toEqual({ query: "x", version: "World of Warcraft" });
});

test("a wrong argument is a 400 that names it, an unknown tool a 404 that lists the tools, a missing release a 503", async () => {
  const bad = await get("item_page", "?itemId=abc");
  expect(bad.status).toBe(400);
  expect((await bad.json()).error).toMatch(/^itemId: /);
  const missing = await get("item_page");
  expect(missing.status).toBe(400);
  const unknown = await get("no_such_tool");
  expect(unknown.status).toBe(404);
  expect((await unknown.json()).error).toContain(MCP_TOOL_NAMES[0]);
  store.release.db = null;
  const gone = await get("everloot_plan");
  expect(gone.status).toBe(503);
  expect((await gone.json()).error).toContain("unrecorded, not zero");
});

test("a bad argument the handler refuses is a 400 with its message; a store failure is a 503 with fixed text, no-store and Retry-After, and none of the internal text", async () => {
  const bad = await get("profession_path", "?profession=Basketweaving&fromSkill=1&toSkill=10");
  expect(bad.status).toBe(400);
  expect((await bad.json()).error).toContain('No profession named "Basketweaving"');
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  store.fail = new Error("Pull storage unavailable (500)");
  const res = await get("item_page", "?itemId=1234");
  expect(res.status).toBe(503);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(res.headers.get("retry-after")).toBe("60");
  const text = await res.text();
  expect(JSON.parse(text)).toEqual({ ok: false, error: "Everloot's data store is unavailable; try again in a minute." });
  expect(text).not.toContain("Pull storage");
  expect(log).toHaveBeenCalled();
  log.mockRestore();
});

test("the guild ladder's tools are unknown with EVERLOOT_GUILDS off, and answer under their schema with it on", async () => {
  const off = await get("guild_rankings");
  expect(off.status).toBe(404);
  expect((await off.json()).error.split("Tools: ")[1]).not.toMatch(/guild_(search|rankings)/);
  vi.stubEnv("EVERLOOT_GUILDS", "1");
  const on = toolAnswerResponse.parse(await (await get("guild_rankings")).json());
  expect(z.object(MCP_TOOLS.guild_rankings.outputSchema).parse(on.answer)).toMatchObject({ connected: true, page: { instance: null, rows: [] } });
  expect(on.text).toContain("No instance has an agreed kill yet.");
  const search = toolAnswerResponse.parse(await (await get("guild_search", "?query=night")).json());
  expect(z.object(MCP_TOOLS.guild_search.outputSchema).parse(search.answer)).toMatchObject({ connected: true, page: { guilds: [] } });
});

test("my_builds is unknown with the switch off, and with it on answers for the session without the public quota", async () => {
  vi.stubEnv("EVERLOOT_DATA_GUARD", "1");
  const off = await get("my_builds");
  expect(off.status).toBe(404);
  expect((await off.json()).error).toBe(`No tool named my_builds. Tools: ${MCP_TOOL_NAMES.filter((n) => n !== "guild_search" && n !== "guild_rankings").join(", ")}.`);
  vi.stubEnv("EVERLOOT_SAVED_BUILDS", "1");
  auth.getUser.mockResolvedValue(null);
  const signedOut = await get("my_builds");
  expect(signedOut.status).toBe(401);
  expect((await signedOut.json()).error).toBe(MY_BUILDS_REFUSAL);
  auth.getUser.mockResolvedValue({ id: "11111111-2222-4333-8444-555555555555", name: "Thrall#1" });
  auth.authQuery.mockResolvedValue([]);
  const mine = await get("my_builds");
  expect(mine.status).toBe(200);
  expect((await mine.json()).text).toContain("No saved builds yet.");
  expect(store.api).not.toHaveBeenCalled();
  expect(store.mcp).not.toHaveBeenCalled();
});

test("with the data guard on, the MCP's quota decides before the tool runs, not the bulk endpoints' one", async () => {
  vi.stubEnv("EVERLOOT_DATA_GUARD", "1");
  expect((await get("everloot_plan")).status).toBe(200);
  expect(store.mcp).toHaveBeenCalledTimes(1);
  expect(store.api).not.toHaveBeenCalled();
  store.mcp.mockResolvedValue({ allowed: false, retryAfter: 30 });
  const res = await get("everloot_plan");
  expect(res.status).toBe(429);
  expect(res.headers.get("retry-after")).toBe("30");
});

test("with the data guard on, a key is counted on the drops surface and spends no anonymous quota", async () => {
  vi.stubEnv("EVERLOOT_DATA_GUARD", "1");
  vi.stubEnv("SUPABASE_URL", "https://db.example");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
  const send = vi.fn().mockImplementation(async () => Response.json([{ allowed: true, retry_after: 0, key_ref: "00000000-0000-4000-8000-000000000001" }]));
  vi.stubGlobal("fetch", send);
  try {
    const key = `evl_${"a".repeat(64)}`;
    const res = await GET(new Request("https://everloot.app/api/tools/everloot_plan", { headers: { authorization: `Bearer ${key}` } }), { params: Promise.resolve({ tool: "everloot_plan" }) });
    expect(res.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(send.mock.calls[0][1].body)).toMatchObject({ p_surface: "drops" });
    expect(store.mcp).not.toHaveBeenCalled();
    expect(store.api).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); }
});
