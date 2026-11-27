import { CLIENT_CLASS_GEAR } from "@/data/game-data/client-class-gear";
import { CLIENT_ITEM_SETS } from "@/data/game-data/client-item-sets";
import type { ClientItemSet } from "@kb/client-item-sets";

/**
 * The item sets the game files list (data/game-data/client-item-sets.json): ids, pieces, bonuses and the skill a
 * crafted set asks for. Their names are not in the file: they come from the private set names file
 * (loadItemSetNames), pages only (docs/DATA_POLICY.md). Found in game files, unconfirmed.
 */
export const ITEM_SETS: readonly ClientItemSet[] = CLIENT_ITEM_SETS.sets;
export const ITEM_SETS_BUILD = CLIENT_ITEM_SETS.build.version;
export const ITEM_SETS_PATH = "/database/item-sets";

const byId = new Map(ITEM_SETS.map((s) => [s.id, s]));
export const itemSet = (id: number): ClientItemSet | undefined => byId.get(id);
export const itemSetHref = (id: number) => `${ITEM_SETS_PATH}/${id}`;
const byItem = new Map(ITEM_SETS.flatMap((s) => s.items.map((item) => [item, s] as const)));
/** The set an item is a piece of, as the game files list it. */
export const itemSetOf = (itemId: number): ClientItemSet | undefined => byItem.get(itemId);

/**
 * A set bonus as the game's tooltip words it: the bonus spell's tooltip text when the files give all of it (no value
 * left unresolved), else the spell's name without the files' zero-padding ("Run Speed +08%" is "Run Speed +8%").
 * Nothing is added: a name the files lack stays undefined, for the caller's "Spell N".
 */
export function setBonusText(name: string | undefined, tip?: { text: string | null; partial: boolean } | null): string | undefined {
  if (tip?.text && !tip.partial) return tip.text;
  return name?.replace(/(^|[^\d.])0+(?=\d)/g, "$1");
}

const CLASS_BY_BIT = Object.entries(CLIENT_CLASS_GEAR.classes).map(([slug, c]) => ({ slug, bit: 1 << (c.id - 1), id: c.id })).sort((a, b) => a.id - b.id);

/**
 * The classes a set is for, from its pieces' own class masks (client-class-gear.json `restricted`, bit id − 1): the
 * classes every piece allows. Null when some piece allows every class (it has no mask there), or the set has no
 * pieces: the files then do not tie the set to a class.
 */
export function itemSetClasses(items: readonly number[], restricted: Record<string, number> = CLIENT_CLASS_GEAR.restricted): string[] | null {
  if (!items.length) return null;
  let mask = -1;
  for (const item of items) {
    const own = restricted[String(item)];
    if (own === undefined) return null;
    mask &= own;
  }
  return CLASS_BY_BIT.filter((c) => mask & c.bit).map((c) => c.slug);
}
