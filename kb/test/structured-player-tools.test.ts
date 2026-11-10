import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MCP_TOOLS } from "@everloot/protocol";
import { afterEach, expect, test } from "vitest";
import { z } from "zod";
import { auctionHistories, auctionHistory, auctionHistoryKey, auctionSightingsFromRecords } from "../src/auction-history.js";
import { collectionFactsFromRecords, collectionGap } from "../src/collection-gap.js";
import { openDb, type DB } from "../src/db.js";
import { guildBoard, guildFactsFromRecords } from "../src/guild-board.js";
import { createKnowledgeServer, type ToolOptions } from "../src/mcp-server.js";

const OUT = {
  auction_history: z.object(MCP_TOOLS.auction_history.outputSchema),
  collection_gap: z.object(MCP_TOOLS.collection_gap.outputSchema),
  guild_board: z.object(MCP_TOOLS.guild_board.outputSchema),
};

const AS_OF = "2026-10-18T10:00:00.000Z";
const records: unknown[] = [];
for (const [i, installId] of ["a", "b", "c"].entries()) {
  records.push({ installId, capturedAt: `2026-10-1${i}T06:00:00Z`, eventId: `scan-${i}`, kind: "auction_scan", realm: "Forever", itemId: 5, copper: 100 + i, priceBasis: "unit" });
  records.push({ installId, capturedAt: "2026-10-12T06:00:00Z", eventId: `scan2-${i}`, kind: "auction_scan", realm: "Forever", itemId: 5, copper: 200, priceBasis: "unit" });
  records.push({ installId, kind: "collection_catalog", collection: "Mounts", source: "Vendor", itemId: 1 });
  records.push({ installId, kind: "collection_catalog", collection: "Mounts", source: "Drop", itemId: 2 });
  records.push({
    // Any 16 characters: the fact builder only checks the length. Not a real token, and not secret-shaped.
    installId, kind: "guild_snapshot", claimToken: "x".repeat(16), guildName: "Olympus", realm: "Forever",
    members: [{ name: "Ada", rank: "Officer", level: 60, class: "Mage" }, { name: "Bea", rank: "Member", level: 60, class: "Priest" }],
  });
}
records.push({ installId: "owner", kind: "collection_owned", collection: "Mounts", itemId: 1 });

