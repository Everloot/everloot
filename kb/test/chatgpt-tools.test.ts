import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CHATGPT_TOOLS, CREDIT_LINE, MCP_TOOLS } from "@everloot/protocol";
import { afterEach, expect, test } from "vitest";
import { z } from "zod";
import { openDb, type DB } from "../src/db.js";
import { replaceSourceRows, type EntityInput } from "../src/entities.js";
import { loreSlug, recordUrl, slugify } from "../src/lore-slug.js";
import { createKnowledgeServer } from "../src/mcp-server.js";

const BODY = "Thrall, son of Durotan, was Warchief of the Horde. ".repeat(8).trim();

const databases: DB[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

async function client() {
  const db = openDb(":memory:");
  databases.push(db);
  const rows: EntityInput[] = [
    { kind: "lore_page", extId: "291323", name: "Thrall", body: BODY, gameVersion: "lore", sourceUrl: "https://warcraft.wiki.gg/wiki/Thrall", retrievedAt: "2023-11-13" },
    { kind: "item", extId: "19019", name: "Thunderfury, Blessed Blade of the Windseeker", body: "A sword Thrall never held.", gameVersion: "retail", sourceUrl: "https://example.test/items/19019", retrievedAt: "2023-11-13" },
  ];
  await replaceSourceRows(db, "curated", ["lore_page", "item"], rows);
  const server = createKnowledgeServer(db);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const c = new Client({ name: "chatgpt", version: "0" });
  await c.connect(clientSide);
  return c;
}

test("search and fetch are listed as read-only tools with the connector contract's shapes", async () => {
  const tools = (await (await client()).listTools()).tools;
  for (const name of CHATGPT_TOOLS) {
    const tool = tools.find((t) => t.name === name)!;
    expect(tool.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    expect(tool.outputSchema).toBeDefined();
  }
  expect(Object.keys(tools.find((t) => t.name === "search")!.inputSchema.properties ?? {})).toEqual(["query"]);
  expect(Object.keys(tools.find((t) => t.name === "fetch")!.inputSchema.properties ?? {})).toEqual(["id"]);
});

test("search gives results with an id for fetch, a title and a URL, as structured content and as the same JSON text", async () => {
  const c = await client();
  const answer = await c.callTool({ name: "search", arguments: { query: "Thrall" } });
  expect(answer.isError).not.toBe(true);
  const parsed = z.object(MCP_TOOLS.search.outputSchema).parse(answer.structuredContent);
  expect(parsed.results.length).toBe(2);
  const thrall = parsed.results.find((r) => r.title === "Thrall")!;
  expect(thrall.id).toMatch(/^\d+$/);
  expect(thrall.url).toBe("https://everloot.app/lore/291323-thrall");
  const sword = parsed.results.find((r) => r.title.startsWith("Thunderfury"))!;
  expect(sword.url).toBe("https://example.test/items/19019");
  expect(JSON.parse((answer.content as { text: string }[])[0].text)).toEqual(answer.structuredContent);
});

test("fetch gives the whole record with its URL and the source, licence, date and credit as metadata", async () => {
  const c = await client();
  const results = z.object(MCP_TOOLS.search.outputSchema).parse((await c.callTool({ name: "search", arguments: { query: "Thrall" } })).structuredContent).results;
  const id = results.find((r) => r.title === "Thrall")!.id;
  const answer = await c.callTool({ name: "fetch", arguments: { id } });
  expect(answer.isError).not.toBe(true);
  const doc = z.object(MCP_TOOLS.fetch.outputSchema).parse(answer.structuredContent);
  expect(doc).toEqual({
    id, title: "Thrall", text: BODY, url: "https://everloot.app/lore/291323-thrall",
    metadata: { kind: "lore_page", gameVersion: "lore", sourceUrl: "https://warcraft.wiki.gg/wiki/Thrall", sourceId: "curated", licence: "CC-BY-SA-4.0", retrievedAt: "2023-11-13", credit: CREDIT_LINE },
  });
  expect(JSON.parse((answer.content as { text: string }[])[0].text)).toEqual(answer.structuredContent);
});

test("an id that is not a record is an error that says where ids come from", async () => {
  const c = await client();
  for (const id of ["999999", "abc", ""]) {
    const answer = await c.callTool({ name: "fetch", arguments: { id } });
    expect(answer.isError).toBe(true);
    expect((answer.content as { text: string }[])[0].text).toContain("Ids come from search results");
  }
});

test("record URLs follow the site's lore slugs", () => {
  expect(slugify("Thunderfury, Blessed Blade of the Windseeker")).toBe("thunderfury-blessed-blade-of-the-windseeker");
  expect(loreSlug({ extId: "291323", name: "Frostwhisper" })).toBe("291323-frostwhisper");
  expect(loreSlug({ extId: "forever-launch-date", name: "WoW: Forever launch date" })).toBe("forever-launch-date");
  // The launch date has its own page now; the lore address redirects there, so the record links the page.
  expect(recordUrl({ kind: "lore_page", extId: "forever-launch-date", name: "x", sourceUrl: "https://s" }, "https://everloot.app")).toBe("https://everloot.app/wow-forever");
  expect(recordUrl({ kind: "lore_page", extId: "291323", name: "Frostwhisper", sourceUrl: "https://s" }, "https://everloot.app")).toBe("https://everloot.app/lore/291323-frostwhisper");
  expect(recordUrl({ kind: "npc", extId: "1", name: "x", sourceUrl: "https://s" }, "https://everloot.app")).toBe("https://s");
  expect(recordUrl({ kind: "faction", extId: "1", name: "Stormwind", sourceUrl: "x" }, "https://everloot.app")).toBe("https://everloot.app/database/factions/1-stormwind");
});
