import { describe, expect, test } from "vitest";
import { planRenders } from "../src/renders/plan.js";
import type { Row, Rows } from "../src/talents/build-catalog.js";

// Made-up ids throughout; none are from a real build.
const t = (rows: Row[]): Rows => new Map(rows.map((r, i) => [typeof r.ID === "number" ? r.ID : i + 1, r]));
const tables: Record<string, Rows> = {
  // NPC 10: a beast through Creature; 11: through CreatureXDisplayInfo; 12: a dressed humanoid; 13: no display link.
  Creature: t([{ ID: 10, DisplayID: [0, 501, 0, 0] }, { ID: 12, DisplayID: [503, 0, 0, 0] }]),
  CreatureXDisplayInfo: t([{ ID: 1, CreatureID: 11, CreatureDisplayInfoID: 502, OrderIndex: 1 }, { ID: 2, CreatureID: 11, CreatureDisplayInfoID: 509, OrderIndex: 0 }]),
  CreatureDisplayInfo: t([
    { ID: 501, ModelID: 1, ExtendedDisplayInfoID: 0, TextureVariationFileDataID: [6001, 6002, 0, 0] },
    { ID: 509, ModelID: 1, ExtendedDisplayInfoID: 0, TextureVariationFileDataID: [6003, 0, 0, 0] },
    { ID: 503, ModelID: 1, ExtendedDisplayInfoID: 77, TextureVariationFileDataID: [0, 0, 0, 0] },
  ]),
  CreatureModelData: t([{ ID: 1, FileDataID: 5001 }]),
  CreatureDisplayInfoGeosetData: t([{ ID: 1, CreatureDisplayInfoID: 501, GeosetIndex: 0, GeosetValue: 3 }]),
  // Item 20: a sword (one model); 21: a helmet (race and gender variants); 22: chest armour (no model); 23: no appearance.
  ItemModifiedAppearance: t([
    { ID: 1, ItemID: 20, ItemAppearanceModifierID: 1, ItemAppearanceID: 99, OrderIndex: 1 },
    { ID: 2, ItemID: 20, ItemAppearanceModifierID: 0, ItemAppearanceID: 30, OrderIndex: 0 },
    { ID: 3, ItemID: 21, ItemAppearanceModifierID: 0, ItemAppearanceID: 31, OrderIndex: 0 },
    { ID: 4, ItemID: 22, ItemAppearanceModifierID: 0, ItemAppearanceID: 32, OrderIndex: 0 },
  ]),
  ItemAppearance: t([{ ID: 30, ItemDisplayInfoID: 700 }, { ID: 31, ItemDisplayInfoID: 701 }, { ID: 32, ItemDisplayInfoID: 702 }, { ID: 99, ItemDisplayInfoID: 799 }]),
  ItemDisplayInfo: t([
    { ID: 700, ModelResourcesID: [40, 0], ModelMaterialResourcesID: [80, 0], GeosetGroup: [0, 0, 0, 0, 0, 0] },
    { ID: 701, ModelResourcesID: [41, 0], ModelMaterialResourcesID: [81, 0], GeosetGroup: [0, 0, 0, 0, 0, 0] },
    { ID: 702, ModelResourcesID: [0, 0], ModelMaterialResourcesID: [0, 0], GeosetGroup: [1, 0, 0, 0, 0, 0] },
  ]),
  ModelFileData: t([
    { ID: 1, FileDataID: 5100, ModelResourcesID: 40 },
    { ID: 2, FileDataID: 5202, ModelResourcesID: 41 }, { ID: 3, FileDataID: 5201, ModelResourcesID: 41 }, { ID: 4, FileDataID: 5203, ModelResourcesID: 41 },
  ]),
  ComponentModelFileData: t([
    { ID: 5201, RaceID: 4, GenderIndex: 0, ClassID: 0, PositionIndex: -1 },
    { ID: 5202, RaceID: 1, GenderIndex: 1, ClassID: 0, PositionIndex: -1 },
    { ID: 5203, RaceID: 1, GenderIndex: 0, ClassID: 0, PositionIndex: -1 },
  ]),
  TextureFileData: t([{ ID: 1, FileDataID: 6102, MaterialResourcesID: 80, UsageType: 0 }, { ID: 2, FileDataID: 6101, MaterialResourcesID: 80, UsageType: 0 }, { ID: 3, FileDataID: 6200, MaterialResourcesID: 81, UsageType: 0 }]),
};
const get = (name: string) => tables[name];

describe("planRenders", () => {
  test("draws only what the gates list: nothing without a list", () => {
    const plan = planRenders(get, { npcs: new Set(), items: new Set() });
    expect(plan.targets).toEqual([]);
  });

  test("creatures: the display the client links to the NPC, its skins and geoset choice; humanoids and unlinked NPCs are counted", () => {
    const plan = planRenders(get, { npcs: new Set([10, 11, 12, 13]), items: new Set() });
    expect(plan.targets).toEqual([
      { kind: "creature", displayId: 501, modelFileId: 5001, replaceable: { 11: 6001, 12: 6002 }, geosets: [103] },
      { kind: "creature", displayId: 509, modelFileId: 5001, replaceable: { 11: 6003 }, geosets: [] },
    ]);
    expect([...plan.npcs]).toEqual([[10, 501], [11, 509]]);
    expect(plan.skipped).toMatchObject({ npcsWithoutDisplay: 1, npcsHumanoid: 1, npcsWithoutModel: 0 });
  });

  test("items: the base appearance's model and texture; a helmet takes the human male model; armour without a model is counted", () => {
    const plan = planRenders(get, { npcs: new Set(), items: new Set([20, 21, 22, 23]) });
    expect(plan.targets).toEqual([
      { kind: "item", displayId: 700, modelFileId: 5100, replaceable: { 2: 6101 }, geosets: [] },
      { kind: "item", displayId: 701, modelFileId: 5203, replaceable: { 2: 6200 }, geosets: [] },
    ]);
    expect([...plan.items]).toEqual([[20, 700], [21, 701]]);
    expect(plan.skipped).toMatchObject({ itemsWithoutAppearance: 1, itemsTextureOnly: 1, itemsWithoutModelFile: 0 });
  });

  test("two items or NPCs on one display make one picture", () => {
    const plan = planRenders((n) => (n === "Creature" ? t([{ ID: 10, DisplayID: [501, 0, 0, 0] }, { ID: 14, DisplayID: [501, 0, 0, 0] }]) : get(n)), { npcs: new Set([10, 14]), items: new Set() });
    expect(plan.targets).toHaveLength(1);
    expect([...plan.npcs]).toEqual([[10, 501], [14, 501]]);
  });

  test("refuses to plan items when the snapshot has no TextureFileData", () => {
    expect(() => planRenders((n) => (n === "TextureFileData" ? undefined : get(n)), { npcs: new Set(), items: new Set([20]) })).toThrow(/TextureFileData/);
  });
});
