import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { buildClientPetFamilies, ClientPetFamilies, writeClientPetFamilies } from "../src/client-pet-families.js";
import { writeClientSnapshot, type ClientBuildMeta, type ExtractedTable } from "../src/client-snapshot.js";

const meta: ClientBuildMeta = {
  product: "test", buildConfig: "abcd1234abcd1234", buildId: 70707,
  version: "1.0.0.70707", extractedAt: "2026-11-25T00:00:00.000Z", library: "test", definitions: "abc1234",
};
type Rows = [number, Record<string, unknown>][];
const table = (name: string, rows: Rows): ExtractedTable => ({ table: name, fileDataID: 1, cKey: "c".repeat(32), encryptedBlocks: 0, rows: new Map(rows) });

const tables: Record<string, Rows> = {
  CreatureFamily: [
    [2, { Name_lang: "Cat", PetFoodMask: 3, IconFileID: 132185, SkillLine: [209, 270] }],
    [1, { Name_lang: "Wolf", PetFoodMask: 1, IconFileID: 132203, SkillLine: [208, 270] }],
    // A warlock's demon eats nothing and a remote control is no pet: neither is a hunter's.
    [16, { Name_lang: "Voidwalker", PetFoodMask: 0, IconFileID: 136221, SkillLine: [204, 0] }],
    [28, { Name_lang: "Remote Control", PetFoodMask: 0, IconFileID: 0, SkillLine: [758, 0] }],
  ],
  SkillLineAbility: [
    [1, { SkillLine: 208, Spell: 17253 }], [2, { SkillLine: 208, Spell: 17255 }], [3, { SkillLine: 208, Spell: 17253 }],
    [4, { SkillLine: 208, Spell: 900 }], [5, { SkillLine: 209, Spell: 16827 }], [6, { SkillLine: 270, Spell: 4000 }],
  ],
  SpellName: [[17253, { Name_lang: "Bite" }], [17255, { Name_lang: "Bite" }], [900, { Name_lang: "Tamed Pet Passive (DND)" }], [16827, { Name_lang: "Claw" }]],
};

function snapshot(t: Record<string, Rows>): string {
  const path = join(mkdtempSync(join(tmpdir(), "kb-families-")), "client.sqlite");
  writeClientSnapshot(path, meta, Object.entries(t).map(([name, rows]) => table(name, rows)));
  return path;
}

test("hunter pet families: the ones that eat, with their icon and the spells on their own skill line", () => {
  expect(buildClientPetFamilies(snapshot(tables)).families).toEqual([
    { id: 1, name: "Wolf", iconFileId: 132203, skillLine: 208, spellIds: [17253, 17255] },
    { id: 2, name: "Cat", iconFileId: 132185, skillLine: 209, spellIds: [16827] },
  ]);
});

test("the file parses back, one family per line", () => {
  const file = join(mkdtempSync(join(tmpdir(), "kb-families-out-")), "client-pet-families.json");
  const out = writeClientPetFamilies(snapshot(tables), file);
  expect(out.schema).toBe("everloot.client-pet-families/1");
  const text = readFileSync(file, "utf8");
  expect(ClientPetFamilies.parse(JSON.parse(text))).toEqual(out);
  expect(text).toContain('\n  {"id":1,"name":"Wolf"');
  expect(buildClientPetFamilies(snapshot({ Other: [[1, { X: 1 }]] })).families).toEqual([]);
});
