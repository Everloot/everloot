import type { TooltipType } from "@everloot/protocol";
import { npcPage, vendorPage } from "../../../kb/src/world-pages";
import { loadStoredAggregates } from "./aggregate-store";
import { categoryOf } from "../../../kb/src/item-taxonomy";
import { loadSiteAssets, PRIVATE_UNREACHABLE, readItemTips, readQuestNames, readSpellNames, tipLabel } from "./game-assets";
import { withReported } from "./item-names";
import { loadCardFacts, loadListNames } from "./item-view";
import { splitWhy } from "./placeholder";
import { CLIENT_LAYER, CLIENT_TAXONOMY, NAME_FROM, shownItemName } from "./items";
import { assetsBaseUrl } from "./talents/assets";
import { loadTooltip, NO_QUEST_TITLE } from "./tooltip";

/**
 * The hover card on the site's own links to an item, NPC, quest, object, spell or vendor page (GET /database/card/<type>/<id>).
 * It shows what the page's own box shows, under the page's rules: an item's game file tooltip where its page
 * shows it (players reported it, or its name shows under the item name rule), a quest's Warcraft Wiki title
 * where its page shows one, and where a shown name comes from, which the lists used to say in a `title`.
 * Pages only, like the names it reads: the embeddable card (/api/tooltip) keeps the three-install rule.
 *
 * A 200 is kept an hour at the edge, so it is a whole card or nothing: any read that failed (the players' uploads or
 * aggregates, the names, the asset manifest, the private item files, the quest titles) makes the card a 503, never
 * a card missing what that read holds. A 404 is only for an id no page shows.
 */
export type SiteCardType = TooltipType | "spell" | "vendor";

export interface SiteCard {
  type: SiteCardType;
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
const UNAVAILABLE = { status: 503, error: UNREACHABLE } as const;
const join = (parts: (string | null | undefined)[]) => parts.filter(Boolean).join(" · ") || null;

/** A card with no game file art: an NPC, a quest or an object, as the embeddable card has it. */
const plain = (type: SiteCardType, id: number, title: string, lines: string[], foot: string | null = null): SiteCardResult =>
  ({ status: 200, body: { type, id, title, quality: null, color: null, icon: null, lines, foot } });

export async function loadSiteCard(type: SiteCardType, id: number): Promise<SiteCardResult> {
  if (type === "spell" || type === "vendor") {
    try { return await (type === "spell" ? spellCard(id) : vendorCard(id)); }
    catch { return UNAVAILABLE; }
  }
  if (type === "item") return itemCard(id);
  const result = await loadTooltip(type, id);
  // Storage down: the players' facts are unread, so no wiki title stands in for them.
  if (result.status === 503) return result;
  // A quest players agree on no title for: the quest page shows the Warcraft Wiki's, for a quest the game files list.
  const agreedTitle = result.status === 200 && !result.body.lines.includes(NO_QUEST_TITLE);
  if (type === "quest" && !agreedTitle) {
    const names = await readQuestNames(CLIENT_LAYER.build.version);
    if (names === PRIVATE_UNREACHABLE) return UNAVAILABLE;
    const wiki = names?.names.get(id)?.name;
    if (wiki) return plain(type, id, wiki, result.status === 200 ? result.body.lines.filter((l) => l !== NO_QUEST_TITLE) : [], NAME_FROM.wiki);
  }
  return result.status === 200 ? plain(type, id, result.body.title, result.body.lines) : result;
}

async function spellCard(id: number): Promise<SiteCardResult> {
  const [assets, names] = await Promise.all([loadSiteAssets(), readSpellNames(CLIENT_LAYER.build.version)]);
  // A configured catalog that cannot be read must not turn into a cached, incomplete card.
  if (names === PRIVATE_UNREACHABLE || (assetsBaseUrl() && (!assets || !names))) return UNAVAILABLE;
  const tip = assets?.spellTips.get(id);
  const title = names?.names.get(id) ?? tip?.name;
  if (!title) return { status: 404, error: NOT_FOUND };
  return {
    status: 200,
    body: {
      type: "spell", id, title, quality: null, color: null, icon: assets?.spellIcons.get(id) ?? null,
      lines: [tip?.text || "No text for this spell in the client files."],
      foot: assets ? tipLabel(assets) : `Found in game files, unconfirmed · build ${CLIENT_LAYER.build.version}`,
    },
  };
}

async function vendorCard(id: number): Promise<SiteCardResult> {
  // Read only the cron's stored view. loadWorldFacts can replay the full corpus on a miss.
  const set = await loadStoredAggregates({ strict: true });
  if (!set) return UNAVAILABLE;
  const npc = npcPage(id, set.world);
  if (!npc.name) return { status: 404, error: NOT_FOUND };
  const goods = vendorPage(id, set.world).offers.length;
  return plain("vendor", id, npc.name, [
    npc.pins.length ? `Seen on ${npc.pins.length} ${npc.pins.length === 1 ? "map" : "maps"}, agreed by 3 or more installs.` : "No agreed position. A pin needs 3 installs on the same map.",
    goods ? `${goods} ${goods === 1 ? "price" : "prices"}, agreed by 3 or more installs.` : "No agreed goods yet. An item shows once 3 installs see it for sale.",
  ]);
}

async function itemCard(id: number): Promise<SiteCardResult> {
  // The cron's stored item view (lib/item-view.ts), the same names the item page shows, so a card never replays or
  // downloads the whole corpus; the view's absence falls back to that.
  const shown = await loadListNames();
  // Unread uploads or names: whether a page shows this id, and under what name, is unknown.
  if (shown.unreachable || shown.degraded) return UNAVAILABLE;
  // The item page's test for its game file box; any other id may be unreleased content.
  if (!shown.showsTip(id)) return { status: 404, error: NOT_FOUND };
  // As the item page's box: the numbers 3 installs agree on, with their installs, build and date.
  const [files, reported] = await Promise.all([
    loadSiteAssets().then((assets) => (assets || !assetsBaseUrl() ? readItemTips(assets, [id]) : null)),
    loadCardFacts(id),
  ]);
  // A manifest that did not load (with its URL set), a private file that could not be read or is broken, or the aggregates.
  if (!files || files.unreachable || files.degraded || reported.unreachable) return UNAVAILABLE;
  const filesTip = files.tips.get(id);
  const tip = filesTip && withReported(filesTip, reported);
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
