import { expect, test } from "vitest";
import { buildGatheringEvidence, gatheringRank, reportedTrainerRanks } from "./gathering-guide";

const fish = (installId: string, mapId: number, itemIds: number[]) => ({
  kind: "loot", sourceEvidence: "loot-api", lootType: "fishing", sourceObjectId: 35591, installId, mapId,
  x: 40, y: 60, items: itemIds.map((itemId) => ({ itemId, count: 1 })),
});

test("fishing agrees on catches per map without borrowing witnesses from another map or killing the same NPC", () => {
  const result = buildGatheringEvidence([
    fish("a", 1429, [6291, 6317]), fish("b", 1429, [6291]), fish("c", 1429, [6291]),
    fish("b", 1426, [6317]), fish("c", 1426, [6317]), fish("b", 1426, [6317]),
    { ...fish("d", 1426, [6317]), lootType: "gather" }, { ...fish("e", 1426, [6317]), sourceEvidence: undefined },
    { ...fish("d", 1426, [6317]), x: undefined },
  ]);
  expect(result).toEqual({ fishing: [{ mapId: 1429, installs: 3, itemIds: [6291] }], skinning: [] });
  expect(JSON.stringify(result)).not.toContain("35591");
});

test("skinning is independently confirmed from actual skinning windows and uses each install's least successful rank", () => {
  const skin = (installId: string, rank?: number) => ({ kind: "loot", lootType: "skinning", sourceEvidence: "loot-api",
    installId, sourceNpcId: 6, gatherSkill: rank, items: [{ itemId: 2934, count: 1 }],
  });
  const result = buildGatheringEvidence([
    skin("a", 35), skin("a", 17), skin("b", 22), skin("c", 28), skin("d"),
    { ...skin("e", 1), lootType: "kill" }, { ...skin("f", 1), sourceNpcId: 7 },
  ]);
  expect(result.skinning).toEqual([{ npcId: 6, installs: 4, itemIds: [2934], skill: { min: 17, median: 22, installs: 3 } }]);
});

test("the skill filter distinguishes absent input from invalid or ambiguous input", () => {
  expect(gatheringRank(undefined)).toEqual({ rank: null, invalid: false });
  expect(gatheringRank(" 75 ")).toEqual({ rank: 75, invalid: false });
  for (const value of ["0", "10000", "2.5", "3e2", ["75", "100"]]) expect(gatheringRank(value)).toEqual({ rank: null, invalid: true });
});

test("trainer ranks require known spell identities and three installs on the correct skill line", () => {
  const report = (installId: string, spellId?: number, skillLineId = 182) => ({ installId, spellId, trainerNpcId: 1218, skillLineId });
  const reports = [report("a", 2368), report("b", 2373), report("c", 1240960), report("a", 3570), report("b", 3570), report("c", 3570, 186), report("d")];
  expect(reportedTrainerRanks("herbalism", 182, reports)).toEqual(new Map([[1218, ["Journeyman"]]]));
});
