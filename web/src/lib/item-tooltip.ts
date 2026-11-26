import { isDevelopmentItemName } from "@kb/dev-item-names";
import type { ItemCategory } from "@kb/item-taxonomy";
import { itemSetHref } from "./item-sets";
import { NAME_FROM, type ShownItemName } from "./items";
import { splitWhy } from "./placeholder";
import { PIECE } from "./tip-line";

/**
 * One item's tooltip as the hover card (/card/item/<id>) and the item page's box both draw it, so the two never drift:
 * the name the page shows in its quality colour, the game file lines with the numbers installs agree on, the item's set
 * laid out as the game lays it out, and the reasons for any `[?]` apart from the lines. The callers keep the gates:
 * `tip` is only passed where the page shows the game file tooltip (`showsTip`), and `name` is the item name rule's.
 */
export interface ItemTooltip {
  title: string;
  /** The game's quality (0 poor to 5 legendary), only for a shown name. */
  quality: number | null;
  /** The name's colour where no quality is known: the tooltip's or the matched name's. */
  color: string | null;
  icon: string | null;
  lines: string[];
  /** Why the lines hold `[?]`; absent without any. */
  notes?: string[];
  foot: string | null;
}

/** The item's set as the game files list it (data/game-data/client-item-sets.json), with the names the pages may show. */
export interface TooltipSet {
  id: number;
  items: readonly number[];
  bonuses: readonly (readonly [number, number])[];
  /** A piece's name under the item name rule; undefined where no name may be shown. */
  pieceName: (itemId: number) => string | undefined;
  /** A bonus spell's name from the private spell names; undefined where the file has none. */
  spellName: (spellId: number) => string | undefined;
}

export interface ItemTooltipInput {
  id: number;
  /** The game file tooltip with the reported numbers in (withReported), only where the page shows it. */
  tip: { lines: string[]; why: string[]; icon: string | null; label: string } | undefined;
  /** The name the page shows (shownItemName), or null for "Item N". */
  name: ShownItemName | null;
  category: Pick<ItemCategory, "class" | "subclass" | "slot" | "quality"> | null | undefined;
  /** The quality the names file gives, for an item the taxonomy leaves without one. */
  namesQuality?: number;
  /** The item's icon where the tooltip has none (an item the files give only an icon for). */
  icon?: string | null;
  set?: TooltipSet | null;
}

const SET_LINE = /^Set: (.+)$/;

/**
 * The set lines as the game draws them in place of the files' one "Set: Name" line: the name with the pieces it has
 * ("Name (0/8)", in yellow, nobody's equipped count being known), each piece's name indented, then each bonus as
 * "(2) Set: <bonus>". A piece whose name may not be shown is "Item N"; a development leftover stays out, as on the set
 * page; a bonus is its spell's name, as on the set page, never a description the site may not show.
 */
function setLines(name: string, set: TooltipSet): { lines: string[]; links: Record<string, string> } {
  const pieces = set.items.filter((item) => !isDevelopmentItemName(set.pieceName(item)));
  const head = `${name} (0/${pieces.length})`;
  const links: Record<string, string> = { [head]: itemSetHref(set.id) };
  const lines = [head];
  for (const item of pieces) {
    const line = `${PIECE}${set.pieceName(item) ?? `Item ${item}`}`;
    lines.push(line);
    links[line] = `/database/items/${item}`;
  }
  for (const [count, spell] of set.bonuses) lines.push(`(${count}) Set: ${set.spellName(spell) ?? `Spell ${spell}`}`);
  return { lines, links };
}

/**
 * The card, and the lines that open a page (the set's name, its pieces) by the line's text: the page box links them,
 * the hover card takes no pointer and leaves them out.
 */
export function itemTooltip({ id, tip, name, category, namesQuality, icon, set }: ItemTooltipInput): { card: ItemTooltip; links: Record<string, string> } {
  const { reasons, evidence } = splitWhy(tip?.why ?? []);
  let links: Record<string, string> = {};
  const lines: string[] = [];
  if (tip) {
    for (const line of tip.lines) {
      const named = SET_LINE.exec(line);
      // The files' name for the set, or the placeholder when they give none, heads the pieces and bonuses.
      if (named && set) {
        const block = setLines(named[1], set);
        lines.push(...block.lines);
        links = { ...links, ...block.links };
      } else lines.push(line);
    }
    lines.push(...evidence);
  } else {
    // No game file tooltip may be shown: the type and the slot from the client layer.
    lines.push(...[category?.subclass?.name ?? category?.class?.label, category?.slot?.name].filter((l): l is string => Boolean(l)));
  }
  // The quality colour only where a name is shown; "Item N" stays plain.
  const q = category?.quality?.id ?? namesQuality;
  const quality = name && q !== undefined && q <= 5 ? q : null;
  // The card draws them only while a line holds a `[?]` (GameCard).
  const notes = reasons.length ? reasons : undefined;
  const foot = [name && name.source !== "files" ? NAME_FROM[name.source] : null, tip?.label].filter(Boolean).join(" · ") || null;
  return {
    card: {
      title: name?.name ?? `Item ${id}`,
      quality,
      color: name && quality === null ? name.color : null,
      icon: tip?.icon ?? icon ?? null,
      lines,
      ...(notes ? { notes } : {}),
      foot,
    },
    links,
  };
}
