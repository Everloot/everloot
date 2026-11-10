import { NO_REPORTED_FACTS, type ItemFactState } from "../../../kb/src/item-facts";
import { loadItemNames, PRIVATE_UNREACHABLE } from "./game-assets";
import type { ItemSeen } from "./item-seen";
import { loadItemSeen } from "./item-seen";
import { loadItemView } from "./item-view-store";
import { CLIENT_LAYER } from "./items";
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
  const [stored, read] = await Promise.all([loadItemView(), loadItemNames(CLIENT_LAYER.build.version)]);
  if (!stored) {
    const { facts, ...rest } = await loadShownNames();
    return { ...rest, unreachable: facts.unreachable };
  }
  const matched = read === PRIVATE_UNREACHABLE ? null : read;
  const { agreed, dropped } = stored;
  return {
    agreed, matched, degraded: read === PRIVATE_UNREACHABLE, unreachable: false,
    named: { has: (id) => agreed.has(id) || Boolean(matched?.names.has(id)) },
    showsTip: (id) => agreed.has(id) || dropped.has(id) || Boolean(matched?.names.has(id)),
  };
}

/**
 * One item's tooltip numbers installs agree or disagree on, for its hover card, from the stored view; falls back to
 * `loadReportedItemFacts` (the whole aggregate set) when there is no view or it predates the field.
 */
export async function loadCardFacts(itemId: number): Promise<ItemFactState> {
  const reported = (await loadItemView())?.reported;
  return reported ? reported.get(itemId) ?? NO_REPORTED_FACTS : loadReportedItemFacts(itemId);
}

/** The items players have seen and where from, from the stored view; falls back to `loadItemSeen`. */
export async function loadListSeen(): Promise<ItemSeen> {
  return (await loadItemView())?.seen ?? loadItemSeen();
}
