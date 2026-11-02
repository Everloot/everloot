import { expect, test } from "vitest";
import type { InstanceDef } from "../../../kb/src/guilds";
import { scoreInstances } from "./everloot-score";
import type { InstanceRow } from "./instances";

// SYNTHETIC instances: the ids and names are made up.
const def = (instanceMapId: number, instanceType: InstanceDef["instanceType"], bosses: number[]): InstanceDef => ({
  instanceMapId, name: `Instance ${instanceMapId}`, instanceType, tier: 0, bosses: bosses.map((encounterId) => ({ encounterId, name: `Boss ${encounterId}` })),
});
const row = (raid: boolean | null, level: number | null, files: number[]): Pick<InstanceRow, "raid" | "level" | "encounters"> => ({
  raid, level: level === null ? null : { min: level, max: level + 5 }, encounters: files.map((id) => ({ id, name: `Boss ${id}` })),
});

test("the agreed bosses, with the files' kind, lowest level and a dungeon's last encounter as its final boss", () => {
  const rows = new Map([[1, row(false, 20, [11, 12, 13])], [2, row(true, 60, [21, 22])]]);
  expect(scoreInstances([def(1, "dungeon", [11, 13]), def(2, null, [21])], rows)).toEqual([
    { instanceMapId: 1, kind: "dungeon", bosses: [11, 13], finalBoss: 13, minLevel: 20 },
    { instanceMapId: 2, kind: "raid", bosses: [21], minLevel: 60 },
  ]);
});

test("with no row, the players' kind stands and there is no level or final boss; with neither, the kind is unknown", () => {
  expect(scoreInstances([def(3, "dungeon", [31]), def(4, null, [41])], new Map())).toEqual([
    { instanceMapId: 3, kind: "dungeon", bosses: [31] },
    { instanceMapId: 4, kind: null, bosses: [41] },
  ]);
});

test("a final boss not yet agreed stays off the boss list", () => {
  const [d] = scoreInstances([def(1, "dungeon", [11])], new Map([[1, row(false, 20, [11, 12])]]));
  expect(d.finalBoss).toBe(12);
  expect(d.bosses).not.toContain(12);
});
