/**
 * The numbers a spell's tooltip is made of, for the spells the site links to: its school (`SpellMisc.SchoolMask`), the
 * level it is learned at (`SpellLevels`), its cast time (`SpellCastTimes`), range in yards (`SpellRange`, hostile first,
 * with the melee flag), cooldown (`SpellCooldowns`, the longer of the spell's own and its category's), duration
 * (`SpellDuration`), costs (`SpellPower`: power type, amount in the game's units, percent of base mana), whether it is
 * passive or channeled (`SpellMisc.Attributes`), its dispel type and mechanic (`SpellCategories`), the rank it replaces
 * (`SkillLineAbility.SupercedesSpell`), its effect values (`SpellEffect`, as the talent catalog reads them) and the
 * items whose Use, Equip or Chance on hit line casts it (`ItemEffect` through `ItemXItemEffect`).
 *
 * "Linked" means a skill line lists it (class spells and recipes), a talent is it, a mount or companion pet summons it,
 * an item set bonus is it, or an item's Use, Equip or Chance on hit line casts it; a spell the files do not name is left
 * out. The base difficulty only. A field the files leave at zero is left out of its spell.
 *
 * No spell names, rank text or descriptions: those stay in private storage (docs/DATA_POLICY.md, "Item set and spell
 * names from the game files"). The power type tags, dispel type names and mechanic names are the files' own short
 * labels. Blizzard's data, labelled "found in game files, unconfirmed"; the spell pages read it. The build watch
 * regenerates it.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { GAME_DATA_CREDIT } from "@everloot/protocol";
import { readClientMeta, readClientRows, readClientTables } from "./client-snapshot.js";
import { CLIENT_LABEL } from "./edges.js";

export const SPELLS_SCHEMA = "everloot.client-spells/1";

const Id = z.number().int();
const Flag = z.literal(1);

/** One spell's numbers. Every field is left out when the files give nothing (zero) for it. */
export const ClientSpell = z.object({
  /** SpellMisc.SchoolMask: 1 physical, 2 holy, 4 fire, 8 nature, 16 frost, 32 shadow, 64 arcane. */
  school: Id.optional(),
  level: Id.optional(),
  castMs: Id.optional(),
  /** [min yards, max yards], with a third 1 when the files mark it melee range. */
  range: z.union([z.tuple([z.number(), z.number()]), z.tuple([z.number(), z.number(), Flag])]).optional(),
  cooldownMs: Id.optional(),
  /** -1: until cancelled. */
  durationMs: Id.optional(),
  /** [power type, amount in the game's units, percent of base mana], in the files' order. */
  costs: z.array(z.tuple([Id, z.number(), z.number()])).optional(),
  passive: Flag.optional(),
  channeled: Flag.optional(),
  dispel: Id.optional(),
  mechanic: Id.optional(),
  /** The spell this one replaces on its skill line: the rank before it. */
  supersedes: Id.optional(),
  /** [effect index, base points, die sides, period ms, chain targets, radius yards, variance], effects with a value only. */
  effects: z.array(z.tuple([Id, z.number(), z.number(), z.number(), z.number(), z.number(), z.number()])).optional(),
  /** [item id, trigger]: 0 Use, 1 Equip, 2 Chance on hit; by item id. */
  items: z.array(z.tuple([Id, Id])).optional(),
});
export type ClientSpell = z.infer<typeof ClientSpell>;

export const ClientSpells = z.object({
  schema: z.literal(SPELLS_SCHEMA),
  label: z.literal(CLIENT_LABEL),
  credit: z.string(),
  build: z.object({
    product: z.string(), buildId: z.number().int(), version: z.string(), buildConfig: z.string(),
    definitions: z.string().nullable(), extractedAt: z.string(),
  }),
  note: z.literal("numbers and ids only; spell names, rank text and descriptions are not in this file"),
  /** PowerType.PowerTypeEnum → its tag (MANA, RAGE, ENERGY, FOCUS). */
  powerTypes: z.record(z.string(), z.string()),
  /** SpellDispelType names, None left out. */
  dispelTypes: z.record(z.string(), z.string()),
  /** SpellMechanic state names. */
  mechanics: z.record(z.string(), z.string()),
  spells: z.record(z.string(), ClientSpell),
});
export type ClientSpells = z.infer<typeof ClientSpells>;

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
/** The tables store floats as 32-bit: four decimals keep every value the tooltip prints and drop the noise. */
const dec = (v: unknown) => Math.round(num(v) * 1e4) / 1e4;
const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : 0);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const arr = (v: unknown) => (Array.isArray(v) ? v : [v]);
const base = (r: Record<string, unknown>) => int(r.DifficultyID) === 0;

