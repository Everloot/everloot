import { NO_REPORTED_FACTS, type ItemFactState } from "@kb/item-facts";
import { loadItemNames, PRIVATE_UNREACHABLE } from "./game-assets";
import type { ItemSeen } from "./item-seen";
import { loadItemSeen } from "./item-seen";
import { loadItemView } from "./item-view-store";
import { CLIENT_TAXONOMY, developmentLeftovers, sortItems } from "./items";
import gameBuild from "@/data/game-data/build-version.json";
import { loadReportedItemFacts } from "./rollup-compute";
import { loadShownNames, type ShownNames } from "./shown-item-names";

/**
 * The item lists' names and seen items from the cron's stored view (item-view-store.ts), with the game-file names
 * added from the private names file. Pages only: the API, MCP server and bulk download never import this.
 */

export type ListNames = Omit<ShownNames, "facts"> & {
  /** The players' uploads could not be read: no stored view, and the corpus out of reach. */
  unreachable: boolean;
};

/**
 * The names an item list, its metadata, the sitemap and the item icons show, from the stored view: the same values
 * as `loadShownNames` without the corpus. Falls back to `loadShownNames` when there is no view.
 */
export async function loadListNames(): Promise<ListNames> {
  const [stored, read] = await Promise.all([loadItemView(), loadItemNames(gameBuild.version)]);
  if (!stored) {
    const { facts, ...rest } = await loadShownNames();
    return { ...rest, unreachable: facts.unreachable };
  }
  // The same object while neither file was read again, so what a list works out from it is kept (itemListIndex).
  if (lastNames?.stored === stored && lastNames.read === read) return lastNames.names;
  const matched = read === PRIVATE_UNREACHABLE ? null : read;
  const { agreed, dropped } = stored;
  const names: ListNames = {
    agreed, matched, degraded: read === PRIVATE_UNREACHABLE, unreachable: false,
    named: { has: (id) => agreed.has(id) || Boolean(matched?.names.has(id)) },
    showsTip: (id) => agreed.has(id) || dropped.has(id) || Boolean(matched?.names.has(id)),
  };
  lastNames = { stored, read, names };
  return names;
}
let lastNames: { stored: object; read: unknown; names: ListNames } | null = null;

/** What every item list works out from the names and the seen items alone, whatever its category, filters or page. */
export interface ItemListIndex {
  /** The name a list shows and searches (the players' agreed name, else the names file's). */
  name: (id: number) => string | undefined;
  /** The development leftovers among every item (developmentLeftovers). */
  leftovers: Set<number>;
  /** Every item no source names (`showsTip` false): the rows a list folds into one line. */
  unnamed: Set<number>;
  /** Each item's place in the default order (sortItems with no sort, by `name` and the seen items): ItemListContext.order. */
  order: Map<number, number>;
}
const listIndexes = new WeakMap<ListNames, WeakMap<ItemSeen, ItemListIndex>>();

/**
 * The list index for these names and seen items, worked out once per version of them: loadListNames and loadListSeen
 * give the same objects until a file is read again, so the item lists stop comparing every name on every view.
 */
export function itemListIndex(names: ListNames, seen: ItemSeen): ItemListIndex {
  let bySeen = listIndexes.get(names);
  if (!bySeen) listIndexes.set(names, bySeen = new WeakMap());
  const hit = bySeen.get(seen);
  if (hit) return hit;
  const { agreed, matched, showsTip } = names;
  const name = (id: number) => agreed.get(id) ?? matched?.names.get(id)?.name;
  const rows = CLIENT_TAXONOMY.items;
  const index: ItemListIndex = {
    name,
    leftovers: developmentLeftovers(rows, name),
    unnamed: new Set(rows.filter((row) => !showsTip(row[0])).map((row) => row[0])),
    order: new Map(sortItems(rows, undefined, { name, seen: seen.seen }).map((row, i) => [row[0], i])),
  };
  bySeen.set(seen, index);
  return index;
}

/**
 * One item's tooltip numbers installs agree or disagree on, for its hover card, from the stored view; falls back to
 * `loadReportedItemFacts` (the whole aggregate set) when there is no view or it predates the field. `unreachable` when
 * that fallback could not read the aggregates.
 */
export async function loadCardFacts(itemId: number): Promise<ItemFactState & { unreachable: boolean }> {
  const reported = (await loadItemView())?.reported;
  return reported ? { ...(reported.get(itemId) ?? NO_REPORTED_FACTS), unreachable: false } : loadReportedItemFacts(itemId);
}

/** The items players have seen and where from, from the stored view; falls back to `loadItemSeen`. */
export async function loadListSeen(): Promise<ItemSeen> {
  return (await loadItemView())?.seen ?? loadItemSeen();
}
