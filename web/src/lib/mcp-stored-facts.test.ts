import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { IntakeRecord } from "@everloot/protocol";
import type { RecheckScope } from "@kb/coverage";

const hoisted = vi.hoisted(() => ({ stored: vi.fn(), loadCorpus: vi.fn(), scopes: [] as RecheckScope[] }));
vi.mock("./upload-store", () => ({ uploadStore: { loadCorpus: hoisted.loadCorpus } }));
vi.mock("./aggregate-store", async (actual) => ({ ...(await actual<typeof import("./aggregate-store")>()), loadStoredAggregates: hoisted.stored }));
vi.mock("./recheck-scopes", () => ({ RECHECK_SCOPES: hoisted.scopes }));
vi.mock("./coverage-answer", () => ({ loadCoverageForTool: vi.fn(async () => null) }));
vi.mock("./settled-store", () => ({ readSettledList: vi.fn() }));

import { createToolHandlers, type ToolName } from "@kb/mcp-server";
import { openDb, type DB } from "@kb/db";
import { anonymousAggregates } from "./aggregate-store";
import { storedToolFacts, toolLoaders } from "./mcp-mount";

/**
 * The page tools' facts assembled from the stored set must be what the tools build from the corpus. The fixture
 * reaches every table the switched tools read: an agreed NPC with public drops and a measured zero, an item with a
 * tooltip number, a quest, a vendor, an object gathered from and one seen on the minimap.
 */
const AS_OF = "2026-11-06T12:00:00.000Z";
const INSTALLS = ["install-aaaa-0001", "install-bbbb-0002", "install-cccc-0003"];
const daysAgo = (d: number, h = 0) => new Date(Date.parse(AS_OF) - d * 86_400_000 - h * 3_600_000).toISOString();

function rows(): IntakeRecord[] {
  const out: Record<string, unknown>[] = [];
  INSTALLS.forEach((installId, i) => {
    let n = 0;
    const row = (r: Record<string, unknown>, at = daysAgo(1, i)) => out.push({ installId, eventId: `ev-${i}-${n++}`, capturedAt: at, ...r });
    row({ kind: "npc_sighting", npcId: 100, name: "Kobold Vermin", mapId: 1429, x: 40.1, y: 50.2, level: 2, reaction: "hostile", positionKind: "npc", creatureType: "Humanoid", rank: "normal" });
    row({ kind: "npc_sighting", npcId: 200, name: "Corina Steele", mapId: 1429, x: 41.5, y: 65.8, level: 10, reaction: "friendly", positionKind: "interaction", role: "vendor" });
    row({ kind: "npc_sighting", npcId: 300, name: "Marshal McBride", mapId: 1429, x: 48.2, y: 41.9, level: 20, reaction: "friendly", positionKind: "interaction", role: "questgiver" });
    for (let w = 0; w < 12; w++) {
      row({ kind: "loot", sourceNpcId: 100, sourceEvidence: "loot-api", lootType: "kill", copper: 7, items: w % 3 === 0 ? [{ itemId: 1001, count: 1 }] : [{ itemId: 1003, count: 2 }] }, daysAgo(2, w));
    }
    row({ kind: "loot", sourceNpcId: 101, sourceEvidence: "loot-api", lootType: "kill", items: [] });
    row({ kind: "loot", sourceObjectId: 500, sourceEvidence: "loot-api", lootType: "gather", gatherKind: "herb", mapId: 1429, x: 30, y: 30, sourceObjectName: "Peacebloom", items: [{ itemId: 2447, count: 1 }] });
    row({ kind: "quest", questId: 7, title: "Kobold Camp Cleanup", level: 2, giverNpcId: 300, turnInNpcId: 300, rewardItemIds: [1002], category: "Elwynn Forest", faction: "alliance" });
    row({ kind: "vendor", vendorNpcId: 200, items: [{ itemId: 159, priceCopper: 25 }, { itemId: 4540, priceCopper: 25, limitedStock: 5 }] });
    for (const [itemId, name] of [[1001, "Kobold Candle"], [1002, "Militia Dagger"], [1003, "Linen Cloth"], [159, "Refreshing Spring Water"], [2447, "Peacebloom"]] as const) {
      row({ kind: "item_seen", itemId, name, quality: "common" });
    }
    row({ kind: "object_sighting", objectId: 600, name: "Copper Vein", mapId: 1429, x: 55.5, y: 60.25 });
    row({ kind: "item_fact", itemId: 1002, fact: "damage_per_second", value: 2.5, clientBuild: "1.60.1.70790" });
  });
  return out as unknown as IntakeRecord[];
}

