import { loadItemTips, loadSiteAssets, type ItemTip, type SiteAssets } from "@/lib/game-assets";
import { shownItemName } from "@/lib/items";
import { loadShownNames } from "@/lib/shown-item-names";

export type { ItemTip };

/**
 * Icons, quality and tooltips for the items an Auction House page shows. Callers pass only items with a
 * public value (3 reporters scanned them), so nothing found only in the game files is drawn. Nothing is
 * read when there are no items.
 */
export async function itemArt(ids: readonly number[]): Promise<{ assets: SiteAssets | null; tips: Map<number, ItemTip> }> {
  if (!ids.length) return { assets: null, tips: new Map() };
  const assets = await loadSiteAssets();
  return { assets, tips: await loadItemTips(assets, ids) };
}

/**
 * The names the item pages show, for items with a public value: players' agreed name, then the game files and
 * wiki match, then the tooltip's name (a public auction value is a player report, as the tooltip rule counts
 * them). Items with none are left out and read "Item N". `stored` is the names the cron worked out by the same rule
 * (lib/market-boards.ts; null without them): an id it holds is taken from it, and the names are read only for the rest.
 */
export async function auctionNames(ids: readonly number[], tips: Map<number, ItemTip>, stored?: ReadonlyMap<number, string | null> | null): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const rest: number[] = [];
  for (const id of new Set(ids)) {
    if (!stored?.has(id)) rest.push(id);
    else if (stored.get(id)) out.set(id, stored.get(id)!);
  }
  if (!rest.length) return out;
  const { agreed, matched } = await loadShownNames();
  for (const id of rest) {
    const shown = shownItemName(id, agreed, matched?.names, tips.get(id));
    if (shown) out.set(id, shown.name);
  }
  return out;
}
