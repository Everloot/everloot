import { loadItemTips, loadSiteAssets, unknownItemIcon } from "./game-assets";
import { loadShownNames, type ShownNames } from "./shown-item-names";

/**
 * The game icons of the items a search result list shows (/search and the type-ahead), by id: only for items
 * whose page shows its game file tooltip (`showsTip`, the item lists' rule), and only the few ids asked for.
 * `unknown` is the game's question mark from the same asset folder, for a row without one; null when no icon
 * was read. Pages only, like the names it reads. Empty without the asset files.
 */
export async function shownItemIcons(ids: readonly number[], shownRead?: Promise<ShownNames>): Promise<{ icons: Map<number, string>; unknown: string | null }> {
  const none = { icons: new Map<number, string>(), unknown: null };
  if (!ids.length) return none;
  const { showsTip } = await (shownRead ?? loadShownNames());
  const shown = ids.filter(showsTip);
  if (!shown.length) return none;
  const assets = await loadSiteAssets();
  const tips = await loadItemTips(assets, shown);
  const icons = new Map([...tips].flatMap(([id, tip]) => (tip.icon ? [[id, tip.icon] as const] : [])));
  return { icons, unknown: assets && icons.size ? unknownItemIcon(assets.base) : null };
}
