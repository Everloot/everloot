/**
 * What each class can equip, by the game files: the item classes and subclasses its weapon and armor proficiencies
 * name, with the level the files give for each, and the items whose own class mask leaves some classes out.
 *
 * The join, with no name matching: a weapon or armor skill line (`SkillLine.CategoryID` 6 or 8) → the spells it
 * teaches (`SkillLineAbility`, its `ClassMask`, 0 for every class the line has) that carry a Proficiency effect
 * (`SpellEffect.Effect` 60; Parry, Block and the Shoot spells only ask for a weapon and are left out) → the item
 * class and subclass mask they allow (`SpellEquippedItems`). A class has the line when a `SkillRaceClassInfo` row of it
 * names the class, and the lowest `MinLevel` among those rows is when it gets it (Plate Mail at 40). Races are not
 * told apart: a class counts when any race of it has the line. `ItemSparse.AllowableClass` is the item's own mask.
 *
 * Blizzard's data, labelled "found in game files, unconfirmed", pages only. The build watch regenerates it.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { GAME_DATA_CREDIT } from "@everloot/protocol";
import { readClientMeta, readClientRows, readClientTables } from "./client-snapshot.js";
import { CLIENT_LABEL } from "./edges.js";

export const CLASS_GEAR_SCHEMA = "everloot.client-class-gear/1";

/** SkillLine.CategoryID of the weapon and armor skill lines. */
const GEAR_SKILL_CATEGORIES = new Set([6, 8]);
/** SpellEffect.Effect of a proficiency (SPELL_EFFECT_PROFICIENCY). */
const PROFICIENCY_EFFECT = 60;

/** [item class, item subclass, the level the class gets it at (0: from the start)]. */
const Gear = z.tuple([z.number().int(), z.number().int(), z.number().int()]);

export const ClientClassGear = z.object({
  schema: z.literal(CLASS_GEAR_SCHEMA),
  label: z.literal(CLIENT_LABEL),
  credit: z.string(),
  build: z.object({
    product: z.string(), buildId: z.number().int(), version: z.string(), buildConfig: z.string(),
    definitions: z.string().nullable(), extractedAt: z.string(),
  }),
  /** Each class by its lower-case file name (mage), with its id and what its proficiencies let it equip. */
  classes: z.record(z.string(), z.object({ id: z.number().int(), gear: z.array(Gear) })),
  /** Items whose AllowableClass leaves out at least one class, item id → the mask (bit id − 1). */
  restricted: z.record(z.string(), z.number().int()),
  note: z.literal("proficiencies and class masks are the game files'; races are not told apart"),
});
export type ClientClassGear = z.infer<typeof ClientClassGear>;

type Get = (table: string) => Map<number, Record<string, unknown>> | undefined;
const num = (v: unknown) => Number(v ?? 0);
const bits = (mask: number) => Array.from({ length: 31 }, (_, i) => i).filter((i) => (mask >>> i) & 1).map((i) => i + 1);

