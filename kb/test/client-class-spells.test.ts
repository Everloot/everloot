import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { buildClientClassSpells, ClientClassSpells, spellsByClass, writeClientClassSpells } from "../src/client-class-spells.js";
import { writeClientSnapshot, type ClientBuildMeta, type ExtractedTable } from "../src/client-snapshot.js";

const meta: ClientBuildMeta = {
  product: "test", buildConfig: "abcd1234abcd1234", buildId: 70707,
  version: "1.0.0.70707", extractedAt: "2026-11-01T00:00:00.000Z", library: "test", definitions: "abc1234",
};
type Rows = [number, Record<string, unknown>][];
const table = (name: string, rows: Rows): ExtractedTable => ({ table: name, fileDataID: 1, cKey: "c".repeat(32), encryptedBlocks: 0, rows: new Map(rows) });

// Synthetic rows in the shape of the 1.60.1 tables. Classes: 1 (warrior), 8 (mage). Skill lines: 26 Arms and 8 Fire
// (class, category 7), 43 Swords (weapon, category 6) and 164 Blacksmithing (profession, category 11): only the class
// lines count. 777 Mounts is a category 7 line every class has: only a spell whose own mask names a class counts.
const tables: Record<string, Rows> = {
  ChrClasses: [[1, { ID: 1, Filename: "WARRIOR" }], [8, { ID: 8, Filename: "MAGE" }]],
  SkillLine: [[26, { ID: 26, CategoryID: 7 }], [8, { ID: 8, CategoryID: 7 }], [43, { ID: 43, CategoryID: 6 }], [164, { ID: 164, CategoryID: 11 }], [777, { ID: 777, CategoryID: 7 }]],
  SkillRaceClassInfo: [
    [1, { SkillID: 26, ClassMask: 1, MinLevel: 0 }],
    [2, { SkillID: 8, ClassMask: 128, MinLevel: 0 }],
    [3, { SkillID: 43, ClassMask: 1 | 128, MinLevel: 0 }],
    [4, { SkillID: 164, ClassMask: 1 | 128, MinLevel: 0 }],
    [5, { SkillID: 777, ClassMask: 65535, MinLevel: 0 }],
  ],
  SkillLineAbility: [
    [1, { SkillLine: 26, Spell: 78, ClassMask: 0 }],
    [2, { SkillLine: 8, Spell: 133, ClassMask: 0 }],
    [3, { SkillLine: 8, Spell: 143, ClassMask: 128 }],
    // On the mage's line, but its mask names only the warrior: the mage does not get it, and the warrior lacks the line.
    [4, { SkillLine: 8, Spell: 9999, ClassMask: 1 }],
    [5, { SkillLine: 43, Spell: 201, ClassMask: 0 }],
    [6, { SkillLine: 164, Spell: 2018, ClassMask: 0 }],
    // A mount every class has (mask 0 or every bit), and one the warrior's mask alone names.
    [7, { SkillLine: 777, Spell: 458, ClassMask: 0 }],
    [8, { SkillLine: 777, Spell: 459, ClassMask: -1 }],
    [9, { SkillLine: 777, Spell: 13819, ClassMask: 1 }],
  ],
};
const get = (t: string) => (tables[t] ? new Map(tables[t]) : undefined);

test("spellsByClass: only class skill lines, by the line's classes and the spell's mask", () => {
  const out = spellsByClass(get, 1 | 128);
  expect([...out.get(1)!].sort((a, b) => a - b)).toEqual([78, 13819]);
  expect([...out.get(8)!].sort((a, b) => a - b)).toEqual([133, 143]);
  // A table missing: nothing to read, nothing invented.
  expect(spellsByClass((t) => (t === "SkillLine" ? undefined : get(t)), 1 | 128).size).toBe(0);
});

test("buildClientClassSpells: classes by file name, spells ascending, and the file reads back", () => {
  const path = join(mkdtempSync(join(tmpdir(), "kb-class-spells-")), "client.sqlite");
  writeClientSnapshot(path, meta, Object.entries(tables).map(([name, rows]) => table(name, rows)));
  const out = buildClientClassSpells(path);
  expect(out.schema).toBe("everloot.client-class-spells/1");
  expect(out.build).toMatchObject({ product: "test", version: "1.0.0.70707" });
  expect(out.classes).toEqual({ warrior: { id: 1, spells: [78, 13819] }, mage: { id: 8, spells: [133, 143] } });
  const file = join(mkdtempSync(join(tmpdir(), "kb-class-spells-")), "out.json");
  writeClientClassSpells(path, file);
  expect(ClientClassSpells.parse(JSON.parse(readFileSync(file, "utf8")))).toEqual(out);
});
