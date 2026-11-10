import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MCP_TOOLS } from "@everloot/protocol";
import { afterEach, expect, test } from "vitest";
import { z } from "zod";
import { completionProgress, type CompletionFacts } from "../src/completion.js";
import { openDb, type DB } from "../src/db.js";
import { entityRelationsStructured, observedEdgesFromRecords } from "../src/edges.js";
import { CLIENT_EDGES } from "../src/client-layer-file.js";
import { emptyMarket, foldMarket, itemMarket } from "../src/market.js";
import { COMPLETION_UNSET, createKnowledgeServer, MARKET_UNSET } from "../src/mcp-server.js";
import { professionPath } from "../src/profession-path.js";
import { pathFactsFromRecords, recipeFactsFromRecords, recipeThresholdsStructured } from "../src/recipe-thresholds.js";

const OUT = {
  profession_path: z.object(MCP_TOOLS.profession_path.outputSchema),
  recipe_thresholds: z.object(MCP_TOOLS.recipe_thresholds.outputSchema),
  entity_relations: z.object(MCP_TOOLS.entity_relations.outputSchema),
  completion_progress: z.object(MCP_TOOLS.completion_progress.outputSchema),
  market_value: z.object(MCP_TOOLS.market_value.outputSchema),
};

const AS_OF = "2026-10-18T10:00:00.000Z";
const records: unknown[] = [];
for (const [i, installId] of ["a", "b", "c"].entries()) {
  const base = { installId, capturedAt: "2026-10-09T00:00:00Z", eventId: `${installId}-${i}` };
  records.push({ ...base, kind: "recipe_seen", profession: "Alchemy", recipe: "Minor Healing Potion", skillMin: 1, skillMax: 10, points: 1, reagents: [{ item: "Peacebloom", count: 1 }] });
  records.push({ ...base, kind: "price_seen", item: "Peacebloom", copper: 10 + i });
  records.push({ ...base, kind: "recipe_observed", profession: "Alchemy", recipe: "Minor Healing Potion", rank: 50 + i * 5, difficulty: i === 0 ? "optimal" : "medium", reagents: [{ item: "Peacebloom", count: 1 }] });
  for (let k = 0; k < 2; k++) records.push({ ...base, eventId: `loot-${i}-${k}`, kind: "loot", sourceEvidence: "loot-api", sourceNpcId: 456, items: [{ itemId: 1234, count: 1 }] });
}

