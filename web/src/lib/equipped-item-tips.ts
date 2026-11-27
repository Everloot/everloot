import type { ItemTipLines } from "@kb/armory/parse";
import { privateStoreFromEnv, readItemTips, type ItemTip, type PrivateStore, type SiteAssets } from "./game-assets";
import { itemCategoryOf } from "./item-categories";
import { qualityColor } from "./item-names";
import { PAIR, PIECE } from "./tip-line";

const QUALITY_NAMES = ["Poor", "Common", "Uncommon", "Rare", "Epic", "Legendary", "Artifact", "Heirloom"];

/** An equipped item as Blizzard's armory read it: `level` and `tip` (its tooltip lines) when the read brought them. */
export interface EquippedItem { itemId: number; name: string; quality: string | null; level?: number | null; tip?: ItemTipLines }

/**
 * The tooltips of items Blizzard's armory reports equipped. Those items are in the live game, so each gets a card: the
 * game files' tooltip where they have one, else (an item the files give only an icon for, whose ItemSparse row the
 * server sends) a card from the armory's name, quality and item level, the files' icon, and the type and slot from the
 * client layer, labelled unconfirmed like every game-file card. An item with neither keeps its plain link. With
 * `armoryLines` (armory pages only), an item whose read brought Blizzard's tooltip lines gets a card from those lines
 * instead, labelled as Blizzard's. Never throws.
 */
export async function loadEquippedTips(assets: SiteAssets | null, items: readonly EquippedItem[], store: PrivateStore | null = privateStoreFromEnv(), armoryLines = false): Promise<Map<number, ItemTip>> {
  return (await loadEquippedItems(assets, items, store, armoryLines)).tips;
}

/**
 * `loadEquippedTips`, and the items the game files carry nothing for: no tooltip and no icon after a complete read of
 * this build's item index (indexed, nothing unreachable or broken). Any doubt leaves an item out of `unknown`, so a slow
 * or missing bucket never makes the armory page call a known item unknown. Never throws.
 */
export async function loadEquippedItems(assets: SiteAssets | null, items: readonly EquippedItem[], store: PrivateStore | null = privateStoreFromEnv(), armoryLines = false): Promise<{ tips: Map<number, ItemTip>; unknown: Set<number> }> {
  const read = await readItemTips(assets, items.map((i) => i.itemId), store).catch(() => null);
  // Without the files, only Blizzard's own lines can make a card (armory pages); nothing is called unknown.
  if (!read || !assets) return { tips: armoryLines ? new Map(items.flatMap((i) => (i.tip ? [[i.itemId, blizzardTip(null, i, i.tip, null)] as const] : []))) : new Map(), unknown: new Set() };
  const complete = read.indexed && !read.unreachable && !read.degraded;
  const unknown = new Set(complete ? items.filter((i) => !read.tips.has(i.itemId) && !read.icons.has(i.itemId)).map((i) => i.itemId) : []);
  return { tips: equippedTips(assets, read, items, armoryLines), unknown };
}

const qualityOf = (item: EquippedItem) => {
  const q = QUALITY_NAMES.findIndex((n) => n.toLowerCase() === item.quality?.toLowerCase());
  return q < 0 ? 1 : q;
};

function equippedTips(assets: SiteAssets, read: { tips: Map<number, ItemTip>; icons: Map<number, string> }, items: readonly EquippedItem[], armoryLines: boolean): Map<number, ItemTip> {
  const tips = new Map(read.tips);
  for (const item of items) {
    const icon = read.icons.get(item.itemId) ?? read.tips.get(item.itemId)?.icon ?? null;
    if (armoryLines && item.tip) {
      tips.set(item.itemId, blizzardTip(assets, item, item.tip, icon));
      continue;
    }
    if (tips.has(item.itemId) || !icon) continue;
    const q = qualityOf(item);
    const category = itemCategoryOf(item.itemId);
    tips.set(item.itemId, {
      name: item.name, color: qualityColor(q), quality: QUALITY_NAMES[q], icon,
      lines: [...levelLine(item), category?.subclass?.name ?? category?.class?.label, category?.slot?.name].filter((l): l is string => Boolean(l)),
      partial: true, why: [], label: `Name from Blizzard's armory · icon ${assets.label} · build ${assets.version}`,
      level: item.level ?? 0, required: 0, binding: 0,
    });
  }
  return tips;
}

const levelLine = (item: EquippedItem) => (item.level ? [`Item Level ${item.level}`] : []);

/**
 * A card from the tooltip lines Blizzard sent with the item, in the game's order and the site's line forms
 * (lib/tip-line.ts): the item level, binding, slot and kind, damage and speed, armor, stats, the Equip lines, then the
 * set with the pieces worn counted. Only what Blizzard sent; the icon is the files', so the label names both.
 */
function blizzardTip(assets: SiteAssets | null, item: EquippedItem, t: ItemTipLines, icon: string | null): ItemTip {
  const q = qualityOf(item);
  const worn = t.set ? t.set.pieces.filter((p) => p.equipped).length : 0;
  const lines = [
    ...levelLine(item),
    t.binding,
    t.slot && t.kind ? `${t.slot}${PAIR}${t.kind}` : t.slot ?? t.kind,
    t.damage && t.speed ? `${t.damage}${PAIR}${t.speed}` : t.damage,
    t.dps,
    t.armor ? `${t.armor} Armor` : null,
    ...(t.stats ?? []),
    ...(t.bonus_stats ?? []).map((s) => `Equip: ${s}`),
    ...(t.effects ?? []),
    ...(t.set ? [
      `${t.set.name} (${worn}/${t.set.pieces.length})`,
      ...t.set.pieces.map((p) => `${PIECE}${p.name}`),
      ...t.set.bonuses.map((b) => `(${b.count}) ${b.text}`),
    ] : []),
  ].filter((l): l is string => Boolean(l));
  return {
    name: item.name, color: qualityColor(q), quality: QUALITY_NAMES[q], icon, lines, partial: false, why: [],
    label: icon && assets ? `From Blizzard's API · icon ${assets.label} · build ${assets.version}` : "From Blizzard's API",
    level: item.level ?? 0, required: 0, binding: 0,
  };
}
