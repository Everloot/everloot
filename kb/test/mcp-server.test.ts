import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { openDb } from "../src/db.js";
import { replaceSourceRows, type EntityInput } from "../src/entities.js";
import {
  SERVER_INSTRUCTIONS,
  SERVER_NAME,
  cachePublicCorpus,
  SERVER_VERSION,
  UPLOADS_UNSET,
  createKnowledgeServer,
  fromUploads,
  handleGetByName,
  handleGetEntity,
  handleSearch,
  registeredToolNames,
  searchHits,
  SOME_WORDS,
} from "../src/mcp-server.js";
import type { GuildReader } from "../src/guilds.js";
import { CREDIT_LINE, MCP_CREDIT } from "@everloot/protocol";

const UNAVAILABLE_TEXT = "Public corpus unavailable. These figures are unrecorded, not zero.";

const row = (extId: string, name: string, body = "", extra: Partial<EntityInput> = {}): EntityInput => ({
  kind: "lore_page",
  extId,
  name,
  body,
  gameVersion: "lore",
  sourceUrl: `https://example.test/${extId}`,
  retrievedAt: "2023-11-13",
  ...extra,
});

async function seed() {
  const db = openDb(":memory:");
  await replaceSourceRows(db, "curated", ["lore_page", "item"], [
    row("1", "Thunderfury", "Warchief Thrall once held Thunderfury aloft."),
    row("2", "Thunderfury, Blessed Blade", "A sword.", { kind: "item", gameVersion: "retail" }),
  ]);
  return db;
}

test("search handler answers questions and shows provenance", async () => {
  const text = handleSearch(await seed(), { query: "where is Thunderfury", limit: 8 });
  expect(text).toContain("Thunderfury");
  expect(text).toContain("https://example.test/1");
  expect(text).toContain("CC-BY-SA-4.0");
});

test("search handler says so when nothing matches", async () => {
  expect(handleSearch(await seed(), { query: "xyznothinghere", limit: 8 })).toContain("No matches");
});

test("search handler falls back to pages with some of the words, and says so first", async () => {
  // Found live: "whats the best racial class for warlock on horde" matched no page, so the chat had nothing.
  const db = await seed();
  const text = handleSearch(db, { query: "best sword Thunderfury", limit: 8 });
  expect(text.startsWith(SOME_WORDS)).toBe(true);
  expect(text).toContain("Thunderfury, Blessed Blade");
  expect(searchHits(db, { query: "best sword Thunderfury", limit: 8 }).map((h) => h.name)[0]).toBe("Thunderfury, Blessed Blade");
  expect(handleSearch(db, { query: "Thunderfury", limit: 8 })).not.toContain(SOME_WORDS);
});

test("get_entity handler returns the row or names the missing id", async () => {
  const db = await seed();
  const [first] = (await import("../src/search.js")).search(db, "Thunderfury");
  expect(handleGetEntity(db, { id: first.id })).toContain("Thunderfury");
  expect(handleGetEntity(db, { id: -1 })).toContain("-1");
});

test("get_by_name handler matches exactly and suggests search otherwise", async () => {
  const db = await seed();
  expect(handleGetByName(db, { name: "thunderfury" })).toContain("[lore_page/lore] Thunderfury");
  expect(handleGetByName(db, { name: "Thunderfury", kind: "npc" })).toContain("search_knowledge");
});

test("unset uploads are not an empty corpus", () => {
  const prev = process.env.EVERLOOT_UPLOADS;
  try {
    delete process.env.EVERLOOT_UPLOADS;
    expect(fromUploads(() => { throw new Error("renderer ran"); })).toBe(UPLOADS_UNSET);
    process.env.EVERLOOT_UPLOADS = "   ";
    expect(fromUploads(() => { throw new Error("renderer ran"); })).toBe(UPLOADS_UNSET);
  } finally {
    if (prev === undefined) delete process.env.EVERLOOT_UPLOADS;
    else process.env.EVERLOOT_UPLOADS = prev;
  }
});

test("an empty uploads directory is a real empty corpus", () => {
  const prev = process.env.EVERLOOT_UPLOADS;
  const dir = mkdtempSync(join(tmpdir(), "everloot-uploads-"));
  try {
    process.env.EVERLOOT_UPLOADS = dir;
    expect(fromUploads((records) => `records:${records.length}`)).toBe("records:0");
  } finally {
    if (prev === undefined) delete process.env.EVERLOOT_UPLOADS;
    else process.env.EVERLOOT_UPLOADS = prev;
  }
});

