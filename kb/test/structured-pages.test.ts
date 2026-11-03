import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MCP_TOOLS } from "@everloot/protocol";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { z } from "zod";
import { openDb, type DB } from "../src/db.js";
import { itemFactsFromRecords } from "../src/drop-rollup.js";
import { itemPage } from "../src/item-page.js";
import { createKnowledgeServer, UPLOADS_UNSET } from "../src/mcp-server.js";
import { objectFactsFromRecords, objectPage } from "../src/object-page.js";
import { npcPage, questPage, vendorPage, worldFactsFromRecords } from "../src/world-pages.js";

const OUT = {
  item_page: z.object(MCP_TOOLS.item_page.outputSchema),
  npc_page: z.object(MCP_TOOLS.npc_page.outputSchema),
  quest_page: z.object(MCP_TOOLS.quest_page.outputSchema),
  vendor_page: z.object(MCP_TOOLS.vendor_page.outputSchema),
  object_page: z.object(MCP_TOOLS.object_page.outputSchema),
};
const out = <K extends keyof typeof OUT>(name: K): (typeof OUT)[K] => OUT[name];

const AS_OF = "2026-10-18T10:00:00.000Z";
const base = { capturedAt: "2026-10-09T00:00:00Z", sourceEvidence: "loot-api" };
const records: unknown[] = [];
for (const [i, installId] of ["install-a", "install-b", "install-c"].entries()) {
  records.push({ ...base, installId, eventId: `name-${i}`, kind: "item_seen", itemId: 1234, name: "Peacebloom", quality: "common" });
  records.push({ ...base, installId, eventId: `seen-${i}`, kind: "npc_sighting", npcId: 456, name: "Forest Spider", mapId: 141, x: 40 + i, y: 61, level: 5, reaction: "hostile", positionKind: "npc" });
  for (let k = 0; k < 4; k++) records.push({ ...base, installId, eventId: `loot-${i}-${k}`, kind: "loot", sourceNpcId: 456, items: k === 0 ? [{ itemId: 1234, count: 1 }] : [] });
  records.push({ ...base, installId, eventId: `vein-${i}`, kind: "loot", sourceObjectId: 1731, items: [{ itemId: 2770, count: 1 }] });
  records.push({ ...base, installId, eventId: `quest-${i}`, kind: "quest", questId: 7, title: "Spiders", level: 5, giverNpcId: 456, turnInNpcId: 456, rewardItemIds: [1234] });
  records.push({ ...base, installId, eventId: `vendor-${i}`, kind: "vendor", vendorNpcId: 99, items: [{ itemId: 1234, priceCopper: 25 }] });
}

