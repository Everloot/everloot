import { afterEach, expect, test, vi } from "vitest";
import { openDb, type DB } from "../src/db.js";
import { createToolHandlers } from "../src/mcp-server.js";
import { buildCatalogIndex } from "../src/catalog-index.js";
import * as catalogModule from "../src/catalog-index.js";
import { WORLD_MAP_DATA } from "../src/world-map-file.js";
import { catalogId, CATALOG_ID_BASE } from "../src/catalog-index.js";
import { replaceSourceRows } from "../src/entities.js";

const dbs: DB[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const db of dbs.splice(0)) db.close(); });
const rows = ["a", "b", "c"].flatMap((installId) => [
  { kind: "item_seen", installId, itemId: 2589, name: "Linen Cloth", description: "PRIVATE TEXT" },
  { kind: "npc_sighting", installId, npcId: 3840, name: "Druid of the Fang", mapId: 1429, x: 50, y: 50, positionKind: "interaction" },
]);
function handlers(records: unknown[] = rows) {
  const db = openDb(":memory:"); dbs.push(db);
  return createToolHandlers(db, { catalog: () => buildCatalogIndex({ map: WORLD_MAP_DATA }), corpus: async () => ({ records, dataAsOf: "2026-11-10T00:00:00Z" }) });
}
const out = (a: any) => a.structured;

test("agreed names resolve to game ids and chain through record and gameplay tools", async () => {
  const h = handlers();
  const hit = out(await h.search_knowledge({ query: "Linen Cloth", kind: "item", limit: 5 })).hits[0];
  expect(hit).toMatchObject({ gameId: 2589, kind: "item", sourceKind: "observed", observed: { asOf: "2026-11-10T00:00:00Z" } });
  expect(hit.recordId).toBe(hit.id);
  expect(hit.id).not.toBe(hit.gameId);
  expect(out(await h.get_entity({ id: hit.recordId })).hit).toEqual(hit);
  expect(out(await h.item_page({ itemId: hit.gameId })).page.name).toBe("Linen Cloth");
  expect(JSON.stringify(await h.fetch({ id: String(hit.recordId) }))).not.toContain("PRIVATE TEXT");
  const npc = out(await h.get_by_name({ name: "Druid of the Fang", kind: "npc" })).hits[0];
  expect(out(await h.npc_page({ npcId: npc.gameId })).page.npcId).toBe(3840);
});

test("released zone names give UiMap ids for world_map_near", async () => {
  const h = handlers();
  const hit = out(await h.get_by_name({ name: "Elwynn Forest", kind: "zone" })).hits[0];
  expect(hit).toMatchObject({ gameId: 1429, sourceKind: "game-files", build: expect.any(String) });
  expect(out(await h.get_entity({ id: hit.recordId })).hit.gameId).toBe(1429);
  const instance = out(await h.get_entity({ id: catalogId("instance", "34") })).hit;
  expect(instance).not.toBeNull();
  expect(instance).not.toHaveProperty("gameId");
  const near = await h.world_map_near({ zone: String(hit.gameId), x: 50, y: 50, radius: 500, limit: 5 });
  expect(JSON.stringify(near)).toContain("Elwynn Forest");
});

test("one or two reporters and conflicting agreed names stay out of discovery", async () => {
  expect(out(await handlers(rows.slice(0, 4)).search_knowledge({ query: "Linen Cloth", kind: "item", limit: 5 })).hits).toEqual([]);
  const conflict = [...rows, ...["d", "e", "f"].map((installId) => ({ kind: "item_seen", installId, itemId: 2589, name: "Other" }))];
  expect(out(await handlers(conflict).get_by_name({ name: "Linen Cloth", kind: "item" })).hits).toEqual([]);
});

test("original kind ranges stay fixed and new entity ranges do not collide", () => {
  const original = ["achievement", "faction", "title", "quest_chain", "mount", "legacy_perk", "race", "instance"];
  original.forEach((kind, index) => expect(catalogId(kind, "72")).toBe(CATALOG_ID_BASE + index * 10_000_000 + 72));
  const ids = ["item", "npc", "object", "quest", "zone"].map((kind) => catalogId(kind, "72"));
  expect(new Set(ids).size).toBe(5);
  expect(Math.min(...ids)).toBeGreaterThan(catalogId("instance", "9999999"));
});

test("archive hits remain lore and never claim a game id", async () => {
  const db = openDb(":memory:"); dbs.push(db);
  await replaceSourceRows(db, "curated", ["lore_page"], [{ kind: "lore_page", extId: "123", name: "Linen Cloth", body: "Historical archive text", gameVersion: "lore", sourceUrl: "https://example.test/lore", retrievedAt: "2023-11-13" }]);
  const h = createToolHandlers(db, { corpus: async () => ({ records: rows, dataAsOf: null }) });
  const hits = out(await h.get_by_name({ name: "Linen Cloth" })).hits;
  expect(hits).toHaveLength(2);
  expect(hits[0]).toMatchObject({ sourceKind: "lore", gameVersion: "lore" });
  expect(hits[0]).not.toHaveProperty("gameId");
  expect(hits[1]).toMatchObject({ gameId: 2589, sourceKind: "observed" });
  expect(out(await h.search_knowledge({ query: "Linen Cloth", version: "lore", limit: 5 })).hits).toHaveLength(1);
});

