import { expect, test } from "vitest";
import { computeCoverage } from "../src/coverage.js";
import {
  computeSettled, decodeIds, emptySettledList, encodeIds, factKey, LOOT_SOURCE_MIN_WINDOWS, listOf, matchSettled, parseSettledFile, parseSettledList,
  settledKeys, settledSkip, type SettledInput,
} from "../src/settled-list.js";

const day = (n: number) => new Date(Date.UTC(2026, 9, 1 + n)).toISOString();
const BUILD = "1.60.1.70450";
const input = (records: unknown[], extra: Partial<SettledInput> = {}): SettledInput => ({ records, asOf: day(30), build: BUILD, ...extra });

function npcs(n: number, npcId: number, opts: { mapId?: number; name?: string; x?: number; at?: number; from?: number; spread?: number; level?: number } = {}) {
  return Array.from({ length: n }, (_, i) => ({
    kind: "npc_sighting", installId: `install-${(opts.from ?? 0) + i}`, eventId: `e:${npcId}:${(opts.from ?? 0) + i}`, npcId, name: opts.name ?? "Marshal Dughan",
    mapId: opts.mapId ?? 1429, x: (opts.x ?? 42) + (opts.spread ?? 0) * i, y: 65, positionKind: "interaction", role: "questgiver", capturedAt: day(opts.at ?? 0),
    ...(opts.level ? { level: opts.level } : {}),
  }));
}
function quests(n: number, questId: number, opts: { at?: number; from?: number; title?: string; rewards?: number[] } = {}) {
  return Array.from({ length: n }, (_, i) => ({
    kind: "quest", installId: `install-${(opts.from ?? 0) + i}`, questId, title: opts.title ?? "A Threat Within", level: 5, giverNpcId: 1, turnInNpcId: 1,
    rewardItemIds: opts.rewards ?? [], faction: "alliance", capturedAt: day(opts.at ?? 0),
  }));
}
function vendors(n: number, vendorNpcId: number, items: { itemId: number; priceCopper: number }[], opts: { at?: number; from?: number } = {}) {
  return Array.from({ length: n }, (_, i) => ({ kind: "vendor", installId: `install-${(opts.from ?? 0) + i}`, vendorNpcId, items, capturedAt: day(opts.at ?? 0) }));
}

test("ids are sorted, distinct and delta-encoded, and decode back", () => {
  expect(encodeIds([8, 3, 7, 3])).toEqual([3, 4, 1]);
  expect(decodeIds([3, 4, 1])).toEqual([3, 7, 8]);
  expect(decodeIds(encodeIds([]))).toEqual([]);
});

test("an NPC is in the list with the maps whose pin settled: five installs, the third 14 days old", () => {
  const file = computeSettled(input([...npcs(5, 1, { at: 0 }), ...npcs(5, 1, { mapId: 1411, at: 25 }), ...npcs(4, 2)]));
  expect([...settledKeys(file)]).toEqual(["npc:1@1429"]);
  expect(file.values["npc:1@1429"]).toEqual({ kind: "npc", name: "Marshal Dughan", roles: ["questgiver"], at: [42, 65] });
  expect(file.dataAsOf).toBe(day(30));
});

test("a spread pin, an open trait or a conflicting name keeps an NPC out", () => {
  expect(settledKeys(computeSettled(input(npcs(5, 1, { spread: 3 })))).size).toBe(0);
  // Levels split 3 to 2: the level is not settled, so the NPC is not.
  expect(settledKeys(computeSettled(input([...npcs(3, 1, { level: 10 }), ...npcs(2, 1, { level: 11, from: 3 })]))).size).toBe(0);
  // A second name reported inside the 14 days keeps the first from settling.
  expect(settledKeys(computeSettled(input([...npcs(5, 1), ...npcs(1, 1, { name: "Someone Else", from: 5, at: 25 })]))).size).toBe(0);
});

test("without a corpus time nothing settles, and a new build's list is empty", () => {
  expect(settledKeys(computeSettled(input(npcs(5, 1), { asOf: null }))).size).toBe(0);
  expect(settledKeys(emptySettledList("1.61.0.71000")).size).toBe(0);
});

