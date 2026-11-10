import { expect, test } from "vitest";
import type { Baseline } from "../src/baseline-report.js";
import { buildCoverageReport } from "../src/coverage-report.js";
import { computeCoverage, EXPECTED_TYPE, type CoverageType, type RecheckScope } from "../src/coverage.js";
import { lootRecheckSince, lootWindowsFromRecords, recheckLootRecords, rollupDrops } from "../src/drop-rollup.js";
import { confirmedEntrances, instanceBosses, instanceFactsFromRecords } from "../src/instances.js";
import { agreedObjectNames, objectSightingRowsFromRecords, objectSpawns } from "../src/object-spawns.js";
import { laterSince, npcZones, scopeSince } from "../src/recheck-scopes.js";
import {
  agreedNpcNames, agreedQuestTitles, npcPage, npcRoles, npcTraits, questPage, zonesFor, questTraits, vendorPage, worldFactsFromRecords,
} from "../src/world-pages.js";

const day = (n: number) => new Date(Date.UTC(2026, 9, 1 + n)).toISOString();
const ZONES = [{ mapId: 1429, name: "Elwynn Forest" }, { mapId: 1411, name: "Durotar" }];
/** The scopes below begin on day 20; the old reports are from day 0, the new ones from day 25; the corpus is day 30. */
const SINCE = day(20);
const scope = (extra: Omit<RecheckScope, "since" | "source">): RecheckScope => ({ since: SINCE, source: "https://example.test/patch-notes", ...extra });

/** `n` installs, numbered from `from`, each making one record from `make` at `at`. */
const each = (n: number, from: number, at: number, make: (installId: string, i: number) => Record<string, unknown>) =>
  Array.from({ length: n }, (_, i) => ({ installId: `install-${from + i}`, eventId: `e-${from + i}-${at}-${Math.random().toString(36).slice(2, 8)}`, capturedAt: day(at), ...make(`install-${from + i}`, i) }));
const npc = (opts: { npcId?: number; name?: string; mapId?: number; x?: number; y?: number; level?: number; role?: string } = {}) => () => ({
  kind: "npc_sighting", npcId: opts.npcId ?? 10, name: opts.name ?? "Marshal Dughan", mapId: opts.mapId ?? 1429, x: opts.x ?? 40, y: opts.y ?? 60,
  positionKind: "interaction", role: opts.role ?? "questgiver", level: opts.level ?? 5,
});
const quest = (opts: { title?: string; reward?: number; faction?: "alliance" | "horde" } = {}) => () => ({
  kind: "quest", questId: 20, title: opts.title ?? "A Threat Within", level: 5, giverNpcId: 10, turnInNpcId: 10, rewardItemIds: [opts.reward ?? 30],
  ...(opts.faction ? { faction: opts.faction } : {}),
});
const vendor = (price: number) => () => ({ kind: "vendor", vendorNpcId: 10, items: [{ itemId: 30, priceCopper: price }] });
const loot = (sourceNpcId: number, itemId = 30) => () => ({ kind: "loot", sourceNpcId, sourceEvidence: "loot-api", items: [{ itemId, count: 1 }] });

test("a scope covers a fact by type, zone and id, and the latest one wins", () => {
  const fact = { types: ["quests"] as CoverageType[], zones: [1429], ids: [20, 30] };
  expect(scopeSince([], fact)).toBeNull();
  expect(scopeSince([scope({ type: "quests" })], fact)).toBe(SINCE);
  expect(scopeSince([scope({ type: "npcs" })], fact)).toBeNull();
  expect(scopeSince([scope({ zones: [1411] })], fact)).toBeNull();
  // A reward's id names the quest; a zone list never covers a fact placed nowhere.
  expect(scopeSince([scope({ ids: [30] })], fact)).toBe(SINCE);
  expect(scopeSince([scope({ zones: [1429] })], { ...fact, zones: [null] })).toBeNull();
  const later = { ...scope({ ids: [20] }), since: day(22) };
  expect(scopeSince([scope({ type: "quests" }), later, scope({ zones: [1429] })], fact)).toBe(day(22));
  expect(laterSince(SINCE, day(22))).toBe(day(22));
  expect(laterSince(undefined, SINCE)).toBe(SINCE);
  // An NPC is placed on its busiest pinned map before any map it was only seen on.
  expect(npcZones([
    { npcId: 1, mapId: 5, installId: "a", pin: false }, { npcId: 1, mapId: 5, installId: "b", pin: false }, { npcId: 1, mapId: 7, installId: "c", pin: true },
  ]).get(1)).toBe(7);
});

