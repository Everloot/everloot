import { categoryOf } from "@kb/item-taxonomy";
import { privateStoreFromEnv, readItemTips, type ItemTip, type PrivateStore, type SiteAssets } from "./game-assets";
import { qualityColor } from "./item-names";
import { CLIENT_TAXONOMY } from "./items";

const QUALITY_NAMES = ["Poor", "Common", "Uncommon", "Rare", "Epic", "Legendary", "Artifact", "Heirloom"];

/**
 * The tooltips of items Blizzard's armory reports equipped. Those items are in the live game, so each gets a card: the
 * game files' tooltip where they have one, else (an item the files give only an icon for, whose ItemSparse row the
 * server sends) a card from the armory's name and quality, the files' icon, and the type and slot from the client
 * layer, labelled unconfirmed like every game-file card. An item with neither keeps its plain link. Never throws.
 */
export async function loadEquippedTips(assets: SiteAssets | null, items: readonly { itemId: number; name: string; quality: string | null }[], store: PrivateStore | null = privateStoreFromEnv()): Promise<Map<number, ItemTip>> {
  const read = await readItemTips(assets, items.map((i) => i.itemId), store).catch(() => null);
  if (!read || !assets) return new Map();
  const tips = new Map(read.tips);
  for (const item of items) {
    const icon = read.icons.get(item.itemId);
    if (tips.has(item.itemId) || !icon) continue;
    const q = QUALITY_NAMES.findIndex((n) => n.toLowerCase() === item.quality?.toLowerCase());
    const category = categoryOf(CLIENT_TAXONOMY, item.itemId);
    tips.set(item.itemId, {
      name: item.name, color: qualityColor(q < 0 ? 1 : q), quality: QUALITY_NAMES[q < 0 ? 1 : q], icon,
      lines: [category?.subclass?.name ?? category?.class?.label, category?.slot?.name].filter((l): l is string => Boolean(l)),
      partial: true, why: [], label: `Name from Blizzard's armory · icon ${assets.label} · build ${assets.version}`,
      level: 0, required: 0, binding: 0,
    });
  }
  return tips;
}
