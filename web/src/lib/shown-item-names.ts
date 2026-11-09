import { agreedItemNames } from "../../../kb/src/item-page";
import { loadItemNames, PRIVATE_UNREACHABLE, type ItemNames } from "@/lib/game-assets";
import { CLIENT_LAYER } from "@/lib/items";
import { loadItemFacts } from "@/lib/rollup-compute";

// The item names the item pages may show, read once per request for the category list, its metadata and the
// sitemap. Server only, and pages only: the API, MCP server and bulk download never import this
// (talents/assets.test.ts checks that).

export interface ShownNames {
  facts: Awaited<ReturnType<typeof loadItemFacts>>;
  /** Names 3 installs agree on; empty when upload storage cannot be reached. */
  agreed: Map<number, string>;
  /** Names the game files and the Warcraft Wiki agree on, for this build; null without the private file. */
  matched: ItemNames | null;
  /** Whether an item has a name from either: the share a category needs before it is indexed. */
  named: { has(id: number): boolean };
  /**
   * Whether a page may show an item's game file tooltip (icon, item level, required level, binding, and the rest):
   * players reported it (an agreed name or a public drop, as its page counts them), or its name shows under the
   * item name rule (docs/DATA_POLICY.md). Any other id may be unreleased content.
   */
  showsTip(id: number): boolean;
  /** Upload storage or the private bucket could not be read: names may be missing (components/EdgeDegraded.tsx). */
  degraded: boolean;
}

export async function loadShownNames(): Promise<ShownNames> {
  const [facts, read] = await Promise.all([loadItemFacts(), loadItemNames(CLIENT_LAYER.build.version)]);
  const matched = read === PRIVATE_UNREACHABLE ? null : read;
  const agreed = facts.unreachable ? new Map<number, string>() : agreedItemNames(facts);
  // The same test as itemPage's name, drops and pins (pins come only with a drop), in one pass.
  const dropped = new Set(facts.unreachable ? [] : facts.rates.filter((r) => r.public).map((r) => r.itemId));
  return {
    facts, agreed, matched, degraded: facts.unreachable || read === PRIVATE_UNREACHABLE,
    named: { has: (id) => agreed.has(id) || Boolean(matched?.names.has(id)) },
    showsTip: (id) => agreed.has(id) || dropped.has(id) || Boolean(matched?.names.has(id)),
  };
}
