import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { buildClientRecipes, ClientRecipes, recipesByProfession, writeClientRecipes } from "../src/client-recipes.js";
import { writeClientSnapshot, type ClientBuildMeta, type ExtractedTable } from "../src/client-snapshot.js";

const meta: ClientBuildMeta = {
  product: "test", buildConfig: "abcd1234abcd1234", buildId: 70707,
  version: "1.0.0.70707", extractedAt: "2026-11-02T00:00:00.000Z", library: "test", definitions: "abc1234",
};
type Rows = [number, Record<string, unknown>][];
const table = (name: string, rows: Rows): ExtractedTable => ({ table: name, fileDataID: 1, cKey: "c".repeat(32), encryptedBlocks: 0, rows: new Map(rows) });

// Synthetic rows in the shape of the 1.60.1 tables. 171 Alchemy (profession) with its tier line 2937; 185 Cooking
// (a secondary skill, named by id); 8 Fire (a class line, not a profession); 2933 a test profession.
const tables: Record<string, Rows> = {
  SkillLine: [
    [171, { ID: 171, CategoryID: 11, DisplayName_lang: "Alchemy", ParentSkillLineID: 0 }],
    [2937, { ID: 2937, CategoryID: 11, DisplayName_lang: "Alchemy", ParentSkillLineID: 171 }],
    [185, { ID: 185, CategoryID: 9, DisplayName_lang: "Cooking", ParentSkillLineID: 0 }],
    [8, { ID: 8, CategoryID: 7, DisplayName_lang: "Fire", ParentSkillLineID: 0 }],
    [2933, { ID: 2933, CategoryID: 11, DisplayName_lang: "Test Profession [DNT]", ParentSkillLineID: 0 }],
  ],
  SkillLineAbility: [
    // The rank spell: on the line, makes and costs nothing, so it is counted, not listed.
    [1, { SkillLine: 171, Spell: 2259, MinSkillLineRank: 1, TrivialSkillLineRankLow: 0, TrivialSkillLineRankHigh: 0 }],
    [2, { SkillLine: 171, Spell: 2329, MinSkillLineRank: 1, TrivialSkillLineRankLow: 55, TrivialSkillLineRankHigh: 95 }],
    // On the tier line: folded into Alchemy.
    [3, { SkillLine: 2937, Spell: 2335, MinSkillLineRank: 60, TrivialSkillLineRankLow: 90, TrivialSkillLineRankHigh: 130 }],
    // The same spell listed again (another race mask): the first row stands.
    [4, { SkillLine: 171, Spell: 2329, MinSkillLineRank: 5, TrivialSkillLineRankLow: 1, TrivialSkillLineRankHigh: 2 }],
    [5, { SkillLine: 185, Spell: 2538, MinSkillLineRank: 1, TrivialSkillLineRankLow: 45, TrivialSkillLineRankHigh: 85 }],
    [6, { SkillLine: 8, Spell: 133, MinSkillLineRank: 1, TrivialSkillLineRankLow: 0, TrivialSkillLineRankHigh: 0 }],
    [7, { SkillLine: 2933, Spell: 9000, MinSkillLineRank: 1, TrivialSkillLineRankLow: 5, TrivialSkillLineRankHigh: 20 }],
  ],
  SpellEffect: [
    [10, { SpellID: 2329, Effect: 24, EffectItemType: 2454 }],
    [11, { SpellID: 2335, Effect: 24, EffectItemType: 2459 }],
    [12, { SpellID: 2538, Effect: 24, EffectItemType: 2679 }],
    [13, { SpellID: 133, Effect: 2, EffectItemType: 0 }],
    [14, { SpellID: 9000, Effect: 24, EffectItemType: 1 }],
  ],
  SpellReagents: [
    [20, { SpellID: 2329, Reagent: [2449, 765, 0, 0], ReagentCount: [1, 1, 0, 0] }],
    [21, { SpellID: 2335, Reagent: [2452, 2450, 3371, 0], ReagentCount: [1, 1, 1, 0] }],
  ],
};
const get = (t: string) => (tables[t] ? new Map(tables[t]) : undefined);

test("recipesByProfession: professions only, tiers folded, recipes with their item, reagents and ranks", () => {
  expect(recipesByProfession(get)).toEqual([
    { id: 171, name: "Alchemy", otherSpells: 1, recipes: [
      [2329, 2454, 1, 55, 95, [[2449, 1], [765, 1]]],
      [2335, 2459, 60, 90, 130, [[2452, 1], [2450, 1], [3371, 1]]],
    ] },
    // A recipe with no reagents in the files keeps an empty list, not an invented one.
    { id: 185, name: "Cooking", otherSpells: 0, recipes: [[2538, 2679, 1, 45, 85, []]] },
  ]);
  // A table missing: nothing to read, nothing invented.
  expect(recipesByProfession((t) => (t === "SkillLineAbility" ? undefined : get(t)))).toEqual([]);
});

test("buildClientRecipes: build-stamped, and the file reads back", () => {
  const path = join(mkdtempSync(join(tmpdir(), "kb-recipes-")), "client.sqlite");
  writeClientSnapshot(path, meta, Object.entries(tables).map(([name, rows]) => table(name, rows)));
  const out = buildClientRecipes(path);
  expect(out.schema).toBe("everloot.client-recipes/1");
  expect(out.build).toMatchObject({ product: "test", version: "1.0.0.70707" });
  expect(out.professions.map((p) => p.name)).toEqual(["Alchemy", "Cooking"]);
  const file = join(mkdtempSync(join(tmpdir(), "kb-recipes-")), "out.json");
  writeClientRecipes(path, file);
  expect(ClientRecipes.parse(JSON.parse(readFileSync(file, "utf8")))).toEqual(out);
});
