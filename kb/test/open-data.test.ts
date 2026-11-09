import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { readCatalogFiles } from "../src/catalog-index.js";
import { buildOpenData, OPEN_DATA_KINDS, type Dataset, type OpenDataInput } from "../src/open-data/build.js";
import { readOpenDataGameFiles, type OpenDataCatalogs } from "../src/open-data/game-data.js";
import { OpenDataManifest } from "../src/open-data/manifest.js";
import { readRecordsFile } from "../src/open-data/read.js";
import { renderReadme } from "../src/open-data/text.js";
import { writeOpenData } from "../src/open-data/write.js";
import { npcPage, npcRoles, npcTraits, questPage, questTraits, vendorPage, worldFactsFromRecords } from "../src/world-pages.js";
import type { Edge } from "../src/edges.js";
import type { WorldMapData } from "../src/world-map-data.js";
import { z } from "zod";

const AT = "2026-10-10T12:00:00.000Z";
const NOW = "2026-10-12T09:30:00.000Z";

/** `n` installs, named by the group they belong to, so a fact with 1, 2 or 3 installs is one group. */
const installs = (n: number) => Array.from({ length: n }, (_, i) => `inst-${n}-${i}`);
const each = <T>(n: number, make: (installId: string, i: number) => T): T[] => installs(n).map(make);
const base = (installId: string) => ({ installId, eventId: `e-${installId}`, capturedAt: AT });

/**
 * One fact of every kind, held by one, two and three installs. The id of the fact says which: 1xx is one
 * install, 2xx two, 3xx three. Only the 3xx facts may come out.
 */
function corpus(): unknown[] {
  const out: unknown[] = [];
  for (const n of [1, 2, 3]) {
    out.push(...each(n, (id) => ({ ...base(id), kind: "npc_sighting", npcId: 100 * n, name: `Marshal ${n}`, mapId: 1429, x: 40 + n, y: 60, positionKind: "interaction", role: "questgiver", level: 12, creatureType: "Humanoid", rank: "elite" })));
    out.push(...each(n, (id) => ({ ...base(id), kind: "quest", questId: 1000 + 100 * n, title: `Quest ${n}`, level: 9, giverNpcId: 100 * n, turnInNpcId: 100 * n, rewardItemIds: [5000 + 100 * n], category: "Elwynn Forest", faction: "alliance" })));
    out.push(...each(n, (id) => ({ ...base(id), kind: "vendor", vendorNpcId: 100 * n, items: [{ itemId: 6000 + 100 * n, priceCopper: 250 }] })));
    out.push(...each(n, (id) => ({ ...base(id), kind: "loot", sourceEvidence: "loot-api", sourceNpcId: 100 * n, items: [{ itemId: 7000 + 100 * n, count: 1 }] })));
    out.push(...each(n, (id) => ({ ...base(id), kind: "loot", sourceEvidence: "loot-api", sourceNpcId: 8000 + 100 * n, items: [] })));
    out.push(...each(n, (id) => ({ ...base(id), kind: "item_seen", itemId: 9000 + 100 * n, name: `Linen Cloth ${n}`, quality: "common" })));
    out.push(...each(n, (id) => ({ ...base(id), kind: "instance_entrance", instanceMapId: 30 + n, name: `Deadmines ${n}`, instanceType: "party", mapId: 1436, x: 42, y: 71 })));
    out.push(...each(n, (id) => ({ ...base(id), kind: "encounter", encounterId: 600 + n, name: `Boss ${n}`, instanceMapId: 30 + n, success: true, npcIds: [700 + n] })));
    out.push(...each(n, (id) => ({ ...base(id), kind: "object_sighting", objectId: 800 + n, name: `Chest ${n}`, mapId: 1429, x: 30, y: 30 })));
    out.push(...each(n, (id) => ({ ...base(id), kind: "loot", sourceEvidence: "loot-api", sourceObjectId: 900 + n, sourceObjectName: `Peacebloom ${n}`, gatherKind: "herb", mapId: 1429, x: 50, y: 50, items: [{ itemId: 2447, count: 1 }] })));
  }
  return out;
}

