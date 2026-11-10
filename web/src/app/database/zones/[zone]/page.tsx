import type { Metadata } from "next";
import { trailFor } from "@/lib/breadcrumbs";
import JsonLd from "@/components/JsonLd";
import { entityPageJsonLd } from "@/lib/jsonld";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import AdSlot from "@/components/AdSlot";
import EntityLink from "@/components/EntityLink";
import ZonePreview from "@/components/ZonePreview";
import {
  AgreementMeter, Badge, Card, Container, DataTable, DataTitle, EmptyState, ResultStrip, SectionHeading, Tabs,
  type Column, type TabItem,
} from "@/components/ui";
import { GAME_NAME_TITLE } from "@/components/EntityRelations";
import { loadItemTips, loadQuestNames, loadSiteAssets } from "@/lib/game-assets";
import { CLIENT_LAYER } from "@/lib/items";
import { computeRollups, loadItemFacts, loadLootTables, loadWorldFacts } from "@/lib/rollup-compute";
import { zoneCoverageHref } from "@/lib/coverage-view";
import { gatheredObjects, zoneFarmLinks } from "@/lib/farming";
import { itemNames } from "@/lib/names";
import { loadProfessions } from "@/lib/profession-store";
import { METHOD_LINE } from "../../../../../../kb/src/loot-tables";
import { zoneItems, type ZoneItem, type ZoneItemSource } from "@/lib/zone-items";
import { wikiHref, zoneWikiPage } from "@/lib/wiki";
import { bossLine, entranceLinks, instanceHref, loadSightings } from "@/lib/instances";
import { confirmedLine, dayLabel } from "@/lib/report-labels";
import { pageMetadata } from "@/lib/seo";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";
import EdgeDegraded from "@/components/EdgeDegraded";
import { WORLD_MAP } from "@/lib/world-map";
import {
  hasConfirmed, hasContent, parseZoneSegment, zoneByMapId, zoneContents, zoneHref, zoneMapHref,
  type ZoneEntrance, type ZoneNpc, type ZoneQuest, type ZoneTreasure,
} from "@/lib/zones";
import { zoneLore } from "@/lib/zone-lore";
import { EmptyTab, FREQUENCY, percent } from "../../entity";
import { listQuery, PER_PAGE, type Search } from "../../list-parts";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ zone: string }>; searchParams?: Promise<Search> };

const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";

/** Resolves the segment to a released zone, or null; a held-back zone is the same as one that does not exist. */
function find(segment: string) {
  const id = parseZoneSegment(segment);
  return id === null ? null : zoneByMapId(id) ?? null;
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { zone: segment } = await props.params;
  const zone = find(segment);
  if (!zone) return { robots: { index: false, follow: true } };
  const [facts, seen] = await Promise.all([loadWorldFacts(), loadSightings()]);
  const here = facts.unreachable ? undefined : zoneContents(facts, undefined, seen).get(zone.mapId);
  // Indexed once there is something on it (a player-confirmed NPC or quest, or an entrance), and as the sitemap lists it.
  // Storage down: noindex rather than cache a thin page.
  const indexable = !facts.unreachable && hasContent(here);
  return {
    ...pageMetadata({
      title: `${zone.name} – WoW Forever Zone: Quests, NPCs and Map`,
      description: `${zone.name} in WoW: Forever (${zone.continentName}): the map, the dungeon and raid entrances, and the NPCs, vendors and quests players have confirmed.`,
      path: zoneHref(zone.mapId, zone.name),
    }),
    robots: { index: indexable, follow: true },
  };
}

const position = (x: number, y: number) => `${x}, ${y}`;