test("MCP reads the current sanitized public corpus without caching named grants", async () => {
  vi.stubEnv("EVERLOOT_PUBLIC_CORPUS_URL", "https://everloot.example/api/corpus/public");
  const gold = { kind: "gold_snapshot", installId: "install-one", eventId: "epoch:1",
    capturedAt: "2026-10-07T00:00:00Z", realm: "Moon Guard", character: "Thrall", currentCopper: 10, peakCopper: 10 };
  const send = vi.fn().mockResolvedValueOnce(Response.json({ ok: true, records: [gold] }))
    .mockResolvedValueOnce(Response.json({ ok: true, records: [] }))
    .mockResolvedValueOnce(Response.json({ ok: false }, { status: 503 }));
  vi.stubGlobal("fetch", send);
  try {
    const [answer] = (await fromUploads((records) => JSON.stringify(records))).split("\n");
    expect(JSON.parse(answer!)).toEqual([gold]);
    expect(await fromUploads((records) => `records:${records.length}`)).toBe(`records:0\nData age unrecorded.\n${MCP_CREDIT}`);
    expect(await fromUploads(() => { throw new Error("renderer must not run"); })).toMatch(/unavailable/i);
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[0][1].cache).toBe("no-store");
  } finally { vi.unstubAllEnvs(); vi.unstubAllGlobals(); }
});

test("answers from the public corpus say how old its data is", async () => {
  vi.stubEnv("EVERLOOT_PUBLIC_CORPUS_URL", "https://everloot.example/api/corpus/public");
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce(Response.json({ ok: true, records: [], dataAsOf: "2026-10-09T10:05:42.000Z" }))
    .mockResolvedValueOnce(Response.json({ ok: true, records: [], dataAsOf: "not a time" })));
  try {
    expect(await fromUploads(() => "Price unrecorded.")).toBe(`Price unrecorded.\nData as of 2026-10-09 10:05 UTC.\n${MCP_CREDIT}`);
    expect(await fromUploads(() => "Price unrecorded.")).toBe(`Price unrecorded.\nData age unrecorded.\n${MCP_CREDIT}`);
  } finally { vi.unstubAllEnvs(); vi.unstubAllGlobals(); }
});

test("the server registers under the Everloot name", async () => {
  const server = createKnowledgeServer(await seed());
  expect(server).toBeTruthy();
  expect(SERVER_NAME).toBe("everloot-knowledge");
  expect(SERVER_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
});

test("public corpus reads enforce the actual byte ceiling even with a false content length", async () => {
  vi.stubEnv("EVERLOOT_PUBLIC_CORPUS_URL", "https://everloot.example/api/corpus/public");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ok: true, records: [], padding: "x".repeat(2_000_001) },
    { headers: { "content-length": "1" } })));
  try {
    expect(await fromUploads(() => "renderer must not run")).toMatch(/unavailable/i);
  } finally { vi.unstubAllEnvs(); vi.unstubAllGlobals(); }
});

test("the server tells every client how to credit player data", () => {
  expect(SERVER_INSTRUCTIONS).toContain(CREDIT_LINE);
  expect(SERVER_INSTRUCTIONS).toContain("CC BY-SA 4.0");
  expect(SERVER_INSTRUCTIONS).toContain("stay Blizzard's");
  // The line that ends each answer states facts only: nothing in it reads as an instruction to a model.
  expect(MCP_CREDIT).toBe("Licence: CC BY-SA 4.0. Credit: Everloot contributors, https://everloot.app");
  expect(MCP_CREDIT).not.toMatch(/(keep|you|must|always|ignore|show)/i);
});

test("a paged public corpus is read to the end, with EVERLOOT_API_KEY sent as a bearer key", async () => {
  vi.stubEnv("EVERLOOT_PUBLIC_CORPUS_URL", "https://everloot.example/api/corpus/public");
  vi.stubEnv("EVERLOOT_API_KEY", `evl_${"a".repeat(64)}`);
  const gold = (n: number) => ({ kind: "gold_snapshot", installId: "install-one", eventId: `page:${n}`, capturedAt: "2026-10-07T00:00:00Z",
    realm: "Moon Guard", character: "Thrall", currentCopper: n, peakCopper: n });
  const send = vi.fn()
    .mockResolvedValueOnce(Response.json({ ok: true, records: [gold(1)], dataAsOf: "2026-10-09T10:05:00.000Z", next: "https://everloot.example/api/corpus/public?offset=1" }))
    .mockResolvedValueOnce(Response.json({ ok: true, records: [gold(2)], dataAsOf: "2026-10-09T10:05:00.000Z", next: null }));
  vi.stubGlobal("fetch", send);
  try {
    expect(await fromUploads((records) => `records:${records.length}`)).toBe(`records:2\nData as of 2026-10-09 10:05 UTC.\n${MCP_CREDIT}`);
    expect(send.mock.calls.map((call) => call[0])).toEqual(["https://everloot.example/api/corpus/public", "https://everloot.example/api/corpus/public?offset=1"]);
    expect(send.mock.calls[0][1].headers).toEqual({ authorization: `Bearer evl_${"a".repeat(64)}` });
  } finally { vi.unstubAllEnvs(); vi.unstubAllGlobals(); }
});

