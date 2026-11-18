import { describe, expect, test } from "vitest";
import type { ObjectSpawnRow } from "../../../kb/src/object-spawns";
import { gatherAreas } from "./farming";
import type { ZoneSummary } from "./zones";

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
