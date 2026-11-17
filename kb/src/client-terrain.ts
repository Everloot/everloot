/**
 * Terrain and the gear that depends on it. WoW: Forever gives some item effects a kind of ground to work on ("in
 * Desert areas", "doubled in Strongholds and Cities"): the spell that carries the bonus names an area group
 * (`SpellCastingRequirements.RequiredAreasID`) and `AreaGroupMember` lists the group's areas. This file keeps each
 * group the spells' own text names (the terrain types), with the zones it lists whole (UiMap ids), the zones it lists
 * only parts of (with those parts' area names, through `AreaTable.ParentAreaID` to the area a zone shows) and the
 * instances (map ids) of its areas, and every item effect that needs a terrain type or
 * changes speed: its spell, how it fires (use, equip, chance on hit), the group it needs, and which speed it changes
 * by how much (`SpellEffect` aura and base points), following the spells it triggers and the enchantment it applies
 * (Mithril Spurs, the boot speed enchants); and the item set bonuses that do the same (`ItemSetSpell`, `ItemSet`). A speed effect bound to a group the text does not name (a zone list, as on the Staff of
 * Westfall) keeps that group too.
 *
 * Ids, numbers, area names and the terrain words only: item names, spell names and spell text stay in private storage
 * (docs/DATA_POLICY.md); a page names the item and its spell under the site's name rules. Blizzard's data,
 * labelled "found in game files, unconfirmed". The build watch regenerates it with every new build.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { GAME_DATA_CREDIT } from "@everloot/protocol";
import { readClientMeta, readClientRows, readClientTables } from "./client-snapshot.js";
import { isDevelopmentItemName } from "./dev-item-names.js";
import { CLIENT_LABEL } from "./edges.js";
import { placeUiMaps, zoneOfAreaChain } from "./world-map-data.js";

export const TERRAIN_SCHEMA = "everloot.client-terrain/1";

/** `ItemEffect.TriggerType`: 0 on use, 1 on equip, 2 chance on hit. The recipe learn trigger (6) is not read. */
const TRIGGERS: Record<number, "use" | "equip" | "hit"> = { 0: "use", 1: "equip", 2: "hit" };
/** `SpellEffect.Effect` 53 and 54 enchant an item (permanent, temporary) with the enchantment in `EffectMiscValue[0]`. */
const ENCHANT_ITEM = new Set([53, 54]);
/** `SpellItemEnchantment.Effect`: 1 a spell on hit, 3 a spell while equipped, 7 a spell on use. */
const ENCHANT_SPELL = new Set([1, 3, 7]);
/** How deep a spell's triggers and enchantments are followed: item spell, then two more steps. */
const REACH = 2;
/** `SpellEffect.EffectAura` of the speed auras: run speed, mounted speed and swim speed. */
export const SPEED_AURAS: Record<number, "run" | "mount" | "swim"> = { 31: "run", 129: "run", 32: "mount", 130: "mount", 58: "swim" };
/** `SpellEffect.Effect` 6 applies an aura. */
const APPLY_AURA = 6;
/** `SpellEffect.EffectAura` 78 mounts the caster: the spell summons a mount. */
const MOUNTED = 78;
/** `SpellEffect.EffectAura` 4 is a dummy: a number the text prints, worked by the server. */
const DUMMY = 4;
const UI_MAP_ZONE = 3;

const AreaGroup = z.object({
  /** The words the spells' text uses for the group ("Desert", "Strongholds and Cities"); null for a zone list. */
  name: z.string().nullable(),
  /** Zones (UiMap ids) the group lists whole: the zone's own area is a member. Ascending. */
  zones: z.array(z.number().int()),
  /** Zones the group lists only part of, by UiMap id: the names of the member areas inside them ("Everlook"). */
  parts: z.record(z.string(), z.array(z.string())),
  /** Instances (map ids) of the group's areas, ascending. */
  instances: z.array(z.number().int()),
});

