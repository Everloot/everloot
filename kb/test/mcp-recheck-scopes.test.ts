import { expect, test } from "vitest";
import type { DB } from "../src/db.js";
import type { RecheckScope } from "../src/coverage.js";
import { answerSources, answerSourcesFactsFromRecords } from "../src/answer-sources.js";
import { observedEdges } from "../src/edges.js";
import { nearResult, type NearFacts } from "../src/world-map-near.js";
import type { WorldMapData } from "../src/world-map-data.js";
import { createToolHandlers } from "../src/mcp-server.js";

const capturedAt = "2026-09-01T00:00:00.000Z";

const rows = ["a", "b", "c"].map((installId) => ({
  kind: "npc_sighting", positionKind: "npc", installId, npcId: 42, name: "Hogger",
  mapId: 12, x: 40, y: 20, capturedAt,
}));

const call = (recheck?: readonly RecheckScope[]) => createToolHandlers({} as DB, {
  corpus: async () => ({ records: rows, dataAsOf: capturedAt }),
  recheck,
}).npc_page({ npcId: 42 });

test("page tools count only reports after a recheck scope's date, as the coverage score does", async () => {
  const scoped = await call([{ since: "2026-09-15T00:00:00.000Z", source: "blue-post test", ids: [42] }]);
  const text = typeof scoped === "string" ? scoped : scoped.text;
  expect(text).toContain("No agreed name");
  expect(text).not.toContain("Hogger");
});

test("without scopes the same reports still agree, so the scope is the only difference", async () => {
  const unscoped = await call();
  const text = typeof unscoped === "string" ? unscoped : unscoped.text;
  expect(text).toContain("Hogger");
});

const objects = ["a", "b", "c"].map((installId) => ({
  kind: "object_sighting", installId, objectId: 77, name: "Copper Vein",
  mapId: 12, x: 40, y: 20, capturedAt,
}));

const callObject = (recheck?: readonly RecheckScope[]) => createToolHandlers({} as DB, {
  corpus: async () => ({ records: objects, dataAsOf: capturedAt }),
  recheck,
}).object_page({ objectId: 77 });

test("the object page cuts its names and pins by the same scope", async () => {
  const scoped = await callObject([{ since: "2026-09-15T00:00:00.000Z", source: "blue-post test", ids: [77] }]);
  const scopedText = typeof scoped === "string" ? scoped : scoped.text;
  expect(scopedText).toContain("No agreed name yet");
  expect(scopedText).not.toContain("Copper Vein");
  expect(scopedText).not.toContain("Seen on the minimap");

  const unscoped = await callObject();
  const unscopedText = typeof unscoped === "string" ? unscoped : unscoped.text;
  expect(unscopedText).toContain("Copper Vein");
  expect(unscopedText).toContain("Seen on the minimap");
});

const entrances = ["a", "b", "c"].map((installId) => ({
  kind: "instance_entrance", installId, instanceMapId: 100, name: "The Test Dungeon",
  instanceType: "party", mapId: 1411, x: 50, y: 50, capturedAt,
}));

const map = {
  zones: [{ uiMapId: 1411, name: "Test Zone", continentId: 1, bounds: { left: 0, top: 0, right: 1000, bottom: 1000 } }],
  heldBackZones: [],
  entrances: [{ mapId: 100, name: "The Test Dungeon", raid: false, continentId: 1, worldX: 500, worldY: 500 }],
} as unknown as WorldMapData;

const callNear = (recheck?: readonly RecheckScope[]) => nearResult(
  { zone: "Test Zone", x: 50, y: 50, radius: 100 }, map,
  { npcs: [], vendors: [], recheck, entrances } as NearFacts,
);

test("world_map_near drops entrance confirmations the scope withholds", () => {
  const scoped = callNear([{ since: "2026-09-15T00:00:00.000Z", source: "blue-post test", ids: [100] }]);
  expect(scoped.ok).toBe(true);
  if (scoped.ok) expect(scoped.entrances[0]?.confirmed).toBeUndefined();

  const unscoped = callNear();
  expect(unscoped.ok).toBe(true);
  if (unscoped.ok) expect(unscoped.entrances[0]?.confirmed).toBe(3);
});

const answer = async (recheck?: readonly RecheckScope[]) => (await answerSources(
  { prepare: () => ({ all: () => [] }) } as unknown as DB,
  { question: "Where is Hogger?", limit: 5 },
  answerSourcesFactsFromRecords(rows, recheck ?? []),
  capturedAt,
)).evidence;

test("answer_sources does not cite an NPC name the scope withholds", async () => {
  expect((await answer([{ since: "2026-09-15T00:00:00.000Z", source: "blue-post test", ids: [42] }])).some((e) => e.claim.includes("Hogger"))).toBe(false);
  expect((await answer()).some((e) => e.claim.includes("Hogger"))).toBe(true);
});

const callRelations = (recheck?: readonly RecheckScope[]) => createToolHandlers({} as DB, {
  corpus: async () => ({ records: rows, dataAsOf: capturedAt }),
  recheck,
}).entity_relations({ kind: "npc", id: 42, direction: "both", limit: 20 });