const BOUNDS = { left: 100, top: 100, right: -100, bottom: -100 };
const MAP: WorldMapData = {
  schema: "everloot.world-map/1",
  source: { name: "x", status: "found in game files, unconfirmed", licence: "Blizzard", licenceUrl: "https://example.com", product: "wow_forever", buildId: 1, version: "1.60.1.70450", buildConfig: "x", definitions: null, extractedAt: AT, tables: [] },
  continents: [{ id: 0, name: "Eastern Kingdoms", bounds: BOUNDS }],
  zones: [{ uiMapId: 1429, name: "Elwynn Forest", continentId: 0, bounds: BOUNDS }],
  heldBackZones: [{ uiMapId: 2482, name: "Mount Hyjal", continentId: 1, bounds: { left: 9000, top: 9000, right: 8000, bottom: 8000 } }],
  // The committed map file carries a zone, a level range and difficulties per entrance, and a zone per flight master.
  entrances: [{ mapId: 36, name: "The Deadmines", raid: false, continentId: 0, worldX: -11208, worldY: 1675, uiMapId: 1436, minLevel: 15, maxLevel: 25, difficultyIds: [1] }],
  flightNodes: [
    { id: 2, name: "Stormwind, Elwynn", continentId: 0, worldX: 10, worldY: 10, uiMapId: 1429 },
    { id: 3, name: "Goldshire, Elwynn", continentId: 0, worldX: 20, worldY: 20 },
    { id: 99, name: "Nordrassil, Mount Hyjal", continentId: 1, worldX: 8500, worldY: 8500 },
  ],
  flightPaths: [
    { from: 2, to: 3, continentId: 0, points: [[10, 10], [20, 20]] },
    { from: 3, to: 99, continentId: 0, points: [[20, 20], [8500, 8500]] },
  ],
  warnings: [],
};
const CLIENT_EDGE = (over: Partial<Edge> = {}): Edge => ({ fromKind: "item", fromId: 25, rel: "created_by", toKind: "spell", toId: 7, evidence: "client", build: "1.60.1.70450", installs: null, firstSeen: AT, lastSeen: AT, ...over });

/**
 * The catalog files: the eight catalog kinds from the fixture folder the catalog index is tested on, and one
 * or two rows of each of the recipe, class, talent and raid files, with the stamp each file carries.
 */
const STAMP = { product: "wowf", buildId: 70790, version: "1.60.1.70790", buildConfig: "x", definitions: null, extractedAt: AT };
const CREDIT = "Game data © Blizzard Entertainment, Inc.";
const LABEL = "Found in game files, unconfirmed" as const;
function catalogFixture(): OpenDataCatalogs {
  const { files } = readCatalogFiles(join(__dirname, "fixtures", "game-files"));
  return {
    achievements: files.achievements!, factions: files.factions!, titles: files.titles!, questLines: files.questLines!,
    mounts: files.mounts!, encounters: files.encounters!, races: files.races!, legacyPerks: files.legacyPerks!,
    recipes: {
      schema: "everloot.client-recipes/1", label: LABEL, credit: CREDIT, build: STAMP,
      note: "ranks are SkillLineAbility's MinSkillLineRank, TrivialSkillLineRankLow (yellow) and TrivialSkillLineRankHigh (grey), 0 where the files give none; green is not stored",
      professions: [{ id: 164, name: "Blacksmithing", otherSpells: 1, recipes: [[2660, 2862, 1, 25, 45, [[2840, 1]]], [3115, 0, 0, 0, 0, [[2835, 2]]]] }],
    },
    classGear: {
      schema: "everloot.client-class-gear/1", label: LABEL, credit: CREDIT, build: STAMP,
      classes: { warrior: { id: 1, gear: [[2, 7, 0], [4, 4, 40]] } }, restricted: { "17182": 1 },
      note: "proficiencies and class masks are the game files'; races are not told apart",
    },
    classSpells: {
      schema: "everloot.client-class-spells/1", label: LABEL, credit: CREDIT, build: STAMP,
      classes: { warrior: { id: 1, spells: [78, 100] } }, note: "class skill lines and class masks are the game files'; races are not told apart",
    },
    talents: [{
      schema: "everloot.talent-catalog/2", build: { version: "1.60.1.70790", extractedAt: AT }, classId: 8, className: "Mage",
      trees: [{ id: 11582, name: "Arcane", order: 0, nodes: [
        { id: 105798, x: 1620, y: 5730, row: 6, col: 1, kind: "single", maxRanks: 1, entries: [{ definitionId: 135328, spellId: 12042, name: "Arcane Power", maxRanks: 1 }], prereqs: [{ nodeId: 105801, rule: "any" }] },
      ] }],
    }],
    raidBuffs: {
      schema: "everloot.web-raid-data/1", build: "1.60.1.70790",
      entries: [{ id: "arcane-intellect", label: "Arcane Intellect", kind: "buff", class: "mage", family: "arcane-intellect", scope: "single", tree: "baseline", names: ["Arcane Intellect"], spellIds: [1459, 1460] }],
    },
  };
}