/** One effect of one item: `[itemId, spellId, trigger, areaGroupId | null, speed kind | null, percent | null]`. */
const TerrainItem = z.tuple([
  z.number().int(), z.number().int(), z.enum(["use", "equip", "hit"]), z.number().int().nullable(),
  z.enum(["run", "mount", "swim"]).nullable(), z.number().nullable(),
]);

/** One set bonus: `[setId, spellId, pieces needed, areaGroupId | null, speed kind | null, percent | null, [piece item ids]]`. */
const TerrainSet = z.tuple([
  z.number().int(), z.number().int(), z.number().int(), z.number().int().nullable(),
  z.enum(["run", "mount", "swim"]).nullable(), z.number().nullable(), z.array(z.number().int()),
]);

export const ClientTerrain = z.object({
  schema: z.literal(TERRAIN_SCHEMA),
  label: z.literal(CLIENT_LABEL),
  credit: z.string(),
  build: z.object({
    product: z.string(), buildId: z.number().int(), version: z.string(), buildConfig: z.string(),
    definitions: z.string().nullable(), extractedAt: z.string(),
  }),
  /** The area groups the items below need, by group id. */
  areaGroups: z.record(z.string(), AreaGroup),
  /** Item effects that need a terrain type or change speed, by item and spell id. */
  items: z.array(TerrainItem),
  /** Item set bonuses that need a terrain type or change speed (`ItemSetSpell`), by set and spell id. */
  sets: z.array(TerrainSet),
  note: z.literal("ids, numbers, area names and the terrain words are the game files'; item and spell names follow the site's name rules"),
});
export type ClientTerrain = z.infer<typeof ClientTerrain>;
export type TerrainItem = z.infer<typeof TerrainItem>;
export type TerrainSet = z.infer<typeof TerrainSet>;

type Rows = Map<number, Record<string, unknown>>;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * The terrain words of a spell's text: "Desert" from "in Desert areas", "Wasteland and Haunted" from "doubled in
 * Wasteland and Haunted areas", "Strongholds and Cities" from "doubled in Strongholds and Cities.". Null when the text
 * names no kind of ground. A place name ("in Tanaris") is not followed by "areas" and is no "X and Y" pair, so it is
 * not read as one.
 */
export function terrainWord(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const m = /\bin ([A-Z][a-z]+(?: (?:and|or) [A-Z][a-z]+)*) areas\b/.exec(text)
    ?? /\bin ([A-Z][a-z]+ (?:and|or) [A-Z][a-z]+)[.,]/.exec(text);
  return m ? m[1]! : null;
}

/** One group per line and one item effect per line, so a new build's file reads as a line diff in review. */
export function serializeClientTerrain(table: ClientTerrain): string {
  const { areaGroups, items, sets, ...head } = table;
  const top = JSON.stringify(head, null, 1).replace(/\n}$/, "");
  const groups = Object.keys(areaGroups).sort((a, b) => Number(a) - Number(b)).map((id) => `  ${JSON.stringify(id)}: ${JSON.stringify(areaGroups[id])}`);
  const list = (rows: unknown[]) => rows.map((r) => `  ${JSON.stringify(r)}`).join(",\n");
  return `${top},\n "areaGroups": {\n${groups.join(",\n")}\n },\n "items": [\n${list(items)}\n ],\n "sets": [\n${list(sets)}\n ]\n}\n`;
}

