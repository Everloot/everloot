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
 * `outputs` (added without a schema bump, so older files still read) gives each item-making recipe's item, quantity
 * and recorded cooldown from the same snapshot, and `outputSource` stamps it with the snapshot's SHA-256, the columns
 * read, the encrypted block counts and why each recipe has a quantity or not (see recipeOutputs).
 *
 * Blizzard's data, labelled "found in game files, unconfirmed", pages only. The build watch regenerates it.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { z } from "zod";
import { GAME_DATA_CREDIT } from "@everloot/protocol";
import { readClientManifest, readClientMeta, readClientRows, readClientTables } from "./client-snapshot.js";
import { sha256File } from "./snapshot.js";
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

/**
 * What a recipe spell makes, read from its one base-difficulty create-item effect. `minimum`/`maximum` are set only
 * for a fixed positive whole quantity; null means unavailable (random, scaled, missing or conflicting), never one.
 * `cooldownMs` is null when these files record no cooldown, which is not proof there is none.
 */
const Output = z.object({
  itemId: z.number().int().positive(),
  minimum: z.number().int().positive().nullable(),
  maximum: z.number().int().positive().nullable(),
  cooldownMs: z.number().int().positive().nullable(),
});
export type RecipeOutput = z.infer<typeof Output>;

/** Why each item-making recipe has, or lacks, a quantity; every item-making recipe is counted once. */
const OUTPUT_REASONS = ["fixed", "random", "scaled", "missing", "nonPositive", "nonIntegral", "conflicting", "ambiguous", "noBaseEffect"] as const;
type OutputReason = (typeof OUTPUT_REASONS)[number];

/** The quantity columns that must be present and 0, and the ones that must be 0 when the layout has them. */
const ZERO_REQUIRED = ["Variance", "EffectRealPointsPerLevel", "EffectPointsPerResource", "EffectBonusCoefficient"] as const;
const SCALING_OPTIONAL = ["BonusCoefficientFromAP", "Coefficient", "ResourceCoefficient", "ScalingClass"] as const;
/** Every column the outputs read, for the coverage receipt. */
export const OUTPUT_FIELDS = [
  "SpellID", "DifficultyID", "Effect", "EffectIndex", "EffectItemType", "EffectBasePointsF", "EffectBasePoints", "EffectDieSides",
  ...ZERO_REQUIRED, ...SCALING_OPTIONAL, "RecoveryTime", "CategoryRecoveryTime",
] as const;

const OUTPUT_NOTE = "outputs[spellId]: the item the recipe's one base-difficulty (DifficultyID 0) CREATE_ITEM (Effect 24) effect makes. minimum and maximum are its EffectBasePointsF only when that is a positive whole number with Variance, EffectRealPointsPerLevel, EffectPointsPerResource and EffectBonusCoefficient 0, no legacy EffectDieSides, no other scaling, and no disagreeing legacy EffectBasePoints; null means unavailable, not one. A recipe with no base-difficulty create effect, or with several, has no entry. cooldownMs: the larger of RecoveryTime and CategoryRecoveryTime in SpellCooldowns at DifficultyID 0, when positive; null means none recorded in these files, not proof there is none (encrypted blocks and server changes are not in them).";

const OutputSource = z.object({
  note: z.literal(OUTPUT_NOTE),
  generator: z.literal("kb/src/client-recipes.ts"),
  /** The snapshot's file name and SHA-256, and the extractor that wrote it; never a local path. */
  snapshot: z.string(), snapshotSha256: z.string(), extractor: z.string(),
  fields: z.array(z.string()),
  /** Blocks the extractor could not read; null where the snapshot has no manifest entry for the table. */
  encryptedBlocks: z.object({ SpellEffect: z.number().int().nullable(), SpellCooldowns: z.number().int().nullable() }),
  counts: z.object(Object.fromEntries(OUTPUT_REASONS.map((r) => [r, z.number().int()])) as Record<OutputReason, z.ZodNumber>),
});