export default async function ZonePage(props: Props) {
  const { zone: segment } = await props.params;
  const zone = find(segment);
  if (!zone) notFound();
  const canonical = zoneHref(zone.mapId, zone.name);
  if (`/database/zones/${segment}` !== canonical) permanentRedirect(canonical);
  // The Items tab pages like the database lists: ?page=2, a malformed or past-the-end page is a 404. Nothing else is read.
  const query = listQuery({ page: (await props.searchParams)?.page }, []);
  if (!query) notFound();

  const [facts, seen, loot, { rates }] = await Promise.all([loadWorldFacts(), loadSightings(), loadLootTables(), computeRollups()]);
  // Entrances come from the game files, so they show even when storage is down; player reports do not.
  const here = zoneContents(facts.unreachable ? { npcs: [], quests: [], vendors: [] } : facts, undefined, facts.unreachable ? {} : seen).get(zone.mapId);
  const lore = await zoneLore(zone.name);
  const shape = WORLD_MAP.zones.find((z) => z.uiMapId === zone.mapId)!;
  const assets = await loadSiteAssets();
  const art = assets?.maps.find((m) => m.kind === "zone" && m.uiMapId === zone.mapId && !m.heldBack) ?? null;

  const npcs = (here?.npcs ?? []).filter((n) => !n.vendor);
  const vendors = (here?.npcs ?? []).filter((n) => n.vendor);
  const quests = here?.quests ?? [];
  const wikiTitles = quests.some((q) => !q.title) ? await loadQuestNames(CLIENT_LAYER.build.version) : null;
  const entrances = here?.entrances ?? [];
  const treasures = here?.treasures ?? [];
  // Items need the loot tables as well as the pins; a failed read of either is unavailable, never an empty list.
  const itemsDown = facts.unreachable || loot.unreachable;
  // Gathering reads the stored professions view the profession pages read, not the corpus.
  const gathering = facts.unreachable ? null : await loadProfessions();
  const gatherRows = gathering && !gathering.unreachable ? gathering.sightings : [];
  const gathered = gatherRows.length ? gatheredObjects(zone.mapId, gatherRows).map((id) => ({ id, name: seen.objectNames?.get(id) ?? null })) : [];
  const items = itemsDown ? [] : zoneItems(here, loot.tables, gathered);
  const itemPages = Math.max(1, Math.ceil(items.length / PER_PAGE));
  // While the loot read is down there are no rows to page, so a link to a later page still answers.
  if (!itemsDown && query.page > itemPages) notFound();
  const shownItems = items.slice((query.page - 1) * PER_PAGE, query.page * PER_PAGE);
  const itemsHref = (page: number) => `${canonical}${page > 1 ? `?page=${page}` : ""}#items`;
  const itemFacts = shownItems.length ? await loadItemFacts() : null;
  const itemName = itemFacts && !itemFacts.unreachable ? itemNames(itemFacts) : new Map<number, string>();
  const tips = await loadItemTips(assets, shownItems.map((i) => i.itemId));
  const farmLinks = !gathering ? [] : zoneFarmLinks(zone, (here?.npcs ?? []).map((n) => n.npcId), rates, gatherRows);
  const wiki = zoneWikiPage(zone.mapId);
  const nameOf = (n: ZoneNpc) => n.name ?? `NPC ${n.npcId}`;
  // An empty list is one muted line. The addon call is made once, in the notice above the tabs.
  const empty = (message: string) => <div className="px-4 sm:px-6"><EmptyTab message={message} players={false} action={null} /></div>;

  const npcColumns = (kind: "npcs" | "vendors"): Column<ZoneNpc>[] => [
    { key: "name", header: "Name", cell: (n) => <Link href={`/database/${kind}/${n.npcId}`} className={link}>{nameOf(n)}</Link> },
    { key: "at", header: "Position", numeric: true, cell: (n) => position(n.x, n.y) },
    { key: "installs", header: "Installs", cell: (n) => <AgreementMeter count={n.reporters} /> },
  ];
  const npcLink = (id: number | null) => (id === null ? "unrecorded" : <Link href={`/database/npcs/${id}`} className={link}>NPC {id}</Link>);
  const questColumns: Column<ZoneQuest>[] = [
    { key: "title", header: "Quest", cell: (q) => {
      // A title players agree on; else the Warcraft Wiki's, with its source in the link's hover card.
      const wiki = q.title ? undefined : wikiTitles?.names.get(q.questId)?.name;
      // The screen reader words follow the link, so its text is the title alone.
      return <>
        <Link href={`/database/quests/${q.questId}`} className={link}>{q.title ?? wiki ?? `Quest ${q.questId}`}</Link>
        {wiki && <span className="sr-only"> ({GAME_NAME_TITLE.wiki.toLowerCase()})</span>}
      </>;
    } },
    { key: "level", header: "Level", numeric: true, cell: (q) => q.level ?? "–" },
    { key: "giver", header: "Giver", cell: (q) => npcLink(q.giverNpcId) },
    { key: "turnin", header: "Turn-in", cell: (q) => npcLink(q.turnInNpcId) },
  ];
  const sourceLink = (s: ZoneItemSource) => <EntityLink kind={s.from.kind} id={s.from.id} name={s.from.name} />;
  // One source: its numbers are the row's. Several: the row counts the distinct sources and a range of their frequencies,
  // and each source's own windows, frequency and installs open under it (the numbers of two sources are never added).
  const manySources = (i: ZoneItem) => i.sources.length > 1;
  const rateRange = (i: ZoneItem) => {
    const rates = i.sources.map((s) => s.rate);
    const [low, high] = [Math.min(...rates), Math.max(...rates)];
    return low === high ? percent(high) : `${percent(low)} to ${percent(high)}`;
  };
  const itemColumns: Column<ZoneItem>[] = [
    { key: "item", header: "Item", cell: (i) => <EntityLink kind="item" id={i.itemId} name={itemName.get(i.itemId) ?? tips.get(i.itemId)?.name} icon={tips.get(i.itemId)?.icon} /> },
    { key: "from", header: "From", cell: (i) => (!manySources(i) ? sourceLink(i.sources[0]) : (
      <details data-item-sources className="group">
        <summary className="flex min-h-6 cursor-pointer list-none items-center gap-2 text-fg [&::-webkit-details-marker]:hidden">
          {i.sources.length} sources
          <span aria-hidden="true" className="shrink-0 font-mono text-muted transition-transform group-open:rotate-45">+</span>
        </summary>
        <ul className="mt-1 space-y-1 pb-1 text-meta text-fg-2">
          {i.sources.map((s) => (
            <li key={`${s.from.kind}-${s.from.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
              {sourceLink(s)}
              <span className="font-mono tabular-nums">{percent(s.rate)} · {s.withItem} of {s.windows} windows · {s.installs} installs</span>
            </li>
          ))}
        </ul>
      </details>
    )) },
    { key: "with", header: "Windows with it", numeric: true, cell: (i) => (manySources(i) ? "–" : i.sources[0].withItem) },
    { key: "windows", header: "Out of", numeric: true, cell: (i) => (manySources(i) ? "–" : i.sources[0].windows) },
    { key: "rate", header: FREQUENCY, numeric: true, cell: (i) => rateRange(i) },
    { key: "installs", header: "Installs", numeric: true, cell: (i) => (manySources(i) ? "–" : <AgreementMeter count={i.sources[0].installs} />) },
  ];
  const entranceColumns: Column<ZoneEntrance>[] = [
    // Each instance entered here links to its own page.
    { key: "name", header: "Name", cell: (e) => entranceLinks(e).map(({ name, id }, i) => (
      <span key={name}>{i > 0 && ", "}{id ? <Link href={instanceHref(id, name)} className={link}>{name}</Link> : name}</span>
    )) },
    { key: "kind", header: "Type", cell: (e) => <Badge tone="neutral">{e.raid ? "Raid" : "Dungeon"}</Badge> },
    { key: "at", header: "Entrance", numeric: true, cell: (e) => position(e.x, e.y) },
    { key: "bosses", header: "Bosses", cell: (e) => (e.bosses.length ? e.bosses.map(bossLine).join("; ") : "–") },
    { key: "src", header: "Source", cell: (e) => (
      <span className="inline-flex flex-wrap items-center gap-1">
        {e.files && <Badge tone="files" />}
        {e.confirmed !== null && <Badge tone="confirmed">{confirmedLine(e.confirmed, e.lastSeen)}</Badge>}
      </span>
    ) },
  ];
  const treasureColumns: Column<ZoneTreasure>[] = [
    { key: "name", header: "Name", cell: (t) => <Link href={`/database/objects/${t.objectId}`} className={link}>{t.name ?? `Object ${t.objectId}`}</Link> },
    { key: "at", header: "Position", numeric: true, cell: (t) => position(t.x, t.y) },
    { key: "installs", header: "Installs", cell: (t) => <AgreementMeter count={t.reporters} /> },
    { key: "seen", header: "Last seen", cell: (t) => dayLabel(t.lastSeen) },
  ];

  const all: TabItem[] = [
    { id: "npcs", label: "NPCs", count: npcs.length, panel: <DataTable dense caption={`NPCs players placed in ${zone.name}`} columns={npcColumns("npcs")} rows={npcs} rowKey={(n) => String(n.npcId)} empty={empty("No NPC has a confirmed position here yet. A pin needs 3 installs on the same map.")} /> },
    { id: "vendors", label: "Vendors", count: vendors.length, panel: <DataTable dense caption={`Vendors players placed in ${zone.name}`} columns={npcColumns("vendors")} rows={vendors} rowKey={(n) => String(n.npcId)} empty={empty("No vendor here has prices 3 installs agree on yet.")} /> },
    { id: "quests", label: "Quests", count: quests.length, panel: <DataTable dense caption={`Quests given or turned in at confirmed NPCs in ${zone.name}`} columns={questColumns} rows={quests} rowKey={(q) => String(q.questId)} empty={empty("No quest has a confirmed giver or turn-in here yet.")} /> },
    // The loot tables could not be read (the world facts could): the tab says so, with no count and no empty-list copy.
    loot.unreachable
      ? { id: "items", label: "Items", panel: <p data-items-unreadable className="px-4 py-3 text-meta text-fg-2 sm:px-6">Items could not be read right now. They are unrecorded here, not none. Try again in a minute.</p> }
      : { id: "items", label: "Items", count: items.length, panel: <>
        {items.length > 0 && <div className="px-4 pb-2 sm:px-6"><ResultStrip total={items.length} noun={items.length === 1 ? "item" : "items"} page={query.page} perPage={PER_PAGE} href={itemsHref} label="Item pages" /></div>}
        <DataTable dense caption={`Items players looted from confirmed NPCs and objects in ${zone.name}`} columns={itemColumns} rows={shownItems} rowKey={(i) => String(i.itemId)} empty={empty("No item has an agreed drop from a confirmed NPC or object here yet. A rate needs loot windows from 3 installs.")} />
        {itemPages > 1 && <div className="px-4 pt-2 sm:px-6"><ResultStrip total={items.length} noun={items.length === 1 ? "item" : "items"} page={query.page} perPage={PER_PAGE} href={itemsHref} label="Item pages" /></div>}
        {items.length > 0 && <p className="px-4 py-2 text-meta text-fg-2 sm:px-6">{METHOD_LINE}{loot.dataAsOf ? ` Data as of ${loot.dataAsOf.slice(0, 10)}.` : ""}</p>}
      </> },
    { id: "dungeons", label: "Dungeons and raids", count: entrances.length, panel: <DataTable dense caption={`Dungeon and raid entrances in ${zone.name}`} columns={entranceColumns} rows={entrances} rowKey={(e) => `${e.names.join("|")}-${e.x}-${e.y}`} empty={empty("No dungeon or raid is entered from this zone.")} /> },
    { id: "objects", label: "Objects", count: treasures.length, panel: <DataTable dense caption={`Treasures players saw on the minimap in ${zone.name}`} columns={treasureColumns} rows={treasures} rowKey={(t) => `${t.objectId}-${t.x}-${t.y}`} empty={empty("No treasure has a confirmed position here yet. A pin needs 3 installs at the same spot.")} /> },
  ];
  // Storage down: an empty list would read as "nobody has seen anything", so only the game-file list stays.
  const tabs = facts.unreachable ? all.filter((t) => t.id === "dungeons") : all;

  return (
    <Container width="data">
      <EdgeDegraded when={facts.unreachable || seen.unreachable || loot.unreachable || gathering?.unreachable === true} />
      <JsonLd data={entityPageJsonLd({ name: zone.name, path: canonical, identifier: `zone:${zone.mapId}` })} />
      <article>
        {/* The database title row: name, continent, and the map link as a quiet control (the header keeps the one filled button). */}
        <DataTitle
          title={zone.name}
          meta={(
            <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
              {zone.continentName}
              <Badge tone="files">Zone outline · from game files</Badge>
              <Link href={zoneCoverageHref(zone)} className={link}>Coverage</Link>
              {wiki && <Link href={wikiHref(wiki.slug)} className={link}>Wiki</Link>}
            </span>
          )}
          trail={[
            ...trailFor("/database/zones")!,
            { name: zone.name, path: canonical },
          ]}
          aside={<Link href={zoneMapHref(zone.mapId)} className="ctl inline-flex items-center border border-edge px-3 text-control text-fg-2 hover:text-fg">Open on the map</Link>}
        />

        {facts.unreachable && <p className="mb-3 text-meta text-warning">{STORAGE_UNREACHABLE} The lists below cannot be shown until it is back.</p>}

        <div className="space-y-6">
          <ZonePreview
            name={zone.name}
            width={shape.bounds.left - shape.bounds.right}
            height={shape.bounds.top - shape.bounds.bottom}
            art={art?.url ?? null}
            npcs={here?.npcs ?? []}
            entrances={entrances}
          />

          {lore && (
            <section aria-labelledby="lore">
              <SectionHeading id="lore">Lore</SectionHeading>
              <Card as="div">
                <p className="max-w-[65ch] text-fg">{lore.text}</p>
                <p className="mt-3 text-sm text-muted">
                  From the archive of the Warcraft Wiki, 2023 · {lore.licence} ·{" "}
                  <Link href={lore.href} className={link}>Read the full lore page</Link>
                </p>
              </Card>
            </section>
          )}

          <section aria-labelledby="known">
            <SectionHeading id="known" note="Positions, quests, bosses and treasures are public once 3 installs agree. Entrances are read from the game files and confirmed once 3 installs zoned in.">
              What we know here
            </SectionHeading>
            {/* Confirmed items and gathering spots are things players confirmed too (a herb spot is no treasure, NPC or quest). */}
            {!facts.unreachable && !hasConfirmed(here) && items.length === 0 && gathered.length === 0 && (
              <div className="mb-4">
                <EmptyState
                  message={`Players have not confirmed anything in ${zone.name} yet.${entrances.length ? " The dungeon and raid entrances here are read from the game files." : ""} A fact appears when 3 installs agree on it, and until then the lists below stay empty on purpose.`}
                />
              </div>
            )}
            <Tabs label={`Known in ${zone.name}`} tabs={tabs} />
            {farmLinks.length > 0 && (
              <p data-farm-links className="mt-3 text-meta text-fg-2">
                Farming and gathering:{" "}
                {farmLinks.map((l, i) => <span key={l.href}>{i > 0 && " · "}<Link href={l.href} className={link}>{l.label}</Link></span>)}
              </p>
            )}
          </section>
        </div>
        {!facts.unreachable && hasContent(here) && <AdSlot slot="inContent" />}
      </article>
    </Container>
  );
}