test("entity relations cut the destination facts the same scope withholds", async () => {
  const scoped = await callRelations([{ since: "2026-09-15T00:00:00.000Z", source: "blue-post test", ids: [42] }]);
  const text = typeof scoped === "string" ? scoped : scoped.text;
  expect(text).not.toContain("Located in");
  expect(text).not.toContain("zone 12");

  const unscoped = await callRelations();
  const unscopedText = typeof unscoped === "string" ? unscoped : unscoped.text;
  expect(unscopedText).toContain("Located in: zone 12");
});

const sighting = (installId: string, npcId: number, mapId: number, extra: Record<string, unknown> = {}) => ({
  kind: "npc_sighting", positionKind: "npc", installId, npcId, name: `NPC ${npcId}`, mapId, x: 40, y: 20, capturedAt, ...extra,
});
const questRow = (installId: string, questId: number, giverNpcId: number, rewardItemIds: number[]) => ({
  kind: "quest", installId, questId, giverNpcId, rewardItemIds, capturedAt,
});
const vendorRow = (installId: string, vendorNpcId: number, itemId: number, priceCopper: number, at = capturedAt) => ({
  kind: "vendor", installId, vendorNpcId, items: [{ itemId, priceCopper }], capturedAt: at,
});
const lootRow = (installId: string, sourceObjectId: number, itemId: number) => ({
  kind: "loot", sourceEvidence: "loot-api", installId, sourceObjectId, items: [{ itemId, count: 1 }], capturedAt,
});
const scope = (extra: Record<string, unknown>) => ({ since: "2026-09-15T00:00:00.000Z", source: "blue-post test", ...extra }) as RecheckScope;
const located = (records: unknown[], recheck?: readonly RecheckScope[]) =>
  observedEdges(records, capturedAt, recheck).filter((e) => e.rel === "located_in");
const rewards = (records: unknown[], recheck?: readonly RecheckScope[]) =>
  observedEdges(records, capturedAt, recheck).filter((e) => e.rel === "reward_from");
const sold = (records: unknown[], recheck?: readonly RecheckScope[]) =>
  observedEdges(records, capturedAt, recheck).filter((e) => e.rel === "sold_by");

test("a rare NPC's location edge follows a rares scope, as its pins do", () => {
  const rareRows = ["a", "b", "c"].map((installId) => sighting(installId, 42, 12, { rank: "rare" }));
  expect(located(rareRows, [scope({ type: "rares", ids: [42] })])).toHaveLength(0);
  expect(located(rareRows)).toHaveLength(1);
});

test("a quest's zone edge uses the leading giver by votes, not the first report", () => {
  const rowsQ = [sighting("a", 42, 12), sighting("b", 42, 12), sighting("c", 42, 12), sighting("d", 43, 13),
    questRow("a", 100, 43, [77]), questRow("b", 100, 42, [77]), questRow("c", 100, 42, [77]), questRow("d", 100, 42, [77])];
  expect(rewards(rowsQ, [scope({ type: "quests", zones: [12] })])).toHaveLength(0);
  expect(rewards(rowsQ)).toHaveLength(1);
});

test("a quest scope naming one reward covers every reward edge of that quest", () => {
  const rowsQ = ["a", "b", "c"].map((installId) => questRow(installId, 100, 42, [77, 78]));
  expect(rewards(rowsQ, [scope({ type: "quests", ids: [77] })])).toHaveLength(0);
  expect(rewards(rowsQ)).toHaveLength(2);
});

test("a vendor recheck settles all prices of one item together, as the vendor page does", () => {
  const rowsV = [vendorRow("a", 42, 77, 100), vendorRow("b", 42, 77, 100), vendorRow("c", 42, 77, 100),
    vendorRow("d", 42, 77, 200), vendorRow("e", 42, 77, 200), vendorRow("f", 42, 77, 200, "2026-09-20T00:00:00.000Z")];
  expect(sold(rowsV, [scope({ type: "vendors", ids: [42] })])).toHaveLength(0);
  expect(sold(rowsV)).toHaveLength(1);
});

test("entity_relations reads object sightings so a zone-scoped drop can be located", async () => {
  const rowsO = [sighting("a", 42, 12), sighting("b", 42, 12), sighting("c", 42, 12),
    { kind: "object_sighting", installId: "a", objectId: 50, name: "Copper Vein", mapId: 12, x: 40, y: 20, capturedAt },
    { kind: "object_sighting", installId: "b", objectId: 50, name: "Copper Vein", mapId: 12, x: 40, y: 20, capturedAt },
    { kind: "object_sighting", installId: "c", objectId: 50, name: "Copper Vein", mapId: 12, x: 40, y: 20, capturedAt },
    lootRow("a", 50, 77), lootRow("b", 50, 77), lootRow("c", 50, 77)];
  const callDrops = (recheck?: readonly RecheckScope[]) => createToolHandlers({} as DB, {
    corpus: async () => ({ records: rowsO, dataAsOf: capturedAt }),
    recheck,
  }).entity_relations({ kind: "item", id: 77, direction: "from", limit: 20 });
  const scoped = await callDrops([scope({ type: "drops", zones: [12] })]);
  const scopedText = typeof scoped === "string" ? scoped : scoped.text;
  expect(scopedText).not.toContain("Dropped by");
  const unscoped = await callDrops();
  const unscopedText = typeof unscoped === "string" ? unscoped : unscoped.text;
  expect(unscopedText).toContain("Dropped by: object 50");
});
