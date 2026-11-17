/**
 * Terrain and the gear that depends on it. WoW: Forever gives some item effects a kind of ground to work on ("in
 * Desert areas", "doubled in Strongholds and Cities"): the spell that carries the bonus names an area group
 * (`SpellCastingRequirements.RequiredAreasID`) and `AreaGroupMember` lists the group's areas. This file keeps each
 * group the spells' own text names (the terrain types), with the zones it lists whole (UiMap ids), the zones it lists
 * only parts of (with those parts' area names, through `AreaTable.ParentAreaID` to the area a zone shows) and the
 * instances (map ids) of its areas, and every item effect that needs a terrain type or
 * changes speed: its spell, how it fires, the group it needs, and which speed it changes by how much (`SpellEffect`
 * aura and base points). A speed effect bound to a group the text does not name (a zone list, as on the Staff of
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
import { CLIENT_LABEL } from "./edges.js";
import { placeUiMaps, zoneOfAreaChain } from "./world-map-data.js";

export const TERRAIN_SCHEMA = "everloot.client-terrain/1";

/** `ItemEffect.TriggerType`: 0 on use, 1 on equip. Chance on hit (2) and the recipe learn trigger (6) are not read. */
const TRIGGERS: Record<number, "use" | "equip"> = { 0: "use", 1: "equip" };
/** `SpellEffect.EffectAura` of the speed auras: run speed, mounted speed and swim speed. */
export const SPEED_AURAS: Record<number, "run" | "mount" | "swim"> = { 31: "run", 129: "run", 32: "mount", 130: "mount", 58: "swim" };
/** `SpellEffect.Effect` 6 applies an aura. */
const APPLY_AURA = 6;
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
  z.number().int(), z.number().int(), z.enum(["use", "equip"]), z.number().int().nullable(),
  z.enum(["run", "mount", "swim"]).nullable(), z.number().nullable(),
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
  note: z.literal("ids, numbers, area names and the terrain words are the game files'; item and spell names follow the site's name rules"),
});
export type ClientTerrain = z.infer<typeof ClientTerrain>;
export type TerrainItem = z.infer<typeof TerrainItem>;

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
  const { areaGroups, items, ...head } = table;
  const top = JSON.stringify(head, null, 1).replace(/\n}$/, "");
  const groups = Object.keys(areaGroups).sort((a, b) => Number(a) - Number(b)).map((id) => `  ${JSON.stringify(id)}: ${JSON.stringify(areaGroups[id])}`);
  return `${top},\n "areaGroups": {\n${groups.join(",\n")}\n },\n "items": [\n${items.map((r) => `  ${JSON.stringify(r)}`).join(",\n")}\n ]\n}\n`;
}

export function buildClientTerrain(snapshotPath: string): ClientTerrain {
  const meta = readClientMeta(snapshotPath);
  const present = new Set(readClientTables(snapshotPath));
  const get = (t: string): Rows => (present.has(t) ? readClientRows(snapshotPath, t) : new Map());
  const itemRows = get("Item"), itemEffects = get("ItemEffect"), spellEffects = get("SpellEffect");
  const requirements = get("SpellCastingRequirements"), spellText = get("Spell"), areas = get("AreaTable");
  const maps = get("Map"), uiMaps = get("UiMap");

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

  // The group an item's spell needs: its own, or that of a spell it triggers (Mirage Mirror's desert bonus).
  const neededGroup = (spell: number): { group: number; spell: number } | null => {
    if (groupOf.has(spell)) return { group: groupOf.get(spell)!, spell };
    for (const e of effectsOf.get(spell) ?? []) {
      const t = num(e.EffectTriggerSpell);
      if (t && groupOf.has(t)) return { group: groupOf.get(t)!, spell: t };
    }
    return null;
  };
  const speedOf = (spell: number): { kind: "run" | "mount" | "swim"; percent: number } | null => {
    for (const e of [...(effectsOf.get(spell) ?? [])].sort((a, b) => Number(a.EffectIndex) - Number(b.EffectIndex))) {
      const kind = SPEED_AURAS[Number(e.EffectAura)];
      const percent = num(e.EffectBasePointsF);
      if (num(e.Effect) === APPLY_AURA && kind && percent !== null && percent > 0) return { kind, percent };
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
    if (!trigger || !spell) continue;
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
  // Kept: an effect bound to a named terrain, and a speed effect (with its zone list when it has one).
  const items = candidates.map((c) => c.row).filter((r) => (r[3] !== null && nameOf(r[3]) !== null) || r[4] !== null);

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
  for (const group of [...new Set(items.map((r) => r[3]).filter((g): g is number => g !== null))].sort((a, b) => a - b)) {
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
