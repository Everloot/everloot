import { qualityNamed, qualityOf, type Quality } from "@/components/ui/quality";
import { readItemTips, type ItemTip, type SiteAssets } from "./game-assets";
import { loadListNames, type ListNames } from "./item-view";
import { CLIENT_TAXONOMY, shownItemName, type ShownItemName } from "./items";

/**
 * An item as a row of another page's table shows it (an NPC's or boss's drops, an instance's loot): the name, quality
 * and icon its own page and hover card show (site-card.ts itemCard, lib/item-tooltip.ts), under the same gate. Pages only.
 */
export interface ItemLook {
  /** The shown name and where it is from (`source: "files"` carries the unconfirmed mark); null reads "Item N". */
  name: ShownItemName | null;
  /** The game files' quality (client taxonomy, else the names file's), only where a name is shown. */
  quality: Quality | undefined;
  /** The tooltip's icon, else the icon of an item the files give nothing else for. */
  icon: string | null;
  /** The game file tooltip, for the hover box. */
  tip: ItemTip | undefined;
}

/** Whether the item's hover card has anything to show: one with no name, tooltip or icon is a 404 or a bare "Item N". */
export const lookHasCard = (look: ItemLook): boolean => Boolean(look.name || look.tip || look.icon);

const NOTHING: ItemLook = { name: null, quality: undefined, icon: null, tip: undefined };
let taxonomyQuality: Map<number, number | null> | null = null;

/** One item's look from the names and the files read for it; an id no page shows (`showsTip`) gets nothing from the files. */
export function itemLook(id: number, names: Pick<ListNames, "agreed" | "matched" | "showsTip">, files: { tips: Map<number, ItemTip>; icons: Map<number, string> }): ItemLook {
  if (!names.showsTip(id)) return NOTHING;
  const tip = files.tips.get(id);
  const name = shownItemName(id, names.agreed, names.matched?.names, tip);
  taxonomyQuality ??= new Map(CLIENT_TAXONOMY.items.map((row) => [row[0], row[4]]));
  // As the card: the files' quality (the tooltip's, the taxonomy's, else the names file's); "Item N" stays plain.
  const q = taxonomyQuality.get(id) ?? names.matched?.names.get(id)?.quality;
  const quality = qualityNamed(tip?.quality) ?? (q !== null && q !== undefined && q <= 5 ? qualityOf(q) : undefined);
  return { name, quality: name ? quality : undefined, icon: tip?.icon ?? files.icons.get(id) ?? null, tip };
}

/** The looks of these items: the names the item lists and hover cards read, and the files only for the ids they may show. */
export async function loadItemLooks(assets: SiteAssets | null, ids: readonly number[]): Promise<(id: number) => ItemLook> {
  const names = await loadListNames();
  const shown = [...new Set(ids)].filter(names.showsTip);
  const files = await readItemTips(shown.length ? assets : null, shown);
  return (id) => itemLook(id, names, files);
}
