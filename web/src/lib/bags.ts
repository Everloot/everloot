import bagsJson from "@/data/game-data/client-bags.json";
import type { ClientBags } from "../../../kb/src/client-bags";
import type { MarketRow, RealmBoard } from "./auction-house";
import { SLOT } from "./tip-line";

// The item tooltip reader imports this and reaches a client bundle, so this reads the JSON with a type only and not the kb
// module, which imports node:fs. data/game-data/client-bags.ts parses the same file against the schema.
const CLIENT_BAGS = bagsJson as ClientBags;
/** `Item.SubclassID` of a plain bag, the one any item fits in (kb/src/client-bags.ts PLAIN_BAG). */
const PLAIN_BAG = 0;

/**
 * Bags: the slot counts the game files give (data/game-data/client-bags.json, found in game files, unconfirmed) and
 * what the bag calculator at /tools/bags works out from one auction house's public prices. Every price is one house's:
 * a house is its own market, so nothing here reads more than one house's rows at a time, except `pricedSizes`, which
 * only asks which sizes some house has priced.
 */

export const BAGS_BUILD = CLIENT_BAGS.build.version;

/** "14 Slot Bag", "20 Slot Herb Bag": what the game prints for a container, its subclass word from the files; null for any other item. */
export function bagSlotLine(itemId: number): string | null {
  const bag = CLIENT_BAGS.bags[String(itemId)];
  if (!bag) return null;
  return `${bag.slots} Slot ${CLIENT_BAGS.subclasses[String(bag.subclass)] ?? "Container"}`;
}

const LEADING = /^(?:Binds |Quest Item$|Unique)/;

/**
 * A container's tooltip lines with its slot line where the game prints it: in place of the bare "Bag" slot line,
 * or else under the binding and Unique lines. Other items' lines are returned as they are.
 */
export function withBagSlots(lines: readonly string[], itemId: number): string[] {
  const line = bagSlotLine(itemId);
  if (!line) return [...lines];
  const slot = lines.indexOf(SLOT[18]!);
  if (slot >= 0) return [...lines.slice(0, slot), line, ...lines.slice(slot + 1)];
  const at = lines.findIndex((l) => !LEADING.test(l));
  return at < 0 ? [...lines, line] : [...lines.slice(0, at), line, ...lines.slice(at)];
}

/** Plain bags (any item fits) by item id, with their slot count. Profession, soul and ammo bags are not upgrades. */
export const PLAIN_BAGS: ReadonlyMap<number, number> = new Map(
  Object.entries(CLIENT_BAGS.bags).filter(([, b]) => b.subclass === PLAIN_BAG).map(([id, b]) => [Number(id), b.slots]),
);

/** Every plain bag size the files list, smallest first: the choices for "the bags you have". */
export const BAG_SIZES: readonly number[] = [...new Set(PLAIN_BAGS.values())].sort((a, b) => a - b);

/** How many bag slots a character has besides the backpack, which is fixed and not sold. */
export const BAG_SLOTS = 4;

/**
 * The cheapest plain bag of each size among one house's rows, by the newest public minimum buyout (`value.min`), the
 * lower item id on a tie. Sizes without a public price are absent, never 0.
 */
export function cheapestBySize(rows: readonly MarketRow[]): Map<number, MarketRow> {
  const out = new Map<number, MarketRow>();
  for (const row of rows) {
    const slots = PLAIN_BAGS.get(row.value.itemId);
    if (slots === undefined) continue;
    const best = out.get(slots);
    if (!best || row.value.min < best.value.min || (row.value.min === best.value.min && row.value.itemId < best.value.itemId)) out.set(slots, row);
  }
  return out;
}

/**
 * The plain bag sizes some house on some realm has a public price for. A bag that binds when picked up never reaches
 * an auction house, so its size shows up only if a tradable bag of that size does.
 */
export function pricedSizes(boards: readonly RealmBoard[]): Set<number> {
  const out = new Set<number>();
  for (const b of boards) for (const id of b.byItem.keys()) {
    const slots = PLAIN_BAGS.get(id);
    if (slots !== undefined) out.add(slots);
  }
  return out;
}

export interface Upgrade {
  slots: number;
  row: MarketRow;
  /** Slots gained by swapping the smallest bag for this one. */
  added: number;
  /** The minimum buyout divided by the slots gained, in copper (not rounded). */
  perSlot: number;
}

/**
 * Every bigger bag worth buying: the cheapest of each size bigger than the smallest bag the player has (0 for an empty
 * slot), what it costs and what each added slot costs, the best value first, then the bigger bag.
 */
export function upgrades(cheapest: ReadonlyMap<number, MarketRow>, current: readonly number[]): Upgrade[] {
  const smallest = current.length ? Math.min(...current) : 0;
  return [...cheapest]
    .filter(([slots]) => slots > smallest)
    .map(([slots, row]) => ({ slots, row, added: slots - smallest, perSlot: row.value.min / (slots - smallest) }))
    .sort((a, b) => a.perSlot - b.perSlot || b.slots - a.slots || a.row.value.itemId - b.row.value.itemId);
}

/** `?b1=..&b4=..`: each a bag size the files list, or 0 for an empty slot; anything else reads as empty. */
export function bagsParam(search: Record<string, string | string[] | undefined>): number[] {
  return Array.from({ length: BAG_SLOTS }, (_, i) => {
    const raw = search[`b${i + 1}`];
    const n = Number(Array.isArray(raw) ? raw[0] : raw);
    return BAG_SIZES.includes(n) ? n : 0;
  });
}
