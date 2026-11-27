import { loadWikiEntityNames, shownNpcName } from "@/lib/wiki-entity-names";
import { NAME_FROM } from "@/lib/items";
import type { Metadata } from "next";
import AdSlot from "@/components/AdSlot";
import { pageMetadata } from "@/lib/seo";
import Link from "@/components/Link";
import { notFound } from "next/navigation";
import { hasCard } from "@/lib/tooltip";
import { agreedNpc, npcNameReporters, npcPage, npcTraits, vendorPage, type NpcPin, type NpcRank } from "@kb/world-pages";
import { pendingLine } from "@kb/pending-loot";
import { npcLootTable } from "@kb/loot-tables";
import { computeRollups, loadLootTables, loadWorldFacts } from "@/lib/rollup-compute";
import { pinLink, WORLD_MAP } from "@/lib/world-map";
import { publicZones, zoneByMapId, zoneHref } from "@/lib/zones";
import { killZones } from "@/lib/farming";
import { trailFor } from "@/lib/breadcrumbs";
import { Badge, DataTable, Tabs, TooltipFrame, type SortDirection } from "@/components/ui";
import { qualityNamed } from "@/components/ui/quality";
import ItemTip from "@/components/game/ItemTip";
import { EMPTY, EmptyTab, EntityPage, known, LINK, ModelPicture, PinTable, Unreachable } from "../../entity";
import { loadRenders } from "@/lib/game-renders";
import EntityMap from "../../EntityMap";
import { entityMapZones } from "../../entity-map";
import { NPC_LOOT_SORTS, NpcLootPanel, lootPage } from "../../loot-tables";
import { listHref, nextSort, sortParam, sortRows } from "../../list-parts";
import { VendorGoods } from "../../vendors/goods";
import { npcRelations } from "../relations";
import { unknownNpc } from "../../unknown";
import { entitySummary, observedLine } from "@/lib/evidence";
import { loadItemFacts } from "@/lib/rollup-compute";
import { itemNames } from "@/lib/names";
import { loreFor } from "@/lib/lore-links";
import { loadItemTips, loadSiteAssets } from "@/lib/game-assets";
import EntityLink from "@/components/EntityLink";
import LoreSection from "@/components/LoreSection";
import { npcIndexable } from "@/lib/indexable";
import { entityTitle, npcDescription } from "@/lib/entity-meta";
import EntityComments from "@/components/comments/EntityComments";
import EntityScreenshots from "@/components/screenshots/EntityScreenshots";
import { bossesOfNpc, bossHref } from "@/lib/bosses";
import { instanceHref, instanceRows, instanceTitle, loadSightings } from "@/lib/instances";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const params = await props.params;
  if (!/^[1-9]\d*$/.test(params.id)) return { robots: { index: false, follow: true } };
  const npcId = Number(params.id);
  const [facts, rollup] = await Promise.all([loadWorldFacts(), computeRollups()]);
  const wiki = await loadWikiEntityNames("npc");
  if (unknownNpc(npcId, facts, rollup)) notFound();
  const page = npcPage(npcId, facts);
  const name = shownNpcName(npcId, facts, wiki).name ?? `NPC ${npcId}`;
  return {
    ...pageMetadata({ title: entityTitle(name, "NPC"), description: npcDescription({ name, id: npcId, positions: facts.unreachable ? 0 : page.pins.length }), path: `/database/npcs/${npcId}`, image: `/database/npcs/${npcId}/opengraph-image` }),
    robots: { index: npcIndexable({ ...page, name: shownNpcName(npcId, facts, wiki).name ?? null }, facts.unreachable), follow: true },
  };
}

/** `UnitClassification` in words, as the game shows it. */
const RANK_LABELS: Record<NpcRank, string> = { normal: "Normal", elite: "Elite", rare: "Rare", rare_elite: "Rare elite", boss: "Boss" };
const REACTION_LABELS = { friendly: "Friendly", neutral: "Neutral", hostile: "Hostile" } as const;