const corpus = { uploads: INSTALLS.length, records: rows(), dataAsOf: AS_OF, unreachable: false };
const set = anonymousAggregates(corpus);

/** One call per switched tool, each on an entity the fixture fills. */
const CALLS: Record<string, (h: ReturnType<typeof createToolHandlers>) => unknown> = {
  entity_relations: (h) => h.entity_relations({ kind: "item", id: 1001, direction: "both", limit: 25 }),
  "entity_relations (npc drops)": (h) => h.entity_relations({ kind: "npc", id: 100, rel: "dropped_by", direction: "to", limit: 25 }),
  item_page: (h) => h.item_page({ itemId: 1002 }),
  "item_page (dropped)": (h) => h.item_page({ itemId: 1001 }),
  npc_page: (h) => h.npc_page({ npcId: 100 }),
  quest_page: (h) => h.quest_page({ questId: 7 }),
  vendor_page: (h) => h.vendor_page({ vendorNpcId: 200 }),
  object_page: (h) => h.object_page({ objectId: 500 }),
  "object_page (seen)": (h) => h.object_page({ objectId: 600 }),
};

let db: DB;
beforeEach(() => {
  db = openDb(":memory:");
  hoisted.loadCorpus.mockReset().mockResolvedValue(corpus);
  hoisted.stored.mockReset().mockResolvedValue(set);
});
afterEach(() => db.close());

test.each(Object.keys(CALLS))("%s answers from the stored set exactly as from the corpus", async (name) => {
  const fromCorpus = await CALLS[name]!(createToolHandlers(db, { ...toolLoaders(), storedFacts: undefined }));
  expect(hoisted.loadCorpus).toHaveBeenCalled();
  hoisted.loadCorpus.mockClear();
  const fromStore = await CALLS[name]!(createToolHandlers(db, toolLoaders()));
  expect(fromStore).toEqual(fromCorpus);
  expect(fromStore).toMatchObject({ structured: { connected: true, dataAsOf: AS_OF } });
  expect(hoisted.loadCorpus).not.toHaveBeenCalled();
});

test("with the stored set, the switched tools never open the corpus; the tools the set has no table for still do", async () => {
  hoisted.loadCorpus.mockRejectedValue(new Error("the corpus must not be read"));
  const h = createToolHandlers(db, toolLoaders());
  for (const call of Object.values(CALLS)) expect(await call(h)).toMatchObject({ structured: { connected: true } });
  expect(hoisted.loadCorpus).not.toHaveBeenCalled();
  expect(await h.world_map_near({ zone: "1429", x: 40, y: 50, radius: 100, limit: 10 })).toMatchObject({ structured: { connected: false } });
  expect(hoisted.loadCorpus).toHaveBeenCalledTimes(1);
});

test("a set built under other recheck scopes, or no set at all, leaves every tool on the corpus", async () => {
  const scoped = { ...set, world: { ...set.world, recheck: [{ since: "2026-11-01T00:00:00.000Z", source: "test", ids: [100] }] } };
  hoisted.stored.mockResolvedValue(scoped);
  expect(await createToolHandlers(db, toolLoaders()).npc_page({ npcId: 100 })).toMatchObject({ structured: { connected: true } });
  expect(hoisted.loadCorpus).toHaveBeenCalled();
  hoisted.loadCorpus.mockClear();
  hoisted.stored.mockResolvedValue(null);
  expect(await createToolHandlers(db, toolLoaders()).entity_relations({ kind: "item", id: 1001, direction: "both", limit: 25 })).toMatchObject({ structured: { connected: true } });
  expect(hoisted.loadCorpus).toHaveBeenCalled();
});

test("the set covers the page tools and nothing else; what it hands over is the set's own table", () => {
  const covered: ToolName[] = ["entity_relations", "item_page", "npc_page", "quest_page", "vendor_page", "object_page"];
  const others: ToolName[] = ["answer_sources", "profession_path", "recipe_thresholds", "world_map_near", "collection_gap", "guild_board", "auction_history", "gold_ledger"];
  for (const tool of covered) expect(storedToolFacts(set, tool), tool).not.toBeNull();
  for (const tool of others) expect(storedToolFacts(set, tool), tool).toBeNull();
  expect(storedToolFacts(set, "entity_relations")).toBe(set.edges);
  expect(storedToolFacts(set, "npc_page")).toBe(set.world);
});