const input = (records: unknown[] = corpus(), over: Partial<OpenDataInput> = {}): OpenDataInput => ({
  records, dataAsOf: AT, generatedAt: NOW,
  gameFiles: {
    build: { version: "1.60.1.70450", extractedAt: AT },
    edges: [CLIENT_EDGE(), CLIENT_EDGE({ fromId: 26, toId: 8 }), CLIENT_EDGE({ evidence: "observed", installs: 5, build: null, fromId: 27 })],
    taxonomy: {
      classes: [{ id: 2, name: "Weapon", label: "Weapons", slug: "weapons", items: 2 }],
      subclasses: [{ classId: 2, id: 7, name: "Sword", slug: "sword", items: 2 }],
      items: [[25, 2, 7, 13, 1], [26, 2, 7, 13, null]],
    },
    map: MAP,
    catalogs: catalogFixture(),
  },
  ...over,
});

const byName = (datasets: Dataset[], layer: string, name: string) => datasets.find((d) => d.layer === layer && d.name === name)!;
const rows = (datasets: Dataset[], layer: string, name: string) => byName(datasets, layer, name).rows as Record<string, unknown>[];

let dir: string;
beforeEach(() => { dir = join(mkdtempSync(join(tmpdir(), "everloot-open-data-")), "out"); });
afterEach(() => { rmSync(join(dir, ".."), { recursive: true, force: true }); });

test("only facts three installs agree on come out; one-install and two-install facts of every kind stay out", () => {
  const { datasets } = buildOpenData(input());
  const only = (name: string, idOf: (r: Record<string, unknown>) => unknown, expected: unknown[]) => expect(rows(datasets, "observed", name).map(idOf), name).toEqual(expected);
  only("npcs", (r) => r.npcId, [300]);
  only("quests", (r) => r.questId, [1300]);
  only("vendor-offers", (r) => r.vendorNpcId, [300]);
  only("drop-rates", (r) => r.sourceNpcId ?? r.sourceObjectId, [300, 903]);
  only("drop-measured-zeros", (r) => r.sourceNpcId, [8300]);
  only("item-names", (r) => r.itemId, [9300]);
  only("entrances", (r) => r.instanceMapId, [33]);
  only("bosses", (r) => r.encounterId, [603]);
  // Object 803 is the treasure the minimap showed, 903 the herb opened in a loot window; 801, 802, 901 and 902 are short.
  only("objects", (r) => r.objectId, [803, 903]);
  expect(rows(datasets, "observed", "object-pins").map((r) => [r.source, r.objectId])).toEqual([["treasure", 803], ["loot", 903]]);
  // A relation of every kind players saw, from the same three installs; none from one or two.
  const rel = rows(datasets, "observed", "relations");
  expect(rel.length).toBeGreaterThan(0);
  for (const r of rel) expect(r.installs).toBeGreaterThanOrEqual(3);
  expect(rel.map((r) => [r.fromKind, r.fromId, r.rel, r.toKind, r.toId])).toEqual(expect.arrayContaining([
    ["item", 7300, "dropped_by", "npc", 300], ["item", 6300, "sold_by", "npc", 300], ["item", 5300, "reward_from", "quest", 1300], ["npc", 300, "located_in", "zone", 1429],
  ]));
  const leaked = rel.filter((r) => [100, 200, 1100, 1200, 5100, 5200, 6100, 6200, 7100, 7200].some((id) => id === r.fromId || id === r.toId));
  expect(leaked).toEqual([]);
});

test("every observed count is three or more, and the rows say how many installs agree", () => {
  const { datasets } = buildOpenData(input());
  const npc = rows(datasets, "observed", "npcs")[0]!;
  expect(npc).toMatchObject({ npcId: 300, name: "Marshal 3", level: 12, creatureType: "Humanoid", rank: "elite", roles: [{ role: "questgiver", installs: 3 }], pins: [{ mapId: 1429, x: 43, y: 60, installs: 3 }], installs: { name: 3, level: 3, creatureType: 3, rank: 3 } });
  expect(rows(datasets, "observed", "quests")[0]).toMatchObject({ questId: 1300, title: "Quest 3", side: "alliance", rewards: [{ itemId: 5300, installs: 3 }], installs: { title: 3, side: 3 } });
  for (const d of datasets.filter((x) => x.layer === "observed")) {
    for (const row of d.rows) {
      const counts = [...JSON.stringify(row).matchAll(/"installs":(\d+)/g)].map((m) => Number(m[1]));
      for (const c of counts) expect(c, d.name).toBeGreaterThanOrEqual(3);
    }
  }
});

