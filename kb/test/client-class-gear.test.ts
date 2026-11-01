import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { buildClientClassGear, ClientClassGear, proficienciesByClass, writeClientClassGear } from "../src/client-class-gear.js";
import { writeClientSnapshot, type ClientBuildMeta, type ExtractedTable } from "../src/client-snapshot.js";

const meta: ClientBuildMeta = {
  product: "test", buildConfig: "abcd1234abcd1234", buildId: 70707,
  version: "1.0.0.70707", extractedAt: "2026-11-01T00:00:00.000Z", library: "test", definitions: "abc1234",
};
type Rows = [number, Record<string, unknown>][];
const table = (name: string, rows: Rows): ExtractedTable => ({ table: name, fileDataID: 1, cKey: "c".repeat(32), encryptedBlocks: 0, rows: new Map(rows) });

// Synthetic rows in the shape of the 1.60.1 tables. Classes: 1 (warrior), 8 (mage). Skill lines: 293 Plate (armor),
// 415 Cloth (armor), 43 Swords (weapon), 95 Defense (weapon, Parry asks for a weapon but teaches no proficiency),
// 999 a profession line (category 11) whose spell names an item class: never read.
const tables: Record<string, Rows> = {
  ChrClasses: [[1, { ID: 1, Filename: "WARRIOR" }], [8, { ID: 8, Filename: "MAGE" }]],
  SkillLine: [[293, { ID: 293, CategoryID: 8 }], [415, { ID: 415, CategoryID: 8 }], [43, { ID: 43, CategoryID: 6 }], [95, { ID: 95, CategoryID: 6 }], [999, { ID: 999, CategoryID: 11 }]],
  SkillRaceClassInfo: [
    [1, { SkillID: 293, ClassMask: 1, MinLevel: 40 }],
    [2, { SkillID: 415, ClassMask: 1 | 128, MinLevel: 0 }],
    // Two rows give the warrior swords (one per race group); the lower level counts.
    [3, { SkillID: 43, ClassMask: 1, MinLevel: 10 }],
    [4, { SkillID: 43, ClassMask: 1 | 128, MinLevel: 0 }],
    [5, { SkillID: 95, ClassMask: 1 | 128, MinLevel: 0 }],
    [6, { SkillID: 999, ClassMask: 128, MinLevel: 0 }],
  ],
  SkillLineAbility: [
    [1, { SkillLine: 293, Spell: 750, ClassMask: 1 }],
    // ClassMask 0: every class the line has (warrior and mage).
    [2, { SkillLine: 415, Spell: 9078, ClassMask: 0 }],
    // The line has the mage too, but this spell's mask is the warrior's alone.
    [3, { SkillLine: 43, Spell: 201, ClassMask: 1 }],
    [4, { SkillLine: 95, Spell: 3127, ClassMask: 1 | 128 }],
    [5, { SkillLine: 999, Spell: 5000, ClassMask: 128 }],
  ],
  SpellEffect: [[1, { SpellID: 750, Effect: 60 }], [2, { SpellID: 9078, Effect: 60 }], [3, { SpellID: 201, Effect: 60 }], [4, { SpellID: 3127, Effect: 22 }], [5, { SpellID: 5000, Effect: 60 }]],
  SpellEquippedItems: [
    [1, { SpellID: 750, EquippedItemClass: 4, EquippedItemSubclass: 1 << 4 }],
    [2, { SpellID: 9078, EquippedItemClass: 4, EquippedItemSubclass: 1 << 1 }],
    [3, { SpellID: 201, EquippedItemClass: 2, EquippedItemSubclass: 1 << 7 }],
    [4, { SpellID: 3127, EquippedItemClass: 2, EquippedItemSubclass: (1 << 7) | (1 << 8) }],
    [5, { SpellID: 5000, EquippedItemClass: 2, EquippedItemSubclass: 1 << 20 }],
  ],
  ItemSparse: [
    [10, { ID: 10, AllowableClass: -1 }],
    [11, { ID: 11, AllowableClass: 128 }],
    // Every bit, or every class of the build: no restriction.
    [12, { ID: 12, AllowableClass: 32767 }],
    [13, { ID: 13, AllowableClass: 1 | 128 }],
    [14, { ID: 14, AllowableClass: 0 }],
  ],
};
const get = (t: string) => (tables[t] ? new Map(tables[t]) : undefined);

test("proficienciesByClass: skill line → proficiency spell → equipped items, the lowest level, no Parry, no profession", () => {
  const out = proficienciesByClass(get);
  expect([...out.get(1)!].sort()).toEqual([["2:7", 0], ["4:1", 0], ["4:4", 40]]);
  // The mage has cloth (mask 0), not swords (the spell's mask leaves it out), and nothing from Parry or the profession.
  expect([...out.get(8)!]).toEqual([["4:1", 0]]);
  // A table missing: nothing to read, nothing invented.
  expect(proficienciesByClass((t) => (t === "SpellEffect" ? undefined : get(t))).size).toBe(0);
});

test("buildClientClassGear: classes by file name, gear sorted, only masks that leave a class out", () => {
  const path = join(mkdtempSync(join(tmpdir(), "kb-class-gear-")), "client.sqlite");
  writeClientSnapshot(path, meta, Object.entries(tables).map(([name, rows]) => table(name, rows)));
  const out = buildClientClassGear(path);
  expect(out.schema).toBe("everloot.client-class-gear/1");
  expect(out.build).toMatchObject({ product: "test", version: "1.0.0.70707" });
  expect(out.classes).toEqual({ warrior: { id: 1, gear: [[2, 7, 0], [4, 1, 0], [4, 4, 40]] }, mage: { id: 8, gear: [[4, 1, 0]] } });
  expect(out.restricted).toEqual({ "11": 128 });
  const file = join(mkdtempSync(join(tmpdir(), "kb-class-gear-")), "out.json");
  writeClientClassGear(path, file);
  expect(ClientClassGear.parse(JSON.parse(readFileSync(file, "utf8")))).toEqual(out);
});