test("the list agrees with the coverage score: what it holds, the score counts settled", () => {
  const records = [...npcs(5, 1), ...npcs(3, 2), ...quests(5, 10)];
  const file = computeSettled(input(records));
  const score = computeCoverage({ records, asOf: day(30), zones: [{ mapId: 1429, name: "Elwynn Forest" }] });
  const elwynn = score.zones[0]!;
  expect(settledKeys(file)).toEqual(new Set(["npc:1@1429", "quest:10"]));
  expect(elwynn.types.pins).toMatchObject({ confirmed: 2, settled: 1 });
  // The quest's title, level, giver, turn-in and side.
  expect(elwynn.types.quests.settled).toBe(5);
});

test("a quest needs every reported field settled, its rewards included", () => {
  expect(settledKeys(computeSettled(input(quests(5, 10, { rewards: [2589] })))).has("quest:10")).toBe(true);
  // One reward three installs listed and two did not: confirmed, not settled.
  const split = [...quests(3, 10, { rewards: [2589] }), ...quests(2, 10, { from: 3 })];
  expect(settledKeys(computeSettled(input(split))).has("quest:10")).toBe(false);
});

test("a vendor is in the list only when every offer is settled", () => {
  const settled = vendors(5, 50, [{ itemId: 159, priceCopper: 25 }, { itemId: 4540, priceCopper: 25 }]);
  expect(settledKeys(computeSettled(input(settled))).has("vendor:50")).toBe(true);
  const open = [...settled, ...vendors(1, 50, [{ itemId: 2287, priceCopper: 400 }], { from: 5 })];
  expect(settledKeys(computeSettled(input(open))).has("vendor:50")).toBe(false);
});

test("a source's loot settles at 200 windows with every common drop settled; Recorder windows never count", () => {
  const windows = (n: number, evidence: boolean) => Array.from({ length: n }, (_, i) => ({
    kind: "loot", installId: `install-${i % 6}`, sourceNpcId: 99, ...(evidence ? { sourceEvidence: "loot-api" } : {}),
    items: i % 2 ? [{ itemId: 1, count: 1 }] : [{ itemId: 2, count: 1 }], capturedAt: day(0),
  }));
  expect(settledKeys(computeSettled(input(windows(LOOT_SOURCE_MIN_WINDOWS, true)))).has("loot:npc:99")).toBe(true);
  expect(settledKeys(computeSettled(input(windows(LOOT_SOURCE_MIN_WINDOWS - 1, true)))).has("loot:npc:99")).toBe(false);
  expect(settledKeys(computeSettled(input(windows(LOOT_SOURCE_MIN_WINDOWS, false)))).size).toBe(0);
});

test("entrances, encounters and treasures settle at their own grain", () => {
  const five = (make: (i: number) => object) => Array.from({ length: 5 }, (_, i) => ({ installId: `install-${i}`, capturedAt: day(0), ...make(i) }));
  const records = [
    ...five(() => ({ kind: "instance_entrance", instanceMapId: 36, name: "The Deadmines", instanceType: "party", mapId: 1436, x: 42, y: 72 })),
    ...five(() => ({ kind: "encounter", encounterId: 1144, name: "Edwin VanCleef", instanceMapId: 36, success: true, npcIds: [639] })),
    ...five(() => ({ kind: "object_sighting", objectId: 2843, name: "Battered Chest", mapId: 1436, x: 30, y: 30 })),
  ];
  const file = computeSettled(input(records));
  expect(settledKeys(file)).toEqual(new Set(["entrance:36@1436", "encounter:1144@36", "object:2843@1436"]));
});

test("a recheck scope takes a fact out until it settles again after the scope's date", () => {
  const scope = { since: day(10), source: "build-watch wow_classic-1", type: "npcs" as const, ids: [1] };
  expect(settledKeys(computeSettled(input(npcs(5, 1), { recheck: [scope] }))).size).toBe(0);
  const again = [...npcs(5, 1), ...npcs(5, 1, { from: 10, at: 12 })];
  expect(settledKeys(computeSettled(input(again, { asOf: day(40), recheck: [scope, { ...scope, type: "pins" as const }] }))).has("npc:1@1429")).toBe(true);
});