const databases: DB[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

async function client(corpus?: () => Promise<{ records: unknown[]; dataAsOf: string } | null>, more: ToolOptions = {}) {
  const db = openDb(":memory:");
  databases.push(db);
  const server = createKnowledgeServer(db, { ...(corpus ? { corpus } : {}), ...more });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const c = new Client({ name: "test", version: "0" });
  await c.connect(clientSide);
  return c;
}

test("auction_history, collection_gap and guild_board answer with their result under the uploads envelope", async () => {
  const c = await client(async () => ({ records, dataAsOf: AS_OF }));

  const auctions = await c.callTool({ name: "auction_history", arguments: { realm: "Forever", itemId: 5 } });
  const auctionsOut = OUT.auction_history.parse(auctions.structuredContent);
  expect(auctionsOut).toEqual({ connected: true, dataAsOf: AS_OF, url: "https://everloot.app/tools/auctions?realm=Forever&item=5", page: auctionHistory("Forever", 5, auctionSightingsFromRecords(records)) });
  expect(auctionsOut.page!.points).toEqual([{ day: "2026-10-12", copper: 200, reporters: 3 }]);
  expect(JSON.stringify(auctions.content)).toContain("2026-10-12  2s 0c  3 reporters");

  const gap = OUT.collection_gap.parse((await c.callTool({ name: "collection_gap", arguments: { collection: "Mounts", ownerInstallId: "owner" } })).structuredContent);
  expect(gap).toEqual({ connected: true, dataAsOf: AS_OF, url: "https://everloot.app/tools/collections?collection=Mounts&install=owner", page: collectionGap("Mounts", "owner", collectionFactsFromRecords(records)) });
  expect(gap.page).toMatchObject({ ownedRecorded: true, groups: [{ source: "Drop", owned: [], missing: [2] }, { source: "Vendor", owned: [1], missing: [] }] });

  const guild = OUT.guild_board.parse((await c.callTool({ name: "guild_board", arguments: { guildName: "Olympus", realm: "Forever" } })).structuredContent);
  expect(guild).toEqual({ connected: true, dataAsOf: AS_OF, url: "https://everloot.app/tools/guild-board?guild=Olympus&realm=Forever", page: guildBoard("Olympus", "Forever", guildFactsFromRecords(records)) });
  expect(guild.page).toMatchObject({ memberCount: 2, roster: [{ name: "Ada", rank: "Officer", level: 60, className: "Mage" }, { name: "Bea", rank: "Member", level: 60, className: "Priest" }], averageItemLevel: null });
});

test("a blank name keeps the text's refusal and a page with nothing agreed; no corpus is not connected", async () => {
  const c = await client(async () => ({ records, dataAsOf: AS_OF }));
  const blank = await c.callTool({ name: "guild_board", arguments: { guildName: " ", realm: "Forever" } });
  expect(JSON.stringify(blank.content)).toContain("Name a guild.");
  expect(OUT.guild_board.parse(blank.structuredContent).page).toMatchObject({ memberCount: null, roster: [] });
  // Nothing published, nothing scanned, no catalog: those pages would be empty, so none is linked.
  expect(blank.structuredContent).not.toHaveProperty("url");
  expect((await c.callTool({ name: "auction_history", arguments: { realm: "Forever", itemId: 6 } })).structuredContent).not.toHaveProperty("url");
  expect((await c.callTool({ name: "collection_gap", arguments: { collection: "Pets", ownerInstallId: "owner" } })).structuredContent).not.toHaveProperty("url");
  const off = OUT.auction_history.parse((await (await client()).callTool({ name: "auction_history", arguments: { realm: "Forever", itemId: 5 } })).structuredContent);
  expect(off.connected).toBe(false);
  expect(off).not.toHaveProperty("page");
});

test("auction_history answers from the site's stored days without reading the corpus, the same as from the corpus", async () => {
  const stored = new Map(auctionHistories(auctionSightingsFromRecords(records)));
  const auctionHistory = async (realm: string, itemId: number) => ({ points: stored.get(auctionHistoryKey(realm, itemId)) ?? [], dataAsOf: AS_OF });
  let corpusReads = 0;
  const corpus = async () => { corpusReads += 1; return { records, dataAsOf: AS_OF }; };
  const fromStore = await client(corpus, { auctionHistory });
  const fromCorpus = await client(async () => ({ records, dataAsOf: AS_OF }));
  for (const args of [{ realm: "Forever", itemId: 5 }, { realm: " forever ", itemId: 5 }, { realm: "Forever", itemId: 6 }, { realm: " ", itemId: 5 }]) {
    const a = await fromStore.callTool({ name: "auction_history", arguments: args });
    const b = await fromCorpus.callTool({ name: "auction_history", arguments: args });
    expect(a.structuredContent).toEqual(b.structuredContent);
    expect(a.content).toEqual(b.content);
  }
  expect(corpusReads).toBe(0);
  // No stored file, or one that cannot be read: the corpus answers, and without one the answer stays unavailable.
  for (const missing of [async () => null, async () => { throw new Error("r2 down"); }]) {
    const c = await client(corpus, { auctionHistory: missing });
    const out = OUT.auction_history.parse((await c.callTool({ name: "auction_history", arguments: { realm: "Forever", itemId: 5 } })).structuredContent);
    expect(out.page!.points).toEqual([{ day: "2026-10-12", copper: 200, reporters: 3 }]);
  }
  expect(corpusReads).toBe(2);
  const down = await client(async () => null, { auctionHistory: async () => null });
  expect(OUT.auction_history.parse((await down.callTool({ name: "auction_history", arguments: { realm: "Forever", itemId: 5 } })).structuredContent))
    .toMatchObject({ connected: false, reason: "Public corpus unavailable. These figures are unrecorded, not zero." });
});