test("a fact the installs split on, or that two agree on, is null, and an entity with no agreed fact has no row", () => {
  const split = [
    ...each(2, (id) => ({ ...base(id), kind: "npc_sighting", npcId: 5, name: "Hogger", mapId: 1429, x: 1, y: 1, positionKind: "player" })),
    { ...base("inst-x-0"), kind: "npc_sighting", npcId: 5, name: "Hogga", mapId: 1429, x: 1, y: 1, positionKind: "player" },
    // Three and three on two different names: contested, so neither is stated.
    ...Array.from({ length: 3 }, (_, i) => ({ ...base(`inst-a-${i}`), kind: "npc_sighting", npcId: 6, name: "Eliza", mapId: 1429, x: 1, y: 1, positionKind: "player", level: 5 })),
    ...Array.from({ length: 3 }, (_, i) => ({ ...base(`inst-b-${i}`), kind: "npc_sighting", npcId: 6, name: "Elisa", mapId: 1429, x: 1, y: 1, positionKind: "player" })),
  ];
  const npcs = rows(buildOpenData(input(split)).datasets, "observed", "npcs");
  // NPC 5: no value has three installs, so no row. NPC 6: the level has three, the name is contested.
  expect(npcs).toHaveLength(1);
  expect(npcs[0]).toMatchObject({ npcId: 6, name: null, level: 5, installs: { name: null, level: 3 } });
});

test("the player's own position never makes a pin, as on the NPC page", () => {
  const standing = Array.from({ length: 3 }, (_, i) => ({ ...base(`inst-p-${i}`), kind: "npc_sighting", npcId: 9, name: "Rare Wolf", mapId: 1429, x: 5, y: 5, positionKind: "player" }));
  const npcs = rows(buildOpenData(input(standing)).datasets, "observed", "npcs");
  expect(npcs[0]).toMatchObject({ npcId: 9, name: "Rare Wolf", pins: [] });
});

test("the values match what the site's pages state for the same records", () => {
  const records = corpus();
  const facts = worldFactsFromRecords(records);
  const { datasets } = buildOpenData(input(records));
  const npc = rows(datasets, "observed", "npcs")[0]!;
  const page = npcPage(300, facts), traits = npcTraits(facts.npcs.filter((r) => r.npcId === 300));
  expect(npc).toMatchObject({ name: page.name, level: traits.level, creatureType: traits.creatureType, rank: traits.rank });
  expect(npc.roles).toEqual(npcRoles(facts.npcs.filter((r) => r.npcId === 300)).map((role) => ({ role, installs: 3 })));
  expect(npc.pins).toEqual(page.pins.map((p) => ({ mapId: p.mapId, x: p.x, y: p.y, installs: p.reporters })));
  const quest = rows(datasets, "observed", "quests")[0]!, qp = questPage(1300, facts), qt = questTraits(facts.quests.filter((q) => q.questId === 1300));
  expect(quest).toMatchObject({ title: qp.title, level: qp.level, giverNpcId: qp.giverNpcId, turnInNpcId: qp.turnInNpcId, category: qt.category, side: qt.side });
  expect((quest.rewards as { itemId: number }[]).map((r) => r.itemId)).toEqual(qp.rewards);
  const offer = rows(datasets, "observed", "vendor-offers")[0]!;
  expect(vendorPage(300, facts).offers).toEqual([{ itemId: offer.itemId, priceCopper: offer.priceCopper, limitedStock: offer.limitedStock, unlimited: offer.unlimited, reporters: offer.installs }]);
});

test("Polestar Recorder installs that share an address are one voter, so three of them confirm nothing", () => {
  const address = "a".repeat(16);
  const recorder = ["1", "2", "3"].map((c) => ({ ...base(`ps-${c.repeat(16)}-${address}`), kind: "npc_sighting", npcId: 77, name: "Recorder Rare", mapId: 1429, x: 9, y: 9, positionKind: "vignette" }));
  const out = buildOpenData(input(recorder));
  expect(rows(out.datasets, "observed", "npcs")).toEqual([]);
  expect(out.source.installs).toBe(1);
});

