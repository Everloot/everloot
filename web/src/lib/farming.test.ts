import { describe, expect, test } from "vitest";
import type { ObjectSpawnRow } from "@kb/object-spawns";
import type { KillPlace } from "@kb/world-pages";
import { farmingAreas, gatherAreas, HERB_IDS, HERBALISM_SKILL_LINE, herbIndex, herbZones, professionTrainers, zoneFarmLinks } from "./farming";
import { bareNpcRow } from "./world-lists";
import { publicZones, type ZoneSummary } from "./zones";

const zones: ZoneSummary[] = [
  { mapId: 1, name: "Zone One", continentId: 9, continentName: "Continent" },
  { mapId: 2, name: "Zone Two", continentId: 9, continentName: "Continent" },
];
const row = (installId: string, objectId: number, mapId: number, extra: Partial<ObjectSpawnRow> = {}): ObjectSpawnRow =>
  ({ installId, objectId, mapId, x: 40, y: 40, gatherKind: "herb", ...extra });

describe("gathering areas", () => {
  test("an area keeps its old shape until 3 installs report a skill there", () => {
    const rows = ["a", "b", "c"].map((i) => row(i, 10, 1));
    expect(gatherAreas(rows, "herb", zones)).toEqual([{ key: "1", zone: zones[0], levels: null, mobs: 0, nodes: 1 }]);
    const two = [row("a", 10, 1, { gatherSkill: 15 }), row("b", 10, 1, { gatherSkill: 40 }), row("c", 10, 1)];
    expect(gatherAreas(two, "herb", zones)[0]).not.toHaveProperty("skill");
  });

  test("an area says the skill players had on the spots it counts, opened as that kind", () => {
    const rows = [
      row("a", 10, 1, { gatherSkill: 1 }), row("a", 10, 1, { gatherSkill: 30 }), row("b", 10, 1, { gatherSkill: 25 }), row("c", 10, 1, { gatherSkill: 60 }),
      // Another kind of cast on the same herb, and the herb on a map where no spot is placed, do not count.
      row("d", 10, 1, { gatherKind: "other", gatherSkill: 300 }), row("e", 10, 2, { gatherSkill: 2 }),
      // Ore in the same zone is the mining list's.
      ...["a", "b", "c"].map((i) => row(i, 20, 1, { gatherKind: "ore", gatherSkill: 125 })),
    ];
    expect(gatherAreas(rows, "herb", zones)).toEqual([{ key: "1", zone: zones[0], levels: null, mobs: 0, nodes: 1, skill: { min: 1, median: 25, installs: 3 } }]);
    expect(gatherAreas(rows, "ore", zones)[0]!.skill).toEqual({ min: 125, median: 125, installs: 3 });
  });
});

describe("mob farming areas", () => {
  // A mob with public loot whose agreed pin is in Zone Two, and kills looted on Zone One's map.
  const mob = { ...bareNpcRow(6), zone: zones[1]!, level: 7 };
  const rates = [{ sourceNpcId: 6, itemId: 2589, drops: 3, public: true }];
  const kill = (installId: string, mapId = 1): KillPlace => ({ installId, npcId: 6, mapId });
  const gold = (kills: KillPlace[]) => farmingAreas([mob], rates, kills, zones).gold.map((a) => [a.zone.mapId, a.mobs, a.levels]);

  test("3 installs looting a mob's kills on a zone's map place it in that zone", () => {
    expect(gold([kill("a"), kill("b"), kill(" c ")])).toEqual([[1, 1, { min: 7, max: 7 }]]);
  });

  test("2 installs, one install looting many times, or another zone's map fall back to the agreed pin", () => {
    expect(gold([kill("a"), kill("b")])).toEqual([[2, 1, { min: 7, max: 7 }]]);
    expect(gold([kill("a"), kill("a"), kill("a ")])).toEqual([[2, 1, { min: 7, max: 7 }]]);
    expect(gold(["a", "b", "c"].map((i) => kill(i, 99)))).toEqual([[2, 1, { min: 7, max: 7 }]]);
  });

  test("with no kill places the agreed pin decides, and a mob with neither has no zone", () => {
    expect(gold([])).toEqual([[2, 1, { min: 7, max: 7 }]]);
    expect(farmingAreas([{ ...mob, zone: null }], rates, [], zones).gold).toEqual([]);
    expect(farmingAreas([{ ...mob, zone: null }], rates).gold).toEqual([]);
  });

  test("a mob killed by 3 installs in two zones counts in both", () => {
    const both = ["a", "b", "c"].flatMap((i) => [kill(i, 1), kill(i, 2)]);
    expect(gold(both)).toEqual([[1, 1, { min: 7, max: 7 }], [2, 1, { min: 7, max: 7 }]]);
  });

  test("a zone page links to farming by the same rule: kill places first, else the pin", () => {
    // Item 2589 is cloth, so the mob backs the Tailoring and First Aid lists as well as farming routes.
    const links = (zone: ZoneSummary, pinned: number[], kills: KillPlace[]) => zoneFarmLinks(zone, pinned, rates, [], kills, zones).map((l) => l.label);
    const three = ["a", "b", "c"].map((i) => kill(i));
    expect(links(zones[0]!, [], three)).toEqual(["Farming routes", "Tailoring", "First Aid"]);
    // Placed in Zone One by its kills, the mob no longer counts in its pin's zone; with no kill places, the pin decides.
    expect(links(zones[1]!, [6], three)).toEqual([]);
    expect(links(zones[1]!, [6], [])).toEqual(["Farming routes", "Tailoring", "First Aid"]);
    expect(links(zones[0]!, [], three.slice(0, 2))).toEqual([]);
  });
});

