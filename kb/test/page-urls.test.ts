import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { GAME_DATA_CREDIT, MCP_CREDIT, MCP_TOOLS, type McpToolName } from "@everloot/protocol";
import { afterEach, expect, test } from "vitest";
import { z } from "zod";
import { openDb, type DB } from "../src/db.js";
import { replaceSourceRows, type EntityInput } from "../src/entities.js";
import { emptyMarket, foldMarket } from "../src/market.js";
import { createKnowledgeServer, SOME_WORDS, type ToolOptions } from "../src/mcp-server.js";
import { changesUrl, collectionsUrl, marketItemUrl, withMore } from "../src/page-urls.js";
import { WORLD_MAP_DATA } from "../src/world-map-file.js";

/**
 * Every tool answer that has a page on everloot.app names it in its text, as a "More: <url>" line, and
 * names none when the page would be empty or not indexed. The structured answer carries the same page
 * as `url`, and nothing outside its published output shape.
 */

const LONG = "Thrall, son of Durotan, was Warchief of the Horde. ".repeat(8).trim();
const AS_OF = "2026-10-18T10:00:00.000Z";
const zone = WORLD_MAP_DATA.zones[0]!;

const records: unknown[] = [];
for (const [i, installId] of ["install-a", "install-b", "install-c"].entries()) {
  const base = { installId, capturedAt: "2026-10-09T00:00:00Z", sourceEvidence: "loot-api" };
  records.push({ ...base, eventId: `name-${i}`, kind: "item_seen", itemId: 1234, name: "Peacebloom", quality: "common" });
  records.push({ ...base, eventId: `seen-${i}`, kind: "npc_sighting", npcId: 456, name: "Forest Spider", mapId: zone.uiMapId, x: 40 + i, y: 61, level: 5, reaction: "hostile", positionKind: "npc" });
  for (let k = 0; k < 4; k++) records.push({ ...base, eventId: `loot-${i}-${k}`, kind: "loot", sourceNpcId: 456, items: k === 0 ? [{ itemId: 1234, count: 1 }] : [] });
  records.push({ ...base, eventId: `vein-${i}`, kind: "loot", sourceObjectId: 1731, items: [{ itemId: 2770, count: 1 }] });
  records.push({ ...base, eventId: `quest-${i}`, kind: "quest", questId: 7, title: "Spiders", level: 5, giverNpcId: 456, turnInNpcId: 456, rewardItemIds: [1234] });
  records.push({ ...base, eventId: `vendor-${i}`, kind: "vendor", vendorNpcId: 99, items: [{ itemId: 1234, priceCopper: 25 }] });
  records.push({ ...base, eventId: `recipe-${i}`, kind: "recipe_seen", profession: "Alchemy", recipe: "Minor Healing Potion", skillMin: 1, skillMax: 10, points: 1, reagents: [{ item: "Peacebloom", count: 1 }] });
  records.push({ ...base, eventId: `price-${i}`, kind: "price_seen", item: "Peacebloom", copper: 10 + i });
  records.push({ ...base, eventId: `colour-${i}`, kind: "recipe_observed", profession: "Alchemy", recipe: "Minor Healing Potion", rank: 50 + i * 5, difficulty: i === 0 ? "optimal" : "medium", reagents: [{ item: "Peacebloom", count: 1 }] });
  records.push({ installId, capturedAt: "2026-10-12T06:00:00Z", eventId: `scan-${i}`, kind: "auction_scan", realm: "Forever", itemId: 5, copper: 200, priceBasis: "unit" });
  records.push({ installId, kind: "collection_catalog", collection: "Mounts", source: "Vendor", itemId: 1 });
  records.push({
    // Any 16 characters: the fact builder only checks the length. Not a real token, and not secret-shaped.
    installId, kind: "guild_snapshot", claimToken: "x".repeat(16), guildName: "Olympus", realm: "Forever",
    members: [{ name: "Ada", rank: "Officer", level: 60, class: "Mage" }],
  });
  records.push({ ...base, eventId: `gold-${i}`, kind: "gold_snapshot", character: "Bigz", realm: "Forever", currentCopper: 120000, peakCopper: 5389075 });
}
records.push({ installId: "owner", kind: "collection_owned", collection: "Mounts", itemId: 1 });

