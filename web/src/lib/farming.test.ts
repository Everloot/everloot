import { expect, test } from "vitest";
import { HERB_IDS, HERBALISM_SKILL_LINE, herbIndex, herbZones, professionTrainers } from "./farming";
import { publicZones } from "./zones";

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
