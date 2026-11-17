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

// A second snapshot for the reach rules: a speed on a triggered spell, an enchant that gives speed, a chance-on-hit
// proc, a set bonus bound to a zone list, and a QA test item.
const reach = (() => {
  const path = join(mkdtempSync(join(tmpdir(), "kb-terrain-reach-")), "client.sqlite");
  writeClientSnapshot(path, meta, [
    table("Map", [{ ID: 1, InstanceType: 0 }]),
    table("UiMap", [{ ID: 11, Type: 3 }]),
    table("UiMapAssignment", [{ ID: 1, UiMapID: 11, MapID: 1, AreaID: 100, OrderIndex: 0, UiMin: [0, 0], UiMax: [1, 1], Region: [0, 0, 0, 10, 10, 0] }]),
    table("AreaTable", [{ ID: 100, ContinentID: 1, ParentAreaID: 0, AreaName_lang: "Plague Zone" }]),
    table("AreaGroupMember", [{ ID: 1, AreaGroupID: 950, AreaID: 100 }]),
    table("Item", [{ ID: 1 }, { ID: 2 }, { ID: 3 }, { ID: 4 }, { ID: 5 }, { ID: 6 }]),
    table("ItemSparse", [{ ID: 4, Display_lang: "Sprint Ring" }]),
    table("ItemEffect", [
      { ID: 10, SpellID: 1000, TriggerType: 0 }, { ID: 20, SpellID: 2000, TriggerType: 0 },
      { ID: 30, SpellID: 3000, TriggerType: 2 }, { ID: 40, SpellID: 4000, TriggerType: 0 },
    ]),
    table("ItemXItemEffect", [
      { ID: 1, ItemID: 1, ItemEffectID: 10 }, { ID: 2, ItemID: 2, ItemEffectID: 20 },
      { ID: 3, ItemID: 3, ItemEffectID: 30 }, { ID: 4, ItemID: 6, ItemEffectID: 40 },
    ]),
    table("SpellEffect", [
      // Item 1: a cocoon that triggers a +60% sprint.
      { ID: 1, SpellID: 1000, DifficultyID: 0, EffectIndex: 0, Effect: 64, EffectAura: 0, EffectBasePointsF: 0, EffectTriggerSpell: 1001, EffectMiscValue: [0, 0] },
      { ID: 2, SpellID: 1001, DifficultyID: 0, EffectIndex: 0, Effect: 6, EffectAura: 31, EffectBasePointsF: 60, EffectTriggerSpell: 0, EffectMiscValue: [0, 0] },
      // Item 2: spurs that enchant boots with enchantment 70, whose equip spell gives +4% mount speed.
      { ID: 3, SpellID: 2000, DifficultyID: 0, EffectIndex: 0, Effect: 53, EffectAura: 0, EffectBasePointsF: 0, EffectTriggerSpell: 0, EffectMiscValue: [70, 0] },
      { ID: 4, SpellID: 2001, DifficultyID: 0, EffectIndex: 0, Effect: 6, EffectAura: 32, EffectBasePointsF: 4, EffectTriggerSpell: 0, EffectMiscValue: [0, 0] },
      // Item 3: a chance-on-hit +40% run speed proc.
      { ID: 5, SpellID: 3000, DifficultyID: 0, EffectIndex: 0, Effect: 6, EffectAura: 31, EffectBasePointsF: 40, EffectTriggerSpell: 0, EffectMiscValue: [0, 0] },
      // Set 500: +5% mount speed in a zone list.
      { ID: 6, SpellID: 5000, DifficultyID: 0, EffectIndex: 0, Effect: 6, EffectAura: 32, EffectBasePointsF: 5, EffectTriggerSpell: 0, EffectMiscValue: [0, 0] },
      // Item 6: a QA test enchant, left out.
      { ID: 7, SpellID: 4000, DifficultyID: 0, EffectIndex: 0, Effect: 6, EffectAura: 31, EffectBasePointsF: 8, EffectTriggerSpell: 0, EffectMiscValue: [0, 0] },
    ]),
    table("SpellItemEnchantment", [{ ID: 70, Effect: [3, 0, 0], EffectArg: [2001, 0, 0] }]),
    table("SpellCastingRequirements", [{ ID: 1, SpellID: 5000, RequiredAreasID: 950 }]),
    table("SpellName", [{ ID: 4000, Name_lang: "QAEnchant Boots +8% Speed" }]),
    table("ItemSet", [{ ID: 500, Name_lang: "Rider Set", ItemID: [4, 5, 0, 0] }]),
    table("ItemSetSpell", [{ ID: 1, ItemSetID: 500, SpellID: 5000, Threshold: 2 }]),
  ]);
  return path;
})();

test("buildClientTerrain follows triggered spells and enchantments, reads chance-on-hit procs and set bonuses, and skips QA rows", () => {
  const out = buildClientTerrain(reach);
  expect(out.items).toEqual([
    [1, 1000, "use", null, "run", 60],
    [2, 2000, "use", null, "mount", 4],
    [3, 3000, "hit", null, "run", 40],
  ]);
  expect(out.sets).toEqual([[500, 5000, 2, 950, "mount", 5, [4, 5]]]);
  expect(out.areaGroups).toEqual({ 950: { name: null, zones: [11], parts: {}, instances: [] } });
});

test("the speed is the percent the spell's text prints; mount summons and other kinds of speed are left out", () => {
  const path = join(mkdtempSync(join(tmpdir(), "kb-terrain-text-")), "client.sqlite");
  const fx = (ID: number, SpellID: number, EffectIndex: number, EffectAura: number, EffectBasePointsF: number) =>
    ({ ID, SpellID, DifficultyID: 0, EffectIndex, Effect: 6, EffectAura, EffectBasePointsF, EffectTriggerSpell: 0, EffectMiscValue: [0, 0] });
  writeClientSnapshot(path, meta, [
    table("Item", [{ ID: 1 }, { ID: 2 }, { ID: 3 }, { ID: 4 }]),
    table("ItemEffect", [1, 2, 3, 4].map((i) => ({ ID: i, SpellID: i * 100, TriggerType: 1 }))),
    table("ItemXItemEffect", [1, 2, 3, 4].map((i) => ({ ID: i, ItemID: i, ItemEffectID: i }))),
    table("SpellEffect", [
      fx(1, 100, 0, 4, 33), fx(2, 100, 1, 58, 78), // a cloak: the text prints the dummy's 33
      fx(3, 200, 0, 78, 0), fx(4, 200, 1, 58, 500), // a mount summon
      fx(5, 300, 0, 527, 140), fx(6, 300, 1, 31, 100), // backwards walking speed
      fx(7, 400, 0, 87, 14), fx(8, 400, 1, 129, 14), // fire damage taken and movement speed
    ]),
    table("Spell", [
      { ID: 100, Description_lang: "Swim speed increased by $s1%." },
      { ID: 300, Description_lang: "Increases movement speed while walking backwards by $s1% for $d1." },
      { ID: 400, Description_lang: "Increases Fire damage taken by $s1% and movement speed by $s2% for $d." },
    ]),
  ]);
  expect(buildClientTerrain(path).items).toEqual([[1, 100, "equip", null, "swim", 33], [4, 400, "equip", null, "run", 14]]);
});
