import { ITEM_FACTS } from "@everloot/protocol";
import { itemFactsFromRecords } from "./drop-rollup.js";
import { itemFactRowsFromRecords, type ItemFactName, type ItemFactState } from "./item-facts.js";
import type { RecheckScope } from "./coverage.js";
import type { ItemRow } from "./item-taxonomy.js";

/** MCP's index adds item numbers without changing the page reader used by other callers. */
export function itemToolFactsFromRecords(records: unknown[], recheck: readonly RecheckScope[] = []) {
  return { ...itemFactsFromRecords(records, recheck), numbers: itemFactRowsFromRecords(records) };
}

const words: Record<ItemFactName, string> = {
  armor: "Armor", block: "Block", damage_per_second: "damage per second", health: "Health", mana: "Mana",
  agility: "Agility", strength: "Strength", intellect: "Intellect", spirit: "Spirit", stamina: "Stamina",
  defense_rating: "Defense Rating", dodge_rating: "Dodge Rating", parry_rating: "Parry Rating", block_rating: "Block Rating",
  hit_rating: "Hit Rating", crit_rating: "Critical Strike Rating", haste_rating: "Haste Rating", expertise_rating: "Expertise Rating",
  resilience_rating: "Resilience Rating", attack_power: "Attack Power", mana_regeneration: "Mana Regeneration", spell_power: "Spell Power",
  holy_resistance: "Holy Resistance", fire_resistance: "Fire Resistance", nature_resistance: "Nature Resistance",
  frost_resistance: "Frost Resistance", shadow_resistance: "Shadow Resistance", arcane_resistance: "Arcane Resistance",
};

/** Cloth, leather, mail, plate and shields carry armour, except in the shirt and tabard slots (web/src/lib/item-names.ts). */
const ARMORED = new Set([1, 2, 3, 4, 6]);
const NO_ARMOR_SLOT = new Set([4, 19]);

/**
 * The numbers the item's tooltip shows whatever players report, as the web item page decides: a weapon's damage per
 * second, and armour on armoured gear. An item not in the game files has none known.
 */
function classLines(row: ItemRow | undefined): ItemFactName[] {
  if (!row) return [];
  const [, classId, subclassId, inventoryType] = row;
  if (classId === 2) return ["damage_per_second"];
  if (classId === 4 && ARMORED.has(subclassId) && !NO_ARMOR_SLOT.has(inventoryType)) return ["armor"];
  return [];
}

export function formatItemNumbers(state: ItemFactState, row?: ItemRow): string {
  const lines = ["Item numbers reported by players", "Method: each install's latest report per line and build; the newest build with at least 3 reporting installs decides. One value needs 3 agreeing installs and no competing value with 3. Missing is not zero."];
  const applies = classLines(row);
  let others = false;
  for (const fact of ITEM_FACTS) {
    const shown = state.shown.find((f) => f.fact === fact);
    if (!shown) {
      const contested = state.contested.includes(fact);
      if (!contested && !applies.includes(fact)) { others = true; continue; }
      lines.push(`${words[fact]}: [?]; ${contested ? "contested: installs disagree on the number" : "no number confirmed by 3 agreeing installs"}; agreeing installs [?], last seen [?], build [?].`);
      continue;
    }
    const n = fact === "damage_per_second" ? shown.value.toFixed(1) : String(shown.value);
    const line = fact === "damage_per_second" ? `${n} damage per second`
      : fact === "armor" || fact === "block" ? `${n} ${words[fact]}`
      : `${shown.value < 0 ? "" : "+"}${n} ${words[fact]}`;
    lines.push(`${line}: reported by ${shown.reporters} installs, last seen ${shown.lastSeen ?? "[?]"}, build ${shown.build}.`);
  }
  if (others) lines.push("Other numbers: [?]; none confirmed by 3 agreeing installs.");
  return lines.join("\n");
}