test("a next link that cannot be followed makes the answer unavailable, never a short one", async () => {
  vi.stubEnv("EVERLOOT_PUBLIC_CORPUS_URL", "https://everloot.example/api/corpus/public");
  for (const next of ["https://elsewhere.example/steal", "not a url", 42]) {
    const send = vi.fn().mockResolvedValueOnce(Response.json({ ok: true, records: [], next }));
    vi.stubGlobal("fetch", send);
    expect(await fromUploads(() => "renderer must not run")).toBe(UNAVAILABLE_TEXT);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][1].headers).toBeUndefined();
  }
  vi.unstubAllEnvs(); vi.unstubAllGlobals();
});

const pageOf = (n: number, dataAsOf: string, next: string | null) => Response.json({ ok: true, dataAsOf, next,
  records: [{ kind: "gold_snapshot", installId: "install-one", eventId: `snap:${n}`, capturedAt: "2026-10-07T00:00:00Z",
    realm: "Moon Guard", character: "Thrall", currentCopper: n, peakCopper: n }] });
const SECOND = "https://everloot.example/api/corpus/public?offset=1";

test("a failed later page makes the answer unavailable", async () => {
  vi.stubEnv("EVERLOOT_PUBLIC_CORPUS_URL", "https://everloot.example/api/corpus/public");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(pageOf(1, "2026-10-09T10:00:00.000Z", SECOND))
    .mockResolvedValueOnce(Response.json({ ok: false, error: "Rate limited" }, { status: 429 })));
  try {
    expect(await fromUploads(() => "renderer must not run")).toBe(UNAVAILABLE_TEXT);
  } finally { vi.unstubAllEnvs(); vi.unstubAllGlobals(); }
});

test("pages from two snapshots are never mixed: the read starts again once, then gives up", async () => {
  vi.stubEnv("EVERLOOT_PUBLIC_CORPUS_URL", "https://everloot.example/api/corpus/public");
  const [a, b, c] = ["2026-10-09T10:00:00.000Z", "2026-10-09T10:10:00.000Z", "2026-10-09T10:20:00.000Z"];
  const send = vi.fn()
    .mockResolvedValueOnce(pageOf(1, a, SECOND)).mockResolvedValueOnce(pageOf(2, b, null))
    .mockResolvedValueOnce(pageOf(3, b, SECOND)).mockResolvedValueOnce(pageOf(4, b, null));
  vi.stubGlobal("fetch", send);
  try {
    expect(await fromUploads((records) => records.map((r) => (r as { eventId: string }).eventId).join(","))).toBe(
      `snap:3,snap:4\nData as of 2026-10-09 10:10 UTC.\n${MCP_CREDIT}`);
    expect(send).toHaveBeenCalledTimes(4);
    send.mockReset()
      .mockResolvedValueOnce(pageOf(1, a, SECOND)).mockResolvedValueOnce(pageOf(2, b, null))
      .mockResolvedValueOnce(pageOf(3, b, SECOND)).mockResolvedValueOnce(pageOf(4, c, null));
    expect(await fromUploads(() => "renderer must not run")).toBe(UNAVAILABLE_TEXT);
  } finally { vi.unstubAllEnvs(); vi.unstubAllGlobals(); }
});

test("the stdio server reuses a corpus read for the snapshot interval, then reads again", async () => {
  vi.stubEnv("EVERLOOT_PUBLIC_CORPUS_URL", "https://everloot.example/api/corpus/public");
  vi.useFakeTimers({ toFake: ["Date"] });
  const send = vi.fn().mockImplementation(async () => pageOf(1, "2026-10-09T10:00:00.000Z", null));
  vi.stubGlobal("fetch", send);
  cachePublicCorpus(10 * 60_000);
  try {
    await fromUploads(() => "one");
    await fromUploads(() => "two");
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10 * 60_000);
    await fromUploads(() => "three");
    expect(send).toHaveBeenCalledTimes(2);
  } finally { cachePublicCorpus(0); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); }
});