const now = new Date();
const market = foldMarket(emptyMarket(), ["a", "b", "c"].map((who, i) => ({
  kind: "auction_snapshot", installId: `${who}-install`, eventId: `e:${i}`, capturedAt: now.toISOString(), realm: "Forever",
  scanId: `s-${i}`, part: 1, parts: 1, items: [[2589, 2, 40, 100, 110]],
})), now);

const databases: DB[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

async function client(options: ToolOptions = {}) {
  const db = openDb(":memory:");
  databases.push(db);
  const rows: EntityInput[] = [
    { kind: "lore_page", extId: "291323", name: "Thrall", body: LONG, gameVersion: "lore", sourceUrl: "https://warcraft.wiki.gg/wiki/Thrall", retrievedAt: "2023-11-13" },
    // Rendered by the site but not indexed: too short, and a redirect stub.
    { kind: "lore_page", extId: "1001", name: "Thrall stub", body: "Thrall in brief.", gameVersion: "lore", sourceUrl: "https://warcraft.wiki.gg/wiki/Thrall_stub", retrievedAt: "2023-11-13" },
    { kind: "lore_page", extId: "1002", name: "Thrall redirect", body: `REDIRECT ${LONG}`, gameVersion: "lore", sourceUrl: "https://warcraft.wiki.gg/wiki/Go'el", retrievedAt: "2023-11-13" },
    // A record kind the site has no page for.
    { kind: "item", extId: "19019", name: "Thrall's Blade", body: "A sword Thrall never held.", gameVersion: "retail", sourceUrl: "https://example.test/items/19019", retrievedAt: "2023-11-13" },
  ];
  await replaceSourceRows(db, "curated", ["lore_page", "item"], rows);
  const server = createKnowledgeServer(db, { corpus: async () => ({ records, dataAsOf: AS_OF }), market: async () => ({ state: market, dataAsOf: AS_OF }), ...options });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const c = new Client({ name: "test", version: "0" });
  await c.connect(clientSide);
  return c;
}

/** JSON with object keys sorted at every depth, so two objects compare by content alone. */
const canonical = (v: unknown): string => JSON.stringify(v, (_k, x) =>
  x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x);

/** The tool's text, after checking its structured answer holds nothing outside the published output shape. */
async function call(c: Client, name: McpToolName, args: Record<string, unknown>): Promise<string> {
  const result = await c.callTool({ name, arguments: args });
  expect(result.isError, name).not.toBe(true);
  // Parsing drops any key the shape does not declare; a field the frozen schemas lack would show up here.
  const def = MCP_TOOLS[name];
  if (!("outputSchema" in def)) throw new Error("Expected a structured tool");
  const parsed = z.object(def.outputSchema).parse(result.structuredContent);
  expect(canonical(parsed), name).toBe(canonical(result.structuredContent));
  return (result.content as { text: string }[])[0]!.text;
}

const THRALL = "https://everloot.app/lore/291323-thrall";
const FOOTER = `Data as of 2026-10-18 10:00 UTC.\n${MCP_CREDIT}`;

test("each tool built on uploads links its page last before the data age and credit, and only when the page has something", async () => {
  const c = await client();
  const linked: [McpToolName, Record<string, unknown>, string][] = [
    ["item_page", { itemId: 1234 }, "https://everloot.app/database/items/1234"],
    ["npc_page", { npcId: 456 }, "https://everloot.app/database/npcs/456"],
    ["quest_page", { questId: 7 }, "https://everloot.app/database/quests/7"],
    ["vendor_page", { vendorNpcId: 99 }, "https://everloot.app/database/vendors/99"],
    ["object_page", { objectId: 1731 }, "https://everloot.app/database/objects/1731"],
    ["entity_relations", { kind: "item", id: 1234 }, "https://everloot.app/database/items/1234"],
    ["world_map_near", { npcId: 456 }, "https://everloot.app/database/npcs/456"],
    ["world_map_near", { zone: zone.name, x: 50.04, y: 49.96 }, `https://everloot.app/map?zone=${zone.uiMapId}&x=50&y=50`],
    ["profession_path", { profession: "Alchemy", fromSkill: 1, toSkill: 10 }, "https://everloot.app/tools/professions?profession=Alchemy&from=1&to=10"],
    ["recipe_thresholds", { profession: "Alchemy" }, "https://everloot.app/tools/professions?profession=Alchemy"],
    ["collection_gap", { collection: "Mounts", ownerInstallId: "owner" }, "https://everloot.app/tools/collections?collection=Mounts&install=owner"],
    ["guild_board", { guildName: "Olympus", realm: "Forever" }, "https://everloot.app/tools/guild-board?guild=Olympus&realm=Forever"],
    ["gold_ledger", { character: "bigz", realm: "forever" }, "https://everloot.app/tools/gold-ledger?character=Bigz&realm=Forever"],
    ["auction_history", { realm: "Forever", itemId: 5 }, "https://everloot.app/tools/auctions?realm=Forever&item=5"],
    ["market_value", { realm: "Forever", itemId: 2589 }, "https://everloot.app/tools/auctions?realm=Forever&item=2589"],
  ];
  for (const [name, args, url] of linked) {
    const text = await call(c, name, args);
    expect(text.endsWith(`\nMore: ${url}\n${FOOTER}`), `${name} ${JSON.stringify(args)}:\n${text}`).toBe(true);
  }
  const unlinked: [McpToolName, Record<string, unknown>][] = [
    ["item_page", { itemId: 999 }], ["npc_page", { npcId: 999 }], ["quest_page", { questId: 999 }],
    ["vendor_page", { vendorNpcId: 999 }], ["object_page", { objectId: 999 }],
    ["entity_relations", { kind: "spell", id: 2330 }], ["entity_relations", { kind: "npc", id: 999 }],
    ["world_map_near", { npcId: 999999 }],
    ["profession_path", { profession: "Tailoring", fromSkill: 1, toSkill: 10 }], ["recipe_thresholds", { profession: "Tailoring" }],
    ["collection_gap", { collection: "Pets", ownerInstallId: "owner" }], ["guild_board", { guildName: "Nobody", realm: "Forever" }],
    ["gold_ledger", { character: "Nobody", realm: "Forever" }], ["auction_history", { realm: "Forever", itemId: 6 }],
    ["market_value", { realm: "Forever", itemId: 1 }],
  ];
  for (const [name, args] of unlinked) expect(await call(c, name, args), `${name} ${JSON.stringify(args)}`).not.toContain("More:");
});

test("an item the game files list links its page before anyone reports it; an id they do not list links none", async () => {
  const c = await client();
  // Linen Cloth (2589) is in the committed client layer, with no upload about it in this corpus.
  const text = await call(c, "item_page", { itemId: 2589 });
  expect(text.endsWith(`\nMore: https://everloot.app/database/items/2589\n${FOOTER}`), text).toBe(true);
  expect(text).toContain("No agreed name yet.");
  const relations = await call(c, "entity_relations", { kind: "item", id: 2589 });
  expect(relations.endsWith(`\nMore: https://everloot.app/database/items/2589\n${FOOTER}`), relations).toBe(true);
  expect(await call(c, "item_page", { itemId: 99999999 })).not.toContain("More:");
});

test("with no corpus there is no page to send anyone to", async () => {
  const c = await client({ corpus: undefined, market: undefined });
  for (const [name, args] of [["item_page", { itemId: 1234 }], ["market_value", { realm: "Forever", itemId: 2589 }]] as const) {
    expect(await call(c, name, args)).not.toContain("More:");
  }
});

test("knowledge hits link their indexed lore page, and only that", async () => {
  const c = await client();
  const search = await call(c, "search_knowledge", { query: "Thrall" });
  expect(search).toContain(`Source: https://warcraft.wiki.gg/wiki/Thrall (CC-BY-SA-4.0, retrieved 2023-11-13)\nMore: ${THRALL}`);
  expect(search.match(/More: /g)).toHaveLength(1);

  const hits = z.object(MCP_TOOLS.search_knowledge.outputSchema).parse((await c.callTool({ name: "search_knowledge", arguments: { query: "Thrall" } })).structuredContent).hits;
  const one = await call(c, "get_entity", { id: hits.find((h) => h.name === "Thrall")!.id });
  expect(one.endsWith(`\nMore: ${THRALL}`)).toBe(true);
  for (const name of ["Thrall stub", "Thrall redirect", "Thrall's Blade"]) {
    expect(await call(c, "get_entity", { id: hits.find((h) => h.name === name)!.id }), name).not.toContain("More:");
  }
  expect(await call(c, "get_by_name", { name: "thrall" })).toContain(`More: ${THRALL}`);
});

test("answer_sources gives a lore piece its page beside its wiki source", async () => {
  const c = await client();
  const text = await call(c, "answer_sources", { question: "Who is Thrall?" });
  expect(text).toContain(`  Source: https://warcraft.wiki.gg/wiki/Thrall (CC-BY-SA-4.0, as of 2023-11-13)\n  More: ${THRALL}`);
  expect(text.match(/More: /g)).toHaveLength(1);
  expect(text.endsWith(MCP_CREDIT)).toBe(true);
});

test("the game-file tools link before Blizzard's credit", async () => {
  const c = await client();
  expect((await call(c, "item_categories", {})).endsWith(`\nMore: https://everloot.app/database/items\n${GAME_DATA_CREDIT}`)).toBe(true);
  expect(await call(c, "item_categories", { class: "no-such-class" })).not.toContain("More:");
  expect((await call(c, "talent_tree", { class: "mage" })).endsWith(`\nMore: https://everloot.app/tools/talents/mage\n${GAME_DATA_CREDIT}`)).toBe(true);
});

test("the structured answers carry the same page as url, and no url where the text has no link", async () => {
  const c = await client();
  const structured = async (name: McpToolName, args: Record<string, unknown>) => {
    const def = MCP_TOOLS[name];
    if (!("outputSchema" in def)) throw new Error("Expected a structured tool");
    return z.object(def.outputSchema).parse((await c.callTool({ name, arguments: args })).structuredContent) as Record<string, unknown>;
  };
  const hits = (await structured("search_knowledge", { query: "Thrall" })).hits as { id: number; name: string; url?: string }[];
  expect(Object.fromEntries(hits.map((h) => [h.name, h.url]))).toEqual({
    Thrall: THRALL, "Thrall stub": undefined, "Thrall redirect": undefined, "Thrall's Blade": undefined,
  });
  expect((await structured("get_entity", { id: hits.find((h) => h.name === "Thrall")!.id })).hit).toMatchObject({ url: THRALL });
  expect((await structured("get_by_name", { name: "thrall" })).hits).toEqual([expect.objectContaining({ url: THRALL })]);
  const evidence = (await structured("answer_sources", { question: "Who is Thrall?" })).evidence as { source: { title: string }; url?: string }[];
  expect(evidence.find((e) => e.source.title === "Thrall")).toMatchObject({ url: THRALL });
  expect(evidence.find((e) => e.source.title === "Thrall stub")).not.toHaveProperty("url");
  // A fallback answer says so in its text; the structured answer keeps its published shape.
  const partial = (await c.callTool({ name: "answer_sources", arguments: { question: "best warchief for horde mains" } })).structuredContent as Record<string, unknown>;
  expect(partial).not.toHaveProperty("someWords");
  expect(partial.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ url: THRALL })]));
  expect(await call(c, "answer_sources", { question: "best warchief for horde mains" })).toContain(SOME_WORDS);
  expect(await structured("item_categories", {})).toMatchObject({ url: "https://everloot.app/database/items" });
  expect(await structured("item_categories", { class: "no-such-class" })).not.toHaveProperty("url");
  expect(await structured("item_page", { itemId: 1234 })).toMatchObject({ url: "https://everloot.app/database/items/1234" });
  expect(await structured("item_page", { itemId: 999 })).not.toHaveProperty("url");
});

test("page links are absolute, encoded like the site's own, and the More line sits before a credit", () => {
  // The single place market links are built: an item on a realm whose name has a space.
  expect(marketItemUrl(" Mirage Raceway ", 2589)).toBe("https://everloot.app/tools/auctions?realm=Mirage%20Raceway&item=2589");
  expect(collectionsUrl({ install: "a b", collection: "Mounts & Pets" })).toBe("https://everloot.app/tools/collections?collection=Mounts%20%26%20Pets&install=a%20b");
  expect(changesUrl("all", "forever")).toBe("https://everloot.app/changes");
  expect(changesUrl("hotfixes", "classic")).toBe("https://everloot.app/changes?show=hotfixes&game=all");
  expect(withMore("Body.", undefined)).toBe("Body.");
  expect(withMore("Body.", "https://everloot.app/x")).toBe("Body.\nMore: https://everloot.app/x");
  expect(withMore(`Body.\n${GAME_DATA_CREDIT}`, "https://everloot.app/x", GAME_DATA_CREDIT)).toBe(`Body.\nMore: https://everloot.app/x\n${GAME_DATA_CREDIT}`);
});