/** Per class id, the (item class, subclass) pairs its proficiencies allow and the lowest level it gets each at. */
export function proficienciesByClass(get: Get): Map<number, Map<string, number>> {
  const out = new Map<number, Map<string, number>>();
  const lines = get("SkillLine"), abilities = get("SkillLineAbility"), raceClass = get("SkillRaceClassInfo"), equipped = get("SpellEquippedItems"), effects = get("SpellEffect");
  if (!lines || !abilities || !raceClass || !equipped || !effects) return out;
  const gearLines = new Set([...lines].filter(([, r]) => GEAR_SKILL_CATEGORIES.has(num(r.CategoryID))).map(([id]) => id));
  const proficient = new Set([...effects.values()].filter((e) => num(e.Effect) === PROFICIENCY_EFFECT).map((e) => num(e.SpellID)));
  // The classes that have each line, with the lowest level any row gives them it at.
  const levelOf = new Map<number, Map<number, number>>();
  for (const r of raceClass.values()) {
    const line = num(r.SkillID);
    if (!gearLines.has(line)) continue;
    const by = levelOf.get(line) ?? new Map<number, number>();
    for (const cls of bits(num(r.ClassMask))) by.set(cls, Math.min(by.get(cls) ?? Infinity, num(r.MinLevel)));
    levelOf.set(line, by);
  }
  const allows = new Map<number, [number, number][]>();
  for (const e of equipped.values()) {
    const spell = num(e.SpellID), itemClass = num(e.EquippedItemClass), mask = num(e.EquippedItemSubclass);
    if (itemClass < 0 || mask <= 0) continue;
    const list = allows.get(spell) ?? [];
    for (const b of bits(mask)) list.push([itemClass, b - 1]);
    allows.set(spell, list);
  }
  for (const a of abilities.values()) {
    const line = num(a.SkillLine), spell = num(a.Spell);
    const classes = levelOf.get(line);
    if (!classes || !proficient.has(spell) || !allows.has(spell)) continue;
    const mask = num(a.ClassMask);
    for (const [cls, level] of classes) {
      if (mask !== 0 && !((mask >>> (cls - 1)) & 1)) continue;
      const gear = out.get(cls) ?? new Map<string, number>();
      for (const [itemClass, sub] of allows.get(spell)!) {
        const key = `${itemClass}:${sub}`;
        gear.set(key, Math.min(gear.get(key) ?? Infinity, level));
      }
      out.set(cls, gear);
    }
  }
  return out;
}

export function buildClientClassGear(snapshotPath: string): ClientClassGear {
  const meta = readClientMeta(snapshotPath);
  const present = new Set(readClientTables(snapshotPath));
  const get: Get = (t) => (present.has(t) ? readClientRows(snapshotPath, t) : undefined);
  const byClass = proficienciesByClass(get);
  const chr = [...(get("ChrClasses") ?? [])].sort(([a], [b]) => a - b);
  const classes: ClientClassGear["classes"] = {};
  for (const [id, row] of chr) {
    const slug = String(row.Filename ?? "").toLowerCase();
    if (!slug) continue;
    const gear = [...(byClass.get(id) ?? [])].map(([key, level]): [number, number, number] => {
      const [c, s] = key.split(":").map(Number);
      return [c, s, level];
    }).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    classes[slug] = { id, gear };
  }
  // A mask that keeps every class of the build restricts nothing (the files often set every bit, or 32767).
  const every = chr.reduce((m, [id]) => m | (1 << (id - 1)), 0);
  const sparse = get("ItemSparse") ?? new Map();
  const restricted: Record<string, number> = {};
  for (const [id, row] of [...sparse].sort(([a], [b]) => a - b)) {
    const mask = num(row.AllowableClass);
    if (mask !== -1 && mask !== 0 && (mask & every) !== every) restricted[id] = mask;
  }
  return ClientClassGear.parse({
    schema: CLASS_GEAR_SCHEMA, label: CLIENT_LABEL, credit: GAME_DATA_CREDIT,
    build: { product: meta.product, buildId: meta.buildId, version: meta.version, buildConfig: meta.buildConfig, definitions: meta.definitions, extractedAt: meta.extractedAt },
    classes, restricted,
    note: "proficiencies and class masks are the game files'; races are not told apart",
  });
}

/** One class and one restricted item per line, so a new build's file reads as a line diff in review. */
export function serializeClientClassGear(table: ClientClassGear): string {
  const { classes, restricted, ...head } = table;
  const top = JSON.stringify(head, null, 1).replace(/\n}$/, "");
  const cls = Object.entries(classes).map(([slug, c]) => `  ${JSON.stringify(slug)}: ${JSON.stringify(c)}`);
  const items = Object.entries(restricted).map(([id, mask]) => `  ${JSON.stringify(id)}: ${mask}`);
  return `${top},\n "classes": {\n${cls.join(",\n")}\n },\n "restricted": {\n${items.join(",\n")}\n }\n}\n`;
}

/** Writes the table to `path` (the site's copy is web/src/data/game-data/client-class-gear.json). */
export function writeClientClassGear(snapshotPath: string, path: string): ClientClassGear {
  const table = buildClientClassGear(snapshotPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeClientClassGear(table));
  return table;
}
