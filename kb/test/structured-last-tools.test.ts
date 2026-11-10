import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MCP_TOOL_NAMES, MCP_TOOLS, STRUCTURED_TOOLS } from "@everloot/protocol";
import { afterEach, expect, test } from "vitest";
import { z } from "zod";
import { openDb, type DB } from "../src/db.js";
import { goldFactsFromRecords, goldLedger } from "../src/gold-ledger.js";
import { createKnowledgeServer } from "../src/mcp-server.js";
import { WORLD_MAP_DATA } from "../src/world-map-file.js";
import { mapFactsFromRecords, nearResult } from "../src/world-map-near.js";

const OUT = {
  gold_ledger: z.object(MCP_TOOLS.gold_ledger.outputSchema),
  world_map_near: z.object(MCP_TOOLS.world_map_near.outputSchema),
};

const AS_OF = "2026-10-18T10:00:00.000Z";
const zone = WORLD_MAP_DATA.zones[0];
const records: unknown[] = [];
for (const [i, installId] of ["a", "b", "c"].entries()) {
  const base = { installId, capturedAt: "2026-10-09T00:00:00Z" };
  records.push({ ...base, eventId: `snap-${i}`, kind: "gold_snapshot", character: "Bigz", realm: "Forever", currentCopper: 120000, peakCopper: 5389075 });
  records.push({ ...base, eventId: `loot-${i}`, kind: "money_event", character: "Bigz", realm: "Forever", category: "loot", copper: 64600 });
  records.push({ ...base, eventId: `npc-${i}`, kind: "npc_sighting", npcId: 77, name: "Centre Guard", mapId: zone.uiMapId, x: 50, y: 50, level: 5, reaction: "friendly", positionKind: "npc" });
  records.push({ ...base, eventId: `npc2-${i}`, kind: "npc_sighting", npcId: 78, name: "Near Smith", mapId: zone.uiMapId, x: 50.5, y: 50, level: 5, reaction: "friendly", positionKind: "npc" });
}

const databases: DB[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

async function client(corpus?: () => Promise<{ records: unknown[]; dataAsOf: string } | null>) {
  const db = openDb(":memory:");
  databases.push(db);
  const server = createKnowledgeServer(db, corpus ? { corpus } : {});
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const c = new Client({ name: "test", version: "0" });
  await c.connect(clientSide);
  return c;
}

test("every tool declares an output schema", async () => {
  expect(STRUCTURED_TOOLS).toEqual(MCP_TOOL_NAMES);
  const listed = (await (await client()).listTools()).tools;
  for (const tool of listed) expect(tool.outputSchema !== undefined, tool.name).toBe(true);
});

test("gold_ledger answers with one ledger per install, never merged, with unrecorded as null", async () => {
  const c = await client(async () => ({ records, dataAsOf: AS_OF }));
  const result = await c.callTool({ name: "gold_ledger", arguments: { character: "bigz", realm: "forever" } });
  const out = OUT.gold_ledger.parse(result.structuredContent);
  const facts = goldFactsFromRecords(records);
  // The link names the character as the uploads spell it.
  expect(out).toEqual({ connected: true, dataAsOf: AS_OF, url: "https://everloot.app/tools/gold-ledger?character=Bigz&realm=Forever", page: goldLedger("bigz", "forever", facts.snapshots, facts.events) });
  expect(out.page).toMatchObject({ character: "Bigz", realm: "Forever", recorded: true });
  expect(out.page!.ledgers.map((l) => l.installId)).toEqual(["a", "b", "c"]);
  expect(out.page!.ledgers[0]).toEqual({ installId: "a", peakCopper: 5389075, currentCopper: 120000, income: { loot: 64600 }, spending: {}, incomeTotal: 64600 });
  const text = JSON.stringify(result.content);
  expect(text).toContain("Ledgers are not merged.");
  expect(text).toContain("Recorded income is 6g 46s 0c. Peak gold is 538g 90s 75c. The difference is unrecorded.");

  const nobody = OUT.gold_ledger.parse((await c.callTool({ name: "gold_ledger", arguments: { character: "Nobody", realm: "Forever" } })).structuredContent);
  expect(nobody.page).toEqual({ character: "Nobody", realm: "Forever", recorded: false, ledgers: [] });
  expect(nobody).not.toHaveProperty("url");
  const blank = await c.callTool({ name: "gold_ledger", arguments: { character: " ", realm: "Forever" } });
  expect(JSON.stringify(blank.content)).toContain("Name a character.");
  expect(OUT.gold_ledger.parse(blank.structuredContent).page).toEqual({ character: "", realm: "Forever", recorded: false, ledgers: [] });
});

test("world_map_near answers with the entrances and pins the text lists, and a refused query as ok false", async () => {
  const c = await client(async () => ({ records, dataAsOf: AS_OF }));
  const facts = mapFactsFromRecords(records);
  const args = { npcId: 77, radius: 500, limit: 5 };
  const result = await c.callTool({ name: "world_map_near", arguments: args });
  const out = OUT.world_map_near.parse(result.structuredContent);
  // From an NPC: that NPC's page, which has its agreed pin.
  expect(out).toEqual({ connected: true, dataAsOf: AS_OF, url: "https://everloot.app/database/npcs/77", page: nearResult(args, WORLD_MAP_DATA, facts) });
  expect(out.page!.ok).toBe(true);
  expect(out.page!.origin).toContain("Centre Guard");
  expect(out.page!.npcs).toMatchObject([{ npcId: 78, name: "Near Smith", reporters: 3 }]);
  expect(out.page!.npcs![0].yards).toBeGreaterThan(0);
  expect(JSON.stringify(result.content)).toContain(`Near Smith (NPC 78) in ${zone.name}`);

  const refused = await c.callTool({ name: "world_map_near", arguments: { npcId: 999999 } });
  const page = OUT.world_map_near.parse(refused.structuredContent).page!;
  expect(page.ok).toBe(false);
  expect(page.message).toContain("NPC 999999 has no agreed position");
  expect(JSON.stringify(refused.content)).toContain(page.message!);
  expect(refused.structuredContent).not.toHaveProperty("url");

  // From a spot, named by zone name: the map centred there, by the zone's map id.
  const spot = await c.callTool({ name: "world_map_near", arguments: { zone: zone.name, x: 50.04, y: 49.96 } });
  const spotUrl = `https://everloot.app/map?zone=${zone.uiMapId}&x=50&y=50`;
  expect(spot.structuredContent).toMatchObject({ connected: true, url: spotUrl });
  expect(JSON.stringify(spot.content)).toContain(`More: ${spotUrl}`);
});