export const ClientRecipes = z.object({
  schema: z.literal(RECIPES_SCHEMA),
  label: z.literal(CLIENT_LABEL),
  credit: z.string(),
  build: z.object({
    product: z.string(), buildId: z.number().int(), version: z.string(), buildConfig: z.string(),
    definitions: z.string().nullable(), extractedAt: z.string(),
  }),
  note: z.literal("ranks are SkillLineAbility's MinSkillLineRank, TrivialSkillLineRankLow (yellow) and TrivialSkillLineRankHigh (grey), 0 where the files give none; green is not stored"),
  /** Each profession by skill line id, with its recipes and other spell count. */
  professions: z.array(z.object({ id: z.number().int(), name: z.string(), otherSpells: z.number().int(), recipes: z.array(Recipe) })),
  /** Added in place of a schema bump: files from before them have neither, and readers treat that as unavailable. */
  outputs: z.record(z.string(), Output).optional(),
  outputSource: OutputSource.optional(),
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

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const absentOrZero = (v: unknown) => v === undefined || v === null || v === 0;

/** One create-item effect's quantity, or why it has none. An absent legacy EffectDieSides is not a random range. */
function quantity(e: Record<string, unknown>): { reason: OutputReason; count?: number } {
  const points = e.EffectBasePointsF;
  if (!isNumber(points) || ZERO_REQUIRED.some((k) => !isNumber(e[k]))) return { reason: "missing" };
  if (e.Variance !== 0 || !absentOrZero(e.EffectDieSides)) return { reason: "random" };
  if (ZERO_REQUIRED.some((k) => e[k] !== 0) || SCALING_OPTIONAL.some((k) => !absentOrZero(e[k]))) return { reason: "scaled" };
  if (!(e.EffectBasePoints === undefined || e.EffectBasePoints === null || e.EffectBasePoints === points)) return { reason: "conflicting" };
  if (points <= 0) return { reason: "nonPositive" };
  if (!Number.isInteger(points)) return { reason: "nonIntegral" };
  return { reason: "fixed", count: points };
}

/**
 * Each item-making recipe's output: the item and quantity of its one base-difficulty create-item effect (other effects
 * on the spell are not read), and its recorded cooldown. Counts say why each recipe has a quantity or not.
 */
export function recipeOutputs(get: Get, professions: ClientRecipes["professions"]): { outputs: Record<string, RecipeOutput>; counts: Record<OutputReason, number> } {
  const counts = Object.fromEntries(OUTPUT_REASONS.map((r) => [r, 0])) as Record<OutputReason, number>;
  const outputs: Record<string, RecipeOutput> = {};
  const effects = get("SpellEffect");
  if (!effects) return { outputs, counts };
  const creates = new Map<number, Record<string, unknown>[]>();
  for (const e of effects.values()) {
    if (num(e.DifficultyID) !== 0 || num(e.Effect) !== CREATE_ITEM || num(e.EffectItemType) <= 0) continue;
    creates.set(num(e.SpellID), [...(creates.get(num(e.SpellID)) ?? []), e]);
  }
  // The same rule as scripts/build-recipe-cooldowns.py: positive RecoveryTime or CategoryRecoveryTime at DifficultyID 0.
  const cooldowns = new Map<number, number>();
  for (const c of get("SpellCooldowns")?.values() ?? []) {
    const ms = Math.max(num(c.RecoveryTime), num(c.CategoryRecoveryTime));
    if (num(c.DifficultyID) === 0 && ms > 0) cooldowns.set(num(c.SpellID), Math.max(ms, cooldowns.get(num(c.SpellID)) ?? 0));
  }
  for (const [spell, item] of professions.flatMap((p) => p.recipes)) {
    if (item <= 0) continue;
    const made = creates.get(spell) ?? [];
    const items = new Set(made.map((e) => num(e.EffectItemType)));
    if (!made.length) { counts.noBaseEffect++; continue; }
    if (items.size > 1 || !items.has(item)) { counts.conflicting++; continue; }
    if (made.length > 1) { counts.ambiguous++; continue; }
    const q = quantity(made[0]!);
    counts[q.reason]++;
    outputs[spell] = { itemId: item, minimum: q.count ?? null, maximum: q.count ?? null, cooldownMs: cooldowns.get(spell) ?? null };
  }
  return { outputs, counts };
}

/** Teaching items linked by ItemXItemEffect → ItemEffect learning trigger (6), or a base-difficulty LEARN_SPELL (36) effect.
 * Missing tables mean unknown; names are never used to guess these links. */
export function recipeItemsBySpell(get: Get): Record<string, number[]> {
  const learns = new Map<number, Set<number>>();
  for (const e of get("SpellEffect")?.values() ?? []) {
    if (num(e.DifficultyID) !== 0 || num(e.Effect) !== 36 || num(e.EffectTriggerSpell) <= 0) continue;
    const targets = learns.get(num(e.SpellID)) ?? new Set<number>();
    targets.add(num(e.EffectTriggerSpell)); learns.set(num(e.SpellID), targets);
  }
  const out: Record<string, number[]> = {};
  for (const link of get("ItemXItemEffect")?.values() ?? []) {
    const effect = get("ItemEffect")?.get(num(link.ItemEffectID));
    const item = num(link.ItemID);
    if (!effect || item <= 0) continue;
    const targets = new Set(learns.get(num(effect.SpellID)) ?? []);
    if (num(effect.TriggerType) === 6 && num(effect.SpellID) > 0) targets.add(num(effect.SpellID));
    for (const spell of targets) out[spell] = [...new Set([...(out[spell] ?? []), item])].sort((a,b)=>a-b);
  }
  return out;
}

/** Only numeric teaching-item links for the recipe spells this consumer lists. */
export function recipeItemDetails(get: Get, spells: ReadonlySet<number>): { links: Record<string, number[]> } {
  return { links: Object.fromEntries(Object.entries(recipeItemsBySpell(get)).filter(([spell]) => spells.has(Number(spell)))) };
}

export function buildClientRecipes(snapshotPath: string): ClientRecipes {
  const meta = readClientMeta(snapshotPath);
  const present = new Set(readClientTables(snapshotPath));
  const get: Get = (t) => (present.has(t) ? readClientRows(snapshotPath, t) : undefined);
  const manifest = readClientManifest(snapshotPath);
  const sha256 = sha256File(snapshotPath);
  if (manifest && manifest.sha256 !== sha256) throw new Error(`snapshot sha256 ${sha256} does not match its manifest ${manifest.sha256}`);
  const blocks = (table: string) => manifest?.tables.find((t) => t.table === table)?.encryptedBlocks ?? null;
  const professions = recipesByProfession(get);
  const { outputs, counts } = recipeOutputs(get, professions);
  return ClientRecipes.parse({
    schema: RECIPES_SCHEMA, label: CLIENT_LABEL, credit: GAME_DATA_CREDIT,
    build: { product: meta.product, buildId: meta.buildId, version: meta.version, buildConfig: meta.buildConfig, definitions: meta.definitions, extractedAt: meta.extractedAt },
    note: "ranks are SkillLineAbility's MinSkillLineRank, TrivialSkillLineRankLow (yellow) and TrivialSkillLineRankHigh (grey), 0 where the files give none; green is not stored",
    outputSource: {
      note: OUTPUT_NOTE, generator: "kb/src/client-recipes.ts", snapshot: basename(snapshotPath), snapshotSha256: sha256, extractor: meta.library,
      fields: [...OUTPUT_FIELDS], encryptedBlocks: { SpellEffect: blocks("SpellEffect"), SpellCooldowns: blocks("SpellCooldowns") }, counts,
    },
    professions,
    outputs,
  });
}

/** One recipe per line, and one output per line, so a new build's file reads as a line diff in review. */
export function serializeClientRecipes(table: ClientRecipes): string {
  const { professions, outputs, ...head } = table;
  const top = JSON.stringify(head, null, 1).replace(/\n}$/, "");
  const body = professions.map(({ recipes, ...p }) => {
    const open = JSON.stringify(p).replace(/}$/, "");
    return `  ${open},"recipes":[\n${recipes.map((r) => `   ${JSON.stringify(r)}`).join(",\n")}\n  ]}`;
  });
  const made = outputs ? `,\n "outputs": {\n${Object.entries(outputs).map(([spell, o]) => `  ${JSON.stringify(spell)}:${JSON.stringify(o)}`).join(",\n")}\n }` : "";
  return `${top},\n "professions": [\n${body.join(",\n")}\n ]${made}\n}\n`;
}

/** Writes the table to `path` (the site's copy is web/src/data/game-data/client-recipes.json). */
export function writeClientRecipes(snapshotPath: string, path: string): ClientRecipes {
  const table = buildClientRecipes(snapshotPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeClientRecipes(table));
  return table;
}
