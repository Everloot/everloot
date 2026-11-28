import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { buildClientRecipes, ClientRecipes, recipeOutputs, recipesByProfession, writeClientRecipes } from "../src/client-recipes.js";
import { NEEDED_FIELDS } from "../src/client-coverage.js";
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

// Output quantities: synthetic rows in the modern 1.60.1 SpellEffect layout (EffectBasePointsF and Variance, no legacy
// EffectDieSides column). The spell ids and quantities mirror rows read from build 1.60.1.71139.
const fixed = { DifficultyID: 0, Effect: 24, Variance: 0, EffectRealPointsPerLevel: 0, EffectPointsPerResource: 0, EffectBonusCoefficient: 0, EffectIndex: 0 };
const outputTables: Record<string, Rows> = {
  SkillLine: [
    [197, { ID: 197, CategoryID: 11, DisplayName_lang: "Tailoring", ParentSkillLineID: 0 }],
    [202, { ID: 202, CategoryID: 11, DisplayName_lang: "Engineering", ParentSkillLineID: 0 }],
    [185, { ID: 185, CategoryID: 9, DisplayName_lang: "Cooking", ParentSkillLineID: 0 }],
  ],
  SkillLineAbility: [
    [1, { SkillLine: 202, Spell: 3920 }], [2, { SkillLine: 202, Spell: 3930 }], [3, { SkillLine: 202, Spell: 3947 }],
    [4, { SkillLine: 197, Spell: 2963 }], [5, { SkillLine: 197, Spell: 2964 }], [6, { SkillLine: 197, Spell: 3865 }],
    [7, { SkillLine: 185, Spell: 7751 }], [8, { SkillLine: 197, Spell: 18560 }],
    // The unavailable kinds.
    [9, { SkillLine: 202, Spell: 3931 }], [10, { SkillLine: 202, Spell: 9001 }], [11, { SkillLine: 202, Spell: 9002 }],
    [12, { SkillLine: 202, Spell: 9003 }], [13, { SkillLine: 202, Spell: 9004 }], [14, { SkillLine: 202, Spell: 9005 }],
    [15, { SkillLine: 202, Spell: 9006 }], [16, { SkillLine: 202, Spell: 9007 }], [17, { SkillLine: 202, Spell: 9008 }],
    [18, { SkillLine: 202, Spell: 9009 }], [19, { SkillLine: 202, Spell: 9010 }],
    // An enchant: makes nothing, costs a reagent; it has no output and is not counted.
    [20, { SkillLine: 197, Spell: 9011 }],
  ],
  SpellEffect: [
    [100, { ...fixed, SpellID: 3920, EffectItemType: 8067, EffectBasePointsF: 200 }],
    [101, { ...fixed, SpellID: 3930, EffectItemType: 8068, EffectBasePointsF: 200 }],
    [102, { ...fixed, SpellID: 3947, EffectItemType: 8069, EffectBasePointsF: 200 }],
    [103, { ...fixed, SpellID: 2963, EffectItemType: 2996, EffectBasePointsF: 1 }],
    [104, { ...fixed, SpellID: 2964, EffectItemType: 2997, EffectBasePointsF: 1 }],
    [105, { ...fixed, SpellID: 3865, EffectItemType: 4339, EffectBasePointsF: 1 }],
    [106, { ...fixed, SpellID: 7751, EffectItemType: 6290, EffectBasePointsF: 1 }],
    // Mooncloth: the create-item effect, and an unrelated second effect (a dummy) on the same spell.
    [107, { ...fixed, SpellID: 18560, EffectItemType: 14342, EffectBasePointsF: 1 }],
    [108, { ...fixed, SpellID: 18560, EffectIndex: 1, Effect: 3, EffectItemType: 0, EffectBasePointsF: 0 }],
    // Coarse Dynamite: a random yield (Variance) stays unavailable.
    [109, { ...fixed, SpellID: 3931, EffectItemType: 4365, EffectBasePointsF: 2, Variance: 1 }],
    // Scaled by level.
    [110, { ...fixed, SpellID: 9001, EffectItemType: 5001, EffectBasePointsF: 2, EffectRealPointsPerLevel: 2 }],
    // A legacy die-sides column with sides is a random range.
    [111, { ...fixed, SpellID: 9002, EffectItemType: 5002, EffectBasePointsF: 1, EffectDieSides: 3 }],
    // No quantity column at all.
    [112, { DifficultyID: 0, Effect: 24, SpellID: 9003, EffectItemType: 5003, EffectIndex: 0 }],
    // Zero is not one.
    [113, { ...fixed, SpellID: 9004, EffectItemType: 5004, EffectBasePointsF: 0 }],
    [114, { ...fixed, SpellID: 9005, EffectItemType: 5005, EffectBasePointsF: 1.5 }],
    // Two different items made at base difficulty: conflicting.
    [115, { ...fixed, SpellID: 9006, EffectItemType: 5006, EffectBasePointsF: 1 }],
    [116, { ...fixed, SpellID: 9006, EffectIndex: 1, EffectItemType: 5106, EffectBasePointsF: 1 }],
    // The same item made by two effects: ambiguous, not summed.
    [117, { ...fixed, SpellID: 9007, EffectItemType: 5007, EffectBasePointsF: 1 }],
    [118, { ...fixed, SpellID: 9007, EffectIndex: 1, EffectItemType: 5007, EffectBasePointsF: 1 }],
    // Made only at another difficulty.
    [119, { ...fixed, SpellID: 9008, DifficultyID: 1, EffectItemType: 5008, EffectBasePointsF: 1 }],
    // The Variance column missing: no proof the yield is fixed.
    [120, { DifficultyID: 0, Effect: 24, SpellID: 9009, EffectItemType: 5009, EffectBasePointsF: 1, EffectRealPointsPerLevel: 0, EffectPointsPerResource: 0, EffectBonusCoefficient: 0 }],
    // A legacy base-points column that disagrees with the modern one.
    [121, { ...fixed, SpellID: 9010, EffectItemType: 5010, EffectBasePointsF: 1, EffectBasePoints: 4 }],
  ],
  SpellReagents: [[200, { SpellID: 9011, Reagent: [10940, 0], ReagentCount: [1, 0] }]],
  SpellCooldowns: [
    [300, { SpellID: 18560, DifficultyID: 0, RecoveryTime: 0, CategoryRecoveryTime: 342000000 }],
    // Another difficulty's cooldown does not count; a zero cooldown is none recorded.
    [301, { SpellID: 2963, DifficultyID: 1, RecoveryTime: 60000, CategoryRecoveryTime: 0 }],
    [302, { SpellID: 2964, DifficultyID: 0, RecoveryTime: 0, CategoryRecoveryTime: 0 }],
  ],
};
const getOut = (t: string) => (outputTables[t] ? new Map(outputTables[t]) : undefined);
const outputCounts = { fixed: 8, random: 2, scaled: 1, missing: 2, nonPositive: 1, nonIntegral: 1, conflicting: 2, ambiguous: 1, noBaseEffect: 1 };

