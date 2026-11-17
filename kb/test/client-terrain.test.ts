import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { buildClientTerrain, ClientTerrain, terrainWord, writeClientTerrain } from "../src/client-terrain.js";
import { writeClientSnapshot, type ClientBuildMeta, type ExtractedTable } from "../src/client-snapshot.js";

const meta: ClientBuildMeta = {
  product: "test", buildConfig: "abcd1234abcd1234", buildId: 70938,
  version: "1.0.0.70938", extractedAt: "2026-11-17T00:00:00.000Z", library: "test", definitions: "abc1234",
};
const table = (name: string, rows: Record<string, unknown>[]): ExtractedTable =>
  ({ table: name, fileDataID: 1, cKey: "c".repeat(32), encryptedBlocks: 0, rows: new Map(rows.map((r) => [Number(r.ID), r])) });

// Synthetic rows in the shape of the client tables. Continent 1 has two zones (UiMap 11 shows area 100, UiMap 12
// area 200, with town 201 inside it); map 50 is a dungeon with area 500. Group 900 is a terrain ("Desert"), group 901
// a zone list, group 902 a group whose spells name nothing.
const snapshot = (() => {
  const path = join(mkdtempSync(join(tmpdir(), "kb-terrain-")), "client.sqlite");
  writeClientSnapshot(path, meta, [
    table("Map", [{ ID: 1, InstanceType: 0 }, { ID: 50, InstanceType: 1 }]),
    table("UiMap", [{ ID: 11, Type: 3 }, { ID: 12, Type: 3 }]),
    table("UiMapAssignment", [
      { ID: 1, UiMapID: 11, MapID: 1, AreaID: 100, OrderIndex: 0, UiMin: [0, 0], UiMax: [1, 1], Region: [0, 0, 0, 10, 10, 0] },
      { ID: 2, UiMapID: 12, MapID: 1, AreaID: 200, OrderIndex: 0, UiMin: [0, 0], UiMax: [1, 1], Region: [20, 20, 0, 30, 30, 0] },
    ]),
    table("AreaTable", [
      { ID: 100, ContinentID: 1, ParentAreaID: 0, AreaName_lang: "Sand Zone" },
      { ID: 200, ContinentID: 1, ParentAreaID: 0, AreaName_lang: "Green Zone" },
      { ID: 201, ContinentID: 1, ParentAreaID: 200, AreaName_lang: "Oasis Town" },
      { ID: 500, ContinentID: 50, ParentAreaID: 0, AreaName_lang: "Sand Crypt" },
    ]),
    table("AreaGroupMember", [
      { ID: 1, AreaGroupID: 900, AreaID: 100 }, { ID: 2, AreaGroupID: 900, AreaID: 201 }, { ID: 3, AreaGroupID: 900, AreaID: 500 },
      { ID: 4, AreaGroupID: 901, AreaID: 200 }, { ID: 5, AreaGroupID: 902, AreaID: 100 },
    ]),
    table("Item", [{ ID: 1 }, { ID: 2 }, { ID: 3 }, { ID: 4 }, { ID: 5 }, { ID: 6 }]),
    table("ItemEffect", [
      { ID: 10, SpellID: 1000, TriggerType: 1 }, { ID: 20, SpellID: 2000, TriggerType: 0 }, { ID: 30, SpellID: 3000, TriggerType: 1 },
      { ID: 40, SpellID: 4000, TriggerType: 1 }, { ID: 41, SpellID: 4100, TriggerType: 1 }, { ID: 50, SpellID: 5000, TriggerType: 6 },
      { ID: 60, SpellID: 6000, TriggerType: 1 }, { ID: 70, SpellID: 7000, TriggerType: 1 },
    ]),
    table("ItemXItemEffect", [
      { ID: 1, ItemID: 1, ItemEffectID: 10 }, { ID: 2, ItemID: 2, ItemEffectID: 20 }, { ID: 3, ItemID: 3, ItemEffectID: 30 },
      { ID: 4, ItemID: 4, ItemEffectID: 40 }, { ID: 5, ItemID: 4, ItemEffectID: 41 }, { ID: 6, ItemID: 5, ItemEffectID: 50 },
      { ID: 7, ItemID: 6, ItemEffectID: 60 }, { ID: 8, ItemID: 99, ItemEffectID: 70 },
    ]),
    table("SpellEffect", [
      // Item 1: +7% mount speed in Desert areas (the spell itself needs group 900).
      { ID: 1, SpellID: 1000, DifficultyID: 0, EffectIndex: 0, Effect: 6, EffectAura: 130, EffectBasePointsF: 7, EffectTriggerSpell: 0 },
      // Item 2: +25% run speed on use; its triggered bonus needs group 900.
      { ID: 2, SpellID: 2000, DifficultyID: 0, EffectIndex: 0, Effect: 6, EffectAura: 129, EffectBasePointsF: 25, EffectTriggerSpell: 0 },
      { ID: 3, SpellID: 2000, DifficultyID: 0, EffectIndex: 1, Effect: 140, EffectAura: 0, EffectBasePointsF: 0, EffectTriggerSpell: 2001 },
      // Item 3: +2% run speed in a zone list (group 901, named by no text).
      { ID: 4, SpellID: 3000, DifficultyID: 0, EffectIndex: 0, Effect: 6, EffectAura: 129, EffectBasePointsF: 2, EffectTriggerSpell: 0 },
      // Item 4: a spell power aura whose text is on one effect and whose group is on the other.
      { ID: 5, SpellID: 4000, DifficultyID: 0, EffectIndex: 0, Effect: 6, EffectAura: 13, EffectBasePointsF: 5, EffectTriggerSpell: 0 },
      { ID: 6, SpellID: 4100, DifficultyID: 0, EffectIndex: 0, Effect: 6, EffectAura: 13, EffectBasePointsF: 5, EffectTriggerSpell: 0 },
      // Item 5: a recipe (trigger 6), never read. Item 6: no group and no speed, left out.
      { ID: 7, SpellID: 5000, DifficultyID: 0, EffectIndex: 0, Effect: 6, EffectAura: 31, EffectBasePointsF: 40, EffectTriggerSpell: 0 },
      { ID: 8, SpellID: 6000, DifficultyID: 0, EffectIndex: 0, Effect: 6, EffectAura: 13, EffectBasePointsF: 9, EffectTriggerSpell: 0 },
      // A harder difficulty's row is not read.
      { ID: 9, SpellID: 6000, DifficultyID: 2, EffectIndex: 0, Effect: 6, EffectAura: 31, EffectBasePointsF: 50, EffectTriggerSpell: 0 },
    ]),
    table("SpellCastingRequirements", [
      { ID: 1, SpellID: 1000, RequiredAreasID: 900 }, { ID: 2, SpellID: 2001, RequiredAreasID: 900 },
      { ID: 3, SpellID: 3000, RequiredAreasID: 901 }, { ID: 4, SpellID: 4100, RequiredAreasID: 900 },
      { ID: 5, SpellID: 6000, RequiredAreasID: 902 },
    ]),
    table("Spell", [
      { ID: 1000, Description_lang: "Increases mount speed by $s1% in Desert areas." },
      { ID: 2000, Description_lang: "Increases movement speed by $s1% for $d. While out of combat in Desert areas, gain more." },
      { ID: 3000, Description_lang: "Movement speed increased by $s1% in Sand Zone and Green Zone." },
      { ID: 4000, Description_lang: "Increases spell power by $s1. This effect is doubled in Desert areas." },
      { ID: 6000, Description_lang: "Increases spell power by $s1." },
    ]),
  ]);
  return path;
})();