test("a recheck scope matches an NPC on the map the score counts it in, not on every map it was seen on", () => {
  const seen = [...npcs(5, 1), ...npcs(3, 1, { mapId: 1411, from: 10 }), ...npcs(1, 1, { mapId: 1412, from: 20 })];
  const scope = { since: day(10), source: "test", type: "npcs" as const, zones: [1411] };
  expect(settledKeys(computeSettled(input(seen, { recheck: [scope] }))).has("npc:1@1429")).toBe(true);
  expect(settledKeys(computeSettled(input(seen, { recheck: [{ ...scope, zones: [1429] }] }))).has("npc:1@1429")).toBe(false);
});

test("the uploaders skip a row only for the list's own build, by NPC and map together", () => {
  const list = listOf(computeSettled(input(npcs(5, 1))));
  const skip = settledSkip(list, BUILD)!;
  expect(skip({ kind: "npc_sighting", npcId: 1, mapId: 1429 })).toBe(true);
  expect(skip({ kind: "npc_sighting", npcId: 1, mapId: 1411 })).toBe(false);
  expect(skip({ kind: "quest", questId: 1 })).toBe(false);
  expect(settledSkip(list, "1.61.0.71000")).toBeUndefined();
  expect(settledSkip(list, undefined)).toBeUndefined();
  expect(settledSkip(null, BUILD)).toBeUndefined();
  expect(settledSkip(emptySettledList(BUILD), BUILD)).toBeUndefined();
});

test("a row that matches every settled value is a repeat; one that differs in any field is not", () => {
  const { values } = computeSettled(input([...npcs(5, 1), ...quests(5, 10), ...vendors(5, 50, [{ itemId: 159, priceCopper: 25 }])]));
  const sighting = npcs(1, 1, { from: 20 })[0]!;
  expect(matchSettled(values, sighting)).toBe("npc:1@1429");
  expect(matchSettled(values, { ...sighting, name: "  marshal dughan " })).toBe("npc:1@1429");
  expect(matchSettled(values, { ...sighting, name: "Marshal Dugan" })).toBeNull();
  expect(matchSettled(values, { ...sighting, x: 50 })).toBeNull();
  // A player position is not the NPC's: it is not held to the pin.
  expect(matchSettled(values, { ...sighting, positionKind: "player", role: undefined, x: 80 })).toBe("npc:1@1429");
  // A level nobody reported before is new: stored.
  expect(matchSettled(values, { ...sighting, level: 10 })).toBeNull();
  expect(matchSettled(values, { ...sighting, role: "vendor" })).toBeNull();
  const quest = quests(1, 10, { from: 20 })[0]!;
  expect(matchSettled(values, quest)).toBe("quest:10");
  expect(matchSettled(values, { ...quest, turnInNpcId: 2 })).toBeNull();
  expect(matchSettled(values, { ...quest, rewardItemIds: [2589] })).toBeNull();
  expect(matchSettled(values, { ...quest, faction: "horde" })).toBeNull();
  const vendor = vendors(1, 50, [{ itemId: 159, priceCopper: 25 }])[0]!;
  expect(matchSettled(values, vendor)).toBe("vendor:50");
  expect(matchSettled(values, { ...vendor, items: [{ itemId: 159, priceCopper: 30 }] })).toBeNull();
  expect(matchSettled(values, { kind: "npc_sighting", npcId: 2, mapId: 1429, name: "x", x: 1, y: 1 })).toBeNull();
});

test("the file and the public list parse strictly, and the list carries no values", () => {
  const file = computeSettled(input(npcs(5, 1)));
  const json = JSON.parse(JSON.stringify(file));
  expect(parseSettledFile(json)).toEqual(file);
  const list = listOf(file);
  expect("values" in list).toBe(false);
  expect(parseSettledList(JSON.parse(JSON.stringify(list)))).toEqual(list);
  expect(parseSettledList({ ...list, extra: 1 })).toBeNull();
  expect(parseSettledList({ ...list, build: "../x" })).toBeNull();
  expect(factKey({ kind: "loot", sourceObjectId: 7 })).toBe("loot:obj:7");
  expect(factKey({ kind: "auction_snapshot" })).toBeNull();
});
