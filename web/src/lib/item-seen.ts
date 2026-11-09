import { itemNames } from "./names";
import { loadCraftedItems, loadItemFacts, loadWorldFacts } from "./rollup-compute";
import type { Corpus } from "./upload-store";
import { publicQuests, publicVendors } from "./world-lists";
import { SOURCES, type SourceSlug } from "./items";

/** Items players have reported, each public under the 3-install rule its page uses, and where they come from. */
export interface ItemSeen {
  /** An agreed name, a public loot frequency, an agreed vendor price, an agreed quest reward or a recipe 3 installs saw make it. */
  seen: Set<number>;
  /** Where each came from, in SOURCES order; an item players reported only by name has none. */
  from: Map<number, SourceSlug[]>;
  unreachable: boolean;
}

interface SourceFacts {
  /** Public loot frequencies, from an NPC or an object. */
  rates: readonly { itemId: number; drops: number; public: boolean; sourceNpcId?: number; sourceObjectId?: number }[];
  /** Vendor offers and quest rewards that passed the 3-install rule (publicVendors, publicQuests). */
  offers: readonly number[];
  rewards: readonly number[];
  crafted: ReadonlySet<number>;
}

/** The per-item source index: the same facts the item page's Dropped by, Sold by, Reward from and recipe sections state. */
export function buildItemSources(f: SourceFacts): Map<number, SourceSlug[]> {
  const found = new Map<number, Set<SourceSlug>>();
  const add = (id: number, how: SourceSlug) => found.set(id, (found.get(id) ?? new Set()).add(how));
  for (const r of f.rates) {
    if (!r.public || r.drops <= 0) continue;
    if (r.sourceNpcId !== undefined) add(r.itemId, "drop");
    else if (r.sourceObjectId !== undefined) add(r.itemId, "object");
  }
  for (const id of f.offers) add(id, "vendor");
  for (const id of f.rewards) add(id, "quest");
  for (const id of f.crafted) add(id, "crafted");
  return new Map([...found].map(([id, how]) => [id, SOURCES.map((x) => x.slug).filter((x) => how.has(x))]));
}

// The fact arrays are replaced whenever the corpus reloads, so they are the memo's key.
let memo: { keys: unknown[]; value: ItemSeen } | null = null;

/** For the item lists' Source column and filter, and "Seen by players". Built once per corpus version. `read` as in rollup-compute.ts. */
export async function loadItemSeen(read?: Corpus): Promise<ItemSeen> {
  const [items, world, crafted] = await Promise.all([loadItemFacts(read), loadWorldFacts(read), loadCraftedItems(read)]);
  if (items.unreachable || world.unreachable || crafted.unreachable) return { seen: new Set(), from: new Map(), unreachable: true };
  const keys = [items.rates, items.names, world.vendors, world.quests, crafted.items];
  if (memo && memo.keys.every((k, i) => k === keys[i])) return memo.value;
  const from = buildItemSources({
    rates: items.rates,
    offers: publicVendors(world).flatMap((v) => v.offers.map((o) => o.itemId)),
    rewards: publicQuests(world).flatMap((q) => q.rewards),
    crafted: crafted.items,
  });
  const seen = new Set([...itemNames(items).keys(), ...from.keys()]);
  memo = { keys, value: { seen, from, unreachable: false } };
  return memo.value;
}
