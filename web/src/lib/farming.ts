import { CLIENT_TAXONOMY } from "./items";
import { agreedGatherKinds, objectSpawns, type ObjectSpawnRow } from "../../../kb/src/object-spawns";
import type { NpcRow } from "./world-lists";
import type { ZoneSummary } from "./zones";

/**
 * What players farm, in the order the farming page shows it: gold (mobs with public loot in a placed zone) and
 * reputation, which comes from kills and quests that cannot be placed in a zone yet, so it stays empty.
 */
export const FARM_CATEGORIES = [
  { slug: "gold", label: "Gold", noun: "gold" },
  { slug: "reputation", label: "Reputation", noun: "reputation" },
] as const;

export type FarmCategory = (typeof FARM_CATEGORIES)[number]["slug"];

/**
 * The farming page's old tabs and where each lives now: gathering on its profession's page, the dungeons in the
 * dungeon and raid index. The page sends an old `?category=` link there.
 */
export const MOVED_CATEGORIES: Record<string, { label: string; href: string }> = {
  herbs: { label: "Herbs", href: "/tools/professions/herbalism#gather" },
  ore: { label: "Ore", href: "/tools/professions/mining#gather" },
  leather: { label: "Skins and leather", href: "/tools/professions/skinning#gather" },
  cloth: { label: "Cloth", href: "/tools/professions/tailoring#gather" },
  dungeons: { label: "Dungeons", href: "/database/instances" },
};

/** Trade Goods (item class 7) subclasses that make a mob a cloth or leather farm. */
const TRADE_GOODS = 7;
const SUBCLASS = { cloth: 5, leather: 6 } as const;

export interface Levels { min: number; max: number }

/** One area: a zone with the mobs or the gathering spots that back it. */
export interface FarmArea {
  key: string;
  zone: ZoneSummary;
  /** The lowest and highest level players agree on for the mobs here; null when none is agreed, and for nodes. */
  levels: Levels | null;
  /** Mobs placed here with public loot of the area's kind; 0 for a gathering area. */
  mobs: number;
  /** Gathering spots 3 installs placed here; 0 for a mob area. */
  nodes: number;
}

const itemSubclass = new Map(CLIENT_TAXONOMY.items.filter((r) => r[1] === TRADE_GOODS).map((r) => [r[0], r[2]]));

function byZone(npcs: readonly NpcRow[], items: Map<number, Set<number>>, keep: (items: Set<number>) => boolean): FarmArea[] {
  const zones = new Map<number, { zone: ZoneSummary; levels: number[]; mobs: number }>();
  for (const n of npcs) {
    const dropped = items.get(n.npcId);
    if (!n.zone || !dropped || !keep(dropped)) continue;
    const here = zones.get(n.zone.mapId) ?? { zone: n.zone, levels: [], mobs: 0 };
    here.mobs++;
    if (n.level !== null) here.levels.push(n.level);
    zones.set(n.zone.mapId, here);
  }
  return [...zones.values()].map((z) => ({
    key: String(z.zone.mapId), zone: z.zone, mobs: z.mobs, nodes: 0,
    levels: z.levels.length ? { min: Math.min(...z.levels), max: Math.max(...z.levels) } : null,
  }));
}

/** By lowest level, unknown levels last, then by zone name. */
const order = (rows: FarmArea[]) => rows.sort((a, b) => (a.levels?.min ?? 999) - (b.levels?.min ?? 999) || a.zone.name.localeCompare(b.zone.name));

export type MobFarm = "gold" | "leather" | "cloth";

/**
 * The zones whose mobs back each mob farm, from the NPC list rows and the public loot rates: any public loot for
 * gold, and Trade Goods of the kind for cloth or leather. Both are empty when storage is down.
 */
export function farmingAreas(
  npcs: readonly NpcRow[],
  rates: readonly { sourceNpcId?: number; itemId: number; drops: number; public: boolean }[],
): Record<MobFarm, FarmArea[]> {
  const items = new Map<number, Set<number>>();
  for (const r of rates) if (r.public && r.drops > 0 && r.sourceNpcId !== undefined) items.set(r.sourceNpcId, (items.get(r.sourceNpcId) ?? new Set()).add(r.itemId));
  const holds = (subclass: number) => (dropped: Set<number>) => [...dropped].some((id) => itemSubclass.get(id) === subclass);
  return {
    gold: order(byZone(npcs, items, () => true)),
    leather: order(byZone(npcs, items, holds(SUBCLASS.leather))),
    cloth: order(byZone(npcs, items, holds(SUBCLASS.cloth))),
  };
}

/**
 * The zones where players gathered herbs or ore: the loot windows they opened on game objects (`loot` rows with an
 * object source, `objectSpawnRowsFromRecords`), grouped into spots the way the object pins are, a spot counting once
 * 3 installs placed it. An object counts as an herb or ore node when 3 installs agree it was opened that way. The
 * place is where the player stood, a few yards from the node, so an area is a zone and a count, never a pin here.
 */
export function gatherAreas(rows: readonly ObjectSpawnRow[], kind: "herb" | "ore", zones: readonly ZoneSummary[]): FarmArea[] {
  const kinds = agreedGatherKinds([...rows]);
  const byMap = new Map(zones.map((z) => [z.mapId, z]));
  const count = new Map<number, number>();
  for (const pin of objectSpawns([...rows]).pins) {
    if (kinds.get(pin.objectId) !== kind || !byMap.has(pin.mapId)) continue;
    count.set(pin.mapId, (count.get(pin.mapId) ?? 0) + 1);
  }
  return order([...count].map(([mapId, nodes]) => ({ key: String(mapId), zone: byMap.get(mapId)!, levels: null, mobs: 0, nodes })))
    .sort((a, b) => b.nodes - a.nodes || a.zone.name.localeCompare(b.zone.name));
}

/** An area is in a level range when its levels overlap it; an area with no agreed level never is. */
export const inLevels = (area: FarmArea, range: Levels) => area.levels !== null && area.levels.min <= range.max && area.levels.max >= range.min;

/**
 * The professions whose page has a "where to gather" section, and what backs it: herb or ore spots from gather loot
 * windows, or the zones whose mobs dropped leather or cloth.
 */
export const GATHERING: Record<string, { source: "herb" | "ore" | "leather" | "cloth"; noun: string; how: string }> = {
  herbalism: { source: "herb", noun: "herb", how: "Zones where 3 installs placed the same herb spot, from the loot windows they opened on it. The spot is where the player stood, a few yards from the herb." },
  mining: { source: "ore", noun: "ore", how: "Zones where 3 installs placed the same ore spot, from the loot windows they opened on it. The spot is where the player stood, a few yards from the vein." },
  skinning: { source: "leather", noun: "leather", how: "Zones whose mobs dropped leather or hides in players' loot, once 3 installs agree on the drop." },
  tailoring: { source: "cloth", noun: "cloth", how: "Zones whose mobs dropped cloth in players' loot, once 3 installs agree on the drop." },
  "first-aid": { source: "cloth", noun: "cloth", how: "Zones whose mobs dropped cloth in players' loot, once 3 installs agree on the drop." },
};
