/**
 * Which spells belong to each class, by the game files: the spells on the class's own skill lines.
 *
 * The join, with no name matching: a class skill line (`SkillLine.CategoryID` 7: Fire, Frost, Arcane for the mage, the
 * pet lines of the hunter and the warlock) → the spells it lists (`SkillLineAbility`, its `ClassMask`, 0 for every class
 * the line has). A class has the line when a `SkillRaceClassInfo` row of it names the class; races are not told apart.
 * A few category 7 lines are every class's (Mounts, Companions, Engraving, Runes): on those a spell counts only when its
 * own mask names some classes and not all (the Paladin's warhorse, each class's runes). The pet lines name no class in
 * `SkillRaceClassInfo` and are left out: their spells are the pet's.
 * Ranks, talents, passives and helper spells are mixed together, as the files have them, and nothing says which a
 * trainer teaches (docs/sources/2026-10-27-class-legacy-dungeon-source-audit.md, "Trainer spells").
 *
 * Blizzard's data, labelled "found in game files, unconfirmed", pages only. The build watch regenerates it.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { GAME_DATA_CREDIT } from "@everloot/protocol";
import { readClientMeta, readClientRows, readClientTables } from "./client-snapshot.js";
import { CLIENT_LABEL } from "./edges.js";

export const CLASS_SPELLS_SCHEMA = "everloot.client-class-spells/1";

/** SkillLine.CategoryID of the class skill lines. */
const CLASS_SKILL_CATEGORY = 7;

export const ClientClassSpells = z.object({
  schema: z.literal(CLASS_SPELLS_SCHEMA),
  label: z.literal(CLIENT_LABEL),
  credit: z.string(),
  build: z.object({
    product: z.string(), buildId: z.number().int(), version: z.string(), buildConfig: z.string(),
    definitions: z.string().nullable(), extractedAt: z.string(),
  }),
  /** Each class by its lower-case file name (mage), with its id and the spell ids on its class skill lines, ascending. */
  classes: z.record(z.string(), z.object({ id: z.number().int(), spells: z.array(z.number().int()) })),
  note: z.literal("class skill lines and class masks are the game files'; races are not told apart"),
});
export type ClientClassSpells = z.infer<typeof ClientClassSpells>;

type Get = (table: string) => Map<number, Record<string, unknown>> | undefined;
const num = (v: unknown) => Number(v ?? 0);
const bits = (mask: number) => Array.from({ length: 31 }, (_, i) => i).filter((i) => (mask >>> i) & 1).map((i) => i + 1);

/** Per class id, the spells its class skill lines list. `every` is the mask of every class the build has. */
export function spellsByClass(get: Get, every: number): Map<number, Set<number>> {
  const out = new Map<number, Set<number>>();
  const lines = get("SkillLine"), abilities = get("SkillLineAbility"), raceClass = get("SkillRaceClassInfo");
  if (!lines || !abilities || !raceClass) return out;
  const all = (mask: number) => (mask & every) === every;
  const classLines = new Set([...lines].filter(([, r]) => num(r.CategoryID) === CLASS_SKILL_CATEGORY).map(([id]) => id));
  const classesOf = new Map<number, Set<number>>();
  for (const r of raceClass.values()) {
    const line = num(r.SkillID);
    if (!classLines.has(line)) continue;
    const set = classesOf.get(line) ?? new Set<number>();
    for (const cls of bits(num(r.ClassMask))) set.add(cls);
    classesOf.set(line, set);
  }
  const shared = new Set([...classesOf].filter(([, set]) => all([...set].reduce((m, c) => m | (1 << (c - 1)), 0))).map(([line]) => line));
  for (const a of abilities.values()) {
    const line = num(a.SkillLine), classes = classesOf.get(line), spell = num(a.Spell), mask = num(a.ClassMask);
    if (!classes || spell <= 0) continue;
    const own = mask !== 0 && !all(mask);
    if (shared.has(line) && !own) continue;
    for (const cls of classes) {
      if (own && !((mask >>> (cls - 1)) & 1)) continue;
      const set = out.get(cls) ?? new Set<number>();
      set.add(spell);
      out.set(cls, set);
    }
  }
  return out;
}

export function buildClientClassSpells(snapshotPath: string): ClientClassSpells {
  const meta = readClientMeta(snapshotPath);
  const present = new Set(readClientTables(snapshotPath));
  const get: Get = (t) => (present.has(t) ? readClientRows(snapshotPath, t) : undefined);
  const chr = [...(get("ChrClasses") ?? [])].sort(([a], [b]) => a - b);
  const byClass = spellsByClass(get, chr.reduce((m, [id]) => m | (1 << (id - 1)), 0));
  const classes: ClientClassSpells["classes"] = {};
  for (const [id, row] of chr) {
    const slug = String(row.Filename ?? "").toLowerCase();
    if (slug) classes[slug] = { id, spells: [...(byClass.get(id) ?? [])].sort((a, b) => a - b) };
  }
  return ClientClassSpells.parse({
    schema: CLASS_SPELLS_SCHEMA, label: CLIENT_LABEL, credit: GAME_DATA_CREDIT,
    build: { product: meta.product, buildId: meta.buildId, version: meta.version, buildConfig: meta.buildConfig, definitions: meta.definitions, extractedAt: meta.extractedAt },
    classes,
    note: "class skill lines and class masks are the game files'; races are not told apart",
  });
}

/** One class per line, so a new build's file reads as a line diff in review. */
export function serializeClientClassSpells(table: ClientClassSpells): string {
  const { classes, ...head } = table;
  const top = JSON.stringify(head, null, 1).replace(/\n}$/, "");
  const cls = Object.entries(classes).map(([slug, c]) => `  ${JSON.stringify(slug)}: ${JSON.stringify(c)}`);
  return `${top},\n "classes": {\n${cls.join(",\n")}\n }\n}\n`;
}

/** Writes the table to `path` (the site's copy is web/src/data/game-data/client-class-spells.json). */
export function writeClientClassSpells(snapshotPath: string, path: string): ClientClassSpells {
  const table = buildClientClassSpells(snapshotPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeClientClassSpells(table));
  return table;
}
