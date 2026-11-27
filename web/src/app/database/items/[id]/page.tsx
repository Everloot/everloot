import { loadDropSourceNames } from "@/lib/names";
import type { Metadata } from "next";
import { trailFor } from "@/lib/breadcrumbs";
import AdSlot from "@/components/AdSlot";
import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import { notFound } from "next/navigation";
import { hasCard } from "@/lib/tooltip";
import { itemNameReporters, itemPage } from "@kb/item-page";
import { loadShownNames } from "@/lib/shown-item-names";
import { loadEdges } from "@/lib/edges";
import { loadItemSeen } from "@/lib/item-seen";
import { itemSourceValue } from "./item-source";
import { DisenchantPanel, showsDisenchant } from "./disenchant";
import { loadDisenchant } from "@/lib/disenchant";
import { bandYield } from "@kb/disenchant";
import { RelationTarget, SameIcon } from "@/components/EntityRelations";
import { gameNameFor, loadItemSetNames, loadItemTips, loadQuestNames, loadSiteAssets, loadSpellNames, readItemTips, unknownItemIcon } from "@/lib/game-assets";
import { Badge, DataTable, EvidenceLine, QUALITY_TEXT, Tabs, filledTabs, qualityOf, reportedLabel, type Column, type Fact, type TabItem } from "@/components/ui";
import { isDevelopmentItemName } from "@kb/dev-item-names";
import { categoryOf } from "@kb/item-taxonomy";
import { edgesFrom, evidenceLabel, type Edge, type Rel } from "@kb/edges";
import { CLIENT_LAYER } from "@kb/client-layer-file";
import { CLIENT_TAXONOMY, itemsHref, shownItemName, subclassLabel as labelOf } from "@/lib/items";
import { BEGINS_QUEST, FACT_WORD, withReported } from "@/lib/item-names";
import { CLIENT_QUEST_STARTS, questStartedBy } from "@/data/game-data/client-quest-starts";
import { itemTooltip } from "@/lib/item-tooltip";
import { recipeBySpell } from "@/lib/professions";
import { taughtItemId } from "@/lib/recipe-catalog";
import { itemSetOf } from "@/lib/item-sets";
import { GameCard } from "@/components/game/GameCard";
import type { Crumb } from "@/lib/jsonld";
import { loadNames, nameOf } from "@/lib/names";
import { loreForShownItem } from "@/lib/lore-links";
import EntityLink from "@/components/EntityLink";
import LoreSection from "@/components/LoreSection";
import DarkmoonItemNote from "./DarkmoonItemNote";
import { CategoryPage, categoryMetadata } from "../category-page";
import { itemIndexable } from "@/lib/indexable";
import { entityTitle, itemDescription } from "@/lib/entity-meta";
import { MarketBox, loadMarketBox } from "@/app/tools/auctions/MarketBox";
import { pendingLine } from "@kb/pending-loot";
import { itemDropSources } from "@kb/loot-tables";
import { loadLootTables, loadReportedItemFacts } from "@/lib/rollup-compute";
import { EmptyTab, EntityPage, known, LINK, ModelPicture, PinTable, Unreachable } from "../../entity";
import { loadRenders } from "@/lib/game-renders";
import { EntityIcon } from "@/components/game/EntityIcon";
import { ItemSourcesPanel, lootPage } from "../../loot-tables";
import { unknownItem } from "../../unknown";
import { itemSummary } from "@/lib/evidence";
import EntityComments from "@/components/comments/EntityComments";
import EntityScreenshots from "@/components/screenshots/EntityScreenshots";

const PROFESSIONS = { href: "/tools/professions", label: "Professions" };
/** How the files' tooltip prints the vendor price (lib/item-names.ts). */
const SELL_PRICE = "Sell Price: ";

