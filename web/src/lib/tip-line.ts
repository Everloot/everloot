// How the game lays out one line of an item tooltip, read from the plain-text line the site already has
// (item-names.ts writes them, the card API serves them). No imports, so the hover card does not bundle item-names.

/** The slot words the game prints on the left of the slot line, by InventoryType. */
export const SLOT: Record<number, string> = {
  1: "Head", 2: "Neck", 3: "Shoulder", 4: "Shirt", 5: "Chest", 6: "Waist", 7: "Legs", 8: "Feet", 9: "Wrist", 10: "Hands",
  11: "Finger", 12: "Trinket", 13: "One-Hand", 14: "Off Hand", 15: "Ranged", 16: "Back", 17: "Two-Hand", 18: "Bag", 19: "Tabard",
  20: "Chest", 21: "Main Hand", 22: "Off Hand", 23: "Held In Off-hand", 24: "Projectile", 25: "Thrown", 26: "Ranged", 28: "Relic",
};

/** The weapon and armour kinds the game prints on the right of the slot line, by subclass. */
export const WEAPON: Record<number, string> = {
  0: "Axe", 1: "Axe", 2: "Bow", 3: "Gun", 4: "Mace", 5: "Mace", 6: "Polearm", 7: "Sword", 8: "Sword", 10: "Staff",
  13: "Fist Weapon", 14: "Miscellaneous", 15: "Dagger", 16: "Thrown", 18: "Crossbow", 19: "Wand", 20: "Fishing Pole",
};
export const ARMOR: Record<number, string> = { 1: "Cloth", 2: "Leather", 3: "Mail", 4: "Plate", 6: "Shield", 7: "Libram", 8: "Idol", 9: "Totem" };

/** What joins the two halves of a slot line or a damage line in the plain text. */
export const PAIR = " · ";

export type Metal = "gold" | "silver" | "copper";

/**
 * One tooltip line as the game draws it:
 * - `pair`: two columns, slot left and kind right ("Head" / "Plate"), or damage left and speed right;
 * - `effect`: an Equip, Use or Chance on hit line, in the game's green;
 * - `yellow`: the item level, a named set and the quoted flavour text, in the game's yellow;
 * - `price`: the sell price, as coins;
 * - `plain`: everything else (binding, requirements, stats), in the neutral colour. Whether a requirement is met
 *   depends on the character, which the site does not know, so none is drawn red.
 */
export type TipLine =
  | { kind: "pair"; left: string; right: string }
  | { kind: "effect" | "yellow" | "plain"; text: string }
  | { kind: "price"; label: string; coins: { metal: Metal; amount: number }[] };

const SLOTS = new Set(Object.values(SLOT));
const KINDS = new Set([...Object.values(WEAPON), ...Object.values(ARMOR)]);
const DAMAGE = /^(.+ Damage) · (Speed \d+\.\d\d)$/;
const EFFECT = /^(?:Equip|Use|Chance on hit): /;
// "Set: [?]" stands for a set name or set lines nobody has read; it stays neutral, like the other placeholders.
const YELLOW = /^(?:Item Level \d+|Set: (?!\[\?\]$).+|".+")$/;
const PRICE = /^(Sell Price:) (?:(\d+)g )?(?:(\d+)s )?(\d+)c$/;

export function tipLine(line: string): TipLine {
  const damage = DAMAGE.exec(line);
  if (damage) return { kind: "pair", left: damage[1], right: damage[2] };
  const halves = line.split(PAIR);
  if (halves.length === 2 && SLOTS.has(halves[0]) && KINDS.has(halves[1])) return { kind: "pair", left: halves[0], right: halves[1] };
  const price = PRICE.exec(line);
  if (price) {
    const coins = ([["gold", price[2]], ["silver", price[3]], ["copper", price[4]]] as const)
      .filter(([, n]) => n !== undefined)
      .map(([metal, n]) => ({ metal, amount: Number(n) }));
    return { kind: "price", label: price[1], coins };
  }
  if (EFFECT.test(line)) return { kind: "effect", text: line };
  if (YELLOW.test(line)) return { kind: "yellow", text: line };
  return { kind: "plain", text: line };
}