test("tools/list is exactly the protocol's tool table, in order, with its input shapes (the guild ladder's two only with a guild reader)", async () => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { MCP_TOOL_NAMES, MCP_TOOLS } = await import("@everloot/protocol");
  const { z } = await import("zod");
  const server = createKnowledgeServer(await seed());
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
  const listed = (await client.listTools()).tools;
  expect(listed.map((t) => t.name)).toEqual(MCP_TOOL_NAMES.filter((name) => name !== "guild_search" && name !== "guild_rankings"));
  expect(registeredToolNames()).toHaveLength(MCP_TOOL_NAMES.length - 2);
  expect(registeredToolNames({ guilds: {} as GuildReader })).toEqual(MCP_TOOL_NAMES);
  for (const tool of listed) {
    const expected = z.toJSONSchema(z.object(MCP_TOOLS[tool.name as keyof typeof MCP_TOOLS].inputSchema), { io: "input" }) as { properties?: Record<string, unknown>; required?: string[] };
    expect(Object.keys(tool.inputSchema.properties ?? {}).sort()).toEqual(Object.keys(expected.properties ?? {}).sort());
    expect([...(tool.inputSchema.required ?? [])].sort()).toEqual([...(expected.required ?? [])].sort());
    expect(tool.title).toBe(MCP_TOOLS[tool.name as keyof typeof MCP_TOOLS].title);
    expect(tool.annotations?.title).toBe(tool.title);
    expect(tool.annotations?.readOnlyHint).toBe(true);
    expect(tool.annotations?.destructiveHint).toBe(false);
  }
  const hit = await client.callTool({ name: "get_by_name", arguments: { name: "Thunderfury" } });
  expect(JSON.stringify(hit.content)).toContain("Thunderfury");
  await client.close();
});

test("structured tools declare output schemas; coverage answers with text only", async () => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { MCP_TOOL_NAMES, STRUCTURED_TOOLS } = await import("@everloot/protocol");
  const changes = [{ id: "p1", type: "post" as const, game: "forever" as const, at: "2026-10-18T10:00:00Z", title: "Hotfixes", url: "https://example.test/post", author: "Kaivax", excerpt: "A fix." }];
  const server = createKnowledgeServer(await seed(), { changes: () => changes });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
  expect(STRUCTURED_TOOLS).toEqual(MCP_TOOL_NAMES.filter((name) => name !== "coverage"));
  const coverage = await client.callTool({ name: "coverage", arguments: {} });
  expect(coverage.isError).not.toBe(true);
  expect(coverage.structuredContent).toBeUndefined();
  expect(coverage.content).toEqual([{ type: "text", text: expect.stringContaining("not connected") }]);
  const listed = (await client.listTools()).tools;
  for (const tool of listed) expect(tool.outputSchema !== undefined).toBe(STRUCTURED_TOOLS.includes(tool.name as (typeof STRUCTURED_TOOLS)[number]));

  const search = await client.callTool({ name: "search_knowledge", arguments: { query: "Thunderfury" } });
  const hits = (search.structuredContent as { hits: { name: string; sourceUrl: string; licence: string }[] }).hits;
  expect(hits.length).toBeGreaterThan(0);
  expect(hits[0]).toMatchObject({ sourceUrl: expect.stringContaining("https://example.test/"), licence: "CC-BY-SA-4.0" });
  expect(JSON.stringify(search.content)).toContain(hits[0].name);

  const one = await client.callTool({ name: "get_entity", arguments: { id: -1 } });
  expect(one.structuredContent).toEqual({ hit: null });

  const recent = await client.callTool({ name: "recent_changes", arguments: {} });
  // Both games were asked for, so the changes page is linked with both shown.
  expect(recent.structuredContent).toEqual({ connected: true, entries: changes, url: "https://everloot.app/changes?game=all" });
  expect(JSON.stringify(recent.content)).toContain("More: https://everloot.app/changes?game=all");
  const posts = await client.callTool({ name: "recent_changes", arguments: { filter: "posts", game: "forever" } });
  expect(posts.structuredContent).toMatchObject({ url: "https://everloot.app/changes?show=posts" });
  const builds = await client.callTool({ name: "recent_changes", arguments: { filter: "builds" } });
  expect(builds.structuredContent).toEqual({ connected: true, entries: [] });

  await client.close();
});