/** The segment is an item id, or a class slug (/database/items/weapons): numbers are items, words are classes. */
type Props = { params: Promise<{ id: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> };

export const dynamic = "force-dynamic";

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params;
  if (/^[a-z][a-z0-9-]*$/.test(params.id)) return categoryMetadata(params.id, undefined, (await props.searchParams) ?? {});
  if (!/^[1-9]\d*$/.test(params.id)) return { robots: { index: false, follow: true } };
  const itemId = Number(params.id);
  const [{ facts, agreed, matched }, edges, itemSeen] = await Promise.all([loadShownNames(), loadEdges(), loadItemSeen()]);
  const page = itemPage(itemId, facts);
  const all = edgesFrom([...edges.observed, ...edges.client], "item", itemId);
  if (unknownItem(itemId, facts, all, itemSeen)) notFound();
  const name = shownItemName(itemId, agreed, matched?.names);
  const category = categoryOf(CLIENT_TAXONOMY, itemId);
  const targets = (r: Rel) => new Set(all.filter((e) => e.rel === r).map((e) => e.toId)).size;
  const description = itemDescription({
    name: name?.name ?? `Item ${itemId}`, id: itemId,
    quality: category?.quality?.name, classLabel: category?.class?.label, subclass: category?.subclass?.name,
    dropSources: page.drops.length, vendors: targets("sold_by"), createdBy: targets("created_by"), usedIn: targets("reagent_for"), questRewards: targets("reward_from"),
  });
  return {
    ...pageMetadata({ title: entityTitle(name?.name ?? `Item ${itemId}`, "item"), description, path: `/database/items/${itemId}`, image: `/database/items/${itemId}/opengraph-image` }),
    // Indexed once players have reported the item, or a source names it in the current build.
    robots: { index: itemIndexable(page, facts.unreachable, name), follow: true },
  };
}

/** Who vouches for a relation row: the installs that agree, or (the quiet marker) the game files. */
const evidence = (e: Edge) => (e.evidence === "observed" ? evidenceLabel(e) : <Badge tone="files" href={e.build ? `/changes?show=builds&q=${e.build}` : undefined} />);