test("a refreshed or unavailable corpus cannot return stale agreed names", async () => {
  const db = openDb(":memory:"); dbs.push(db);
  let corpus: { records: unknown[]; dataAsOf: string | null } | null = { records: rows, dataAsOf: null };
  const h = createToolHandlers(db, { corpus: async () => corpus });
  const hit = out(await h.get_by_name({ name: "Linen Cloth", kind: "item" })).hits[0];
  corpus = { records: [], dataAsOf: "2026-11-11T00:00:00Z" };
  expect(out(await h.get_entity({ id: hit.recordId })).hit).toBeNull();
  corpus = null;
  expect(out(await h.get_by_name({ name: "Linen Cloth", kind: "item" })).hits).toEqual([]);
});

test("quest and object metadata export only agreed names and allowlisted fields", async () => {
  const records = ["a", "b", "c"].flatMap((installId) => [
    { kind: "quest", installId, questId: 783, title: "A Threat Within", level: 1, rewardItemIds: [], description: "PRIVATE QUEST TEXT" },
    { kind: "object_sighting", installId, objectId: 1731, name: "Copper Vein", mapId: 1429, x: 50, y: 50, capturedAt: "2026-11-10T00:00:00Z", tooltip: "PRIVATE TOOLTIP" },
  ]);
  const h = handlers(records);
  for (const [kind, name, gameId] of [["quest", "A Threat Within", 783], ["object", "Copper Vein", 1731]] as const) {
    const hit = out(await h.get_by_name({ name, kind })).hits[0];
    expect(hit).toMatchObject({ gameId, sourceKind: "observed" });
    const read = out(await h.get_entity({ id: hit.recordId, field: "/description" }));
    expect(read.keys).toEqual(["gameId", "kind", "name", "observed"]);
    expect(JSON.stringify(await h.fetch({ id: String(hit.recordId) }))).not.toContain("PRIVATE");
  }
});

test("held-back zones are absent even when their map metadata is available", async () => {
  const h = handlers();
  for (const zone of WORLD_MAP_DATA.heldBackZones) {
    const hits = out(await h.get_by_name({ name: zone.name, kind: "zone" })).hits;
    expect(hits.some((hit: { gameId: number }) => hit.gameId === zone.uiMapId)).toBe(false);
  }
});

test("discovery reuses indexes across fresh corpus arrays and equivalent scopes", async () => {
  const db = openDb(":memory:"); dbs.push(db);
  const catalog = buildCatalogIndex({ map: WORLD_MAP_DATA });
  const build = vi.spyOn(catalogModule, "gameplayIndex");
  const merge = vi.spyOn(catalogModule, "mergeCatalogIndexes");
  const corpus = vi.fn(async () => ({ records: [...rows], dataAsOf: "2026-11-12T00:00:00Z" }));
  const make = () => createToolHandlers(db, { catalog: () => catalog, corpus, recheck: [] });
  await make().search_knowledge({ query: "Linen Cloth", kind: "item", limit: 5 });
  await make().get_by_name({ name: "Linen Cloth", kind: "item" });
  await make().get_entity({ id: catalogId("item", "2589") });
  await make().fetch({ id: String(catalogId("item", "2589")) });
  expect(corpus).toHaveBeenCalledTimes(4);
  expect(build).toHaveBeenCalledTimes(1);
  expect(merge).toHaveBeenCalledTimes(1);
});

test("release-only and lore discovery never read the corpus", async () => {
  const db = openDb(":memory:"); dbs.push(db);
  const corpus = vi.fn(async () => ({ records: [...rows], dataAsOf: null }));
  const h = createToolHandlers(db, { catalog: () => buildCatalogIndex({ map: WORLD_MAP_DATA }), corpus });
  await h.search_knowledge({ query: "Linen Cloth", version: "lore", limit: 5 });
  await h.search_knowledge({ query: "Elwynn Forest", kind: "zone", limit: 5 });
  await h.get_by_name({ name: "Linen Cloth", kind: "lore_page" });
  await h.get_entity({ id: 1 });
  await h.get_entity({ id: catalogId("zone", "1429") });
  await h.fetch({ id: String(catalogId("instance", "34")) });
  expect(corpus).not.toHaveBeenCalled();
});

test("unavailable corpus reuses the files-only merged index", async () => {
  const db = openDb(":memory:"); dbs.push(db);
  const catalog = buildCatalogIndex({ map: WORLD_MAP_DATA });
  const merge = vi.spyOn(catalogModule, "mergeCatalogIndexes");
  const corpus = async () => null;
  for (let i = 0; i < 2; i++) {
    await createToolHandlers(db, { catalog: () => catalog, corpus }).get_by_name({ name: "Linen Cloth", kind: "item" });
  }
  expect(merge).toHaveBeenCalledTimes(1);
});