const databases: DB[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

async function client(options: Parameters<typeof createKnowledgeServer>[1] = {}) {
  const db = openDb(":memory:");
  databases.push(db);
  const server = createKnowledgeServer(db, options);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const c = new Client({ name: "test", version: "0" });
  await c.connect(clientSide);
  return c;
}
const corpus = async () => ({ records, dataAsOf: AS_OF });

test("profession_path and recipe_thresholds answer with the path and the ranges the text is written from", async () => {
  const c = await client({ corpus });
  const facts = pathFactsFromRecords(records);
  const path = OUT.profession_path.parse((await c.callTool({ name: "profession_path", arguments: { profession: "Alchemy", fromSkill: 1, toSkill: 10 } })).structuredContent);
  expect(path).toEqual({ connected: true, dataAsOf: AS_OF, url: "https://everloot.app/tools/professions/171-alchemy?from=1&to=10", page: professionPath(facts.sightings, facts.prices, { profession: "Alchemy", fromSkill: 1, toSkill: 10 }, facts.derived, facts.vendorPrices) });
  expect(path.page!.steps).toMatchObject([{ recipe: "Minor Healing Potion", fromSkill: 1, toSkill: 10, crafts: 9, reporters: 3, copper: 99 }]);
  expect(path.page!.copper).toBe(99);

  const rf = recipeFactsFromRecords(records);
  const result = await c.callTool({ name: "recipe_thresholds", arguments: { profession: "Alchemy" } });
  const ranges = OUT.recipe_thresholds.parse(result.structuredContent);
  expect(ranges).toEqual({ connected: true, dataAsOf: AS_OF, url: "https://everloot.app/tools/professions/171-alchemy", page: recipeThresholdsStructured({ profession: "Alchemy" }, rf.observations, rf.prices, rf.vendorPrices) });
  expect(ranges.page!.ranges).toMatchObject([{ recipe: "Minor Healing Potion", installs: 3, yellow: { min: 51, max: 55 }, reagents: [{ item: "Peacebloom", count: 1 }], costCopper: 11, missingPrices: [] }]);
  expect(JSON.stringify(result.content)).toContain("Estimated cost per craft: 11c");
  expect(JSON.stringify(result.content)).toContain("More: https://everloot.app/tools/professions/171-alchemy");
  const none = OUT.recipe_thresholds.parse((await c.callTool({ name: "recipe_thresholds", arguments: { profession: "Tailoring" } })).structuredContent);
  expect(none.page).toEqual({ profession: "Tailoring", ranges: [] });
  // Nothing agreed for Tailoring: its hub would be empty, so no link.
  expect(none).not.toHaveProperty("url");
  const noPath = OUT.profession_path.parse((await c.callTool({ name: "profession_path", arguments: { profession: "Tailoring", fromSkill: 1, toSkill: 10 } })).structuredContent);
  expect(noPath).not.toHaveProperty("url");
});

test("a blank profession is refused as an error, not answered as a connected empty page", async () => {
  const c = await client({ corpus });
  const blank = { profession_path: { profession: "  ", fromSkill: 1, toSkill: 10 }, recipe_thresholds: { profession: "  " } };
  for (const [name, args] of Object.entries(blank)) {
    const result = await c.callTool({ name, arguments: args });
    expect(result.isError, name).toBe(true);
    expect(result.structuredContent, name).toBeUndefined();
    expect(JSON.stringify(result.content), name).toContain("Name a profession.");
  }
  // Refused before any read: the same answer when no corpus is connected.
  const offline = await (await client()).callTool({ name: "profession_path", arguments: { profession: "", fromSkill: 1, toSkill: 10 } });
  expect(offline.isError).toBe(true);
  expect(JSON.stringify(offline.content)).toContain("Name a profession.");
});

test("an unknown profession is refused as an error that lists the professions, not answered as one long gap", async () => {
  const c = await client({ corpus });
  const unknown = { profession_path: { profession: "Necromancy", fromSkill: 1, toSkill: 75 }, recipe_thresholds: { profession: "Necromancy" } };
  for (const [name, args] of Object.entries(unknown)) {
    const result = await c.callTool({ name, arguments: args });
    expect(result.isError, name).toBe(true);
    expect(result.structuredContent, name).toBeUndefined();
    const text = JSON.stringify(result.content);
    expect(text, name).toContain('No profession named \\"Necromancy\\".');
    expect(text, name).toContain("Alchemy, Blacksmithing, Cooking, Enchanting, Engineering, First Aid, Fishing, Herbalism, Leatherworking, Mining, Skinning, Tailoring.");
    expect(text, name).not.toMatch(/Gap|DNT/);
  }
  // The game's names in any case are professions.
  const lower = await c.callTool({ name: "profession_path", arguments: { profession: "alchemy", fromSkill: 1, toSkill: 10 } });
  expect(lower.isError).toBeFalsy();
});

test("entity_relations answers with the observed and game-file edges the text lists, cut per group", async () => {
  const c = await client({ corpus });
  const observed = observedEdgesFromRecords(records);
  const result = await c.callTool({ name: "entity_relations", arguments: { kind: "item", id: 1234 } });
  const out = OUT.entity_relations.parse(result.structuredContent);
  // The item has public drops, so its page has something on it and the answer links there.
  expect(out).toEqual({ connected: true, dataAsOf: AS_OF, url: "https://everloot.app/database/items/1234", page: entityRelationsStructured({ kind: "item", id: 1234, direction: "both", limit: 25 }, observed, CLIENT_EDGES) });
  expect(out.page!.edges).toContainEqual(expect.objectContaining({ fromKind: "item", fromId: 1234, rel: "dropped_by", toKind: "npc", toId: 456, evidence: "observed", installs: 3 }));
  expect(JSON.stringify(result.content)).toContain("More: https://everloot.app/database/items/1234");
  const one = OUT.entity_relations.parse((await c.callTool({ name: "entity_relations", arguments: { kind: "npc", id: 456, limit: 1 } })).structuredContent);
  expect(one.page!.edges.length).toBe(1);
  expect(one.page!.notShown).toBe(0);
  // No name or pin is agreed for NPC 456 here, so its page is not indexed and is not linked; a spell has no page.
  expect(one).not.toHaveProperty("url");
  const spell = OUT.entity_relations.parse((await c.callTool({ name: "entity_relations", arguments: { kind: "spell", id: 2330 } })).structuredContent);
  expect(spell).not.toHaveProperty("url");
});

test("completion_progress and market_value answer from their own loaders, and say when they are not connected", async () => {
  const facts: CompletionFacts = { achievements: new Map(), factions: new Map(), titles: new Map(), chains: new Map(), owned: [] };
  const completion = OUT.completion_progress.parse((await (await client({ completion: async () => ({ facts, dataAsOf: AS_OF }) })).callTool({ name: "completion_progress", arguments: { ownerInstallId: "owner" } })).structuredContent);
  // Nothing of this install's is shared, so the completion page would be empty: no link.
  expect(completion).toEqual({ connected: true, dataAsOf: AS_OF, page: completionProgress("owner", undefined, facts) });
  expect(completion.page).toMatchObject({ ownerInstallId: "owner", ownedRecorded: false, characters: [] });
  const noCompletion = await (await client()).callTool({ name: "completion_progress", arguments: { ownerInstallId: "owner" } });
  expect(OUT.completion_progress.parse(noCompletion.structuredContent)).toEqual({ connected: false, dataAsOf: null, reason: COMPLETION_UNSET });
  expect(JSON.stringify(noCompletion.content)).toContain(COMPLETION_UNSET);

  const now = new Date();
  const scans = ["a-install", "b-install", "c-install"].map((installId, i) => ({
    kind: "auction_snapshot", installId, eventId: `e:${i}`, capturedAt: now.toISOString(), realm: "Forever",
    scanId: `s-${i}`, part: 1, parts: 1, items: [[2589, 2, 40, 100, 110]],
  }));
  const state = foldMarket(emptyMarket(), scans, now);
  const marketClient = await client({ market: async () => ({ state, dataAsOf: AS_OF }) });
  const marketResult = await marketClient.callTool({ name: "market_value", arguments: { realm: "Forever", itemId: 2589 } });
  const market = OUT.market_value.parse(marketResult.structuredContent);
  const expected = itemMarket(state, "Forever", 2589, now);
  expect(market).toEqual({ connected: true, dataAsOf: AS_OF, url: "https://everloot.app/tools/auctions?realm=Forever&item=2589", page: { realm: "Forever", itemId: 2589, value: expected.value, history: expected.points, realmStatus: "exact" } });
  expect(market.page!.value).toMatchObject({ itemId: 2589, market: 110, reporters: 3 });
  expect(JSON.stringify(marketResult.content)).toContain("More: https://everloot.app/tools/auctions?realm=Forever&item=2589");
  // An item nobody scanned has an empty price page: no link.
  expect((await marketClient.callTool({ name: "market_value", arguments: { realm: "Forever", itemId: 1 } })).structuredContent).not.toHaveProperty("url");
  expect(OUT.market_value.parse((await (await client()).callTool({ name: "market_value", arguments: { realm: "Forever", itemId: 2589 } })).structuredContent)).toEqual({ connected: false, dataAsOf: null, reason: MARKET_UNSET });
});