type DropSort = { key: (typeof NPC_LOOT_SORTS)[number]; desc: boolean };
/** The loot table's own order: the most frequent item first. */
const DROP_DEFAULT: DropSort = { key: "rate", desc: true };
/** `?sort=item`, `?sort=-rate`: the drops table's order; anything else is the default. */
function dropSort(raw: unknown): DropSort {
  if (typeof raw !== "string") return DROP_DEFAULT;
  const key = raw.replace(/^-/, "");
  return (NPC_LOOT_SORTS as readonly string[]).includes(key) ? { key: key as DropSort["key"], desc: raw.startsWith("-") } : DROP_DEFAULT;
}

/**
 * In place of a tooltip, a small picture of the zone with the NPC's point on it, linked to the world map.
 * The zone's own map art when the asset manifest has it, otherwise a plain panel of the zone's shape.
 */
function MapThumb({ pin, zone, art }: { pin: NpcPin; zone: string; art: string | null }) {
  const shape = WORLD_MAP.zones.find((z) => z.uiMapId === pin.mapId);
  const href = pinLink(pin.mapId, pin.x, pin.y);
  if (!shape || !href) return null;
  const ratio = `${Math.abs(shape.bounds.left - shape.bounds.right)} / ${Math.abs(shape.bounds.top - shape.bounds.bottom)}`;
  return (
    <figure data-map-thumb className="w-full sm:max-w-tip">
      <Link href={href} aria-label={`${zone} at ${pin.x}, ${pin.y}, on the map`} className="relative block overflow-hidden rounded-control border border-line bg-panel" style={{ aspectRatio: ratio }}>
        {/* The zone's picture from the asset bucket as it is; next/image would only proxy it. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {art && <img src={art} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />}
        <span aria-hidden="true" className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent ring-2 ring-black/60" style={{ left: `${pin.x}%`, top: `${pin.y}%` }} />
      </Link>
      <figcaption className="mt-1 text-meta text-muted">{zone} · <span className="tabular-nums">{pin.x}, {pin.y}</span></figcaption>
    </figure>
  );
}

export default async function NpcPage(props: { params: Promise<{ id: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await props.params;
  const search = await props.searchParams;
  const drops = dropSort(search?.sort);
  const dropPage = lootPage(search?.drops);
  if (!/^[1-9]\d*$/.test(params.id)) notFound();
  const npcId = Number(params.id);
  const facts = await loadWorldFacts();
  const rollup = await computeRollups();
  const wiki = await loadWikiEntityNames("npc");
  if (unknownNpc(npcId, facts, rollup)) notFound();
  const unreachable = facts.unreachable || rollup.stats.unreachable;
  const page = npcPage(npcId, facts);
  const goods = vendorPage(npcId, facts).offers;
  const now = Date.now();
  const { quests, goodsEvidence, goodsReported, questsReported } = npcRelations(npcId, facts, now);
  const starts = quests.filter((q) => q.role === "starts"), ends = quests.filter((q) => q.role === "ends");
  // The same traits as the NPC list, each shown when 3 installs agree.
  const traits = agreedNpc(npcId, facts) ?? npcTraits([]);
  const pending = !unreachable && page.pendingLoot ? <p className="py-2 text-meta text-fg-2">{pendingLine(page.pendingLoot)}</p> : null;
  const shown = shownNpcName(npcId, { ...facts, unreachable }, wiki);
  const title = shown.name ?? `NPC ${page.npcId}`;
  const zero = rollup.measuredZeros.find((row) => row.reporters > 0 && row.sourceNpcId === npcId);
  const dropped = rollup.rates.filter((row) => row.reporters > 0 && row.sourceNpcId === npcId);
  const firstPin = unreachable ? undefined : page.pins[0];
  const zone = firstPin ? zoneByMapId(firstPin.mapId) : undefined;
  // With no agreed position, the zones where 3 installs looted its kills (the farming routes' rule).
  const killedIn = zone || unreachable ? [] : killZones((facts.kills ?? []).filter((k) => k.npcId === npcId), publicZones()).get(npcId) ?? [];
  const zoneLinks = (zones: { mapId: number; name: string }[]) => zones.map((z, i) => (
    <span key={z.mapId}>{i > 0 && ", "}<Link href={zoneHref(z.mapId, z.name)} className={LINK}>{z.name}</Link></span>
  ));
  // Item names (and icons, when the game files have them) for the drop and goods lists; an item nobody named stays "Item N".
  const itemFacts = unreachable || (dropped.length === 0 && goods.length === 0) ? null : await loadItemFacts();
  const names = itemFacts && !itemFacts.unreachable ? itemNames(itemFacts) : new Map<number, string>();
  const pins = unreachable ? [] : page.pins;
  const assets = dropped.length > 0 || goods.length > 0 || pins.length > 0 ? await loadSiteAssets() : null;
  const tips = await loadItemTips(assets, [...dropped.map((row) => row.itemId), ...goods.map((o) => o.itemId)]);
  // The map slot draws every agreed position on its zone's art; the pin table below is its text.
  const mapZones = entityMapZones(pins.map((p) => ({ kind: "npc", mapId: p.mapId, x: p.x, y: p.y, label: title, agreed: true })), assets?.maps);
  const art = zone ? assets?.maps.find((m) => m.kind === "zone" && m.uiMapId === zone.mapId && !m.heldBack) : undefined;
  const lore = !unreachable && page.name ? await loreFor("npc", npcId, page.name) : null;
  // The loot table with each number's windows, installs and dates; its public rows are the rates above.
  const loot = await loadLootTables();
  const table = npcLootTable(loot.tables, npcId);
  const itemName = (itemId: number) => names.get(itemId) ?? tips.get(itemId)?.name ?? null;
  const lootTable = { ...table, rows: sortRows([...table.rows], (r) => drops.key === "item" ? itemName(r.itemId)?.toLowerCase() ?? null : drops.key === "with" ? r.withItem : r.rate, drops.desc, (r) => r.itemId) };
  const dropHref = (key: string, dir: SortDirection) => {
    const sort = sortParam(nextSort(key, dir, DROP_DEFAULT));
    return `/database/npcs/${npcId}${sort ? `?sort=${sort}` : ""}#drops`;
  };
  // A page of a long table keeps its sort; a new sort starts at the first page.
  const dropPageHref = (page: number | "all") => {
    const sort = sortParam(nextSort(drops.key, drops.desc ? "desc" : "asc", DROP_DEFAULT));
    return `${listHref(`/database/npcs/${npcId}`, [["sort", sort], ["drops", page === 1 ? undefined : String(page)]])}#drops`;
  };
  const trail = [...trailFor("/database/npcs")!, { name: title, path: `/database/npcs/${npcId}` }];
  const named = title !== `NPC ${npcId}`;
  // The model picture only where the page names the NPC; renders.json lists only NPCs the site lists.
  const picture = named && !unreachable ? (await loadRenders())?.npcs.get(npcId) : undefined;
  // The bosses 3 installs tie this creature to, each linked to its page and its instance's.
  const seen = unreachable ? null : await loadSightings();
  const bosses = seen && !seen.unreachable ? bossesOfNpc(npcId, instanceRows(seen)) : [];
  // The page in three lines: where it is, what players reported, and where the name came from.
  const summary = entitySummary({
    identity: zone
      ? `Seen in ${zone.name}`
      : killedIn.length
        ? `Killed in ${killedIn.map((z) => z.name).join(", ")}`
        : firstPin
        ? `Seen at map ${firstPin.mapId}, ${firstPin.x}, ${firstPin.y}`
        : "No position has been reported yet",
    observed: observedLine(
      [dropped.length ? `${dropped.length} ${dropped.length === 1 ? "item drop" : "item drops"}` : null, page.pins.length ? `${page.pins.length} ${page.pins.length === 1 ? "map position" : "map positions"}` : null, goods.length ? `${goods.length} goods` : null, quests.length ? ((n) => `${n} ${n === 1 ? "quest" : "quests"}`)(new Set(quests.map((q) => q.questId)).size) : null],
      null,
      now,
      unreachable ? [] : ([[traits.level !== null, "level"], [traits.creatureType !== null, "type"], [traits.reaction !== null, "reaction"], [traits.rank !== null, "rank"]] as const)
        .filter(([on]) => on).map(([, word]) => word),
    ),
    nameFrom: shown.fromWiki ? "wiki" : page.name ? "players" : "none",
  });

  return (
    <EntityPage
      name={title}
      jsonLd={{ name: title, path: `/database/npcs/${npcId}`, identifier: `npc:${npcId}` }}
      header={{
        trail,
        title: shown.fromWiki ? <a href={shown.wikiPage} title={NAME_FROM.wiki}>{title}<span className="sr-only">. {NAME_FROM.wiki}</span></a> : title,
        // What it is, from the traits 3 installs agree on: level, rank (a badge unless normal), type, reaction, zone.
        meta: [
          "NPC",
          !unreachable && traits.level !== null ? <span key="level" className="tabular-nums">Level {traits.level}</span> : null,
          !unreachable && traits.rank && traits.rank !== "normal" ? <Badge key="rank" tone="neutral">{RANK_LABELS[traits.rank]}</Badge> : null,
          !unreachable ? traits.creatureType : null,
          !unreachable && traits.reaction ? REACTION_LABELS[traits.reaction] : null,
          zone ? <Link key="zone" href={zoneHref(zone.mapId, zone.name)} className={LINK}>{zone.name}</Link> : killedIn.length ? <span key="zone">{zoneLinks(killedIn)}</span> : null,
          named ? <span key="id" className="tabular-nums">ID {npcId}</span> : null,
        ],
      }}
      // No box without an agreed position: the Map tab says why, and a frame with only the name would repeat the title.
      // With the map slot drawn, the thumbnail would be a second copy of it.
      box={firstPin && mapZones.length === 0 && (zone ? <MapThumb pin={firstPin} zone={zone.name} art={art?.smallUrl ?? art?.url ?? null} /> : (
        <TooltipFrame name={title} label={`${title}, as players saw it`}>
          <p>Map {firstPin.mapId} at {firstPin.x}, {firstPin.y}</p>
        </TooltipFrame>
      ))}
      facts={!unreachable && [
        { label: "Reported name", value: known(page.name, npcNameReporters(npcId, facts)) },
        { label: "Level", value: known(traits.level), numeric: true },
        { label: "Type", value: known(traits.creatureType) },
        { label: "Reaction", value: known(traits.reaction && REACTION_LABELS[traits.reaction]) },
        { label: "Rank", value: known(traits.rank && RANK_LABELS[traits.rank]) },
        ...(bosses.length ? [{ label: "Boss", value: <span>{bosses.map((b, i) => (
          <span key={b.id}>{i > 0 && "; "}<Link href={bossHref(b.id, b.row.name)} className={LINK}>{b.name}</Link> in <Link href={instanceHref(b.instance.instanceMapId, b.instance.name)} className={LINK}>{instanceTitle(b.instance)}</Link></span>
        ))}</span> }] : []),
        { label: "Zone", value: zone ? <Link href={zoneHref(zone.mapId, zone.name)} className={LINK}>{zone.name}</Link>
          : killedIn.length ? <>{zoneLinks(killedIn)}<span className="block text-muted">Player reports: where 3 installs looted its kills</span></>
          : known(null) },
        { label: "Map positions", value: known(page.pins.length || null), numeric: true },
        // Drop rows show from one install; their table labels the agreement tier.
        { label: "Drops", value: known(zero ? `None in ${zero.kills} windows` : dropped.length ? `${dropped.length} items` : null, lootTable.state === "short" ? lootTable.span.installs : 0) },
      ]}
      media={picture && <ModelPicture picture={picture} name={title} />}
      summary={summary}
      map={mapZones.length > 0 && <EntityMap name={title} zones={mapZones} />}
      main={<Tabs
        label={`${title}: relations`}
        tabs={[
          {
            // No rates yet but loot windows on record (short of 3 installs, none with an item, or outside the rates):
            // no count, so the tab and its line stay.
            id: "drops", label: "Drops", count: unreachable || (!dropped.length && (lootTable.state !== "none" || pending)) ? undefined : dropped.length,
            panel: unreachable ? <Unreachable />
              : <>
                <NpcLootPanel
                  table={lootTable}
                  title={title}
                  dataAsOf={loot.dataAsOf}
                  item={(itemId) => <ItemTip tip={tips.get(itemId)}><EntityLink kind="item" id={itemId} name={itemName(itemId)} quality={qualityNamed(tips.get(itemId)?.quality)} /></ItemTip>}
                  sort={{ key: drops.key, direction: drops.desc ? "desc" : "asc" }}
                  sortHref={dropHref}
                  pages={{ page: dropPage, href: dropPageHref }}
                />
                {pending}
              </>,
          },
          {
            // Reports short of 3 installs fill the meter: no count, so the tab and its meter stay.
            id: "sells", label: "Sells", count: unreachable || (!goods.length && goodsReported) ? undefined : goods.length,
            panel: unreachable ? <Unreachable />
              : goods.length ? <>
                <p className="py-2 text-meta text-fg-2">This NPC sells goods. <Link href={`/database/vendors/${npcId}`} className={LINK}>Open the vendor page</Link></p>
                <VendorGoods title={title} offers={goods} tips={tips} items={names} evidence={goodsEvidence} />
              </>
              : <EmptyTab reported={goodsReported} message={EMPTY.goods} />,
          },
          ...([["starts", "Starts", starts, questsReported.giverNpcId, "gives"], ["ends", "Ends", ends, questsReported.turnInNpcId, "takes"]] as const).map(([id, label, rows, reported, verb]) => ({
            // Reports short of 3 installs fill the meter: no count, so the tab and its meter stay.
            id, label, count: unreachable || (!rows.length && reported) ? undefined : rows.length,
            panel: unreachable ? <Unreachable />
              : rows.length ? <DataTable
                dense
                caption={`Quests ${title} ${verb}`}
                columns={[
                  { key: "quest", header: "Quest", cell: (q) => <EntityLink kind="quest" id={q.questId} name={q.title} /> },
                  { key: "reported", header: "Reported", cell: (q) => q.reported },
                ]}
                rows={rows}
                rowKey={(q) => String(q.questId)}
              />
              : <EmptyTab reported={reported} message={EMPTY.quests} />,
          })),
          {
            // The encounters 3 installs tie this creature to; no tab for any other NPC.
            id: "boss", label: "Boss", count: bosses.length || 0,
            panel: <DataTable
              dense
              caption={`Boss encounters ${title} is part of`}
              columns={[
                { key: "boss", header: "Boss", cell: (b) => <Link href={bossHref(b.id, b.row.name)} className={LINK}>{b.name}</Link> },
                { key: "instance", header: "Instance", cell: (b) => <Link href={instanceHref(b.instance.instanceMapId, b.instance.name)} className={LINK}>{instanceTitle(b.instance)}</Link> },
              ]}
              rows={bosses}
              rowKey={(b) => String(b.id)}
            />,
          },
          {
            id: "map", label: "Map", count: unreachable ? undefined : page.pins.length,
            panel: unreachable ? <Unreachable />
              : page.pins.length ? <PinTable caption={`Where ${title} stands`} rows={page.pins} rowKey={(p) => String(p.mapId)} />
              : <EmptyTab message={EMPTY.position} />,
          },
        ]}
      />}
      related={<>
        <LoreSection match={lore} />
        {!unreachable && (page.name !== null || dropped.length > 0 || zero !== undefined) && <AdSlot slot="inContent" />}
      </>}
      screenshots={<EntityScreenshots type="npc" id={npcId} name={title} />}
      comments={<EntityComments type="npc" id={npcId} />}
      openData={{
        report: { type: "NPC", id: npcId, path: `/database/npcs/${npcId}` },
        text: [`${title} (npc ${npcId})`, ...summary, `Source: https://everloot.app/database/npcs/${npcId}`].join("\n"),
        jsonHref: !facts.unreachable && hasCard.npc(page) ? `/api/tooltip/npc/${npcId}` : undefined,
      }}
    />
  );
}