// Herb item 765 from herb object 1617, opened in Elwynn Forest (UiMap 1429).
const ELWYNN = 1429;
const spot = (installId: string, objectId = 1617, mapId = ELWYNN) => ({ installId, objectId, mapId, x: 40, y: 60, gatherKind: "herb" as const });
const three = ["install-a", "install-b", "install-c"];
const rate = (itemId: number, sourceObjectId = 1617, isPublic = true) => ({ sourceObjectId, itemId, drops: 3, public: isPublic });

test("the herb ids are the 45 Trade Goods herbs of the committed taxonomy", () => {
  expect(HERB_IDS).toHaveLength(45);
  expect(HERB_IDS).toContain(765);
  // Item 2589 is Trade Goods (cloth), not an herb.
  expect(HERB_IDS).not.toContain(2589);
});

test("a herb zone carries its spots, the installs behind them and the herbs 3 installs looted from its nodes", () => {
  const zones = herbZones(three.map((i) => spot(i)), [rate(765), rate(2589), rate(785, 1617, false), rate(2447, 9999)], publicZones());
  expect(zones).toHaveLength(1);
  expect(zones[0]).toMatchObject({ nodes: 1, installs: 3, herbs: [765] });
  expect(zones[0].zone.mapId).toBe(ELWYNN);
});

test("two installs at a spot make no herb zone, and the herb index then lists every herb with no zone", () => {
  const zones = herbZones(three.slice(0, 2).map((i) => spot(i)), [rate(765)], publicZones());
  expect(zones).toEqual([]);
  const index = herbIndex(zones);
  expect(index).toHaveLength(45);
  expect(index.every((h) => h.zones.length === 0)).toBe(true);
});

test("the herb index lists a herb under each zone it was looted in", () => {
  const index = herbIndex(herbZones(three.map((i) => spot(i)), [rate(765)], publicZones()));
  expect(index.find((h) => h.itemId === 765)!.zones.map((z) => z.mapId)).toEqual([ELWYNN]);
  expect(index.find((h) => h.itemId === 785)!.zones).toEqual([]);
});

test("a trainer counts at 3 installs on the Herbalism line; 2 installs, other lines and unnamed trainers do not", () => {
  const row = (installId: string, trainerNpcId?: number, skillLineId?: number, profession = "Herbalism") => ({ installId, profession, trainerNpcId, skillLineId });
  const rows = [
    ...three.map((i) => row(i, 1218, HERBALISM_SKILL_LINE)),
    // No skill line from an older addon: the English profession name matches.
    ...three.map((i) => row(i, 3965, undefined)),
    ...three.slice(0, 2).map((i) => row(i, 908, HERBALISM_SKILL_LINE)),
    ...three.map((i) => row(i, 1701, 186, "Mining")),
    ...three.map((i) => row(i, undefined, HERBALISM_SKILL_LINE)),
  ];
  expect(professionTrainers(rows, HERBALISM_SKILL_LINE, "Herbalism")).toEqual([{ npcId: 1218, installs: 3 }, { npcId: 3965, installs: 3 }]);
});
