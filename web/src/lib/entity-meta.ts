import { DESCRIPTION_MAX } from "./seo";

/**
 * Titles and descriptions for the database detail pages, built from the facts each page shows. The title
 * carries "WoW Forever" and the kind, the query a player types; the description says what the page holds,
 * with no build, source or confirmation wording (that stays on the page, beside the value it qualifies).
 */

export type EntityKind = "item" | "NPC" | "quest" | "object" | "vendor" | "faction" | "achievement" | "dungeon" | "raid" | "instance";

/** "Linen Cloth – WoW Forever item"; the layout's template adds "· Everloot". */
export const entityTitle = (name: string, kind: EntityKind): string => `${name} – WoW Forever ${kind}`;

const count = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const article = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "a, b and c". */
function list(parts: string[]): string {
  return parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/**
 * The lead sentence, then the facts as one sentence, then the closing line while it fits. Facts drop from
 * the end until the whole fits DESCRIPTION_MAX; a lead too long on its own is cut at a word.
 */
function fit(lead: string, facts: string[], closing: string): string {
  for (let n = facts.length; n >= 0; n--) {
    const body = n ? `${lead} ${cap(list(facts.slice(0, n)))}.` : lead;
    if (body.length > DESCRIPTION_MAX) continue;
    const full = `${body} ${closing}`;
    return full.length <= DESCRIPTION_MAX ? full : body;
  }
  return `${lead.slice(0, DESCRIPTION_MAX - 1).replace(/\s+\S*$/, "")}…`;
}

export interface ItemFacts {
  name: string;
  id: number;
  /** From the item's row in the game files; absent for an id they do not list. */
  quality?: string | null;
  classLabel?: string | null;
  subclass?: string | null;
  dropSources: number;
  vendors: number;
  createdBy: number;
  usedIn: number;
  questRewards: number;
}

export function itemDescription(f: ItemFacts): string {
  const kind = f.classLabel
    ? `${f.quality ? `${f.quality.toLowerCase()} ` : ""}${f.classLabel} item${f.subclass && f.subclass !== f.classLabel ? ` (${f.subclass})` : ""}`
    : "item";
  const lead = `${f.name} is ${article(kind)} ${kind} in WoW: Forever.`;
  const facts = [
    f.dropSources ? `dropped by ${count(f.dropSources, "source", "sources")}` : "",
    f.vendors ? `sold by ${count(f.vendors, "vendor", "vendors")}` : "",
    f.createdBy ? `made by ${count(f.createdBy, "recipe", "recipes")}` : "",
    f.usedIn ? `used in ${count(f.usedIn, "recipe", "recipes")}` : "",
    f.questRewards ? `a reward from ${count(f.questRewards, "quest", "quests")}` : "",
  ].filter(Boolean);
  return fit(lead, facts, facts.length ? `Item ID ${f.id}.` : `Where it drops, who sells it and the recipes that make or use it. Item ID ${f.id}.`);
}

export function npcDescription(f: { name: string; id: number; positions: number }): string {
  const facts = f.positions ? [`seen at ${count(f.positions, "map position", "map positions")}`] : [];
  return fit(`${f.name} is an NPC in WoW: Forever.`, facts, `Where it stands on the map, what it drops and the quests it gives. NPC ID ${f.id}.`);
}

export function questDescription(f: { name: string; id: number; level: number | null; giver: boolean; turnIn: boolean; rewards: number }): string {
  const lead = `${f.name} is a${f.level !== null ? ` level ${f.level}` : ""} quest in WoW: Forever.`;
  const facts = [
    f.giver ? "its quest giver" : "",
    f.turnIn ? "where to turn it in" : "",
    f.rewards ? count(f.rewards, "reward", "rewards") : "",
  ].filter(Boolean);
  return fit(lead, facts.length ? [`with ${list(facts)}`] : [], `Who gives it, where to turn it in and what it rewards. Quest ID ${f.id}.`);
}

export function objectDescription(f: { name: string; id: number; items: number; windows: number | null }): string {
  const facts = [
    f.items ? `${count(f.items, "item", "items")} looted from it` : "",
    f.windows ? `${count(f.windows, "loot window", "loot windows")} counted` : "",
  ].filter(Boolean);
  return fit(`${f.name} is a chest, herb, ore vein or fishing pool in WoW: Forever.`, facts, "What players looted from it and how often.");
}

export function vendorDescription(f: { name: string; id: number; offers: number }): string {
  const facts = f.offers ? [`sells ${count(f.offers, "item", "items")} at agreed prices`] : [];
  return fit(`${f.name} is a vendor in WoW: Forever.`, facts, `What it sells, at what price, and whether stock is limited. Vendor NPC ID ${f.id}.`);
}
