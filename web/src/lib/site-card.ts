import { loadWikiEntityNames, shownNpcName } from "./wiki-entity-names";
import type { TooltipType } from "@everloot/protocol";
import { npcPage, vendorPage } from "@kb/world-pages";
import { loadWorldFacts } from "./rollup-compute";
import { loadStoredAggregates } from "./aggregate-store";
import { categoryOf } from "@kb/item-taxonomy";
import { loadSiteAssets, PRIVATE_MALFORMED, PRIVATE_UNREACHABLE, readItemSetNames, readItemTips, readQuestNames, readSpellNames, tipLabel } from "./game-assets";
import { CLIENT_LABEL } from "@kb/edges";
import { CLIENT_ACHIEVEMENTS } from "@/data/game-data/client-achievements";
import { currencyEntries, mountEntries, petEntries } from "./collectibles";
import { factionInFiles, loadCatalog, titleDisplayName } from "./completion-lists";
import { instanceRows, levelLabel } from "./instances";
import { itemSet } from "./item-sets";
import { zonePlaces } from "./places";
import { holidayEntries, lastsLabel, petFamilyEntries, startLabel } from "./world-events";
import { placedEntrances, zoneByMapId } from "./zones";
import { WORLD_MAP } from "./world-map";
import { withReported } from "./item-names";
import { loadCardFacts, loadListNames } from "./item-view";
import { splitWhy } from "./placeholder";
import { CLIENT_LAYER, CLIENT_TAXONOMY, NAME_FROM, shownItemName } from "./items";
import { CLIENT_EDGES } from "@kb/client-layer-file";
import { loadSpellTalents } from "./talents/spell-talents";
import { pinLink } from "./world-map";
import { assetsBaseUrl } from "./talents/assets";
import { loadTooltip, NO_QUEST_TITLE } from "./tooltip";

/**
 * The hover card on the site's own links to an item, NPC, quest, object, spell or vendor page (GET /card/<type>/<id>).
 * It shows what the page's own box shows, under the page's rules: an item's game file tooltip where its page
 * shows it (players reported it, or its name shows under the item name rule), a quest's Warcraft Wiki title
 * where its page shows one, and where a shown name comes from, which the lists used to say in a `title`.
 * Pages only, like the names it reads: the embeddable card (/api/tooltip) keeps the three-install rule.
 *
 * A 200 is kept an hour at the edge, so it is a whole card or nothing: any read that failed (the players' uploads or
 * aggregates, the names, the asset manifest, the private item files, the quest titles) makes the card a 503, never
 * a card missing what that read holds. A 404 is only for an id no page shows.
 */
export type SiteCardType = TooltipType | "spell" | "vendor" | EntryCardType;

/**
 * The pages built on the game files' lists, each with a card: its name as the page shows it, the art its header
 * shows, and a few of its facts. Achievements, factions, titles and quest chains also read the completion rollup, as
 * their pages do, and dungeons and raids the cron's stored view; the rest are the committed game data alone.
 */
export const ENTRY_CARD_TYPES = ["achievement", "faction", "title", "chain", "zone", "instance", "item-set", "mount", "pet", "currency", "holiday", "family"] as const;
export type EntryCardType = (typeof ENTRY_CARD_TYPES)[number];
export const isEntryCardType = (v: unknown): v is EntryCardType => (ENTRY_CARD_TYPES as readonly unknown[]).includes(v);

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
  if (isEntryCardType(type)) {
    try { return await entryCard(type, id); }
    catch { return UNAVAILABLE; }
  }
  if (type === "spell" || type === "vendor") {
    try { return await (type === "spell" ? spellCard(id) : vendorCard(id)); }
    catch { return UNAVAILABLE; }
  }
  if (type === "item") return itemCard(id);
  const result = await loadTooltip(type, id);
  // Storage down: the players' facts are unread, so no wiki title stands in for them.
  if (result.status === 503) return result;
  // A quest players agree on no title for: the quest page shows the Warcraft Wiki's, for a quest the game files list.
  if (type === "npc" && (result.status !== 200 || result.body.title === `NPC ${id}`)) {
    const wiki = await loadWikiEntityNames("npc");
    const facts = await loadWorldFacts();
    if (facts.unreachable) return UNAVAILABLE;
    const name = shownNpcName(id, facts, wiki).name;
    if (name) return plain(type, id, name, result.status === 200 ? result.body.lines.filter((l) => !l.startsWith("No agreed name")) : [], NAME_FROM.wiki);
  }
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
  const [assets, names, set, talents] = await Promise.all([
    loadSiteAssets(), readSpellNames(CLIENT_LAYER.build.version), loadStoredAggregates({ strict: true }), loadSpellTalents(),
  ]);
  // A configured catalog that cannot be read must not turn into a cached, incomplete card.
  if (names === PRIVATE_UNREACHABLE || names === PRIVATE_MALFORMED || !assets || !set) return UNAVAILABLE;
  const tip = assets?.spellTips.get(id);
  const wiki = await loadWikiEntityNames("spell");
  const name = names?.names.get(id) || tip?.name || wiki?.names.get(id)?.name;
  const related = [...set.edges, ...CLIENT_EDGES].some((edge) =>
    (edge.fromKind === "spell" && edge.fromId === id) || (edge.toKind === "spell" && edge.toId === id));
  if (names !== null && name === undefined && !tip && !related && !talents.get(id)?.length) return { status: 404, error: NOT_FOUND };
  const title = name ?? tip?.name ?? `Spell ${id}`;
  return {
    status: 200,
    body: {
      type: "spell", id, title, quality: null, color: null, icon: assets?.spellIcons.get(id) ?? null,
      lines: [tip?.text || "No text for this spell in the client files."],
      foot: join([!names?.names.get(id) && !tip?.name && wiki?.names.has(id) ? NAME_FROM.wiki : null, tipLabel(assets!)]),
    },
  };
}