test("recipeOutputs: fixed quantities only from the one base-difficulty create-item effect; the rest unavailable, never 1", () => {
  const { outputs, counts } = recipeOutputs(getOut, recipesByProfession(getOut));
  const range = (n: number) => ({ minimum: n, maximum: n });
  for (const [spell, item] of [[3920, 8067], [3930, 8068], [3947, 8069]]) {
    expect(outputs[spell]).toEqual({ itemId: item, ...range(200), cooldownMs: null });
  }
  for (const [spell, item] of [[2963, 2996], [2964, 2997], [3865, 4339], [7751, 6290]]) {
    expect(outputs[spell]).toEqual({ itemId: item, ...range(1), cooldownMs: null });
  }
  // The unrelated second effect does not stop the matching create-item effect being read.
  expect(outputs["18560"]).toEqual({ itemId: 14342, ...range(1), cooldownMs: 342000000 });
  // Item identity is known; the quantity is not.
  for (const [spell, item] of [[3931, 4365], [9001, 5001], [9002, 5002], [9003, 5003], [9004, 5004], [9005, 5005], [9009, 5009], [9010, 5010]]) {
    expect(outputs[spell], `spell ${spell}`).toEqual({ itemId: item, minimum: null, maximum: null, cooldownMs: null });
  }
  // No single output: no entry at all.
  for (const spell of [9006, 9007, 9008, 9011]) expect(outputs[spell], `spell ${spell}`).toBeUndefined();
  expect(counts).toEqual(outputCounts);
});

test("recipeOutputs: an absent SpellEffect table gives no outputs; an absent SpellCooldowns table gives no cooldowns", () => {
  const recipes = recipesByProfession(getOut);
  expect(recipeOutputs((t) => (t === "SpellEffect" ? undefined : getOut(t)), recipes).outputs).toEqual({});
  expect(recipeOutputs((t) => (t === "SpellCooldowns" ? undefined : getOut(t)), recipes).outputs["18560"]?.cooldownMs).toBeNull();
});