/** Five old installs on each fact in 1429, two NPCs, an entrance, a boss, a treasure in 1411 and a loot source, then the scopes. */
function corpus() {
  return [
    ...each(5, 0, 0, npc()), ...each(5, 0, 0, npc({ npcId: 11, mapId: 1411, name: "Gornek" })),
    ...each(5, 0, 0, quest()), ...each(5, 0, 0, vendor(100)), ...each(5, 0, 0, loot(10)),
    ...each(5, 0, 0, () => ({ kind: "instance_entrance", instanceMapId: 9036, name: "The Deadmines", instanceType: "party", mapId: 1429, x: 30, y: 70 })),
    ...each(5, 0, 0, () => ({ kind: "encounter", encounterId: 639, name: "Edwin VanCleef", instanceMapId: 9036, success: true, npcIds: [639] })),
    ...each(5, 0, 0, () => ({ kind: "object_sighting", objectId: 500, name: "Battered Chest", mapId: 1411, x: 10, y: 10 })),
  ];
}
const SCOPES: RecheckScope[] = [
  scope({ type: "npcs", ids: [10] }), scope({ type: "pins", zones: [1411] }), scope({ type: "quests", zones: [1429] }), scope({ type: "vendors", ids: [30] }),
  scope({ type: "drops", ids: [10] }), scope({ type: "entrances", zones: [1429] }), scope({ type: "bosses", ids: [639] }), scope({ type: "treasures", ids: [500] }),
];
const EMPTY_BASELINE: Baseline = { commit: null, units: new Map(), quests: new Map(), objects: new Map(), items: new Map() } as unknown as Baseline;

test("the score and the internal report put the same facts in recheck: one matcher", () => {
  const records = corpus();
  const score = computeCoverage({ records, asOf: day(30), zones: ZONES, recheck: SCOPES });
  const report = buildCoverageReport({ baseline: EMPTY_BASELINE, records, dataAsOf: day(30), connected: true, recheck: SCOPES });
  const byScore = new Map<string, number>(), byReport = new Map<string, number>();
  for (const z of score.zones) for (const [type, cell] of Object.entries(z.types)) if (cell.recheck) byScore.set(`${z.mapId}:${type}`, cell.recheck);
  const scoreType = Object.fromEntries(Object.entries(EXPECTED_TYPE).map(([k, v]) => [v, k]));
  for (const r of report.rows) if (r.state === "recheck") byReport.set(`${r.zone}:${scoreType[r.type]}`, (byReport.get(`${r.zone}:${scoreType[r.type]}`) ?? 0) + 1);
  expect(Object.fromEntries(byReport)).toEqual(Object.fromEntries(byScore));
  // Every scope above reaches at least one fact, and nothing outside them is in recheck.
  expect([...byScore.keys()].sort()).toEqual(["1411:pins", "1411:treasures", "1429:bosses", "1429:drops", "1429:entrances", "1429:npcs", "1429:quests", "1429:vendors"]);
  expect(byScore.get("1429:npcs")).toBe(3); // name, level and the quest giver role
});

