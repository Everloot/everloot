import { loadItemNames, PRIVATE_UNREACHABLE } from "./game-assets";
import type { ItemSeen } from "./item-seen";
import { loadItemSeen } from "./item-seen";
import { loadItemView } from "./item-view-store";
import { CLIENT_LAYER } from "./items";
import { loadShownNames, type ShownNames } from "./shown-item-names";

/**
 * The item lists' names and seen items from the cron's stored view (item-view-store.ts), with the game-file names
 * added from the private names file. Pages only: the API, MCP server and bulk download never import this.
 */

export type ListNames = Omit<ShownNames, "facts">;

/**
 * The names an item list, its metadata, the sitemap and the item icons show, from the stored view: the same values
 * as `loadShownNames` without the corpus. Falls back to `loadShownNames` when there is no view.
 */
export async function loadListNames(): Promise<ListNames> {
  const [stored, read] = await Promise.all([loadItemView(), loadItemNames(CLIENT_LAYER.build.version)]);
  if (!stored) {
    const { facts: _facts, ...rest } = await loadShownNames();
    return rest;
  }
  const matched = read === PRIVATE_UNREACHABLE ? null : read;
  const { agreed, dropped } = stored;
  return {
    agreed, matched, degraded: read === PRIVATE_UNREACHABLE,
    named: { has: (id) => agreed.has(id) || Boolean(matched?.names.has(id)) },
    showsTip: (id) => agreed.has(id) || dropped.has(id) || Boolean(matched?.names.has(id)),
  };
}

/** The items players have seen and where from, from the stored view; falls back to `loadItemSeen`. */
export async function loadListSeen(): Promise<ItemSeen> {
  return (await loadItemView())?.seen ?? loadItemSeen();
}