export function buildClientTerrain(snapshotPath: string): ClientTerrain {
  const meta = readClientMeta(snapshotPath);
  const present = new Set(readClientTables(snapshotPath));
  const get = (t: string): Rows => (present.has(t) ? readClientRows(snapshotPath, t) : new Map());
  const itemRows = get("Item"), itemEffects = get("ItemEffect"), spellEffects = get("SpellEffect");
  const requirements = get("SpellCastingRequirements"), spellText = get("Spell"), areas = get("AreaTable");
  const maps = get("Map"), uiMaps = get("UiMap"), enchantments = get("SpellItemEnchantment");
  const sparse = get("ItemSparse"), spellNames = get("SpellName");
  // Test and placeholder rows stay out: an item the dev-name rule marks, or a QA spell ("QAEnchant Boots +8% Speed").
  const development = (itemId: number, spell: number) =>
    isDevelopmentItemName(sparse.get(itemId)?.Display_lang as string | undefined) || /^QA/.test(String(spellNames.get(spell)?.Name_lang ?? ""));

  const effectsOf = new Map<number, Record<string, unknown>[]>();
  for (const e of spellEffects.values()) {
    // Base difficulty only, as the tooltips read it.
    if (num(e.DifficultyID) !== 0) continue;
    const spell = num(e.SpellID);
    if (spell !== null) effectsOf.set(spell, [...(effectsOf.get(spell) ?? []), e]);
  }
  const groupOf = new Map<number, number>();
  for (const r of requirements.values()) {
    const spell = num(r.SpellID), group = num(r.RequiredAreasID);
    if (spell !== null && group) groupOf.set(spell, group);
  }
  // The words of each spell's text, and of the texts that quote it ("$1315971s1 ... in Forest and Grassland areas"):
  // the bonus often sits on a second spell whose own text is empty.
  const wordsOf = new Map<number, string[]>();
  const add = (spell: number, word: string | null) => { if (word) wordsOf.set(spell, [...(wordsOf.get(spell) ?? []), word]); };
  for (const [id, row] of spellText) {
    const word = terrainWord(row.Description_lang);
    if (!word) continue;
    add(id, word);
    for (const m of String(row.Description_lang).matchAll(/\$(\d+)[a-z]/g)) if (Number(m[1]) !== id) add(Number(m[1]), word);
  }

  const byIndex = (spell: number) => [...(effectsOf.get(spell) ?? [])].sort((a, b) => Number(a.EffectIndex) - Number(b.EffectIndex));
  // The spells an item's spell reaches, in order: itself, the spells it triggers (Mirage Mirror's desert bonus,
  // Transformative Cocoon's sprint) and the spells of the enchantment it puts on an item (Mithril Spurs, the boot
  // speed enchants), up to REACH steps.
  const reached = (spell: number): number[] => {
    const out = [spell];
    const depth = new Map([[spell, 0]]);
    for (let i = 0; i < out.length; i++) {
      const at = out[i]!, d = depth.get(at)!;
      if (d >= REACH) continue;
      const next: number[] = [];
      for (const e of byIndex(at)) {
        const t = num(e.EffectTriggerSpell);
        if (t) next.push(t);
        const misc = Array.isArray(e.EffectMiscValue) ? num(e.EffectMiscValue[0]) : null;
        const enchant = ENCHANT_ITEM.has(Number(e.Effect)) && misc ? enchantments.get(misc) : undefined;
        if (!enchant) continue;
        const kinds = Array.isArray(enchant.Effect) ? enchant.Effect : [], args = Array.isArray(enchant.EffectArg) ? enchant.EffectArg : [];
        args.forEach((a, k) => { if (ENCHANT_SPELL.has(Number(kinds[k])) && num(a)) next.push(Number(a)); });
      }
      for (const n of next) if (!depth.has(n)) { depth.set(n, d + 1); out.push(n); }
    }
    return out;
  };
  // The group an item's spell needs: the first spell it reaches that names one.
  const neededGroup = (spell: number): { group: number; spell: number } | null => {
    const s = reached(spell).find((r) => groupOf.has(r));
    return s === undefined ? null : { group: groupOf.get(s)!, spell: s };
  };
  // The speed an item's spell gives: the first speed aura among the spells it reaches. A mount summon (aura 78) is a
  // mount, not speed gear. The percent is the one the spell's own text prints ("Swim speed increased by $s1%"), which
  // can sit on another effect of the spell than the aura (the Cloak of Hermitic Bliss's 33%, not its aura's 78).
  const speedOf = (spell: number): { kind: "run" | "mount" | "swim"; percent: number } | null => {
    for (const s of reached(spell)) {
      const effects = byIndex(s);
      if (effects.some((e) => num(e.EffectAura) === MOUNTED)) continue;
      // The effects the text prints as a percent ("$s1%", "$s2%"); of those, the first speed aura or dummy is the speed.
      const quoted = [...String(spellText.get(s)?.Description_lang ?? "").matchAll(/\$s(\d)%/g)]
        .map((m) => effects.find((e) => num(e.EffectIndex) === Number(m[1]) - 1))
        .filter((e): e is Record<string, unknown> => e !== undefined);
      const quotedSpeed = quoted.find((e) => num(e.EffectAura) === DUMMY || SPEED_AURAS[Number(e.EffectAura)]);
      // Text that prints only another kind of effect ("speed while walking backwards", aura 527) is not this speed.
      if (quoted.length && !quotedSpeed) continue;
      const shown = num(quotedSpeed?.EffectBasePointsF);
      for (const e of effects) {
        const kind = SPEED_AURAS[Number(e.EffectAura)];
        const percent = shown !== null && shown > 0 ? shown : num(e.EffectBasePointsF);
        if (num(e.Effect) === APPLY_AURA && kind && percent !== null && percent > 0) return { kind, percent };
      }
    }
    return null;
  };

  // Every item effect that needs a group or changes speed, with the words its spells use for the group.
  const candidates: { row: TerrainItem; words: string[] }[] = [];
  const seen = new Set<string>();
  for (const x of [...get("ItemXItemEffect").values()].sort((a, b) => Number(a.ItemID) - Number(b.ItemID) || Number(a.ItemEffectID) - Number(b.ItemEffectID))) {
    const itemId = num(x.ItemID), effect = itemEffects.get(Number(x.ItemEffectID));
    // An item the build lists (`Item`); many Forever items have no readable ItemSparse row, so no name is required.
    if (itemId === null || !effect || !itemRows.has(itemId)) continue;
    const trigger = TRIGGERS[Number(effect.TriggerType)], spell = num(effect.SpellID);
    if (!trigger || !spell || development(itemId, spell)) continue;
    const need = neededGroup(spell), speed = speedOf(spell);
    if (!need && !speed) continue;
    const key = `${itemId}:${spell}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const words = need ? [...new Set([spell, need.spell])].flatMap((s) => wordsOf.get(s) ?? []) : [];
    candidates.push({ row: [itemId, spell, trigger, need?.group ?? null, speed?.kind ?? null, speed?.percent ?? null], words });
  }

  // An effect whose spells say nothing borrows the words of the same item's other effects: the Black Horn Necklace's
  // text sits on one effect and its area group on the other.
  const itemWords = new Map<number, string[]>();
  for (const [itemId, effect] of [...get("ItemXItemEffect").values()].map((x) => [num(x.ItemID), itemEffects.get(Number(x.ItemEffectID))] as const)) {
    const spell = num(effect?.SpellID);
    if (itemId !== null && spell && wordsOf.has(spell)) itemWords.set(itemId, [...(itemWords.get(itemId) ?? []), ...wordsOf.get(spell)!]);
  }
  // A group's name: the words most of its effects use; a tie goes to the shorter, then the first alphabetically.
  const counts = new Map<number, Map<string, number>>();
  for (const { row, words } of candidates) {
    if (row[3] === null) continue;
    const c = counts.get(row[3]) ?? new Map<string, number>();
    for (const w of words.length ? words : itemWords.get(row[0]) ?? []) c.set(w, (c.get(w) ?? 0) + 1);
    counts.set(row[3], c);
  }
  const nameOf = (group: number) => [...(counts.get(group) ?? [])]
    .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
  // Set bonuses, by the same rules: the bonus spell, the pieces it needs and the set's pieces.
  const setCandidates: { row: TerrainSet; words: string[] }[] = [];
  const itemSets = get("ItemSet");
  for (const b of [...get("ItemSetSpell").values()].sort((p, q) => Number(p.ItemSetID) - Number(q.ItemSetID) || Number(p.SpellID) - Number(q.SpellID))) {
    const setId = num(b.ItemSetID), spell = num(b.SpellID), set = setId === null ? undefined : itemSets.get(setId);
    if (setId === null || !spell || !set) continue;
    const need = neededGroup(spell), speed = speedOf(spell);
    if (!need && !speed) continue;
    const pieces = (Array.isArray(set.ItemID) ? set.ItemID : []).map(Number).filter((id) => id > 0 && itemRows.has(id));
    if (!pieces.length) continue;
    const words = need ? [...new Set([spell, need.spell])].flatMap((s) => wordsOf.get(s) ?? []) : [];
    setCandidates.push({ row: [setId, spell, num(b.Threshold) ?? 0, need?.group ?? null, speed?.kind ?? null, speed?.percent ?? null, pieces], words });
  }
  for (const { row, words } of setCandidates) {
    if (row[3] === null) continue;
    const c = counts.get(row[3]) ?? new Map<string, number>();
    for (const w of words) c.set(w, (c.get(w) ?? 0) + 1);
    counts.set(row[3], c);
  }
  // Kept: an effect bound to a named terrain, and a speed effect (with its zone list when it has one).
  const keep = (group: number | null, kind: string | null) => (group !== null && nameOf(group) !== null) || kind !== null;
  const items = candidates.map((c) => c.row).filter((r) => keep(r[3], r[4]));
  const sets = setCandidates.map((c) => c.row).filter((r) => keep(r[3], r[4]));

  // Which zone shows each area: zone-type UiMaps placed on a map, by the area their assignment shows.
  const zoneOfArea = new Map<number, number>();
  const zoneMaps = new Set([...uiMaps.values()].filter((u) => num(u.Type) === UI_MAP_ZONE).map((u) => Number(u.ID)));
  for (const [uiMapId, at] of placeUiMaps([...get("UiMapAssignment").values()])) {
    if (zoneMaps.has(uiMapId) && at.areaId && !zoneOfArea.has(at.areaId)) zoneOfArea.set(at.areaId, uiMapId);
  }
  const instanceMaps = new Set([...maps.values()].filter((m) => m.InstanceType === 1 || m.InstanceType === 2).map((m) => Number(m.ID)));
  const members = new Map<number, number[]>();
  for (const m of get("AreaGroupMember").values()) {
    const group = num(m.AreaGroupID), area = num(m.AreaID);
    if (group !== null && area !== null) members.set(group, [...(members.get(group) ?? []), area]);
  }

  const areaGroups: ClientTerrain["areaGroups"] = {};
  for (const group of [...new Set([...items, ...sets].map((r) => r[3]).filter((g): g is number => g !== null))].sort((a, b) => a - b)) {
    const zones = new Set<number>(), instances = new Set<number>(), parts = new Map<number, Set<string>>();
    for (const area of members.get(group) ?? []) {
      const continent = num(areas.get(area)?.ContinentID);
      if (continent !== null && instanceMaps.has(continent)) { instances.add(continent); continue; }
      const zone = zoneOfAreaChain(area, areas, zoneOfArea);
      if (zone === null) continue;
      if (zoneOfArea.get(area) === zone) { zones.add(zone); continue; }
      const name = areas.get(area)?.AreaName_lang;
      if (typeof name === "string" && name.trim()) parts.set(zone, (parts.get(zone) ?? new Set()).add(name.trim()));
    }
    for (const zone of zones) parts.delete(zone);
    areaGroups[group] = {
      name: nameOf(group), zones: [...zones].sort((a, b) => a - b),
      parts: Object.fromEntries([...parts].sort((a, b) => a[0] - b[0]).map(([zone, names]) => [String(zone), [...names].sort()])),
      instances: [...instances].sort((a, b) => a - b),
    };
  }

  return ClientTerrain.parse({
    schema: TERRAIN_SCHEMA, label: CLIENT_LABEL, credit: GAME_DATA_CREDIT,
    build: { product: meta.product, buildId: meta.buildId, version: meta.version, buildConfig: meta.buildConfig, definitions: meta.definitions, extractedAt: meta.extractedAt },
    areaGroups,
    items,
    sets,
    note: "ids, numbers, area names and the terrain words are the game files'; item and spell names follow the site's name rules",
  });
}

/** Writes the table to `path` (the site's copy is web/src/data/game-data/client-terrain.json). */
export function writeClientTerrain(snapshotPath: string, path: string): ClientTerrain {
  const table = buildClientTerrain(snapshotPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeClientTerrain(table));
  return table;
}