test("the records that leave are only the kinds the datasets read: named records and census rows are dropped first", () => {
  const named = [{ ...base("inst-n-0"), kind: "guild_snapshot", guildName: "Secret Guild", members: [] }, { ...base("inst-n-0"), kind: "collection_owned", character: "Hidden", items: [] }];
  const out = buildOpenData(input([...corpus(), ...named]));
  expect(out.source.records).toBe(corpus().length);
  expect(out.source.kinds).toEqual([...OPEN_DATA_KINDS]);
});

test("the game-file layer carries the build's ids and relations and leaves out held-back zones and observed edges", () => {
  const { datasets } = buildOpenData(input());
  expect(rows(datasets, "game-files", "item-categories")).toEqual([
    { itemId: 25, classId: 2, subclassId: 7, inventoryType: 13, quality: 1, className: "Weapons", subclassName: "Sword", slot: expect.any(String), qualityName: "Common" },
    { itemId: 26, classId: 2, subclassId: 7, inventoryType: 13, quality: null, className: "Weapons", subclassName: "Sword", slot: expect.any(String), qualityName: null },
  ]);
  expect(rows(datasets, "game-files", "relations").map((r) => r.fromId)).toEqual([25, 26]);
  expect(rows(datasets, "game-files", "zones").map((z) => z.uiMapId)).toEqual([1429]);
  expect(byName(datasets, "game-files", "zones").candidates).toBe(2);
  expect(rows(datasets, "game-files", "flight-masters").map((n) => n.id)).toEqual([2, 3]);
  expect(rows(datasets, "game-files", "flight-paths").map((p) => [p.from, p.to])).toEqual([[2, 3]]);
  expect(rows(datasets, "game-files", "entrances")).toEqual([{ mapId: 36, name: "The Deadmines", raid: false, continentId: 0, worldX: -11208, worldY: 1675 }]);
  expect(rows(datasets, "game-files", "flight-masters")[0]).toEqual({ id: 2, name: "Stormwind, Elwynn", continentId: 0, worldX: 10, worldY: 10 });
});