/** SpellMisc.Attributes bits: word 0 0x40 passive; word 1 0x4 or 0x40 channeled. */
const PASSIVE = 0x40;
const CHANNELED = 0x44;

export function buildClientSpells(snapshotPath: string): ClientSpells {
  const meta = readClientMeta(snapshotPath);
  const present = new Set(readClientTables(snapshotPath));
  const rows = (t: string) => (present.has(t) ? [...readClientRows(snapshotPath, t).values()] : []);
  const bySpell = (t: string) => {
    const out = new Map<number, Record<string, unknown>[]>();
    for (const r of rows(t)) {
      if (!base(r)) continue;
      const id = int(r.SpellID);
      if (id > 0) out.set(id, [...(out.get(id) ?? []), r]);
    }
    return out;
  };
  const byId = (t: string) => new Map(rows(t).map((r) => [int(r.ID), r]));

  const named = new Set(rows("SpellName").filter((r) => str(r.Name_lang)).map((r) => int(r.ID)));
  const linked = new Set<number>();
  const link = (id: number) => { if (id > 0 && named.has(id)) linked.add(id); };
  const supersedes = new Map<number, number>();
  for (const r of rows("SkillLineAbility")) {
    const spell = int(r.Spell), prev = int(r.SupercedesSpell);
    link(spell);
    if (spell > 0 && prev > 0 && prev !== spell) { link(prev); supersedes.set(spell, prev); }
  }
  for (const r of rows("TraitDefinition")) link(int(r.SpellID));
  for (const r of rows("Mount")) link(int(r.SourceSpellID));
  for (const r of rows("BattlePetSpecies")) link(int(r.SummonSpellID));
  for (const r of rows("ItemSetSpell")) link(int(r.SpellID));
  const effectItems = new Map<number, number[]>();
  for (const r of rows("ItemXItemEffect")) {
    const effect = int(r.ItemEffectID), item = int(r.ItemID);
    if (effect > 0 && item > 0) effectItems.set(effect, [...(effectItems.get(effect) ?? []), item]);
  }
  const items = new Map<number, [number, number][]>();
  for (const r of rows("ItemEffect")) {
    const trigger = int(r.TriggerType), spell = int(r.SpellID);
    if (trigger < 0 || trigger > 2 || spell <= 0) continue;
    link(spell);
    for (const item of effectItems.get(int(r.ID)) ?? []) items.set(spell, [...(items.get(spell) ?? []), [item, trigger]]);
  }

  const misc = bySpell("SpellMisc"), power = bySpell("SpellPower"), cooldowns = bySpell("SpellCooldowns");
  const categories = bySpell("SpellCategories"), levels = bySpell("SpellLevels"), effects = bySpell("SpellEffect");
  const castTimes = byId("SpellCastTimes"), durations = byId("SpellDuration"), ranges = byId("SpellRange");
  const radius = new Map(rows("SpellRadius").map((r) => [int(r.ID), num(r.Radius)]));
  const powerTypes = rows("PowerType");
  const modifier = new Map(powerTypes.map((r) => [int(r.PowerTypeEnum), num(r.DisplayModifier) || 1]));

  // SpellLevel 1 with no BaseLevel is the files' default, not a level: the rune abilities, pet abilities and procs on
  // the class skill lines read it (Fel Armor, 403619), while every trained spell gives a BaseLevel too.
  const levelOf = (id: number) => {
    const row = levels.get(id)?.[0];
    const lv = int(row?.SpellLevel);
    return lv === 1 && !int(row?.BaseLevel) ? 0 : lv;
  };
  const spells: Record<string, ClientSpell> = {};
  for (const id of [...linked].sort((a, b) => a - b)) {
    const s: ClientSpell = {};
    const m = misc.get(id)?.[0];
    if (m) {
      if (int(m.SchoolMask)) s.school = int(m.SchoolMask);
      const attrs = arr(m.Attributes).map(int);
      const lv = levelOf(id);
      if (lv) s.level = lv;
      const cast = int(castTimes.get(int(m.CastingTimeIndex))?.Base);
      if (cast > 0) s.castMs = cast;
      const r = ranges.get(int(m.RangeIndex));
      if (r) {
        const max = arr(r.RangeMax).map(num), min = arr(r.RangeMin).map(num);
        const side = max[0] ? 0 : 1;
        if (max[side]) s.range = int(r.Flags) & 1 ? [min[side] ?? 0, max[side]!, 1] : [min[side] ?? 0, max[side]!];
      }
      const cd = Math.max(0, ...(cooldowns.get(id) ?? []).map((c) => Math.max(int(c.RecoveryTime), int(c.CategoryRecoveryTime))));
      if (cd) s.cooldownMs = cd;
      const dur = int(durations.get(int(m.DurationIndex))?.Duration);
      if (dur) s.durationMs = dur;
      const costs = (power.get(id) ?? [])
        .sort((a, b) => int(a.OrderIndex) - int(b.OrderIndex))
        .map((p): [number, number, number] => [int(p.PowerType), num(p.ManaCost) / (modifier.get(int(p.PowerType)) ?? 1), num(p.PowerCostPct)])
        .filter(([, amount, pct]) => amount > 0 || pct > 0);
      if (costs.length) s.costs = costs;
      if ((attrs[0] ?? 0) & PASSIVE) s.passive = 1;
      if ((attrs[1] ?? 0) & CHANNELED) s.channeled = 1;
    } else {
      const lv = levelOf(id);
      if (lv) s.level = lv;
    }
    const c = categories.get(id)?.[0];
    if (int(c?.DispelType)) s.dispel = int(c!.DispelType);
    if (int(c?.Mechanic)) s.mechanic = int(c!.Mechanic);
    if (supersedes.has(id)) s.supersedes = supersedes.get(id)!;
    const fx = (effects.get(id) ?? [])
      .map((e): [number, number, number, number, number, number, number] => [
        int(e.EffectIndex),
        dec(typeof e.EffectBasePointsF === "number" ? e.EffectBasePointsF : e.EffectBasePoints),
        num(e.EffectDieSides), num(e.EffectAuraPeriod), num(e.EffectChainTargets),
        Math.max(0, ...arr(e.EffectRadiusIndex).map((i) => radius.get(int(i)) ?? 0)), dec(e.Variance),
      ])
      .filter(([, ...values]) => values.some((v) => v !== 0))
      .sort((a, b) => a[0] - b[0]);
    if (fx.length) s.effects = fx;
    const used = items.get(id);
    if (used) s.items = used.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    spells[String(id)] = s;
  }

  const names = (list: Record<string, unknown>[], key: string, skipZero: boolean) =>
    Object.fromEntries(list.filter((r) => str(r[key]) && !(skipZero && int(r.ID) === 0)).sort((a, b) => int(a.ID) - int(b.ID)).map((r) => [String(int(r.ID)), str(r[key])]));

  return ClientSpells.parse({
    schema: SPELLS_SCHEMA, label: CLIENT_LABEL, credit: GAME_DATA_CREDIT,
    build: { product: meta.product, buildId: meta.buildId, version: meta.version, buildConfig: meta.buildConfig, definitions: meta.definitions, extractedAt: meta.extractedAt },
    note: "numbers and ids only; spell names, rank text and descriptions are not in this file",
    powerTypes: Object.fromEntries(powerTypes.filter((r) => str(r.NameGlobalStringTag)).sort((a, b) => int(a.PowerTypeEnum) - int(b.PowerTypeEnum)).map((r) => [String(int(r.PowerTypeEnum)), str(r.NameGlobalStringTag)])),
    dispelTypes: names(rows("SpellDispelType"), "Name_lang", true),
    mechanics: names(rows("SpellMechanic"), "StateName_lang", true),
    spells,
  });
}

/** One spell per line, so a new build's file reads as a line diff in review. */
export function serializeClientSpells(table: ClientSpells): string {
  const { spells, ...head } = table;
  const top = JSON.stringify(head, null, 1).replace(/\n}$/, "");
  const ids = Object.keys(spells).sort((a, b) => Number(a) - Number(b));
  return `${top},\n "spells": {\n${ids.map((id) => `  ${JSON.stringify(id)}: ${JSON.stringify(spells[id])}`).join(",\n")}\n }\n}\n`;
}

/** Writes the table to `path` (the site's copy is web/src/data/game-data/client-spells.json). */
export function writeClientSpells(snapshotPath: string, path: string): ClientSpells {
  const table = buildClientSpells(snapshotPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeClientSpells(table));
  return table;
}
