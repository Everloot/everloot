/**
 * Every recipe the game files list for each profession: the recipe spell, the item it makes, its reagents with
 * counts, and the skill ranks `SkillLineAbility` stores for it.
 *
 * The join, with no name matching: a profession skill line (`SkillLine.CategoryID` 11, and Cooking, First Aid and
 * Fishing by id, as `isProfession`; an expansion's tier line folded into its parent) → its spells
 * (`SkillLineAbility`) → the item a spell makes (`SpellEffect`, effect 24) and what it costs (`SpellReagents`,
 * `Reagent` and `ReagentCount` side by side). A spell is a recipe when it makes an item or costs a reagent; the
 * other spells on the line (the rank spells, and the ones whose rows this build does not carry) are counted, not
 * listed. A line whose name marks it as a development leftover ("Test Profession [DNT]") is left out.
 *
 * The ranks are the files' own columns: `MinSkillLineRank` (the files give one above 1 for only a few recipes, so
 * it is not the trainer's rank), `TrivialSkillLineRankLow` (where the recipe turns yellow) and
 * `TrivialSkillLineRankHigh` (where it turns grey); 0 where the files give none. Green is not stored.
 *
 * Blizzard's data, labelled "found in game files, unconfirmed", pages only. The build watch regenerates it.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { GAME_DATA_CREDIT } from "@everloot/protocol";
import { readClientMeta, readClientRows, readClientTables } from "./client-snapshot.js";
import { isDevelopmentItemName } from "./dev-item-names.js";
import { CLIENT_LABEL, isProfession } from "./edges.js";

export const RECIPES_SCHEMA = "everloot.client-recipes/1";

/** SPELL_EFFECT_CREATE_ITEM. */
const CREATE_ITEM = 24;

/** [spellId, itemId (0: makes no item), MinSkillLineRank, yellow rank, grey rank, [[reagent item, count], ...]]. */
const Recipe = z.tuple([
  z.number().int(), z.number().int(), z.number().int(), z.number().int(), z.number().int(),
  z.array(z.tuple([z.number().int(), z.number().int()])),
]);
export type RecipeRow = z.infer<typeof Recipe>;

export const ClientRecipes = z.object({
  schema: z.literal(RECIPES_SCHEMA),
  label: z.literal(CLIENT_LABEL),
  credit: z.string(),
  build: z.object({
    product: z.string(), buildId: z.number().int(), version: z.string(), buildConfig: z.string(),
    definitions: z.string().nullable(), extractedAt: z.string(),
  }),
  note: z.literal("ranks are SkillLineAbility's MinSkillLineRank, TrivialSkillLineRankLow (yellow) and TrivialSkillLineRankHigh (grey), 0 where the files give none; green is not stored"),
  /** Each profession by skill line id, with its client name, its recipes by spell id and how many other spells its line lists. */
  professions: z.array(z.object({ id: z.number().int(), name: z.string(), otherSpells: z.number().int(), recipes: z.array(Recipe) })),
});
export type ClientRecipes = z.infer<typeof ClientRecipes>;

type Rows = Map<number, Record<string, unknown>>;
type Get = (table: string) => Rows | undefined;
const num = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : 0);
const list = (v: unknown) => (Array.isArray(v) ? v.map(num) : []);

/** The professions and their recipes from the tables; an absent table gives nothing, never a guess. */
export function recipesByProfession(get: Get): ClientRecipes["professions"] {
  const lines = get("SkillLine"), abilities = get("SkillLineAbility");
  if (!lines || !abilities) return [];
  const top = (skill: number) => { const parent = num(lines.get(skill)?.ParentSkillLineID); return parent && lines.has(parent) ? parent : skill; };
  const makes = new Map<number, number>();
  for (const e of get("SpellEffect")?.values() ?? []) {
    if (num(e.Effect) === CREATE_ITEM && num(e.EffectItemType) > 0 && !makes.has(num(e.SpellID))) makes.set(num(e.SpellID), num(e.EffectItemType));
  }
  const costs = new Map<number, [number, number][]>();
  for (const r of get("SpellReagents")?.values() ?? []) {
    const counts = list(r.ReagentCount);
    const pairs = list(r.Reagent).map((item, i): [number, number] => [item, counts[i] ?? 0]).filter(([item, count]) => item > 0 && count > 0);
    if (pairs.length && !costs.has(num(r.SpellID))) costs.set(num(r.SpellID), pairs);
  }
  const out = new Map<number, { id: number; name: string; otherSpells: number; recipes: Map<number, RecipeRow> }>();
  const seen = new Set<number>();
  // By row id, so a spell listed twice keeps its first row.
  for (const [, a] of [...abilities].sort(([x], [y]) => x - y)) {
    const skill = top(num(a.SkillLine)), row = lines.get(skill), spell = num(a.Spell);
    if (!row || !isProfession(row) || spell <= 0 || seen.has(spell)) continue;
    const name = typeof row.DisplayName_lang === "string" ? row.DisplayName_lang.trim() : "";
    if (!name || isDevelopmentItemName(name)) continue;
    seen.add(spell);
    const p = out.get(skill) ?? { id: skill, name, otherSpells: 0, recipes: new Map() };
    out.set(skill, p);
    const item = makes.get(spell) ?? 0, reagents = costs.get(spell) ?? [];
    if (!item && !reagents.length) { p.otherSpells++; continue; }
    p.recipes.set(spell, [spell, item, num(a.MinSkillLineRank), num(a.TrivialSkillLineRankLow), num(a.TrivialSkillLineRankHigh), reagents]);
  }
  return [...out.values()].sort((a, b) => a.id - b.id)
    .map((p) => ({ id: p.id, name: p.name, otherSpells: p.otherSpells, recipes: [...p.recipes.values()].sort((a, b) => a[0] - b[0]) }));
}

export function buildClientRecipes(snapshotPath: string): ClientRecipes {
  const meta = readClientMeta(snapshotPath);
  const present = new Set(readClientTables(snapshotPath));
  const get: Get = (t) => (present.has(t) ? readClientRows(snapshotPath, t) : undefined);
  return ClientRecipes.parse({
    schema: RECIPES_SCHEMA, label: CLIENT_LABEL, credit: GAME_DATA_CREDIT,
    build: { product: meta.product, buildId: meta.buildId, version: meta.version, buildConfig: meta.buildConfig, definitions: meta.definitions, extractedAt: meta.extractedAt },
    note: "ranks are SkillLineAbility's MinSkillLineRank, TrivialSkillLineRankLow (yellow) and TrivialSkillLineRankHigh (grey), 0 where the files give none; green is not stored",
    professions: recipesByProfession(get),
  });
}

/** One recipe per line, so a new build's file reads as a line diff in review. */
export function serializeClientRecipes(table: ClientRecipes): string {
  const { professions, ...head } = table;
  const top = JSON.stringify(head, null, 1).replace(/\n}$/, "");
  const body = professions.map(({ recipes, ...p }) => {
    const open = JSON.stringify(p).replace(/}$/, "");
    return `  ${open},"recipes":[\n${recipes.map((r) => `   ${JSON.stringify(r)}`).join(",\n")}\n  ]}`;
  });
  return `${top},\n "professions": [\n${body.join(",\n")}\n ]\n}\n`;
}

/** Writes the table to `path` (the site's copy is web/src/data/game-data/client-recipes.json). */
export function writeClientRecipes(snapshotPath: string, path: string): ClientRecipes {
  const table = buildClientRecipes(snapshotPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeClientRecipes(table));
  return table;
}