test("every committed catalog is a game-files dataset: ids, the names the files hold and each file's own build, all rows counted", () => {
  const { datasets } = buildOpenData(input());
  const catalog = (name: string) => byName(datasets, "game-files", name);
  expect(rows(datasets, "game-files", "achievements")).toEqual([
    { achievementId: 1234, title: "Loremaster", points: 10, criteria: 2, statistic: false, build: "1.60.1.70707" },
    { achievementId: 1300, title: "Creatures slain", points: 0, criteria: 0, statistic: true, build: "1.60.1.70707" },
  ]);
  expect(rows(datasets, "game-files", "factions")).toEqual([{ factionId: 1, name: "Stormwind", parentId: null, shown: true, build: "1.60.1.70755" }]);
  expect(rows(datasets, "game-files", "titles")).toEqual([{ titleId: 7, name: "%s, Champion", build: expect.any(String) }]);
  expect(rows(datasets, "game-files", "quest-lines")).toEqual([
    { questLineId: 1, name: "The Missing Diplomat", questIds: [11, 10], build: expect.any(String) },
    { questLineId: 2, name: "Lonely", questIds: [], build: expect.any(String) },
  ]);
  expect(rows(datasets, "game-files", "mounts")).toEqual([{ mountId: 5, name: "Gray Wolf", spellId: 6777, ridingSkill: 75, build: expect.any(String) }]);
  expect(rows(datasets, "game-files", "encounters")).toEqual([
    { instanceMapId: 36, encounterId: 1, name: "Rhahk'Zor", difficultyId: null, build: expect.any(String) },
    { instanceMapId: 36, encounterId: 2, name: "Edwin VanCleef", difficultyId: 1, build: expect.any(String) },
  ]);
  // A recipe row is the file's tuple named: item 0 is null (makes none), rank 0 stays 0 (the files give none).
  expect(rows(datasets, "game-files", "recipes")).toEqual([
    { professionId: 164, professionName: "Blacksmithing", spellId: 2660, itemId: 2862, minRank: 1, yellowRank: 25, greyRank: 45, reagents: [{ itemId: 2840, count: 1 }], build: "1.60.1.70790" },
    { professionId: 164, professionName: "Blacksmithing", spellId: 3115, itemId: null, minRank: 0, yellowRank: 0, greyRank: 0, reagents: [{ itemId: 2835, count: 2 }], build: "1.60.1.70790" },
  ]);
  expect(rows(datasets, "game-files", "class-gear")).toEqual([
    { classId: 1, className: "warrior", itemClassId: 2, itemSubclassId: 7, level: 0, build: "1.60.1.70790" },
    { classId: 1, className: "warrior", itemClassId: 4, itemSubclassId: 4, level: 40, build: "1.60.1.70790" },
  ]);
  expect(rows(datasets, "game-files", "class-gear-restrictions")).toEqual([{ itemId: 17182, classMask: 1, build: "1.60.1.70790" }]);
  expect(rows(datasets, "game-files", "class-spells").map((r) => r.spellId)).toEqual([78, 100]);
  // Races and talents carry names, never the trait text or spell descriptions.
  const race = rows(datasets, "game-files", "races")[0]!;
  expect(race).toMatchObject({ raceId: 2, name: "Orc", faction: "Horde", build: "1.60.1.70707" });
  expect((race.traits as object[]).length).toBe(1);
  expect(JSON.stringify(race)).not.toContain("description");
  expect(rows(datasets, "game-files", "legacy-perks")).toEqual([{ treeId: 1187, nodeId: 110284, entryId: 136844, definitionId: 141607, spellId: 1225469, name: "Sturdy", maxRanks: 1, build: "1.60.1.70707" }]);
  expect(rows(datasets, "game-files", "talent-nodes")).toEqual([{
    classId: 8, className: "Mage", treeId: 11582, treeName: "Arcane", nodeId: 105798, x: 1620, y: 5730, row: 6, col: 1, kind: "single", maxRanks: 1,
    entries: [{ definitionId: 135328, spellId: 12042, name: "Arcane Power", maxRanks: 1 }], prereqs: [{ nodeId: 105801, rule: "any" }], build: "1.60.1.70790",
  }]);
  expect(rows(datasets, "game-files", "raid-buffs")).toEqual([{
    id: "arcane-intellect", label: "Arcane Intellect", kind: "buff", class: "mage", family: "arcane-intellect", scope: "single", tree: "baseline", treeProof: null,
    names: ["Arcane Intellect"], spellIds: [1459, 1460], build: "1.60.1.70790",
  }]);
  // Every catalog dataset counts all its rows, labelled with the build of its own file, and every row is a row of its strict schema.
  const names = ["achievements", "factions", "titles", "quest-lines", "mounts", "encounters", "recipes", "class-gear", "class-gear-restrictions", "class-spells", "races", "legacy-perks", "talent-nodes", "raid-buffs"];
  for (const name of names) {
    const d = catalog(name);
    expect(d.candidates, name).toBe(d.rows.length);
    expect(d.candidatesAre, name).toMatch(/^all rows of the build 1\.60\.1\.\d+$/);
    for (const row of d.rows) {
      expect(d.schema.safeParse(row).success, name).toBe(true);
      expect(d.schema.safeParse({ ...(row as object), installId: "inst-3-0" }).success, name).toBe(false);
      expect((row as { build: string }).build, name).toBe(d.candidatesAre.slice("all rows of the build ".length));
    }
  }
  expect(catalog("factions").candidatesAre).toBe("all rows of the build 1.60.1.70755");
});

test("the manifest lists every catalog file with its rows and bytes, and the README no longer says the catalogs are missing", () => {
  const { manifest } = writeOpenData(dir, input());
  const file = (name: string) => manifest.files.find((f) => f.path === `game-files/${name}.ndjson`)!;
  expect(file("achievements")).toMatchObject({ layer: "game-files", dataset: "achievements", rows: 2, candidates: 2, schema: "schema/game-files-achievements.schema.json" });
  expect(file("talent-nodes")).toMatchObject({ rows: 1, candidates: 1, candidatesAre: "all rows of the build 1.60.1.70790" });
  expect(file("raid-buffs").bytes).toBeGreaterThan(0);
  for (const name of ["factions", "titles", "quest-lines", "mounts", "encounters", "recipes", "class-gear", "class-spells", "races", "legacy-perks"]) expect(file(name).rows, name).toBeGreaterThan(0);
  expect(manifest.files.filter((f) => f.layer === "game-files")).toHaveLength(21);
  const readme = readFileSync(join(dir, "README.md"), "utf8");
  expect(readme).toContain("game-files/achievements.ndjson");
  expect(readme).not.toContain("the achievement, faction, title and quest chain lists");
  expect(manifest.notYet.join("\n")).not.toMatch(/achievement|faction|title|quest chain|recipe/);
});