test("terrainWord reads the kind of ground a spell's text names, and no place names", () => {
  expect(terrainWord("Increases mount speed by $s1% in Desert areas.")).toBe("Desert");
  expect(terrainWord("This chance is doubled in Wasteland and Haunted areas.")).toBe("Wasteland and Haunted");
  expect(terrainWord("Increases Spirit by $s1 in Cavernous or Underground areas.")).toBe("Cavernous or Underground");
  expect(terrainWord("This effect is doubled in Strongholds and Cities.")).toBe("Strongholds and Cities");
  expect(terrainWord("Call upon the winds of Tanaris to slow nearby enemies.")).toBeNull();
  expect(terrainWord("Movement speed increased by $s1% in Elwynn Forest, Westfall, Redridge Mountains, and the Deadmines.")).toBeNull();
  expect(terrainWord(null)).toBeNull();
});

test("buildClientTerrain: terrain groups with their whole zones, partial zones and instances", () => {
  const out = buildClientTerrain(snapshot);
  expect(out.schema).toBe("everloot.client-terrain/1");
  expect(out.build).toMatchObject({ product: "test", version: "1.0.0.70938", definitions: "abc1234" });
  expect(out.areaGroups).toEqual({
    900: { name: "Desert", zones: [11], parts: { 12: ["Oasis Town"] }, instances: [50] },
    901: { name: null, zones: [12], parts: {}, instances: [] },
  });
});

test("buildClientTerrain: the items that need a terrain or change speed, one row per item effect", () => {
  expect(buildClientTerrain(snapshot).items).toEqual([
    [1, 1000, "equip", 900, "mount", 7],
    [2, 2000, "use", 900, "run", 25],
    [3, 3000, "equip", 901, "run", 2],
    // The text sits on 4000, the group on 4100: the item's words name the group, and the effect with the group is kept.
    [4, 4100, "equip", 900, null, null],
  ]);
});

test("writeClientTerrain writes one group and one item effect per line, and the file parses back", () => {
  const path = join(mkdtempSync(join(tmpdir(), "kb-terrain-out-")), "client-terrain.json");
  const table = writeClientTerrain(snapshot, path);
  const text = readFileSync(path, "utf8");
  expect(ClientTerrain.parse(JSON.parse(text))).toEqual(table);
  expect(text).toContain('\n  "900": {"name":"Desert","zones":[11],"parts":{"12":["Oasis Town"]},"instances":[50]}');
  expect(text).toContain('\n  [1,1000,"equip",900,"mount",7]');
  expect(text).not.toMatch(/Increases|spell power/);
});
