import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { buildClientItemSets, ClientItemSets, serializeClientItemSets, writeClientItemSets } from "../src/client-item-sets.js";
import { writeClientSnapshot, type ClientBuildMeta, type ExtractedTable } from "../src/client-snapshot.js";

const meta: ClientBuildMeta = {
  product: "test", buildConfig: "abcd1234abcd1234", buildId: 70707,
  version: "1.0.0.70707", extractedAt: "2026-11-25T00:00:00.000Z", library: "test", definitions: "abc1234",
};
type Rows = [number, Record<string, unknown>][];
const table = (name: string, rows: Rows): ExtractedTable => ({ table: name, fileDataID: 1, cKey: "c".repeat(32), encryptedBlocks: 0, rows: new Map(rows) });

const tables: Record<string, Rows> = {
  ItemSet: [
    [1, { Name_lang: "The Gladiator", RequiredSkill: 0, RequiredSkillRank: 0, ItemID: [11729, 11726, 0, 0] }],
    [2, { Name_lang: "Lonely Set", RequiredSkill: 0, RequiredSkillRank: 0, ItemID: [500, 0] }],
    [3, { Name_lang: "Volcanic Armor", RequiredSkill: 165, RequiredSkillRank: 225, ItemID: [15053, 15054] }],
    [4, { Name_lang: "", ItemID: [1, 2] }],
    [5, { Name_lang: "<TEST> Set", ItemID: [3, 4] }],
    [6, { Name_lang: "Empty", ItemID: [0, 0] }],
  ],
  ItemSetSpell: [
    [100, { ItemSetID: 1, SpellID: 9000, Threshold: 5, ChrSpecID: 0 }],
    [101, { ItemSetID: 1, SpellID: 9001, Threshold: 2, ChrSpecID: 0 }],
    [102, { ItemSetID: 1, SpellID: 8999, Threshold: 2, ChrSpecID: 0 }],
    [103, { ItemSetID: 3, SpellID: 9100, Threshold: 3, ChrSpecID: 0 }],
    [104, { ItemSetID: 4, SpellID: 9200, Threshold: 2, ChrSpecID: 0 }],
    [105, { ItemSetID: 1, SpellID: 0, Threshold: 3, ChrSpecID: 0 }],
  ],
};

function snapshot(t: Record<string, Rows>): string {
  const path = join(mkdtempSync(join(tmpdir(), "kb-item-sets-")), "client.sqlite");
  writeClientSnapshot(path, meta, Object.entries(t).map(([name, rows]) => table(name, rows)));
  return path;
}

test("item sets: pieces in the files' order, bonuses by threshold then spell, the skill a crafted set needs; no names", () => {
  expect(buildClientItemSets(snapshot(tables)).sets).toEqual([
    { id: 1, items: [11729, 11726], bonuses: [[2, 8999], [2, 9001], [5, 9000]] },
    { id: 2, items: [500], bonuses: [] },
    { id: 3, items: [15053, 15054], bonuses: [[3, 9100]], skill: [165, 225] },
  ]);
});

test("item sets: an unnamed set, a development leftover and a set with no pieces are left out", () => {
  const ids = buildClientItemSets(snapshot(tables)).sets.map((s) => s.id);
  expect(ids).not.toContain(4);
  expect(ids).not.toContain(5);
  expect(ids).not.toContain(6);
});

test("item sets: the file carries no set name", () => {
  const text = serializeClientItemSets(buildClientItemSets(snapshot(tables)));
  expect(text).not.toContain("Gladiator");
  expect(text).not.toContain("Volcanic");
});

test("item sets: build-stamped, and the file reads back", () => {
  const path = snapshot(tables);
  const out = buildClientItemSets(path);
  expect(out.schema).toBe("everloot.client-item-sets/1");
  expect(out.build).toMatchObject({ product: "test", version: "1.0.0.70707" });
  const file = join(mkdtempSync(join(tmpdir(), "kb-item-sets-")), "out.json");
  writeClientItemSets(path, file);
  expect(ClientItemSets.parse(JSON.parse(readFileSync(file, "utf8")))).toEqual(out);
});

test("item sets: a snapshot without ItemSetSpell lists the sets with no bonuses; without ItemSet, none", () => {
  expect(buildClientItemSets(snapshot({ ItemSet: [[1, { Name_lang: "Solo", ItemID: [7] }]] })).sets).toEqual([{ id: 1, items: [7], bonuses: [] }]);
  expect(buildClientItemSets(snapshot({ Other: [[1, { X: 1 }]] })).sets).toEqual([]);
});
