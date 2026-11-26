/**
 * Which model pictures to draw, from the client tables and the site's gates. Only NPCs and items the gates
 * list are looked at (docs/ASSETS.md, "Model pictures"): an NPC the site lists, an item 3 installs reported.
 * Nothing found only in the files gets a picture.
 *
 * First set (2026-11-25): creatures whose display is not a dressed humanoid, and items with a model of their
 * own (weapons, shields, off-hands, helmets, shoulders, cloaks). Dressed humanoid NPCs and armour worn on a
 * character come later.
 */
import type { Row, TableReader } from "../talents/build-catalog.js";

export interface RenderTarget {
  kind: "creature" | "item";
  displayId: number;
  modelFileId: number;
  /** File for each texture type the model's slots ask for (2: the item's texture, 11-13: the creature's skins). */
  replaceable: Record<number, number>;
  /** Geoset ids the display chooses (group * 100 + variant); the other groups show variant 1. */
  geosets: number[];
}

export interface RenderPlan {
  /** One per display: creatures, then items, each by display id. */
  targets: RenderTarget[];
  /** NPC id -> creature display id, and item id -> item display id, for the gated ids that have a target. */
  npcs: Map<number, number>;
  items: Map<number, number>;
  skipped: {
    npcsWithoutDisplay: number; npcsHumanoid: number; npcsWithoutModel: number;
    itemsWithoutAppearance: number; itemsTextureOnly: number; itemsWithoutModelFile: number;
  };
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const nums = (v: unknown): number[] => (Array.isArray(v) ? v.map(num) : []);
const rows = (get: TableReader, table: string): Row[] => [...(get(table)?.values() ?? [])];
const by = (list: Row[], key: string) => new Map(list.map((r) => [num(r[key]), r]));
function groupBy(list: Row[], key: string): Map<number, Row[]> {
  const out = new Map<number, Row[]>();
  for (const r of list) { const k = num(r[key]); out.set(k, [...(out.get(k) ?? []), r]); }
  return out;
}

/** Texture slots a creature display fills: TextureVariationFileDataID[0..2] are texture types 11, 12 and 13. */
const CREATURE_SKIN_TYPES = [11, 12, 13];
/** The texture type an item model's own texture fills. */
const ITEM_TEXTURE_TYPE = 2;
/** For models made per race and gender (helmets), the one drawn: a model for any race first, then human, then male. */
const HUMAN = 1;

export function planRenders(get: TableReader, gates: { npcs: ReadonlySet<number>; items: ReadonlySet<number> }): RenderPlan {
  const skipped = { npcsWithoutDisplay: 0, npcsHumanoid: 0, npcsWithoutModel: 0, itemsWithoutAppearance: 0, itemsTextureOnly: 0, itemsWithoutModelFile: 0 };
  const creatures = new Map<number, RenderTarget>();
  const items = new Map<number, RenderTarget>();
  const npcMap = new Map<number, number>();
  const itemMap = new Map<number, number>();

  if (gates.npcs.size) {
    const creatureRows = by(rows(get, "Creature"), "ID");
    const links = groupBy(rows(get, "CreatureXDisplayInfo"), "CreatureID");
    const displays = by(rows(get, "CreatureDisplayInfo"), "ID");
    const models = by(rows(get, "CreatureModelData"), "ID");
    const geosets = groupBy(rows(get, "CreatureDisplayInfoGeosetData"), "CreatureDisplayInfoID");
    for (const npc of [...gates.npcs].sort((a, b) => a - b)) {
      // The client links few NPCs to a display (Creature, mostly companion pets, and CreatureXDisplayInfo); world NPCs' links are on the server.
      const displayId = nums(creatureRows.get(npc)?.DisplayID).find((d) => d > 0)
        ?? [...(links.get(npc) ?? [])].sort((a, b) => num(a.OrderIndex) - num(b.OrderIndex)).map((r) => num(r.CreatureDisplayInfoID)).find((d) => d > 0);
      const display = displayId ? displays.get(displayId) : undefined;
      if (!displayId || !display) { skipped.npcsWithoutDisplay += 1; continue; }
      if (num(display.ExtendedDisplayInfoID) !== 0) { skipped.npcsHumanoid += 1; continue; }
      const modelFileId = num(models.get(num(display.ModelID))?.FileDataID);
      if (!modelFileId) { skipped.npcsWithoutModel += 1; continue; }
      npcMap.set(npc, displayId);
      if (creatures.has(displayId)) continue;
      const replaceable: Record<number, number> = {};
      nums(display.TextureVariationFileDataID).slice(0, CREATURE_SKIN_TYPES.length).forEach((file, i) => { if (file > 0) replaceable[CREATURE_SKIN_TYPES[i]] = file; });
      const chosen = (geosets.get(displayId) ?? []).map((g) => (num(g.GeosetIndex) + 1) * 100 + num(g.GeosetValue)).sort((a, b) => a - b);
      creatures.set(displayId, { kind: "creature", displayId, modelFileId, replaceable, geosets: chosen });
    }
  }

  if (gates.items.size) {
    if (!get("TextureFileData")) throw new Error("the snapshot has no TextureFileData table; run `client-extract --refresh` first");
    const modified = groupBy(rows(get, "ItemModifiedAppearance"), "ItemID");
    const appearances = by(rows(get, "ItemAppearance"), "ID");
    const displays = by(rows(get, "ItemDisplayInfo"), "ID");
    const modelFiles = groupBy(rows(get, "ModelFileData"), "ModelResourcesID");
    const components = by(rows(get, "ComponentModelFileData"), "ID");
    const textures = groupBy(rows(get, "TextureFileData"), "MaterialResourcesID");
    const rank = (fileId: number): number[] => {
      const c = components.get(fileId);
      if (!c) return [0, 0, 0, fileId];
      const race = num(c.RaceID);
      return [race === 0 ? 1 : race === HUMAN ? 2 : 3, num(c.GenderIndex), num(c.PositionIndex), fileId];
    };
    const order = (a: number[], b: number[]) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
    for (const item of [...gates.items].sort((a, b) => a - b)) {
      // The base appearance (modifier 0), else the first the client orders.
      const mod = [...(modified.get(item) ?? [])].sort((a, b) => num(a.ItemAppearanceModifierID) - num(b.ItemAppearanceModifierID) || num(a.OrderIndex) - num(b.OrderIndex))[0];
      const displayId = num(appearances.get(num(mod?.ItemAppearanceID))?.ItemDisplayInfoID);
      const display = displayId ? displays.get(displayId) : undefined;
      if (!display) { skipped.itemsWithoutAppearance += 1; continue; }
      const resources = nums(display.ModelResourcesID);
      const slot = resources.findIndex((r) => r > 0);
      if (slot < 0) { skipped.itemsTextureOnly += 1; continue; }
      const files = (modelFiles.get(resources[slot]) ?? []).map((r) => num(r.FileDataID)).filter((f) => f > 0);
      const modelFileId = files.map(rank).sort(order)[0]?.[3];
      if (!modelFileId) { skipped.itemsWithoutModelFile += 1; continue; }
      itemMap.set(item, displayId);
      if (items.has(displayId)) continue;
      const material = nums(display.ModelMaterialResourcesID)[slot] ?? 0;
      const texture = (textures.get(material) ?? []).map((r) => num(r.FileDataID)).filter((f) => f > 0).sort((a, b) => a - b)[0];
      items.set(displayId, { kind: "item", displayId, modelFileId, replaceable: texture ? { [ITEM_TEXTURE_TYPE]: texture } : {}, geosets: [] });
    }
  }

  const sorted = (m: Map<number, RenderTarget>) => [...m.values()].sort((a, b) => a.displayId - b.displayId);
  return { targets: [...sorted(creatures), ...sorted(items)], npcs: npcMap, items: itemMap, skipped };
}