test("three new installs on a changed value show it; without the scope old and new votes cancel out", () => {
  const records = [
    ...each(5, 0, 0, npc()), ...each(3, 10, 25, npc({ name: "Marshal Dughan the Elder", level: 6, x: 70, y: 20 })),
    ...each(5, 0, 0, quest({ faction: "horde" })), ...each(3, 10, 25, quest({ title: "A Threat Without", reward: 31, faction: "alliance" })),
    ...each(5, 0, 0, vendor(100)), ...each(3, 10, 25, vendor(150)),
  ];
  const plain = worldFactsFromRecords(records);
  const scoped = { ...plain, recheck: [scope({ type: "npcs", ids: [10] }), scope({ type: "pins", zones: [1429] }), scope({ type: "quests", ids: [20] }), scope({ type: "vendors", ids: [10] })] };

  expect(questPage(20, plain)).toMatchObject({ title: null, rewards: [30, 31] });
  expect(questPage(20, scoped)).toMatchObject({ title: "A Threat Without", level: 5, rewards: [31] });
  expect(questTraits(plain.quests).side).toBe("both");
  expect(questTraits(scoped.quests, scoped).side).toBe("alliance");
  expect(agreedQuestTitles(plain).get(20)).toBeUndefined();
  expect(agreedQuestTitles(scoped).get(20)).toBe("A Threat Without");

  expect(npcPage(10, plain).name).toBeNull();
  expect(npcPage(10, plain).pins).toEqual([{ mapId: 1429, x: 40, y: 60, reporters: 8 }]);
  expect(npcPage(10, scoped)).toMatchObject({ name: "Marshal Dughan the Elder", pins: [{ mapId: 1429, x: 70, y: 20, reporters: 3 }] });
  expect(agreedNpcNames(scoped).get(10)).toBe("Marshal Dughan the Elder");
  expect(npcTraits(plain.npcs).level).toBeNull();
  expect(npcTraits(scoped.npcs, scoped.recheck).level).toBe(6);
  expect(npcRoles(scoped.npcs, scoped.recheck)).toEqual(["questgiver"]);

  expect(vendorPage(10, plain).offers.map((o) => o.priceCopper)).toEqual([100, 150]);
  expect(vendorPage(10, scoped).offers).toMatchObject([{ priceCopper: 150, reporters: 3 }]);
});

test("a fact in recheck is neither confirmed nor settled until three new installs agree, on the page and in the score", () => {
  const old = each(5, 0, 0, quest());
  const scopes = [scope({ type: "quests", ids: [20] })];
  for (const [n, title, state] of [[2, null, "recheck"], [3, "A Threat Without", "confirmed"]] as const) {
    const records = [...old, ...each(n, 10, 25, quest({ title: "A Threat Without" }))];
    const facts = { ...worldFactsFromRecords(records), recheck: scopes };
    expect(questPage(20, facts).title).toBe(title);
    expect(questPage(20, facts, zonesFor(facts.npcs))).toEqual(questPage(20, facts));
    const report = buildCoverageReport({ baseline: EMPTY_BASELINE, records, dataAsOf: day(30), connected: true, recheck: scopes });
    expect(report.rows.find((r) => r.type === "quest" && r.field === "title")?.state).toBe(state);
  }
  // A role is a fact that is there or not: it needs three new installs too.
  const roles = [...each(5, 0, 0, npc()), ...each(2, 10, 25, npc())];
  expect(npcRoles(worldFactsFromRecords(roles).npcs, [scope({ type: "npcs", ids: [10] })])).toEqual([]);
});

test("a scope on another type, zone or id, or one older than every report, leaves the fact alone", () => {
  const records = [...each(5, 0, 25, quest()), ...each(5, 0, 25, npc())];
  const facts = worldFactsFromRecords(records);
  for (const s of [scope({ type: "npcs", ids: [20] }), scope({ type: "quests", zones: [1411] }), scope({ type: "quests", ids: [21] }), scope({ type: "quests", ids: [20] })]) {
    expect(questPage(20, { ...facts, recheck: [s] }).title).toBe("A Threat Within");
  }
  // The quest is placed by its giver: a scope on the giver's zone covers it.
  const moved = [...records, ...each(3, 10, 26, quest({ title: "A Threat Without" }))];
  const before = [...each(5, 0, 0, quest()), ...each(5, 0, 0, npc()), ...each(3, 10, 26, quest({ title: "A Threat Without" }))];
  expect(questPage(20, { ...worldFactsFromRecords(moved), recheck: [scope({ type: "quests", zones: [1429] })] }).title).toBeNull();
  expect(questPage(20, { ...worldFactsFromRecords(before), recheck: [scope({ type: "quests", zones: [1429] })] }).title).toBe("A Threat Without");
});