test("the committed game-data folder reads as a full set of catalogs, and a folder missing one is refused", () => {
  const root = join(__dirname, "..", "..", "web", "src", "data", "game-data");
  const catalogs = readOpenDataGameFiles(root);
  expect(catalogs.talents.length).toBe(9);
  expect(catalogs.raidBuffs.entries.length).toBeGreaterThan(0);
  const { datasets } = buildOpenData(input(corpus(), { gameFiles: { ...input().gameFiles, catalogs } }));
  for (const d of datasets.filter((x) => x.layer === "game-files")) expect(d.rows.length, d.name).toBeGreaterThan(0);
  // The fixture folder has the eight catalog kinds and nothing else: the first file not there stops the read.
  expect(() => readOpenDataGameFiles(join(__dirname, "fixtures", "game-files"))).toThrow(/open-data: no talent files/);
});

test("the export writes a folder whose manifest matches its files, with the schema, README and licence", () => {
  const { manifest, paths } = writeOpenData(dir, input());
  expect(OpenDataManifest.parse(JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")))).toEqual(manifest);
  expect(manifest).toMatchObject({ generatedAt: NOW, dataAsOf: AT, method: { agreement: 3 }, source: { installs: 6 }, gameFiles: { version: "1.60.1.70450" } });
  expect(manifest.licence.observed).toMatchObject({ name: "CC BY-SA 4.0", credit: "Data from Everloot (https://everloot.app), CC BY-SA 4.0." });
  expect(manifest.licence.gameFiles.name).toContain("not under Everloot's licence");
  for (const f of manifest.files) {
    const body = readFileSync(join(dir, f.path));
    expect(body.length).toBe(f.bytes);
    expect(createHash("sha256").update(body).digest("hex")).toBe(f.sha256);
    expect(body.toString("utf8").split("\n").filter(Boolean)).toHaveLength(f.rows);
    expect(JSON.parse(readFileSync(join(dir, f.schema), "utf8"))).toHaveProperty("properties");
    expect(paths).toContain(f.path);
    // A number with a denominator: the rows never exceed what they were chosen from.
    if (f.candidates !== null) expect(f.rows, f.path).toBeLessThanOrEqual(f.candidates);
    expect(f.candidatesAre.length, f.path).toBeGreaterThan(0);
  }
  expect(manifest.files.find((f) => f.path === "observed/npcs.ndjson")).toMatchObject({ rows: 1, candidates: 3 });
  expect(manifest.files.find((f) => f.path === "observed/quests.ndjson")).toMatchObject({ rows: 1, candidates: 3 });
  const readme = readFileSync(join(dir, "README.md"), "utf8");
  for (const phrase of ["CC BY-SA 4.0", "Data from Everloot (https://everloot.app), CC BY-SA 4.0.", "2026-10-10 12:00 UTC", "2026-10-12 09:30 UTC", "1.60.1.70450", "3 or more installs agree", "pfQuest", "How to verify a count", "observed/npcs.ndjson"]) expect(readme, phrase).toContain(phrase);
  expect(readFileSync(join(dir, "LICENCE.md"), "utf8")).toContain("Blizzard's data, not under our licence");
});

test("no install id, no pseudonym and no installId key is in any file of the folder", () => {
  const withPseudonyms = corpus().map((r) => ({ ...(r as Record<string, unknown>), installId: `pub-${createHash("sha256").update(String((r as { installId: string }).installId)).digest("hex").slice(0, 32)}` }));
  const ids = new Set((withPseudonyms as { installId: string }[]).map((r) => r.installId));
  writeOpenData(dir, input(withPseudonyms));
  const files = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(d, e.name)) : [join(d, e.name)]));
  const all = files(dir).map((f) => readFileSync(f, "utf8")).join("\n");
  expect(all).not.toContain("installId");
  expect(all).not.toContain("pub-");
  for (const id of ids) expect(all).not.toContain(id);
});

test("the writer refuses a row under three installs, a key the schema does not name and an install id, and writes nothing", () => {
  const good = buildOpenData(input());
  const mutate = (change: (rows: Record<string, unknown>[]) => void) => {
    const datasets = good.datasets.map((d) => ({ ...d, rows: d.name === "item-names" && d.layer === "observed" ? structuredClone(d.rows) as Record<string, unknown>[] : d.rows }));
    change(rows(datasets, "observed", "item-names"));
    return { ...good, datasets };
  };
  expect(() => writeOpenData(dir, input(), mutate((r) => { r[0]!.installs = 2; }))).toThrow(/refusing to export: observed\/item-names row 1/);
  expect(() => writeOpenData(dir, input(), mutate((r) => { r[0]!.installId = "inst-3-0"; }))).toThrow(/refusing to export/);
  expect(() => writeOpenData(dir, input(), mutate((r) => { r[0]!.name = "inst-3-0"; }))).toThrow(/carries an install id/);
  expect(() => writeOpenData(dir, input(), mutate((r) => { r[0]!.name = "C:\\Users\\someone\\notes.txt"; }))).toThrow(/local filesystem path/);
  expect(() => readdirSync(dir)).toThrow();
});