const databases: DB[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
beforeEach(() => { vi.unstubAllEnvs(); });

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

test("each page tool answers with its page under the uploads envelope, and the text is the same page with the data's age", async () => {
  const c = await client(async () => ({ records, dataAsOf: AS_OF }));
  const world = worldFactsFromRecords(records);

  const item = await c.callTool({ name: "item_page", arguments: { itemId: 1234 } });
  const itemOut = out("item_page").parse(item.structuredContent);
  expect(itemOut).toEqual({ connected: true, dataAsOf: AS_OF, url: "https://everloot.app/database/items/1234", page: { ...itemPage(1234, itemFactsFromRecords(records)), reported: { shown: [], contested: [] } } });
  expect(itemOut.page!.name).toBe("Peacebloom");
  expect(itemOut.page!.drops[0]).toMatchObject({ sourceNpcId: 456, source: "NPC 456 Forest Spider", kills: 12, drops: 3, reporters: 3 });
  expect(itemOut.page!.pins[0]).toMatchObject({ npcId: 456, name: "Forest Spider", mapId: 141, x: 41, y: 61, reporters: 3 });
  const itemText = JSON.stringify(item.content);
  expect(itemText).toContain("Peacebloom");
  expect(itemText).toContain("Data as of 2026-10-18 10:00 UTC.");
  expect(itemText).not.toContain("Licence:");
  // The page link is the body's last line, before the data age the answer must end with.
  const itemLines = (item.content as { text: string }[])[0]!.text.split("\n");
  expect(itemLines.slice(-2)).toEqual(["More: https://everloot.app/database/items/1234", "Data as of 2026-10-18 10:00 UTC."]);

  const npc = out("npc_page").parse((await c.callTool({ name: "npc_page", arguments: { npcId: 456 } })).structuredContent);
  expect(npc).toEqual({ connected: true, dataAsOf: AS_OF, url: "https://everloot.app/database/npcs/456", page: npcPage(456, world) });
  expect(npc.page!.pins).toEqual([{ mapId: 141, x: 41, y: 61, reporters: 3 }]);

  const quest = out("quest_page").parse((await c.callTool({ name: "quest_page", arguments: { questId: 7 } })).structuredContent);
  expect(quest).toEqual({ connected: true, dataAsOf: AS_OF, url: "https://everloot.app/database/quests/7", page: questPage(7, world) });
  expect(quest.page).toEqual({ questId: 7, title: "Spiders", level: 5, giverNpcId: 456, turnInNpcId: 456, rewards: [1234] });

  const vendor = out("vendor_page").parse((await c.callTool({ name: "vendor_page", arguments: { vendorNpcId: 99 } })).structuredContent);
  expect(vendor).toEqual({ connected: true, dataAsOf: AS_OF, url: "https://everloot.app/database/vendors/99", page: vendorPage(99, world) });
  expect(vendor.page!.offers).toEqual([{ itemId: 1234, priceCopper: 25, limitedStock: null, unlimited: true, reporters: 3 }]);

  const object = out("object_page").parse((await c.callTool({ name: "object_page", arguments: { objectId: 1731 } })).structuredContent);
  expect(object).toEqual({ connected: true, dataAsOf: AS_OF, url: "https://everloot.app/database/objects/1731", page: objectPage(1731, objectFactsFromRecords(records)) });
  expect(object.page!.drops[0]).toMatchObject({ itemId: 2770, kills: 3, drops: 3, reporters: 3 });
});

test("reported loot windows not yet in the rates, and minimap pins, are in the page answers, never in the drops", async () => {
  const ps = (c: string) => `ps-${c.repeat(16)}-${String.fromCharCode(c.charCodeAt(0) + 49).repeat(16)}`;
  const recorder = ["1", "2", "3"].flatMap((c) => [
    { installId: ps(c), capturedAt: base.capturedAt, eventId: `ps:1:1:loot`, kind: "loot", sourceNpcId: 456, items: [{ itemId: 1234, count: 1 }] },
    { installId: ps(c), capturedAt: base.capturedAt, eventId: `ps:1:2:loot`, kind: "loot", sourceObjectId: 1731, items: [{ itemId: 2770, count: 1 }] },
    { installId: ps(c), capturedAt: base.capturedAt, eventId: `ps:1:3:object_sighting`, kind: "object_sighting", objectId: 1731, name: "Copper Vein", mapId: 1411, x: 50, y: 50 },
  ]);
  const c = await client(async () => ({ records: [...records, ...recorder], dataAsOf: AS_OF }));
  const npc = out("npc_page").parse((await c.callTool({ name: "npc_page", arguments: { npcId: 456 } })).structuredContent);
  expect(npc.page!.pendingLoot).toEqual({ windows: 3, reporters: 3 });
  const item = await c.callTool({ name: "item_page", arguments: { itemId: 1234 } });
  const itemOut = out("item_page").parse(item.structuredContent);
  expect(itemOut.page!.pendingLoot).toEqual({ windows: 3, reporters: 3 });
  expect(itemOut.page!.drops[0]).toMatchObject({ kills: 12, drops: 3, reporters: 3 });
  expect(JSON.stringify(item.content)).toContain("3 more loot windows with this item reported, not yet in the rates.");
  const object = out("object_page").parse((await c.callTool({ name: "object_page", arguments: { objectId: 1731 } })).structuredContent);
  expect(object.page).toMatchObject({ name: "Copper Vein", pendingLoot: { windows: 3, reporters: 3 }, pins: [{ mapId: 1411, x: 50, y: 50, reporters: 3 }] });
  expect(object.page!.drops[0]).toMatchObject({ kills: 3, reporters: 3 });
});

test("an unknown id is a page with nothing agreed, not an error and not a zero", async () => {
  const c = await client(async () => ({ records, dataAsOf: AS_OF }));
  const result = await c.callTool({ name: "item_page", arguments: { itemId: 999 } });
  expect(result.isError).not.toBe(true);
  const parsed = out("item_page").parse(result.structuredContent);
  expect(parsed.page).toEqual({ itemId: 999, name: null, drops: [], pins: [], reported: { shown: [], contested: [] } });
  expect(JSON.stringify(result.content)).toContain("Drop rate unrecorded");
  // Its page on the site is empty and not indexed, so the answer links nowhere.
  expect(parsed).not.toHaveProperty("url");
  expect(JSON.stringify(result.content)).not.toContain("More:");
  for (const [name, args] of [["npc_page", { npcId: 999 }], ["quest_page", { questId: 999 }], ["vendor_page", { vendorNpcId: 999 }], ["object_page", { objectId: 999 }]] as const) {
    expect((await c.callTool({ name, arguments: args })).structuredContent, name).not.toHaveProperty("url");
  }
});

test("with no corpus the structure says not connected and why; an unreadable corpus says unavailable", async () => {
  const unset = out("npc_page").parse((await (await client()).callTool({ name: "npc_page", arguments: { npcId: 1 } })).structuredContent);
  expect(unset).toEqual({ connected: false, dataAsOf: null, reason: UPLOADS_UNSET });
  const down = await (await client(async () => { throw new Error("down"); })).callTool({ name: "npc_page", arguments: { npcId: 1 } });
  const downOut = out("npc_page").parse(down.structuredContent);
  expect(downOut.connected).toBe(false);
  expect(downOut.reason).toMatch(/unavailable/i);
  expect(JSON.stringify(down.content)).toMatch(/unavailable/i);
  expect(downOut).not.toHaveProperty("page");
});