test("entrances, bosses and treasures count only the rows after their scope", () => {
  const records = [
    ...each(5, 0, 0, () => ({ kind: "instance_entrance", instanceMapId: 9036, name: "The Deadmines", instanceType: "party", mapId: 1429, x: 30, y: 70 })),
    ...each(3, 10, 25, () => ({ kind: "instance_entrance", instanceMapId: 9036, name: "The Deadmines", instanceType: "party", mapId: 1429, x: 35, y: 75 })),
    ...each(5, 0, 0, () => ({ kind: "encounter", encounterId: 639, name: "Edwin VanCleef", instanceMapId: 9036, success: true, npcIds: [639] })),
    ...each(3, 10, 25, () => ({ kind: "encounter", encounterId: 639, name: "Vanessa VanCleef", instanceMapId: 9036, success: true, npcIds: [3439] })),
    ...each(5, 0, 0, () => ({ kind: "object_sighting", objectId: 500, name: "Battered Chest", mapId: 1411, x: 10, y: 10 })),
    ...each(3, 10, 25, () => ({ kind: "object_sighting", objectId: 500, name: "Solid Chest", mapId: 1411, x: 50, y: 50 })),
  ];
  const facts = instanceFactsFromRecords(records);
  const at = new Date(day(30));
  expect(confirmedEntrances(facts.entrances, at).map((e) => [e.x, e.y, e.reporters])).toEqual([[30, 70, 8]]);
  expect(confirmedEntrances(facts.entrances, at, [scope({ type: "entrances", zones: [1429] })]).map((e) => [e.x, e.y, e.reporters])).toEqual([[35, 75, 3]]);
  const plain = instanceBosses(facts.encounters, at).get(9036)![0]!;
  expect(plain).toMatchObject({ name: null, npcIds: [639, 3439], reporters: 8, kills: 8 });
  const scoped = instanceBosses(facts.encounters, at, [scope({ type: "bosses", zones: [1429] })], facts.entrances).get(9036)![0]!;
  expect(scoped).toMatchObject({ name: "Vanessa VanCleef", npcIds: [3439], reporters: 3, kills: 3, lastSeen: day(25) });

  const sightings = objectSightingRowsFromRecords(records);
  expect(objectSpawns(sightings).pins.map((p) => [p.x, p.y])).toEqual([[10, 10], [50, 50]]);
  const treasure = [scope({ type: "treasures", ids: [500] })];
  // The old cluster has no row after the date: it is neither a pin nor a count.
  expect(objectSpawns(sightings, [], at, treasure)).toMatchObject({ pins: [{ x: 50, y: 50, reporters: 3 }], unconfirmed: [] });
  expect(agreedObjectNames(sightings).get(500)).toBeUndefined();
  expect(agreedObjectNames(sightings, treasure).get(500)).toBe("Solid Chest");
});

test("the drop rates' cut-off is per source: a public rate leaves public until three installs loot it again", () => {
  const records = [...each(5, 0, 0, loot(10)), ...each(2, 10, 25, loot(10)), ...each(5, 0, 0, loot(11)), { ...loot(10)(), installId: "install-99", eventId: "e-untimed" }];
  const scopes = [scope({ type: "drops", ids: [10] })];
  expect(recheckLootRecords(records, [])).toBe(records);
  expect([...lootRecheckSince(records, scopes)]).toEqual([["npc:10", SINCE]]);
  const cut = rollupDrops(lootWindowsFromRecords(recheckLootRecords(records, scopes))).rates;
  // Old windows and the one without a time are out; NPC 11 keeps all of its own.
  expect(cut.find((r) => r.sourceNpcId === 10)).toMatchObject({ kills: 2, reporters: 2, public: false });
  expect(cut.find((r) => r.sourceNpcId === 11)).toMatchObject({ kills: 5, public: true });
  // An item id names every source that dropped it.
  expect([...lootRecheckSince(records, [scope({ ids: [30] })]).keys()].sort()).toEqual(["npc:10", "npc:11"]);
  // Rows of other kinds pass through untouched.
  const sighting = { kind: "npc_sighting", installId: "install-1", capturedAt: day(0), npcId: 10, name: "x", mapId: 1429, x: 1, y: 1 };
  expect(recheckLootRecords([...records, sighting], scopes)).toContain(sighting);

  // Placed in a released zone by their sightings, so the score counts them.
  const placed = [...records, ...each(3, 0, 0, npc()), ...each(3, 0, 0, npc({ npcId: 11 }))];
  const score = (rows: unknown[]) => computeCoverage({ records: [...placed, ...rows], asOf: day(30), zones: ZONES, recheck: scopes }).totals.drops;
  expect(score([])).toMatchObject({ recheck: 1, confirmed: 1 });
  expect(score(each(1, 12, 26, loot(10)))).toMatchObject({ recheck: 0, confirmed: 2 });
});