test("every observed row schema refuses fewer than three installs, and refuses a value with no count", () => {
  const { datasets } = buildOpenData(input());
  const fields = (schema: z.ZodType) => JSON.stringify(z.toJSONSchema(schema));
  for (const d of datasets.filter((x) => x.layer === "observed")) {
    expect(fields(d.schema), d.name).toContain('"minimum":3');
    for (const row of d.rows) expect(d.schema.safeParse(row).success).toBe(true);
  }
  const npc = byName(datasets, "observed", "npcs");
  expect(npc.schema.safeParse({ ...(npc.rows[0] as object), installs: { name: null, level: 3, creatureType: 3, rank: 3 } }).success).toBe(false);
  expect(npc.schema.safeParse({ ...(npc.rows[0] as object), installs: { name: 2, level: 3, creatureType: 3, rank: 3 } }).success).toBe(false);
});

test("a folder that is not empty is not written into, and a missing date reads [?]", () => {
  writeOpenData(dir, input());
  expect(() => writeOpenData(dir, input())).toThrow(/not empty/);
  const second = join(dir, "..", "second");
  const { manifest } = writeOpenData(second, input(corpus(), { dataAsOf: null }));
  expect(manifest.dataAsOf).toBeNull();
  expect(readFileSync(join(second, "README.md"), "utf8")).toContain("Data current as of: [?]");
  expect(renderReadme(manifest)).toContain("[?]");
});

test("with no records the observed files are empty and the manifest says zero of zero, never a guess", () => {
  const { manifest } = writeOpenData(dir, input([]));
  for (const f of manifest.files.filter((x) => x.layer === "observed")) expect(f, f.path).toMatchObject({ rows: 0, candidates: 0, bytes: 0 });
  expect(manifest.source).toMatchObject({ records: 0, installs: 0 });
});

test("the exporter reads no baseline, no ledger and no name from the game files", () => {
  const dirOf = join(__dirname, "..", "src", "open-data");
  const source = readdirSync(dirOf).map((f) => readFileSync(join(dirOf, f), "utf8")).join("\n");
  for (const forbidden of ["baseline-report", "importers/pfquest", "pfquest-classic", "item-names", "game-names", "name-gaps", "readCoverageBaseline", "coverage-report"]) {
    expect(source, forbidden).not.toContain(`from "../${forbidden}`);
    expect(source, forbidden).not.toContain(`from "./${forbidden}`);
  }
  expect(source).not.toMatch(/pfquest-classic|SELECT .* FROM entities/i);
});

test("readRecordsFile takes a saved corpus answer, a bare list and NDJSON, and refuses an invalid record", () => {
  const valid = [
    { installId: "install-aaaa", eventId: "evt-1", capturedAt: AT, kind: "npc_sighting", npcId: 1, name: "Marshal", mapId: 1429, x: 1, y: 1 },
    { installId: "install-bbbb", eventId: "evt-2", capturedAt: AT, kind: "item_seen", itemId: 2, name: "Cloth", quality: "common" },
  ];
  const file = join(dir, "..", "feed.json");
  writeFileSync(file, JSON.stringify({ ok: true, records: valid, dataAsOf: AT }));
  expect(readRecordsFile(file)).toMatchObject({ dataAsOf: AT, records: expect.arrayContaining([expect.objectContaining({ npcId: 1 })]) });
  writeFileSync(file, JSON.stringify(valid));
  expect(readRecordsFile(file).dataAsOf).toBeNull();
  writeFileSync(file, valid.map((r) => JSON.stringify(r)).join("\n"));
  expect(readRecordsFile(file).records).toHaveLength(2);
  writeFileSync(file, JSON.stringify({ records: [...valid, { kind: "npc_sighting" }] }));
  expect(() => readRecordsFile(file)).toThrow(/not valid public records/);
  writeFileSync(file, JSON.stringify({ nothing: true }));
  expect(() => readRecordsFile(file)).toThrow(/neither a list of records/);
});
