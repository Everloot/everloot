import type { Metadata } from "next";
import AdSlot from "@/components/AdSlot";
import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import { notFound } from "next/navigation";
import { itemPage } from "../../../../../../kb/src/item-page";
import { loadShownNames } from "@/lib/shown-item-names";
import { loadEdges } from "@/lib/edges";
import { loadItemSeen } from "@/lib/item-seen";
import { itemSourceValue } from "./item-source";
import { RelationTarget, SameIcon } from "@/components/EntityRelations";
import { pinLink } from "@/lib/world-map";
import { gameNameFor, loadItemSetNames, loadItemTips, loadQuestNames, loadSiteAssets, loadSpellNames } from "@/lib/game-assets";
import { Badge, Container, DataTable, EvidenceLine, Facts, InShort, OpenData, QUALITY_TEXT, Tabs, TooltipFrame, qualityOf, type Column, type Fact, type TabItem } from "@/components/ui";
import { categoryOf } from "../../../../../../kb/src/item-taxonomy";
import { edgesFrom, evidenceLabel, type Edge, type Rel } from "../../../../../../kb/src/edges";
import { CLIENT_LAYER, CLIENT_TAXONOMY, itemsHref, shownItemName, subclassLabel as labelOf } from "@/lib/items";
import { tipLines, withReported } from "@/lib/item-names";
import type { Crumb } from "@/lib/jsonld";
import { loadNames, nameOf } from "@/lib/names";
import { loreForEntity } from "@/lib/lore";
import EntityLink from "@/components/EntityLink";
import LoreSection from "@/components/LoreSection";
import { CategoryPage, categoryMetadata } from "../category-page";
import { itemIndexable } from "@/lib/indexable";
import { entityTitle, itemDescription } from "@/lib/entity-meta";
import { MarketBox, loadMarketBox } from "@/app/tools/auctions/MarketBox";
import { pendingLine } from "../../../../../../kb/src/pending-loot";
import { itemDropSources } from "../../../../../../kb/src/loot-tables";
import { loadLootTables, loadReportedItemFacts } from "@/lib/rollup-compute";
import { EmptyTab, EntityHeader, EntityIcon, EntityTop, known, LINK, Unreachable } from "../../entity";
import { ItemSourcesPanel } from "../../loot-tables";
import { itemSummary } from "@/lib/evidence";

const PROFESSIONS = { href: "/tools/professions", label: "Professions" };

/** The segment is an item id, or a class slug (/database/items/weapons): numbers are items, words are classes. */
type Props = { params: Promise<{ id: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> };

export const dynamic = "force-dynamic";

/**
 * An id neither the game files nor any upload knows: no row in the client layer, no report about it (even one
 * short of the 3 installs), no relation. It is a 404, not an empty page. While upload storage is out of reach
 * nothing can be ruled out.
 */
function unknownItem(itemId: number, facts: Awaited<ReturnType<typeof loadShownNames>>["facts"], relations: readonly Edge[], seen: { seen: Set<number>; unreachable: boolean }): boolean {
  if (facts.unreachable || seen.unreachable || categoryOf(CLIENT_TAXONOMY, itemId) !== null || relations.length > 0 || seen.seen.has(itemId)) return false;
  return !facts.names.some((r) => r.itemId === itemId) && !facts.rates.some((r) => r.itemId === itemId);
}

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
    ...pageMetadata({ title: entityTitle(name?.name ?? `Item ${itemId}`, "item"), description, path: `/database/items/${itemId}` }),
    // Indexed once players have reported the item, or a source names it in the current build.
    robots: { index: itemIndexable(page, facts.unreachable, name), follow: true },
  };
}

/** Who vouches for a relation row: the installs that agree, or (the quiet marker) the game files. */
const evidence = (e: Edge) => (e.evidence === "observed" ? evidenceLabel(e) : <Badge tone="files" />);

