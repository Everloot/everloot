import { SITE, TOOLTIP_TYPES, type TooltipResponse, type TooltipType } from "@everloot/protocol";
import { itemPage } from "../../../kb/src/item-page";
import { objectPage } from "../../../kb/src/object-page";
import { npcPage, questPage } from "../../../kb/src/world-pages";
import { attribution } from "./data-guard";
import { loadItemTips, loadSiteAssets } from "./game-assets";
import { loadWorldFacts, loadItemFacts, loadReportedItemFacts } from "./rollup-compute";
import { PLACEHOLDER, tipLines, withReported } from "./item-names";
import { loadObjectFacts } from "./objects";
import { CREDIT } from "./talents/assets";

/**
 * The hover card behind GET /api/tooltip/<type>/<id>, for the embeddable script (public/tooltips.js).
 * It says what the page says, and under the same rules: a fact appears once 3 installs reported it, an
 * entity nobody reported is not answered (an id typed into a URL may be unreleased content), and what the
 * game files give is labelled unconfirmed with its build. Plain text only.
 */

export type TooltipResult = { status: 200; body: TooltipResponse } | { status: 404 | 503; error: string };

const PAGE: Record<TooltipType, string> = { item: "items", npc: "npcs", quest: "quests", object: "objects" };
const NO_NAME = "No agreed name yet. A name needs 3 installs reporting the same one.";
/** A quest card's line when players agree on no title; the site's own card swaps it for the wiki title. */
export const NO_QUEST_TITLE = "No agreed title yet. A title needs 3 installs reporting the same one.";
const UNREACHABLE = "Storage is unavailable. The card is unrecorded, not empty.";
const NOT_FOUND = "Nothing to show: no such page, or players have not reported it yet.";

export function tooltipType(value: string): TooltipType | null {
  return (TOOLTIP_TYPES as readonly string[]).includes(value) ? (value as TooltipType) : null;
}