export default async function ItemPage(props: Props) {
  const params = await props.params;
  if (/^[a-z][a-z0-9-]*$/.test(params.id)) return CategoryPage({ classSlug: params.id, search: (await props.searchParams) ?? {} });
  if (!/^[1-9]\d*$/.test(params.id)) notFound();
  const itemId = Number(params.id);
  const [{ facts, agreed, matched, showsTip, degraded }, edges, itemSeen, auctions] = await Promise.all([loadShownNames(), loadEdges(), loadItemSeen(), loadMarketBox(itemId)]);
  const page = itemPage(itemId, facts);
  if (unknownItem(itemId, facts, edgesFrom([...edges.observed, ...edges.client], "item", itemId), itemSeen)) notFound();
  // Named by players (3 installs agree); the badge and the facts card say so.
  const confirmed = !facts.unreachable && page.name !== null;
  // The name players agree on; else the game file name where the Warcraft Wiki gives the same one; else "Item N".
  const name = shownItemName(itemId, agreed, matched?.names);
  const title = name?.name ?? `Item ${page.itemId}`;
  // The game file tooltip only for an item players have reported or whose name shows under the item name rule:
  // any id can be typed into the URL, and an item found only in the files may be unreleased (docs/DATA_POLICY.md).
  const tipped = showsTip(itemId);
  // The manifest is read only when there is art to show: the item's tooltip or the icon of a spell the game
  // files say makes or uses it. An id nobody reported or named and nothing links to reads nothing.
  const spellLinked = edges.client.some((e) => e.fromKind === "item" && e.fromId === itemId && e.toKind === "spell");
  const assets = tipped || spellLinked ? await loadSiteAssets() : null;
  const filesTip = tipped ? (await loadItemTips(assets, [itemId])).get(itemId) : undefined;
  // An item the files give only an icon for (no ItemSparse row: the server sends it) shows that icon, unconfirmed.
  const filesRead = tipped && !filesTip ? await readItemTips(assets, [itemId]) : null;
  const filesIcon = filesRead?.icons.get(itemId);
  // The box says the files carry no stats only after a whole read of this build's item files found no record.
  const filesLack = assets && filesRead?.indexed && !filesRead.unreachable && !filesRead.degraded && !filesRead.tips.has(itemId)
    ? assets.version.split(".").pop() : undefined;
  // The model picture under the same rule as the icon and tooltip, and only beside a shown name.
  const picture = tipped && name ? (await loadRenders())?.items.get(itemId) : undefined;
  // The numbers 3 installs' tooltips agree on fill the files' placeholders, each with its installs, build and date.
  const reported = await loadReportedItemFacts(itemId);
  const tip = filesTip && withReported(filesTip, reported);
  // A recipe's taught item, under its own page's gate: one that page would not show is never read.
  const taughtId = tip ? taughtItemId(itemId) : null;
  const taught = taughtId !== null && showsTip(taughtId) ? taughtId : null;
  const [taughtFiles, taughtReported] = taught === null ? [] : await Promise.all([loadItemTips(assets, [taught]).then((t) => t.get(taught)), loadReportedItemFacts(taught)]);
  const taughtTip = taughtFiles && taughtReported ? withReported(taughtFiles, taughtReported) : undefined;
  const spellIcon = (spellId: number) => assets?.spellIcons.get(spellId);
  const category = categoryOf(CLIENT_TAXONOMY, itemId);
  const names = await loadNames();
  const nameFor = nameOf(names);
  // By the name the page shows, players' or the Warcraft Wiki's, so an item nobody has reported still links its lore page.
  const lore = name ? await loreForShownItem(itemId, name, matched?.names) : null;

  const all = edgesFrom([...edges.observed, ...edges.client], "item", itemId);
  const rel = (r: Rel) => all.filter((e) => e.rel === r);
  // The clock the page's "last seen" lines are written against, and the newest date among the observed rows.
  const now = Date.now();
  const newestSeen = [...all]
    .filter((e) => e.evidence === "observed" && e.lastSeen)
    .map((e) => e.lastSeen!)
    .sort()
    .pop() ?? null;
  // Names for the quests, sets and spells this item relates to, read only for the kinds it has (players' names come first).
  const kinds = new Set(all.map((e) => e.toKind));
  const version = CLIENT_LAYER.build.version;
  // The quest the game files say the item begins, under the same rule as its tooltip.
  const fileQuest = tipped ? questStartedBy(itemId) : undefined;
  const [questNames, setNames, spellNames] = await Promise.all([
    kinds.has("quest") || fileQuest !== undefined ? loadQuestNames(version) : null, kinds.has("item_set") ? loadItemSetNames(version) : null, kinds.has("spell") ? loadSpellNames(version) : null,
  ]);
  const gameName = gameNameFor({ quests: questNames, sets: setNames, spells: spellNames });
  // Shown only with a title the quest title rule allows: a quest without one may be unreleased, and its page a 404.
  const questTitle = fileQuest !== undefined ? questNames?.names.get(fileQuest)?.name : undefined;
  const startsQuest = fileQuest !== undefined && questTitle ? { id: fileQuest, name: questTitle } : undefined;

  const trail: Crumb[] = [
    ...trailFor("/database/items")!,
    ...(category?.class ? [{ name: category.class.label, path: itemsHref(category.class.slug) }] : []),
    ...(category?.class && category.subclass ? [{ name: category.subclass.name ?? `Subclass ${category.subclass.id}`, path: itemsHref(category.class.slug, category.subclass.slug) }] : []),
    { name: title, path: `/database/items/${itemId}` },
  ];

  // Beside each row, what the site already holds for it: the zone 3 installs measured a vendor in, and a recipe's
  // reagents and skill ranks from the game files (client-recipes.json). A column shows only where some row has a value.
  const npcZones = (npcId: number) => edges.observed.filter((z) => z.rel === "located_in" && z.fromKind === "npc" && z.fromId === npcId);
  const vendorZones = (e: Edge) => (e.rel === "sold_by" ? npcZones(e.toId) : []);
  const zoneLinks = (zones: Edge[]) => <span className="inline-flex flex-wrap gap-x-2">{zones.map((z) => <span key={z.toId}><RelationTarget edge={z} rel={z.rel} client={edges.client} /></span>)}</span>;
  const recipeOf = (e: Edge) => (e.toKind === "spell" && (e.rel === "created_by" || e.rel === "reagent_for") ? recipeBySpell(e.toId) : undefined);
  // Icons only for reagents whose tooltip shows under the item name rule; none reads nothing.
  const reagentIds = [...new Set(rel("created_by").flatMap((e) => recipeOf(e)?.reagents.map((x) => x.itemId) ?? []))].filter(showsTip);
  const reagentTips = reagentIds.length ? await loadItemTips(assets ?? await loadSiteAssets(), reagentIds) : new Map<number, { icon: string | null }>();
  const rank = (n: number | null | undefined) => (n == null ? <span className="text-muted">—</span> : n);
  const detailColumns = (rows: Edge[]): Column<Edge>[] => {
    const recipes = rows.map(recipeOf);
    return [
      ...(rows.some((e) => vendorZones(e).length) ? [{
        key: "zone", header: "Zone", cell: (e: Edge) => {
          const zones = vendorZones(e);
          return zones.length ? zoneLinks(zones) : <span className="text-muted">—</span>;
        },
      }] : []),
      ...(rows.some((e) => e.rel === "created_by") && recipes.some((r) => r?.reagents.length) ? [{
        key: "reagents", header: "Reagents", cell: (e: Edge) => {
          const reagents = recipeOf(e)?.reagents ?? [];
          return reagents.length
            ? <ul className="flex flex-col gap-1">{reagents.map((x) => <li key={x.itemId} className="inline-flex items-center gap-1"><EntityLink kind="item" id={x.itemId} name={itemName(x.itemId)} icon={reagentTips.get(x.itemId)?.icon} />{x.count > 1 && <span className="font-mono tabular-nums text-fg-2">×{x.count}</span>}</li>)}</ul>
            : <span className="text-muted">—</span>;
        },
      }] : []),
      ...(recipes.some((r) => r?.learn) ? [{ key: "learn", header: "Needs", numeric: true, cell: (e: Edge) => rank(recipeOf(e)?.learn) }] : []),
      ...(recipes.some((r) => r?.yellow) ? [{ key: "yellow", header: "Yellow", numeric: true, cell: (e: Edge) => rank(recipeOf(e)?.yellow) }] : []),
      ...(recipes.some((r) => r?.grey) ? [{ key: "grey", header: "Grey", numeric: true, cell: (e: Edge) => rank(recipeOf(e)?.grey) }] : []),
    ];
  };
  // The "Seen" column only where some row was seen in play; a tab read wholly from the game files carries
  // the item's own unconfirmed marker instead of one per row.
  const relationColumns = (head: string, rows: Edge[]): Column<Edge>[] => [
    { key: "target", header: head, cell: (e) => <span className="inline-flex flex-wrap items-center gap-1"><RelationTarget edge={e} rel={e.rel} client={edges.client} spellIcon={spellIcon} nameOf={nameFor} gameName={gameName} /></span> },
    ...detailColumns(rows),
    ...(rows.some((e) => e.evidence === "observed") ? [{ key: "source", header: "Seen", cell: evidence, nowrap: true }] : []),
  ];
  // A relation tab from player reports (sold by) empties with the agreement meter; one from the game files
  // (created by, used in) with a plain line and its own link.
  const relationTab = (id: string, label: string, r: Rel, head: string, empty: string, files?: { href: string; label: string }): TabItem => {
    const rows = rel(r);
    return {
      id, label, count: rows.length,
      panel: rows.length
        ? <><EvidenceLine rows={rows} now={now} /><DataTable dense caption={`${label}: ${title}`} columns={relationColumns(head, rows)} rows={rows} rowKey={(e) => `${e.evidence}-${e.toKind}-${e.toId}`} /></>
        : <EmptyTab message={empty} {...(files ? { players: false, action: files } : {})} />,
    };
  };

  // Each source's windows, installs and dates; its rows are the public rates in page.drops.
  const loot = await loadLootTables();
  const sources = itemDropSources(loot.tables, itemId);
  const dropNames = await loadDropSourceNames();
  // The shared pin table, with the NPC that stands there before its columns.
  const pinLead: Column<(typeof page.pins)[number]>[] = [
    { key: "npc", header: "NPC", cell: (p) => <EntityLink kind="npc" id={p.npcId} name={p.name ?? names.npcs.get(p.npcId)} /> },
  ];

  // A development leftover sharing an icon ("Monster - Item, Flower - White") stays out, as it does in the item lists.
  const icons = new Set(rel("same_icon").map((e) => e.toId));
  const iconEdges = edges.client.filter((o) => !(o.rel === "same_icon" && icons.has(o.toId) && o.fromId !== itemId && isDevelopmentItemName(shownItemName(o.fromId, agreed, matched?.names)?.name)));
  const sharers = (e: Edge) => iconEdges.filter((o) => o.rel === "same_icon" && o.toId === e.toId && o.fromId !== itemId).map((o) => o.fromId);
  const related = [...rel("part_of_set"), ...rel("same_icon").filter((e) => sharers(e).length > 0)];
  // Items sharing an icon file are named, and shown with their icon, only under the item name rule.
  const sameIcon = related.filter((e) => e.rel === "same_icon").flatMap(sharers);
  const iconNamed = [...new Set(sameIcon)].filter((id) => shownItemName(id, agreed, matched?.names)).slice(0, 12);
  const iconTips = iconNamed.length ? await loadItemTips(assets ?? await loadSiteAssets(), iconNamed.filter(showsTip)) : new Map<number, { icon: string | null }>();
  const itemName = (id: number) => shownItemName(id, agreed, matched?.names)?.name;
  // What disenchanting it gives: the band the game files (or players' reported item level) place it in.
  const disenchant = await loadDisenchant();
  const placement = disenchant.placer.place(itemId);
  const band = placement.kind === "band" ? bandYield(disenchant.tables, placement.band) : null;
  const materialIds = (band?.rows ?? []).map((r) => r.materialId).filter((id) => itemName(id));
  const materialTips = materialIds.length ? await loadItemTips(assets ?? await loadSiteAssets(), materialIds.filter(showsTip)) : new Map<number, { icon: string | null }>();
  const tabs: TabItem[] = [
    {
      // No rates yet but loot windows short of 3 installs or outside the rates: no count, so the tab and its line stay.
      id: "dropped-by", label: "Dropped by", count: facts.unreachable || (!page.drops.length && (sources.short || page.pendingLoot)) ? undefined : page.drops.length,
      panel: facts.unreachable ? <Unreachable />
        : <>
          <ItemSourcesPanel
            sources={sources}
            title={title}
            dataAsOf={loot.dataAsOf}
            zone={(d) => { const zones = d.sourceNpcId !== undefined ? npcZones(d.sourceNpcId) : []; return zones.length ? zoneLinks(zones) : null; }}
            pages={{ page: lootPage((await props.searchParams)?.drops), href: (p) => `/database/items/${itemId}${p === 1 ? "" : `?drops=${p}`}#dropped-by` }}
            source={(d) => (d.sourceNpcId !== undefined
              ? <EntityLink kind="npc" id={d.sourceNpcId} name={dropNames.npcs.get(d.sourceNpcId)?.name} />
              : <EntityLink kind="object" id={d.sourceObjectId!} name={dropNames.objects.get(d.sourceObjectId!)?.name} />)}
          />
          {/* Reported windows the rates leave out: a count, never a rate. */}
          {page.pendingLoot && <p className="py-2 text-meta text-fg-2">{pendingLine(page.pendingLoot, true)}</p>}
        </>,
    },
    relationTab("sold-by", "Sold by", "sold_by", "Vendor", "No vendor seen selling this yet. A vendor shows once 3 installs report it."),
    ...(!disenchant.unreachable && showsDisenchant(placement) ? [{
      id: "disenchant", label: "Disenchant", count: band?.state === "rated" ? band.rows.length : undefined,
      panel: <DisenchantPanel placement={placement} band={band} own={disenchant.tables.items.get(itemId)} title={title}
        item={(id) => <EntityLink kind="item" id={id} name={itemName(id)} icon={materialTips.get(id)?.icon} />} />,
    }] : []),
    relationTab("created-by", "Created by", "created_by", "Recipe", "No recipe makes this.", PROFESSIONS),
    relationTab("used-in", "Used in", "reagent_for", "Recipe", "No recipe uses this.", PROFESSIONS),
    ...(rel("reward_from").length ? [relationTab("reward-from", "Reward from", "reward_from", "Quest", "")] : []),
    ...(page.pins.length ? [{
      id: "map", label: "Map", count: page.pins.length,
      panel: <PinTable caption={`Where ${title} is found on the map`} lead={pinLead} rows={page.pins} rowKey={(p) => `${p.npcId}-${p.mapId}`} />,
    }] : []),
    ...(related.length ? [{
      id: "related", label: "Related", count: related.length,
      panel: (
        <DataTable
          dense
          caption={`Items related to ${title}`}
          columns={[
            { key: "what", header: "Relation", nowrap: true, cell: (e: Edge) => (e.rel === "same_icon" ? "Same icon" : "Part of set") },
            { key: "target", header: "With", cell: (e: Edge) => (e.rel === "same_icon" ? <SameIcon edge={e} self={itemId} client={iconEdges} itemName={itemName} itemIcon={(id) => iconTips.get(id)?.icon ?? undefined} /> : <RelationTarget edge={e} rel={e.rel} client={edges.client} nameOf={nameFor} gameName={gameName} />) },
          ]}
          rows={related}
          rowKey={(e) => `${e.rel}-${e.toId}`}
        />
      ),
    }] : []),
  ];

  // The box, as the hover card draws it (lib/item-tooltip.ts): the game file lines, the set's pieces and bonuses, and
  // the reasons for a [?] under the box, not inside the game's tooltip.
  const set = tip ? itemSetOf(itemId) : undefined;
  // The same file names the set's bonuses and tells which Use and Equip spells have a page (a spell it lacks is a 404).
  const bonusNames = set?.bonuses.length || tip?.spells ? spellNames ?? await loadSpellNames(version) : null;
  const box = itemTooltip({
    // The name as the hover card has it: the game file name where the tooltip shows and no other source names the item.
    id: itemId, tip, name: shownItemName(itemId, agreed, matched?.names, tip), category, namesQuality: matched?.names.get(itemId)?.quality,
    set: set && { ...set, pieceName: itemName, spellName: (spell) => bonusNames?.names.get(spell) },
    spellHref: (spell) => (bonusNames?.names.has(spell) ? `/database/spells/${spell}` : undefined),
    filesLack,
    taught: taught === null ? undefined : {
      id: taught, tip: taughtTip, name: shownItemName(taught, agreed, matched?.names, taughtTip),
      category: categoryOf(CLIENT_TAXONOMY, taught), namesQuality: matched?.names.get(taught)?.quality,
    },
  });
  const tooltipLines = tip ? [...box.card.lines, ...(box.card.evidence?.lines ?? []), ...(box.card.notes ?? [])] : [...box.card.lines, ...(box.card.missing ? [box.card.missing] : [])];
  // The quality colour only where the name is shown from players or the wiki: an id nobody reported stays plain. The
  // taxonomy gives the quality, else the names file (for an item whose quality the taxonomy leaves unrecorded).
  const nameQuality = category?.quality?.id ?? matched?.names.get(itemId)?.quality;
  const shownQuality = name && nameQuality !== undefined && nameQuality <= 5 ? qualityOf(nameQuality) : undefined;
  // As the lists label it: no "(OBSOLETE)" suffix and no "Subclass 0".
  const subclassLabel = category?.subclass ? labelOf(category.subclass).label : undefined;

  // The same per-item index and 3-install gate as the item lists' Source column; no row when nothing is reported.
  const source = itemSourceValue(itemSeen.from.get(itemId), filledTabs(tabs).map((t) => t.id));
  // Where to get it, above the fold: the first three sources the tabs below list, vendors (a sure source) first, then
  // drops, then recipes.
  const relationSource = (e: Edge) => (
    <span key={`${e.rel}-${e.toKind}-${e.toId}`}><RelationTarget edge={e} rel={e.rel} client={edges.client} nameOf={nameFor} gameName={gameName} /></span>
  );
  const getFrom = [
    ...rel("sold_by").map(relationSource),
    ...(facts.unreachable ? [] : sources.rows.map((d) => (d.sourceNpcId !== undefined
      ? <EntityLink key={`npc-${d.sourceNpcId}`} kind="npc" id={d.sourceNpcId} name={dropNames.npcs.get(d.sourceNpcId)?.name} />
      : <EntityLink key={`object-${d.sourceObjectId}`} kind="object" id={d.sourceObjectId!} />))),
    ...rel("created_by").map(relationSource),
  ].slice(0, 3);
  // The page in four lines: what it is, what players saw, what nobody has reported, and where the name came from.
  const requiredLevel = tip?.lines.find((l) => l.startsWith("Requires Level"))?.replace("Requires Level ", "") ?? null;
  // The vendor price the files give (the tooltip's last line), as a fact beside the box.
  const sellPrice = tip?.lines.find((l) => l.startsWith(SELL_PRICE))?.slice(SELL_PRICE.length) || null;
  const identity = [
    category?.subclass?.name ?? category?.class?.label,
    shownQuality,
    requiredLevel ? `Requires level ${requiredLevel}` : null,
  ].filter((x): x is string => Boolean(x)).join(" · ");
  const summary = itemSummary({
    identity: identity || "An item the game files list.",
    dropSources: page.drops.length,
    mapPositions: page.pins.length,
    vendors: rel("sold_by").length,
    recipes: rel("created_by").length,
    uses: rel("reagent_for").length,
    nameFrom: confirmed ? "players" : name?.source === "wiki" ? "wiki" : name?.source === "files" ? "files" : "none",
    lastSeen: newestSeen,
    now,
  });
  const quickFacts: Fact[] = [
    ...(category ? [
      { label: "Class", value: category.class ? <Link href={itemsHref(category.class.slug)} className={LINK}>{category.class.label}</Link> : known(null) },
      { label: "Subclass", value: category.class && category.subclass ? <Link href={itemsHref(category.class.slug, category.subclass.slug)} className={LINK}>{subclassLabel}</Link> : known(null) },
      { label: "Slot", value: category.slot?.name ?? "—" },
      { label: "Quality", value: category.quality ? <span className={shownQuality ? QUALITY_TEXT[shownQuality] : undefined}>{category.quality.name}</span> : known(null) },
    ] : [{ label: "Game files", value: "Not found" }]),
    ...(sellPrice ? [{ label: "Sell price", value: sellPrice, numeric: true }] : []),
    ...(startsQuest ? [{ label: "Starts a quest", value: <>
      <EntityLink kind="quest" id={startsQuest.id} name={startsQuest.name} />
      <span className="block text-muted">{CLIENT_QUEST_STARTS.label}</span>
    </> }] : []),
    ...(getFrom.length ? [{ label: "Get it from", value: <span className="inline-flex flex-col gap-1">{getFrom}</span> }] : []),
    ...(facts.unreachable ? [] : [
      { label: "Reported name", value: known(page.name, itemNameReporters(itemId, facts)) },
      { label: "Drop sources", value: known(page.drops.length || null), numeric: true },
      { label: "Map positions", value: known(page.pins.length || null), numeric: true },
      ...(source ? [{ label: "Source", value: source }] : []),
    ]),
  ];

  return (
    <EntityPage
      name={title}
      degraded={degraded || itemSeen.unreachable || edges.unreachable || reported.unreachable}
      jsonLd={{ name: title, path: `/database/items/${itemId}`, identifier: `item:${itemId}` }}
      header={{
        trail, title, quality: shownQuality,
        icon: <EntityIcon item src={tip?.icon ?? filesIcon ?? (assets ? unknownItemIcon(assets.base) : null)} quality={shownQuality} unconfirmed={!confirmed} />,
        meta: [category?.class?.label, subclassLabel, name ? <span key="id" className="tabular-nums">ID {itemId}</span> : null],
      }}
      box={
        // The page draws the icon in its header and says where the name came from in its facts.
        <GameCard card={{ ...box.card, icon: null, foot: null }} links={startsQuest ? { ...box.links, [BEGINS_QUEST]: `/database/quests/${startsQuest.id}` } : box.links} label={`${box.card.title}, from the game files`} />
      }
      facts={quickFacts}
      notices={(isDevelopmentItemName(name?.name) || (!reported.unreachable && Boolean(reported.progress?.length))) && <>
        {isDevelopmentItemName(name?.name) && (
          <p className="mt-2 text-meta text-fg-2">The game files mark this as a development item: a test, placeholder or retired entry. The item lists leave it out unless asked.</p>
        )}
        {!reported.unreachable && Boolean(reported.progress?.length) && (
          <section aria-label="Item report progress" className="mt-3 space-y-1 text-meta text-fg-2">
            <p>Not yet confirmed. Each value needs 3 installs to agree.</p>
            <ul>
              {reported.progress!.map((p) => <li key={p.fact}>{`${FACT_WORD[p.fact]}: ${reportedLabel(p.reporters)} (build ${p.build}).`}</li>)}
            </ul>
          </section>
        )}
      </>}
      media={picture && <ModelPicture picture={picture} name={title} />}
      summary={summary}
      main={<>
        <Tabs label={`${title}: relations`} tabs={tabs} />
        <DarkmoonItemNote name={name?.name} />
        {/* The prices after where the item comes from: the relations answer "where do I get this" first. */}
        <MarketBox itemId={itemId} rows={auctions} />
        {/* Blizzard Developer API Terms: no ads on a page showing Blizzard data. This page carries ads, so it reads none
            and only links to the ad-free page. A plain link, not next/link: the router's prefetch would fetch that
            page's data into this document, and the move must load a fresh document without AdSense. */}
        <p className="mt-2 mb-6 text-meta">
          <a href={`/blizzard-auctions/${itemId}`} className={LINK}>Blizzard auction house data for this item</a>
        </p>
      </>}
      related={<>
        <LoreSection match={lore} />
        {!facts.unreachable && (page.name !== null || page.drops.length > 0) && <AdSlot slot="inContent" />}
      </>}
      screenshots={<EntityScreenshots type="item" id={itemId} name={title} />}
      comments={<EntityComments type="item" id={itemId} />}
      openData={{
        report: { type: "Item", id: itemId, path: `/database/items/${itemId}` },
        text: [
          `${title} (item ${itemId})`,
          ...tooltipLines,
          ...summary,
          `Source: https://everloot.app/database/items/${itemId}`,
        ].join("\n"),
        jsonHref: !facts.unreachable && hasCard.item(page) ? `/api/tooltip/item/${itemId}` : undefined,
      }}
    />
  );
}
