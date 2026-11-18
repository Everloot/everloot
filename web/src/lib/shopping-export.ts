// Import strings for two auction addons, built from a shopping list. Both formats were read from the
// addons' own import code (TradeSkillMaster 4.8 to 4.11, Auctionator's current Shopping tab); the
// pull request that added this file cites the sources. Nothing here is uploaded: the page copies the
// text to the clipboard and the player pastes it into the addon.

export type ExportItem = { itemId: number | null; name: string; count: number };
export type ExportResult = { text: string; included: number; omitted: string[] };

/**
 * TradeSkillMaster's group import takes a comma-separated list of item strings, `i:<item id>`.
 * A group holds items only, so counts are left out. Items without a known id are omitted.
 */
export function tsmImportString(items: ExportItem[]): ExportResult {
  const ids: number[] = [];
  const omitted: string[] = [];
  for (const item of items) {
    if (item.itemId === null || !Number.isInteger(item.itemId) || item.itemId <= 0) omitted.push(item.name);
    else if (!ids.includes(item.itemId)) ids.push(item.itemId);
  }
  return { text: ids.map((id) => `i:${id}`).join(","), included: ids.length, omitted };
}

// Characters Auctionator's import splits on: lists on line breaks, a list's name and searches on `^`,
// a search's fields on `;`. A quote inside a name would change what counts as an exact search.
const AUCTIONATOR_BREAKS = /[\^;"\r\n]/;

/**
 * Auctionator's shopping-list import is one line: the list name, then each search, all joined by `^`.
 * A search is 14 fields joined by `;`: the name in quotes (an exact match), then category, item level,
 * level and crafted level ranges, price range, quality, tier, expansion and quantity. Everything but the
 * name and quantity is left empty, and the tier holds `#`, as Auctionator writes it when no tier is set.
 * Auctionator searches by name, so the item id is not used.
 */
export function auctionatorImportString(listName: string, items: ExportItem[]): ExportResult {
  const name = listName.replace(/[\^\r\n]/g, " ").trim() || "Everloot";
  const counts = new Map<string, { name: string; count: number }>();
  const omitted: string[] = [];
  for (const item of items) {
    const itemName = item.name.trim();
    if (!itemName || AUCTIONATOR_BREAKS.test(itemName)) { omitted.push(item.name); continue; }
    const key = itemName.toLowerCase();
    const count = Number.isInteger(item.count) && item.count > 0 ? item.count : 0;
    const seen = counts.get(key);
    if (seen) seen.count += count;
    else counts.set(key, { name: itemName, count });
  }
  if (counts.size === 0) return { text: "", included: 0, omitted };
  const searches = [...counts.values()].map(({ name: n, count }) =>
    [`"${n}"`, "", "", "", "", "", "", "", "", "", "", "#", "", count > 0 ? String(count) : ""].join(";"));
  return { text: [name, ...searches].join("^"), included: searches.length, omitted };
}