test("buildClientRecipes: outputs are additive to schema 1, stamped with their snapshot and coverage", () => {
  const dir = mkdtempSync(join(tmpdir(), "kb-recipes-"));
  const path = join(dir, "client.sqlite");
  const manifest = writeClientSnapshot(path, meta, Object.entries(outputTables).map(([name, rows]) => table(name, rows)));
  const out = buildClientRecipes(path);
  expect(out.schema).toBe("everloot.client-recipes/1");
  // The recipe tuples are exactly what they were.
  expect(out.professions).toEqual(recipesByProfession(getOut));
  expect(out.outputs?.["3920"]).toEqual({ itemId: 8067, minimum: 200, maximum: 200, cooldownMs: null });
  expect(out.outputSource).toMatchObject({
    generator: "kb/src/client-recipes.ts", snapshot: "client.sqlite", snapshotSha256: manifest.sha256, extractor: "test",
    encryptedBlocks: { SpellEffect: 0, SpellCooldowns: 0 }, counts: outputCounts,
  });
  expect(out.outputSource?.fields).toEqual(expect.arrayContaining(["EffectBasePointsF", "Variance", "EffectRealPointsPerLevel", "EffectPointsPerResource", "EffectBonusCoefficient", "RecoveryTime", "CategoryRecoveryTime"]));
  const file = join(dir, "out.json");
  writeClientRecipes(path, file);
  const text = readFileSync(file, "utf8");
  expect(ClientRecipes.parse(JSON.parse(text))).toEqual(out);
  // Nothing in the file names where the snapshot lived.
  expect(text).not.toContain(JSON.stringify(dir).slice(1, -1));
  expect(text).not.toMatch(/[A-Za-z]:\\\\|\/Users\/|\/home\//);
});

const committedText = readFileSync(new URL("../../web/src/data/game-data/client-recipes.json", import.meta.url), "utf8");

test("ClientRecipes: a file from before outputs still reads", () => {
  const { outputs: _o, outputSource: _s, ...old } = JSON.parse(committedText);
  expect(ClientRecipes.parse(old).outputs).toBeUndefined();
});

// The committed catalog, regenerated from the owned 1.60.1.71139 snapshot.
test("the committed catalog: build-stamped outputs for ammunition, bolts, fish and Mooncloth", () => {
  const committed = ClientRecipes.parse(JSON.parse(committedText));
  const out = committed.outputs!;
  expect(committed.build.version).toBe("1.60.1.71139");
  expect(committed.outputSource?.snapshotSha256).toBe("933e9c3d8f8b1678cf8195f5bfce3ef53eae13fc7125d4706cf2b6520fdba38d");
  for (const spell of [3920, 3930, 3947]) expect(out[spell]).toMatchObject({ minimum: 200, maximum: 200 });
  for (const spell of [2963, 2964, 3865, 7751]) expect(out[spell]).toMatchObject({ minimum: 1, maximum: 1 });
  expect(out["18560"]).toEqual({ itemId: 14342, minimum: 1, maximum: 1, cooldownMs: 342000000 });
  expect(out["3931"]).toMatchObject({ minimum: null, maximum: null });
  // Every output names the item its recipe row makes, and every item-making recipe is counted once.
  const rows = new Map(committed.professions.flatMap((p) => p.recipes.map((r) => [r[0], r[1]] as const)));
  for (const [spell, o] of Object.entries(out)) expect(rows.get(Number(spell)), spell).toBe(o.itemId);
  const counted = Object.values(committed.outputSource!.counts).reduce((a, b) => a + b, 0);
  expect(counted).toBe([...rows.values()].filter((item) => item > 0).length);
  expect(committedText).not.toMatch(/[A-Za-z]:\\\\|\/Users\/|\/home\//);
});

test("the committed catalog's cooldowns agree with the addon's build-stamped cooldown data", () => {
  const committed = ClientRecipes.parse(JSON.parse(committedText));
  const lua = readFileSync(new URL("../../addon/modules/recipe_cooldown_data.lua", import.meta.url), "utf8");
  expect(lua).toContain(`build = "${committed.build.version}"`);
  expect(lua).toContain(`sha256 = "${committed.outputSource!.snapshotSha256}"`);
  const limited = new Map([...lua.matchAll(/\[(\d+)\] = \{ ms = (\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]));
  const withCooldown = Object.entries(committed.outputs!).filter(([, o]) => o.cooldownMs !== null);
  expect(withCooldown.length).toBeGreaterThan(0);
  for (const [spell, o] of withCooldown) expect(limited.get(Number(spell)), spell).toBe(o.cooldownMs);
  for (const [spell, ms] of limited) if (committed.outputs![spell]) expect(committed.outputs![spell].cooldownMs, String(spell)).toBe(ms);
});

test("the coverage report checks every quantity and cooldown column the outputs read", () => {
  expect(NEEDED_FIELDS.SpellEffect).toEqual(expect.arrayContaining(["SpellID", "DifficultyID", "Effect", "EffectIndex", "EffectItemType", "EffectBasePointsF", "Variance", "EffectRealPointsPerLevel", "EffectPointsPerResource", "EffectBonusCoefficient"]));
  expect(NEEDED_FIELDS.SpellCooldowns).toEqual(expect.arrayContaining(["SpellID", "RecoveryTime", "CategoryRecoveryTime"]));
});
