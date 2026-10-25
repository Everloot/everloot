import type { TooltipType } from "@everloot/protocol";
import { categoryOf } from "../../../kb/src/item-taxonomy";
import { loadItemTips, loadQuestNames, loadSiteAssets } from "./game-assets";
import { withReported } from "./item-names";
import { splitWhy } from "./placeholder";
import { loadReportedItemFacts } from "./rollup-compute";
import { CLIENT_LAYER, CLIENT_TAXONOMY, NAME_FROM, shownItemName } from "./items";
import { loadShownNames } from "./shown-item-names";
import { loadTooltip, NO_QUEST_TITLE } from "./tooltip";

/**
 * The hover card on the site's own links to an item, NPC, quest or object page (GET /database/card/<type>/<id>).
 * It shows what the page's own box shows, under the page's rules: an item's game file tooltip where its page
 * shows it (players reported it, or its name shows under the item name rule), a quest's Warcraft Wiki title
 * where its page shows one, and where a shown name comes from, which the lists used to say in a `title`.
 * Pages only, like the names it reads: the embeddable card (/api/tooltip) keeps the three-install rule.
 */
export interface SiteCard {
  type: TooltipType;
  id: number;
  title: string;
  /** The game's quality (0 poor to 5 legendary) for an item whose name is shown; null otherwise. */
  quality: number | null;
  /** The name's colour where the client layer gives no quality: the tooltip's or the matched name's. */
  color: string | null;
  icon: string | null;
  lines: string[];
  /** Why the lines hold `[?]`, apart from the lines so the card can draw them as a footnote; absent without any. */
  notes?: string[];
  /** Where the name and the game file lines come from, one short line; null when there is nothing to say. */
  foot: string | null;
}

export type SiteCardResult = { status: 200; body: SiteCard } | { status: 404 | 503; error: string };

const NOT_FOUND = "No card: no such page, or players have not reported it yet.";
const UNREACHABLE = "Storage is unavailable. The card is unrecorded, not empty.";
const join = (parts: (string | null | undefined)[]) => parts.filter(Boolean).join(" · ") || null;

/** A card with no game file art: an NPC, a quest or an object, as the embeddable card has it. */
const plain = (type: TooltipType, id: number, title: string, lines: string[], foot: string | null = null): SiteCardResult =>
  ({ status: 200, body: { type, id, title, quality: null, color: null, icon: null, lines, foot } });

export async function loadSiteCard(type: TooltipType, id: number): Promise<SiteCardResult> {
  if (type === "item") return itemCard(id);
  const result = await loadTooltip(type, id);
  // A quest players agree on no title for: the quest page shows the Warcraft Wiki's, for a quest the game files list.
  const agreedTitle = result.status === 200 && !result.body.lines.includes(NO_QUEST_TITLE);
  if (type === "quest" && !agreedTitle) {
    const wiki = (await loadQuestNames(CLIENT_LAYER.build.version))?.names.get(id)?.name;
    if (wiki) return plain(type, id, wiki, result.status === 200 ? result.body.lines.filter((l) => l !== NO_QUEST_TITLE) : [], NAME_FROM.wiki);
  }
  return result.status === 200 ? plain(type, id, result.body.title, result.body.lines) : result;
}

async function itemCard(id: number): Promise<SiteCardResult> {
  const shown = await loadShownNames();
  // The item page's test for its game file box; any other id may be unreleased content.
  if (!shown.showsTip(id)) return shown.facts.unreachable ? { status: 503, error: UNREACHABLE } : { status: 404, error: NOT_FOUND };
  const filesTip = (await loadItemTips(await loadSiteAssets(), [id])).get(id);
  // As the item page's box: the numbers 3 installs agree on, with their installs, build and date.
  const tip = filesTip && withReported(filesTip, await loadReportedItemFacts(id));
  const name = shownItemName(id, shown.agreed, shown.matched?.names, tip);
  const category = categoryOf(CLIENT_TAXONOMY, id);
  // As the item page's box: the game's lines, else the type and slot from the client layer.
  const { reasons, evidence } = splitWhy(tip?.why ?? []);
  const lines = tip
    ? [...tip.lines, ...evidence]
    : [category?.subclass?.name ?? category?.class?.label, category?.slot?.name].filter((l): l is string => Boolean(l));
  // The quality colour only where a name is shown, as on the item page; "Item N" stays plain.
  const quality = name && category?.quality && category.quality.id <= 5 ? category.quality.id : null;
  return {
    status: 200,
    body: {
      type: "item", id, title: name?.name ?? `Item ${id}`, quality, color: name && quality === null ? name.color : null, icon: tip?.icon ?? null, lines, ...(reasons.length ? { notes: reasons } : {}),
      foot: join([name && name.source !== "files" ? NAME_FROM[name.source] : null, tip?.label]),
    },
  };
}