export default async function ItemPage(props: Props) {
  const params = await props.params;
  if (/^[a-z][a-z0-9-]*$/.test(params.id)) return CategoryPage({ classSlug: params.id, search: (await props.searchParams) ?? {} });
  if (!/^[1-9]\d*$/.test(params.id)) notFound();
  const itemId = Number(params.id);
  const [{ facts, agreed, matched, showsTip }, edges, itemSeen, auctions] = await Promise.all([loadShownNames(), loadEdges(), loadItemSeen(), loadMarketBox(itemId)]);
  const page = itemPage(itemId, facts);
  if (unknownItem(itemId, facts, edgesFrom([...edges.observed, ...edges.client], "item", itemId), itemSeen)) notFound();
  // Named by players (3 installs agree); the badge and the facts card say so.
  const confirmed = !facts.unreachable && page.name !== null;
  // The name players agree on; else the game file name where the Warcraft Wiki gives the same one; else "Item N".
  const name = shownItemName(itemId, agreed, matched?.names);
  const title = name?.name ?? `Item ${page.itemId}`;
  const seen = !facts.unreachable && Boolean(page.name || page.drops.length || page.pins.length);
  // The game file tooltip only for an item players have reported or whose name shows under the item name rule:
  // any id can be typed into the URL, and an item found only in the files may be unreleased (docs/DATA_POLICY.md).
  const tipped = showsTip(itemId);
  // The manifest is read only when there is art to show: the item's tooltip or the icon of a spell the game
  // files say makes or uses it. An id nobody reported or named and nothing links to reads nothing.
  const spellLinked = edges.client.some((e) => e.fromKind === "item" && e.fromId === itemId && e.toKind === "spell");
  const assets = tipped || spellLinked ? await loadSiteAssets() : null;
  const filesTip = tipped ? (await loadItemTips(assets, [itemId])).get(itemId) : undefined;
  // The numbers 3 installs' tooltips agree on fill the files' placeholders, each with its installs, build and date.
  const tip = filesTip && withReported(filesTip, await loadReportedItemFacts(itemId));
  const spellIcon = (spellId: number) => assets?.spellIcons.get(spellId);
  const category = categoryOf(CLIENT_TAXONOMY, itemId);
  const quality = category?.quality && category.quality.id <= 5 ? qualityOf(category.quality.id) : undefined;
  const names = await loadNames();
  const nameFor = nameOf(names);
  const lore = seen && page.name ? loreForEntity("item", page.name) : null;

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
  const [questNames, setNames, spellNames] = await Promise.all([
    kinds.has("quest") ? loadQuestNames(version) : null, kinds.has("item_set") ? loadItemSetNames(version) : null, kinds.has("spell") ? loadSpellNames(version) : null,
  ]);
  const gameName = gameNameFor({ quests: questNames, sets: setNames, spells: spellNames });

  const trail: Crumb[] = [
    { name: "Home", path: "/" },
    { name: "Database", path: "/database" },
    { name: "Items", path: "/database/items" },
    ...(category?.class ? [{ name: category.class.label, path: itemsHref(category.class.slug) }] : []),
    ...(category?.class && category.subclass ? [{ name: category.subclass.name ?? `Subclass ${category.subclass.id}`, path: itemsHref(category.class.slug, category.subclass.slug) }] : []),
    { name: title, path: `/database/items/${itemId}` },
  ];

  // The "Seen" column only where some row was seen in play; a tab read wholly from the game files carries
  // the item's own unconfirmed marker instead of one per row.
  const relationColumns = (head: string, rows: Edge[]): Column<Edge>[] => [
    { key: "target", header: head, cell: (e) => <span className="inline-flex flex-wrap items-center gap-1"><RelationTarget edge={e} rel={e.rel} client={edges.client} spellIcon={spellIcon} nameOf={nameFor} gameName={gameName} /></span> },
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
  const pinColumns: Column<(typeof page.pins)[number]>[] = [
    { key: "npc", header: "NPC", cell: (p) => <EntityLink kind="npc" id={p.npcId} name={p.name ?? names.npcs.get(p.npcId)} /> },
    { key: "map", header: "Map", numeric: true, cell: (p) => p.mapId },
    { key: "at", header: "Position", numeric: true, cell: (p) => `${p.x}, ${p.y}` },
    { key: "installs", header: "Reporters", numeric: true, cell: (p) => p.reporters },
    { key: "show", header: "", cell: (p) => { const href = pinLink(p.mapId, p.x, p.y); return href ? <Link href={href} className={LINK}>Show on the map</Link> : null; } },
  ];

  const related = [...rel("part_of_set"), ...rel("same_icon")];
  // Items sharing an icon file are named, and shown with their icon, only under the item name rule.
  const sameIcon = related.filter((e) => e.rel === "same_icon").flatMap((e) => edges.client.filter((o) => o.rel === "same_icon" && o.toId === e.toId && o.fromId !== itemId).map((o) => o.fromId));
  const iconNamed = [...new Set(sameIcon)].filter((id) => shownItemName(id, agreed, matched?.names)).slice(0, 12);
  const iconTips = iconNamed.length ? await loadItemTips(assets ?? await loadSiteAssets(), iconNamed.filter(showsTip)) : new Map<number, { icon: string | null }>();
  const itemName = (id: number) => shownItemName(id, agreed, matched?.names)?.name;
  const tabs: TabItem[] = [
    {
      id: "dropped-by", label: "Dropped by", count: facts.unreachable ? undefined : page.drops.length,
      panel: facts.unreachable ? <Unreachable />
        : <>
          <ItemSourcesPanel
            sources={sources}
            title={title}
            dataAsOf={loot.dataAsOf}
            source={(d) => (d.sourceNpcId !== undefined
              ? <EntityLink kind="npc" id={d.sourceNpcId} name={names.npcs.get(d.sourceNpcId)} />
              : <EntityLink kind="object" id={d.sourceObjectId!} />)}
          />
          {/* Reported windows the rates leave out: a count, never a rate. */}
          {page.pendingLoot && <p className="py-2 text-meta text-fg-2">{pendingLine(page.pendingLoot, true)}</p>}
        </>,
    },
    relationTab("sold-by", "Sold by", "sold_by", "Vendor", "No vendor seen selling this yet."),
    relationTab("created-by", "Created by", "created_by", "Recipe", "No recipe makes this.", PROFESSIONS),
    relationTab("used-in", "Used in", "reagent_for", "Recipe", "No recipe uses this.", PROFESSIONS),
    ...(rel("reward_from").length ? [relationTab("reward-from", "Reward from", "reward_from", "Quest", "")] : []),
    ...(page.pins.length ? [{
      id: "map", label: "Map", count: page.pins.length,
      panel: <DataTable dense caption={`Where ${title} is found on the map`} columns={pinColumns} rows={page.pins} rowKey={(p) => `${p.npcId}-${p.mapId}`} />,
    }] : []),
    ...(related.length ? [{
      id: "related", label: "Related", count: related.length,
      panel: (
        <DataTable
          dense
          caption={`Items related to ${title}`}
          columns={[
            { key: "what", header: "Relation", nowrap: true, cell: (e: Edge) => (e.rel === "same_icon" ? "Same icon" : "Part of set") },
            { key: "target", header: "With", cell: (e: Edge) => (e.rel === "same_icon" ? <SameIcon edge={e} self={itemId} client={edges.client} itemName={itemName} itemIcon={(id) => iconTips.get(id)?.icon ?? undefined} /> : <RelationTarget edge={e} rel={e.rel} client={edges.client} nameOf={nameFor} gameName={gameName} />) },
          ]}
          rows={related}
          rowKey={(e) => `${e.rel}-${e.toId}`}
        />
      ),
    }] : []),
  ];

  const tooltipLines = tip
    ? tipLines(tip)
    : [category?.subclass?.name ?? category?.class?.label, category?.slot?.name].filter((l): l is string => Boolean(l));
  // The quality colour only where the name is shown from players or the wiki: an id nobody reported stays plain.
  const shownQuality = name ? quality : undefined;
  // As the lists label it: no "(OBSOLETE)" suffix and no "Subclass 0".
  const subclassLabel = category?.subclass ? labelOf(category.subclass).label : undefined;

  // The same per-item index and 3-install gate as the item lists' Source column; no row when nothing is reported.
  const source = itemSourceValue(itemSeen.from.get(itemId), tabs.map((t) => t.id));
  // The page in four lines: what it is, what players saw, what nobody has reported, and where the name came from.
  const requiredLevel = tip?.lines.find((l) => l.startsWith("Requires Level"))?.replace("Requires Level ", "") ?? null;
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
    recipes: rel("created_by").length + rel("reagent_for").length,
    nameFrom: confirmed ? "players" : name?.source === "wiki" ? "wiki" : name?.source === "files" ? "files" : "none",
    lastSeen: newestSeen,
    now,
  });
  const quickFacts: Fact[] = [
    ...(category ? [
      { label: "Class", value: category.class ? <Link href={itemsHref(category.class.slug)} className={LINK}>{category.class.label}</Link> : known(null) },
      { label: "Subclass", value: category.class && category.subclass ? <Link href={itemsHref(category.class.slug, category.subclass.slug)} className={LINK}>{subclassLabel}</Link> : known(null) },
      { label: "Slot", value: category.slot?.name ?? "None" },
      { label: "Quality", value: category.quality ? <span className={shownQuality ? QUALITY_TEXT[shownQuality] : undefined}>{category.quality.name}</span> : known(null) },
    ] : [{ label: "Game files", value: "Not found" }]),
    ...(facts.unreachable ? [] : [
      { label: "Reported name", value: known(page.name) },
      { label: "Drop sources", value: known(page.drops.length || null), numeric: true },
      { label: "Map positions", value: known(page.pins.length || null), numeric: true },
      ...(source ? [{ label: "Source", value: source }] : []),
    ]),
  ];

  return (
    <Container width="data">
      <article>
        <EntityHeader
          trail={trail}
          title={title}
          quality={shownQuality}
          icon={<EntityIcon src={tip?.icon} unconfirmed={!confirmed} />}
          meta={[category?.class?.label, subclassLabel, name ? <span className="tabular-nums">ID {itemId}</span> : null]}
        />
        <EntityTop
          box={
            <TooltipFrame name={tip?.name ?? title} quality={tip ? quality : undefined} label={`${tip?.name ?? title}, from the game files`}>
              {tooltipLines.map((line, i) => <p key={i}>{line}</p>)}
            </TooltipFrame>
          }
          facts={<Facts layout="list" label={`${title}: quick facts`} items={quickFacts} />}
        />
        <InShort summary="In short" bullets={summary} note={<Link href="/database#reading" className={LINK}>How to read these numbers</Link>} />
        <OpenData
          text={[
            `${title} (item ${itemId})`,
            ...tooltipLines,
            ...summary,
            `Source: https://everloot.app/database/items/${itemId}`,
          ].join("\n")}
          jsonHref={`/api/tooltip/item/${itemId}`}
        />
        <MarketBox itemId={itemId} rows={auctions} />
        <Tabs label={`${title}: relations`} tabs={tabs} />
        <div className="mt-6 space-y-6 empty:hidden">
          <LoreSection match={lore} />
          {!facts.unreachable && (page.name !== null || page.drops.length > 0) && <AdSlot slot="inContent" />}
        </div>
      </article>
    </Container>
  );
}
