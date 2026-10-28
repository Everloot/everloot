import { loadItemTips, loadSiteAssets } from "./game-assets";
import { loadShownNames, type ShownNames } from "./shown-item-names";

/**
 * The game icons of the items a search result list shows (/search and the type-ahead), by id: only for items
 * whose page shows its game file tooltip (`showsTip`, the item lists' rule), and only the few ids asked for.
 * Pages only, like the names it reads. Empty without the asset files.
 */
export async function shownItemIcons(ids: readonly number[], shownRead?: Promise<ShownNames>): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const { showsTip } = await (shownRead ?? loadShownNames());
  const shown = ids.filter(showsTip);
  if (!shown.length) return new Map();
  const tips = await loadItemTips(await loadSiteAssets(), shown);
  return new Map([...tips].flatMap(([id, tip]) => (tip.icon ? [[id, tip.icon] as const] : [])));
}
