import { expect, test } from "vitest";
import type { InstanceDef } from "../../../kb/src/guilds";
import { scoreInstances } from "./everloot-score";
import type { InstanceRow } from "./instances";

// SYNTHETIC instances: the ids and names are made up.
const def = (instanceMapId: number, instanceType: InstanceDef["instanceType"], bosses: number[]): InstanceDef => ({
  instanceMapId, name: `Instance ${instanceMapId}`, instanceType, tier: 0, bosses: bosses.map((encounterId) => ({ encounterId, name: `Boss ${encounterId}` })),
});
const row = (raid: boolean | null, level: number | null, difficulties: number[]): Pick<InstanceRow, "raid" | "level" | "difficulties"> => ({
  raid, level: level === null ? null : { min: level, max: level + 5 }, difficulties,
});

test("the agreed bosses, with the files' kind, difficulties and lowest level", () => {
  const rows = new Map([[1, row(false, 20, [1, 2])], [2, row(true, 60, [3])]]);
  expect(scoreInstances([def(1, "dungeon", [11, 13]), def(2, null, [21])], rows)).toEqual([
    { instanceMapId: 1, kind: "dungeon", bosses: [11, 13], difficulties: [1, 2], minLevel: 20 },
    { instanceMapId: 2, kind: "raid", bosses: [21], difficulties: [3], minLevel: 60 },
  ]);
});

test("with no row, the players' kind stands and there is no level or difficulty; with neither, the kind is unknown", () => {
  expect(scoreInstances([def(3, "dungeon", [31]), def(4, null, [41])], new Map())).toEqual([
    { instanceMapId: 3, kind: "dungeon", bosses: [31], difficulties: [] },
    { instanceMapId: 4, kind: null, bosses: [41], difficulties: [] },
  ]);
});

test("no final boss comes from the files' encounter order", () => {
  const [d] = scoreInstances([def(1, "dungeon", [11, 12])], new Map([[1, row(false, 20, [1])]]));
  expect(d).not.toHaveProperty("finalBoss");
});