async function vendorCard(id: number): Promise<SiteCardResult> {
  // Read only the cron's stored view. loadWorldFacts can replay the full corpus on a miss.
  const set = await loadStoredAggregates({ strict: true });
  if (!set) return UNAVAILABLE;
  const npc = npcPage(id, set.world);
  if (!set.world.vendors.some((row) => row.vendorNpcId === id)) return { status: 404, error: NOT_FOUND };
  const places = npc.pins.filter((pin) => pinLink(pin.mapId, pin.x, pin.y)).length;
  const goods = vendorPage(id, set.world).offers.length;
  return plain("vendor", id, npc.name ?? `Vendor NPC ${id}`, [
    places ? `Seen on ${places} ${places === 1 ? "map" : "maps"}, agreed by 3 or more installs.` : "No agreed position. A pin needs 3 installs on the same map.",
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
      type: "item", id, title: name?.name ?? `Item ${id}`, quality, color: name && quality === null ? name.color : null, icon: tip?.icon ?? files.icons.get(id) ?? null, lines, ...(reasons.length ? { notes: reasons } : {}),
      foot: join([name && name.source !== "files" ? NAME_FROM[name.source] : null, tip?.label]),
    },
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
/** The foot of a card whose page says the entry is the game files' own; a confirmed entry's page says players reported it. */
const filesFoot = (confirmed: boolean) => (confirmed ? "As three installs reported it" : CLIENT_LABEL);
const kept = (parts: (string | null | undefined | false | 0)[]) => parts.filter((p): p is string => Boolean(p));
const NO_CARD = { status: 404, error: NOT_FOUND } as const;
type Assets = NonNullable<Awaited<ReturnType<typeof loadSiteAssets>>>;

/** The art a page's header shows, by id, from the manifest; a manifest that did not load with its URL set is a failed read. */
async function art(from: (assets: Assets) => string | undefined): Promise<string | null | typeof UNAVAILABLE> {
  const assets = await loadSiteAssets();
  if (!assets) return assetsBaseUrl() ? UNAVAILABLE : null;
  return from(assets) ?? null;
}

const failed = (icon: string | null | typeof UNAVAILABLE): icon is typeof UNAVAILABLE => typeof icon === "object" && icon !== null;

/** A card of one of the game-file entry pages, under that page's rules: a 404 where the page is a 404. */
async function entryCard(type: EntryCardType, id: number): Promise<SiteCardResult> {
  const card = (title: string, lines: string[], foot: string | null, icon: string | null = null): SiteCardResult =>
    ({ status: 200, body: { type, id, title, quality: null, color: null, icon, lines, foot } });

  switch (type) {
    case "achievement": case "faction": case "title": case "chain": {
      // The pages read the completion rollup to say whether three installs confirmed the entry, and under what name.
      const catalog = await loadCatalog();
      if (!catalog?.confirmations) return UNAVAILABLE;
      if (type === "achievement") {
        const listed = catalog.achievements.find((a) => a.achievementId === id);
        const files = CLIENT_ACHIEVEMENTS.achievements[String(id)];
        if (!listed && !files) return NO_CARD;
        const entry = listed?.confirmed ? listed : null;
        const points = entry?.points ?? files?.points ?? null;
        const criteria = entry ? entry.criteriaCount : files?.criteria.length ?? null;
        return card(listed?.name ?? files!.title, kept([
          entry ? entry.category : files?.description,
          points !== null && plural(points, "point"),
          criteria !== null && criteria > 0 && plural(criteria, "criterion", "criteria"),
        ]), filesFoot(Boolean(entry)));
      }
      if (type === "faction") {
        const entry = catalog.factions.find((f) => f.factionId === id);
        if (!entry) return NO_CARD;
        const files = factionInFiles(id);
        return card(entry.name, kept([
          files?.parent?.name ?? entry.header, entry.major && "Major faction", files?.header && "A header of the reputation pane",
        ]), filesFoot(entry.confirmed));
      }
      if (type === "title") {
        const entry = catalog.titles.find((t) => t.titleId === id);
        return entry ? card(titleDisplayName(entry.name), ["Character title"], filesFoot(entry.confirmed)) : NO_CARD;
      }
      const entry = catalog.chains.find((c) => c.questLineId === id);
      if (!entry) return NO_CARD;
      const count = entry.questIds.length;
      return card(entry.name, [entry.truncated ? `More than ${plural(count, "quest")}` : plural(count, "quest")], filesFoot(entry.confirmed));
    }
    case "zone": {
      // Released zones only: a held-back zone has no page.
      const zone = zoneByMapId(id);
      if (!zone) return NO_CARD;
      const places = zonePlaces(id);
      const named = places ? places.pois.length + places.subzones.length : 0;
      const entrances = placedEntrances(WORLD_MAP).filter((e) => e.zone?.mapId === id).length;
      return card(zone.name, kept([
        `Zone in ${zone.continentName}`,
        named > 0 && `${plural(named, "named place")} in the game files`,
        entrances > 0 && plural(entrances, "dungeon or raid entrance", "dungeon and raid entrances"),
      ]), null);
    }
    case "instance": {
      // The cron's stored view, as the vendor card reads it: the names and kinds 3 installs agree on beside the files'.
      const set = await loadStoredAggregates({ strict: true });
      if (!set) return UNAVAILABLE;
      const asOf = set.dataAsOf && Number.isFinite(Date.parse(set.dataAsOf)) ? new Date(set.dataAsOf) : undefined;
      const row = instanceRows({ instances: set.instances, ...(asOf ? { asOf } : {}) }).get(id);
      if (!row) return NO_CARD;
      const level = levelLabel(row.level);
      const entrance = row.confirmed[0]?.zoneName ?? row.files[0]?.zoneName;
      return card(row.name ?? `Instance ${id}`, kept([
        `${row.raid === null ? "Instance" : row.raid ? "Raid" : "Dungeon"}${level ? `, level ${level}` : ""}`,
        row.encounters.length > 0 && `${plural(row.encounters.length, "boss", "bosses")} in the game files`,
        entrance && `Entrance in ${entrance}`,
      ]), null);
    }
    case "item-set": {
      const set = itemSet(id);
      if (!set) return NO_CARD;
      // The set and bonus names are the private files', as on the set page; a failed read is never a card without them.
      const version = CLIENT_LAYER.build.version;
      const [names, spells] = await Promise.all([readItemSetNames(version), set.bonuses.length ? readSpellNames(version) : null]);
      if (names === PRIVATE_UNREACHABLE || names === PRIVATE_MALFORMED || spells === PRIVATE_UNREACHABLE || spells === PRIVATE_MALFORMED) return UNAVAILABLE;
      return card(names?.names.get(id) ?? `Item set ${id}`, [
        plural(set.items.length, "piece"),
        ...set.bonuses.map(([count, spell]) => `(${count}) Set: ${spells?.names.get(spell) ?? `Spell ${spell}`}`),
      ], CLIENT_LABEL);
    }
    case "mount": {
      const mount = mountEntries()?.find((m) => m.id === id);
      if (!mount) return NO_CARD;
      const icon = await art((a) => a.spellIcons.get(mount.spellId));
      if (failed(icon)) return icon;
      // Whether 3 installs confirm a mount is read from the whole corpus, which a card never reads: the card says neither.
      return card(mount.name, kept(["Mount", mount.ridingSkill && `Requires Riding (${mount.ridingSkill})`]), null, icon);
    }
    case "pet": {
      const pet = petEntries()?.find((p) => p.id === id);
      if (!pet) return NO_CARD;
      const icon = await art((a) => a.petIcons.get(id));
      return failed(icon) ? icon : card(pet.name, ["Companion pet"], CLIENT_LABEL, icon);
    }
    case "currency": {
      const currency = currencyEntries()?.find((c) => c.id === id);
      if (!currency) return NO_CARD;
      const icon = await art((a) => a.currencyIcons.get(id));
      if (failed(icon)) return icon;
      return card(currency.name, kept([currency.description, currency.max && `Maximum: ${currency.max.toLocaleString("en-US")}`, currency.category]), CLIENT_LABEL, icon);
    }
    case "holiday": {
      const holiday = holidayEntries()?.find((h) => h.id === id);
      if (!holiday) return NO_CARD;
      const lasts = lastsLabel(holiday.hours);
      return card(holiday.name, kept([holiday.starts[0] && startLabel(holiday.starts[0]), lasts && `Lasts ${lasts}`]), CLIENT_LABEL);
    }
    case "family": {
      const family = petFamilyEntries()?.find((f) => f.id === id);
      if (!family) return NO_CARD;
      const icon = await art((a) => a.familyIcons.get(id));
      return failed(icon) ? icon : card(family.name, ["Hunter pet family", `${plural(family.spellIds.length, "spell")} on its skill line`], CLIENT_LABEL, icon);
    }
  }
}
