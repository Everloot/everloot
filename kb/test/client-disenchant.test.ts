import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { buildClientDisenchant, ClientDisenchant, findBand, bandOf, writeClientDisenchant } from "../src/client-disenchant.js";
import { writeClientSnapshot, type ClientBuildMeta, type ExtractedTable } from "../src/client-snapshot.js";

const meta: ClientBuildMeta = {
  product: "test", buildConfig: "abcd1234abcd1234", buildId: 70630,
  version: "1.0.0.70630", extractedAt: "2026-10-27T00:00:00.000Z", library: "test", definitions: "abc1234",
};
const table = (name: string, rows: [number, Record<string, unknown>][]): ExtractedTable =>
  ({ table: name, fileDataID: 1, cKey: "c".repeat(32), encryptedBlocks: 0, rows: new Map(rows) });

// Two armor bands and a weapon band; armor in and out of them, a flagged wand, a nameless row, an item with no
// sparse row (unleveled), a common item (no band for its quality) and a bag (not armor or weapon).
const path = join(mkdtempSync(join(tmpdir(), "kb-disenchant-")), "client.sqlite");
writeClientSnapshot(path, meta, [
  table("ItemDisenchantLoot", [
    [4, { ID: 4, Class: 4, Subclass: -1, Quality: 2, MinLevel: 5, MaxLevel: 15, SkillRequired: 0, ExpansionID: -2 }],
    [5, { ID: 5, Class: 4, Subclass: -1, Quality: 2, MinLevel: 16, MaxLevel: 20, SkillRequired: 0, ExpansionID: -2 }],
    [3, { ID: 3, Class: 2, Subclass: -1, Quality: 2, MinLevel: 5, MaxLevel: 15, SkillRequired: 25, ExpansionID: -2 }],
  ]),
  table("Item", [
    [10, { ID: 10, ClassID: 4 }], [11, { ID: 11, ClassID: 4 }], [12, { ID: 12, ClassID: 2 }], [13, { ID: 13, ClassID: 2 }],
    [14, { ID: 14, ClassID: 4 }], [15, { ID: 15, ClassID: 4 }], [16, { ID: 16, ClassID: 4 }], [17, { ID: 17, ClassID: 1 }],
    [18, { ID: 18, ClassID: 4 }],
  ]),
  table("ItemSparse", [
    [10, { ID: 10, Display_lang: "Synthetic Gloves", OverallQualityID: 2, ItemLevel: 10, Flags: [0, 0] }],
    [11, { ID: 11, Display_lang: "Synthetic Boots", OverallQualityID: 2, ItemLevel: 18, Flags: [0, 0] }],
    [12, { ID: 12, Display_lang: "Synthetic Sword", OverallQualityID: 2, ItemLevel: 7, Flags: [0, 0] }],
    [13, { ID: 13, Display_lang: "Synthetic Wand", OverallQualityID: 2, ItemLevel: 12, Flags: [0x8000, 0] }],
    [14, { ID: 14, Display_lang: "  ", OverallQualityID: 2, ItemLevel: 10, Flags: [0, 0] }],
    [16, { ID: 16, Display_lang: "Synthetic Shirt", OverallQualityID: 1, ItemLevel: 10, Flags: [0, 0] }],
    [17, { ID: 17, Display_lang: "Synthetic Bag", OverallQualityID: 2, ItemLevel: 10, Flags: [0, 0] }],
    [18, { ID: 18, Display_lang: "Synthetic Crown", OverallQualityID: 2, ItemLevel: 70, Flags: [0, 0] }],
  ]),
]);

test("the bands, the items in each, the flagged ones and the unleveled ones, by id", () => {
  const out = buildClientDisenchant(path);
  expect(out.schema).toBe("everloot.client-disenchant/1");
  expect(out.bands).toEqual([[3, 2, 2, 5, 15, 25], [4, 4, 2, 5, 15, 0], [5, 4, 2, 16, 20, 0]]);
  expect(out.items).toEqual({ 3: [12], 4: [10], 5: [11] });
  expect(out.noDisenchant).toEqual([13]);
  expect(out.unleveled).toEqual({ 4: [15] });
});

test("findBand matches class, quality and the inclusive level range", () => {
  const bands = buildClientDisenchant(path).bands.map(bandOf);
  expect(findBand(bands, 4, 2, 15)?.id).toBe(4);
  expect(findBand(bands, 4, 2, 16)?.id).toBe(5);
  expect(findBand(bands, 2, 2, 16)).toBeNull();
  expect(findBand(bands, 4, 3, 10)).toBeNull();
});

test("the written file parses and holds one list per line", () => {
  const out = join(mkdtempSync(join(tmpdir(), "kb-disenchant-out-")), "client-disenchant.json");
  writeClientDisenchant(path, out);
  const text = readFileSync(out, "utf8");
  expect(ClientDisenchant.parse(JSON.parse(text)).items["4"]).toEqual([10]);
  expect(text).toContain('\n  "4": [10],\n');
  expect(text).toContain('\n  [3,2,2,5,15,25],\n');
});

test("the committed file is a valid table from a real build", () => {
  const committed = ClientDisenchant.parse(JSON.parse(readFileSync(join(__dirname, "../../web/src/data/game-data/client-disenchant.json"), "utf8")));
  expect(committed.bands.length).toBeGreaterThan(0);
  expect(committed.build.product).toBe("wowf");
});