/** A positive whole number as written in a URL, or null. Ids past 2^31 are not game ids. */
export function tooltipId(value: string): number | null {
  return /^[1-9]\d{0,9}$/.test(value) && Number(value) <= 2_147_483_647 ? Number(value) : null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Whether the card is answered for an entity: players have reported it. A page shown only from the game files or
 * the Warcraft Wiki gets a 404 from the card, so it links no "Raw JSON".
 */
export const hasCard = {
  item: (page: ReturnType<typeof itemPage>) => Boolean(page.name || page.drops.length || page.pins.length),
  object: (page: ReturnType<typeof objectPage>) => Boolean(page.drops.length || page.zero),
  npc: (page: ReturnType<typeof npcPage>) => Boolean(page.name || page.pins.length),
  quest: (page: ReturnType<typeof questPage>) =>
    Boolean(page.title || page.level !== null || page.giverNpcId !== null || page.turnInNpcId !== null || page.rewards.length),
};

/**
 * What an item card says, without the game files, about the stat amounts, who may use it, its set and its Equip and
 * Use effects. With the files, those lines come from them (item-names.ts). Each value here is a fact only once 3
 * installs agree on it, as everywhere else; null is no such fact. No upload record carries these yet, so today
 * every one is null.
 */
export interface ItemCardFacts {
  /** "Classes: Warrior", "Requires Tailoring (150)": the restriction lines, as the game prints them. */
  restrictions: string[] | null;
  setName: string | null;
  /** "Equip: …" and "Use: …" lines, as the game prints them. */
  effects: string[] | null;
}

export const NO_ITEM_FACTS: ItemCardFacts = { restrictions: null, setName: null, effects: null };

/**
 * The card's lines for `ItemCardFacts`. A value nobody agreed on reads `[?]`, never a blank or a missing line, so a
 * reader can tell "not known" from "none". `hasStats` is true when the files' own lines already name the stats (as
 * `+[?] Stamina`); without them the amounts get one line of their own.
 */
export function itemFactLines(facts: ItemCardFacts, hasStats: boolean): string[] {
  return [
    ...(hasStats ? [] : [`Stats: ${PLACEHOLDER}`]),
    ...(facts.restrictions?.length ? facts.restrictions : [`Restrictions: ${PLACEHOLDER}`]),
    `Set: ${facts.setName ?? PLACEHOLDER}`,
    ...(facts.effects?.length ? facts.effects : [`Equip and Use: ${PLACEHOLDER}`]),
  ];
}

/** The card's last line when the game files cannot be read: why every line above is a placeholder. */
const NO_FILES = `${PLACEHOLDER} The game files the card reads are not available right now.`;

export async function loadTooltip(type: TooltipType, id: number): Promise<TooltipResult> {
  const url = `${SITE}/database/${PAGE[type]}/${id}`;
  const card = (c: { title: string; lines: string[]; color?: string | null; icon?: string | null; partial?: boolean; gameData?: TooltipResponse["gameData"] }): TooltipResult => ({
    status: 200,
    body: {
      ok: true, type, id, title: c.title, color: c.color && /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : null, icon: c.icon ?? null,
      lines: c.lines, partial: c.partial ?? false, url, attribution: attribution(`/database/${PAGE[type]}/${id}`), gameData: c.gameData ?? null,
    },
  });
  const unreachable: TooltipResult = { status: 503, error: UNREACHABLE };
  const notFound: TooltipResult = { status: 404, error: NOT_FOUND };

  if (type === "item") {
    const facts = await loadItemFacts();
    if (facts.unreachable) return unreachable;
    const page = itemPage(id, facts);
    // The same test as the item page: the game file tooltip only for an item players have reported.
    if (!hasCard.item(page)) return notFound;
    // The game's icon and tooltip text are Blizzard's; docs/DATA_POLICY.md ("Third extension") lets one item's
    // into a card, under the same rules as its page.
    const assets = await loadSiteAssets();
    const filesTip = assets ? (await loadItemTips(assets, [id])).get(id) : undefined;
    // The numbers 3 installs' tooltips agree on, as on the item page.
    const tip = filesTip && withReported(filesTip, await loadReportedItemFacts(id));
    // The files' lines and the reasons for their placeholders; without the files, every line is a placeholder.
    const lines = tip ? tipLines(tip) : [...itemFactLines(NO_ITEM_FACTS, false), NO_FILES];
    if (!page.name && !tip) lines.push(NO_NAME);
    if (page.drops.length) lines.push(`Dropped by ${plural(page.drops.length, "source", "sources")} players looted (3 or more installs).`);
    return card({
      title: page.name ?? tip?.name ?? `Item ${id}`, lines, color: tip?.color, icon: tip?.icon, partial: tip ? tip.partial : true,
      gameData: tip && assets ? { label: assets.label, build: assets.version, credit: CREDIT } : null,
    });
  }

  if (type === "object") {
    const facts = await loadObjectFacts();
    if (facts.unreachable) return unreachable;
    const page = objectPage(id, facts);
    if (!hasCard.object(page)) return notFound;
    return card({
      title: page.name ?? `Object ${id}`,
      lines: page.zero
        ? [`No items in ${plural(page.zero.kills, "loot window", "loot windows")} players opened.`]
        : [`${plural(page.drops.length, "item", "items")} players looted from it (3 or more installs).`],
    });
  }

  const facts = await loadWorldFacts();
  if (facts.unreachable) return unreachable;
  if (type === "npc") {
    const page = npcPage(id, facts);
    if (!hasCard.npc(page)) return notFound;
    return card({
      title: page.name ?? `NPC ${id}`,
      lines: [
        ...(page.name ? [] : [NO_NAME]),
        page.pins.length ? `Seen on ${plural(page.pins.length, "map", "maps")}, agreed by 3 or more installs.` : "No agreed position. A pin needs 3 installs on the same map.",
      ],
    });
  }

  const page = questPage(id, facts);
  if (!hasCard.quest(page)) return notFound;
  const npc = (npcId: number) => npcPage(npcId, facts).name ?? `NPC ${npcId}`;
  return card({
    title: page.title ?? `Quest ${id}`,
    lines: [
      ...(page.title ? [] : [NO_QUEST_TITLE]),
      ...(page.level === null ? [] : [`Level ${page.level}`]),
      ...(page.giverNpcId === null ? [] : [`Starts with ${npc(page.giverNpcId)}`]),
      ...(page.turnInNpcId === null ? [] : [`Ends with ${npc(page.turnInNpcId)}`]),
      ...(page.rewards.length ? [`${plural(page.rewards.length, "reward item", "reward items")} players saw (3 or more installs).`] : []),
    ],
  });
}
