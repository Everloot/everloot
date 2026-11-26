import { loadSiteAssets, readItemTips, unknownItemIcon, type SiteAssets } from "./game-assets";
import { loadShownNames, type ShownNames } from "./shown-item-names";

/**
 * The game icons of the items a search result list shows (/search and the type-ahead), by id. This file is the
 * asset half only: which items may show one is `showsTip` in shown-item-names.ts (the policy at the top of names.ts),
 * and only the few ids asked for are read.
 * `unknown` is the game's question mark from the same asset folder, for a row without one; null when no icon
 * was read. Pages only, like the names it reads. Empty without the asset files.
 */
/**
 * The game files' icons of the given items, by id: a tooltip's icon, or the icon of an item the files give nothing else
 * for (its ItemSparse row comes from the server). Like the tips, the caller passes only items it may show.
 */
export async function loadItemIcons(assets: SiteAssets | null, ids: readonly number[]): Promise<Map<number, string>> {
  return (await readItemTips(assets, ids)).icons;
}

export async function shownItemIcons(ids: readonly number[], shownRead?: Promise<Pick<ShownNames, "showsTip">>): Promise<{ icons: Map<number, string>; unknown: string | null }> {
  const none = { icons: new Map<number, string>(), unknown: null };
  if (!ids.length) return none;
  const { showsTip } = await (shownRead ?? loadShownNames());
  const shown = ids.filter(showsTip);
  if (!shown.length) return none;
  const assets = await loadSiteAssets();
  const icons = await loadItemIcons(assets, shown);
  return { icons, unknown: assets && icons.size ? unknownItemIcon(assets.base) : null };
}
