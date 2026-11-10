import type { Metadata } from "next";
import JsonLd from "@/components/JsonLd";
import { entityPageJsonLd } from "@/lib/jsonld";
import AdSlot from "@/components/AdSlot";
import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import { notFound } from "next/navigation";
import { hasCard } from "@/lib/tooltip";
import { npcNameReporters, npcPage, npcTraits, vendorPage, type NpcPin, type NpcRank } from "../../../../../../kb/src/world-pages";
import { pendingLine } from "../../../../../../kb/src/pending-loot";
import { npcLootTable } from "../../../../../../kb/src/loot-tables";
import { computeRollups, loadLootTables, loadWorldFacts } from "@/lib/rollup-compute";
import { pinLink, WORLD_MAP } from "@/lib/world-map";
import { zoneByMapId, zoneHref } from "@/lib/zones";
import { trailFor } from "@/lib/breadcrumbs";
import { Container, DataTable, Facts, InShort, OpenData, Tabs, TooltipFrame, type Column } from "@/components/ui";
import { EmptyTab, EntityHeader, EntityTop, known, LINK, MAP_LINK_HEADER, MapName, ShowOnMap, Unreachable } from "../../entity";
import { NpcLootPanel } from "../../loot-tables";
import { VendorGoods } from "../../vendors/goods";
import { npcRelations } from "../relations";
import { unknownNpc } from "../../unknown";
import { entitySummary, observedLine } from "@/lib/evidence";
import { loadItemFacts } from "@/lib/rollup-compute";
import { itemNames } from "@/lib/names";
import { loreForEntity } from "@/lib/lore";
import { loadItemTips, loadSiteAssets } from "@/lib/game-assets";
import EntityLink from "@/components/EntityLink";
import LoreSection from "@/components/LoreSection";
import { npcIndexable } from "@/lib/indexable";
import { entityTitle, npcDescription } from "@/lib/entity-meta";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const params = await props.params;
  if (!/^[1-9]\d*$/.test(params.id)) return { robots: { index: false, follow: true } };
  const npcId = Number(params.id);
  const [facts, rollup] = await Promise.all([loadWorldFacts(), computeRollups()]);
  if (unknownNpc(npcId, facts, rollup)) notFound();
  const page = npcPage(npcId, facts);
  const name = !facts.unreachable && page.name ? page.name : `NPC ${npcId}`;
  return {
    ...pageMetadata({ title: entityTitle(name, "NPC"), description: npcDescription({ name, id: npcId, positions: facts.unreachable ? 0 : page.pins.length }), path: `/database/npcs/${npcId}`, image: `/database/npcs/${npcId}/opengraph-image` }),
    robots: { index: npcIndexable(page, facts.unreachable), follow: true },
  };
}

/** `UnitClassification` in words, as the game shows it. */
const RANK_LABELS: Record<NpcRank, string> = { normal: "Normal", elite: "Elite", rare: "Rare", rare_elite: "Rare elite", boss: "Boss" };

const pinColumns: Column<NpcPin>[] = [
  { key: "map", header: "Map", cell: (p) => <MapName mapId={p.mapId} /> },
  { key: "at", header: "Position", numeric: true, cell: (p) => `${p.x}, ${p.y}` },
  { key: "installs", header: "Installs", numeric: true, cell: (p) => p.reporters },
  { key: "show", header: MAP_LINK_HEADER, cell: (p) => { const href = pinLink(p.mapId, p.x, p.y); return href ? <ShowOnMap href={href} mapId={p.mapId} x={p.x} y={p.y} /> : null; } },
];

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
      <Link href={href} aria-label={`${zone} at ${pin.x}, ${pin.y}, on the map`} className="relative block overflow-hidden rounded-[4px] border border-line bg-panel" style={{ aspectRatio: ratio }}>
        {/* The zone's picture from the asset bucket as it is; next/image would only proxy it. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {art && <img src={art} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />}
        <span aria-hidden="true" className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent ring-2 ring-black/60" style={{ left: `${pin.x}%`, top: `${pin.y}%` }} />
      </Link>
      <figcaption className="mt-1 text-meta text-muted">{zone} · <span className="tabular-nums">{pin.x}, {pin.y}</span></figcaption>
    </figure>
  );
}

export default async function NpcPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!/^[1-9]\d*$/.test(params.id)) notFound();
  const npcId = Number(params.id);
  const facts = await loadWorldFacts();
  const rollup = await computeRollups();
  if (unknownNpc(npcId, facts, rollup)) notFound();
  const unreachable = facts.unreachable || rollup.stats.unreachable;
  const page = npcPage(npcId, facts);
  const goods = vendorPage(npcId, facts).offers;
  const now = Date.now();
  const { quests, goodsEvidence, goodsReported, questsReported } = npcRelations(npcId, facts, now);
  // The same traits as the NPC list, each shown when 3 installs agree.
  const traits = npcTraits(facts.npcs.filter((r) => r.npcId === npcId), facts.recheck);
  const pending = !unreachable && page.pendingLoot ? <p className="py-2 text-meta text-fg-2">{pendingLine(page.pendingLoot)}</p> : null;
  const title = unreachable ? `NPC ${page.npcId}` : page.name ?? `NPC ${page.npcId}`;
  const zero = rollup.measuredZeros.find((row) => row.public && row.sourceNpcId === npcId);
  const dropped = rollup.rates.filter((row) => row.public && row.sourceNpcId === npcId);
  const firstPin = unreachable ? undefined : page.pins[0];
  const zone = firstPin ? zoneByMapId(firstPin.mapId) : undefined;
  // Item names (and icons, when the game files have them) for the drop and goods lists; an item nobody named stays "Item N".
  const itemFacts = unreachable || (dropped.length === 0 && goods.length === 0) ? null : await loadItemFacts();
  const names = itemFacts && !itemFacts.unreachable ? itemNames(itemFacts) : new Map<number, string>();
  const assets = dropped.length > 0 || goods.length > 0 || zone ? await loadSiteAssets() : null;
  const tips = await loadItemTips(assets, [...dropped.map((row) => row.itemId), ...goods.map((o) => o.itemId)]);
  const art = zone ? assets?.maps.find((m) => m.kind === "zone" && m.uiMapId === zone.mapId && !m.heldBack) : undefined;
  const lore = !unreachable && page.name ? await loreForEntity("npc", page.name) : null;
  // The loot table with each number's windows, installs and dates; its public rows are the rates above.
  const loot = await loadLootTables();
  const lootTable = npcLootTable(loot.tables, npcId);
  const trail = [...trailFor("/database/npcs")!, { name: title, path: `/database/npcs/${npcId}` }];
  const named = title !== `NPC ${npcId}`;
  // The page in three lines: where it is, what players reported, and where the name came from.
  const summary = entitySummary({
    identity: zone
      ? `Seen in ${zone.name}`
      : firstPin
        ? `Seen at map ${firstPin.mapId}, ${firstPin.x}, ${firstPin.y}`
        : "No position has been reported yet",
    observed: observedLine(
      [dropped.length ? `${dropped.length} ${dropped.length === 1 ? "item drops" : "item drops"}` : null, page.pins.length ? `${page.pins.length} ${page.pins.length === 1 ? "map position" : "map positions"}` : null, goods.length ? `${goods.length} goods` : null, quests.length ? `${new Set(quests.map((q) => q.questId)).size} quests` : null],
      null,
      now,
    ),
    named,
  });

  return (
    <Container width="data">
      <article>
        <JsonLd data={entityPageJsonLd({ name: title, path: `/database/npcs/${npcId}`, identifier: `npc:${npcId}` })} />
        <EntityHeader trail={trail} title={title} meta={["NPC", zone?.name, named ? <span key="id" className="tabular-nums">ID {npcId}</span> : null]} />
        <EntityTop
          box={(firstPin && zone && <MapThumb pin={firstPin} zone={zone.name} art={art?.smallUrl ?? art?.url ?? null} />) || (
            <TooltipFrame name={title} label={`${title}, as players saw it`}>
              {firstPin && <p>Map {firstPin.mapId} at {firstPin.x}, {firstPin.y}</p>}
            </TooltipFrame>
          )}
          facts={!unreachable && (
            <Facts
              layout="list"
              label={`${title}: quick facts`}
              items={[
                { label: "Reported name", value: known(page.name, npcNameReporters(npcId, facts)) },
                { label: "Level", value: known(traits.level), numeric: true },
                { label: "Type", value: known(traits.creatureType) },
                { label: "Reaction", value: known(traits.reaction && ({ friendly: "Friendly", neutral: "Neutral", hostile: "Hostile" })[traits.reaction]) },
                { label: "Rank", value: known(traits.rank && RANK_LABELS[traits.rank]) },
                { label: "Zone", value: zone ? <Link href={zoneHref(zone.mapId, zone.name)} className={LINK}>{zone.name}</Link> : known(null) },
                { label: "Map positions", value: known(page.pins.length || null), numeric: true },
                // Short of 3 installs the loot table has no rows, only its installs: that count fills the meter.
                { label: "Drops", value: known(zero ? `None in ${zero.kills} windows` : dropped.length ? `${dropped.length} items` : null, lootTable.state === "short" ? lootTable.span.installs : 0) },
              ]}
            />
          )}
        />
        <InShort summary="In short" bullets={summary} note={<Link href="/database#reading" className={LINK}>How to read these numbers</Link>} />
        <OpenData
          text={[`${title} (npc ${npcId})`, ...summary, `Source: https://everloot.app/database/npcs/${npcId}`].join("\n")}
          jsonHref={!facts.unreachable && hasCard.npc(page) ? `/api/tooltip/npc/${npcId}` : undefined}
        />
        <Tabs
          className="mt-6"
          label={`${title}: relations`}
          tabs={[
            {
              id: "drops", label: "Drops", count: unreachable ? undefined : dropped.length,
              panel: unreachable ? <Unreachable />
                : <>
                  <NpcLootPanel
                    table={lootTable}
                    title={title}
                    dataAsOf={loot.dataAsOf}
                    item={(itemId) => <EntityLink kind="item" id={itemId} name={names.get(itemId) ?? tips.get(itemId)?.name} icon={tips.get(itemId)?.icon} />}
                  />
                  {pending}
                </>,
            },
            {
              id: "goods", label: "Goods", count: unreachable ? undefined : goods.length,
              panel: unreachable ? <Unreachable />
                : goods.length ? <>
                  <p className="py-2 text-meta text-fg-2">This NPC sells goods. <Link href={`/database/vendors/${npcId}`} className={LINK}>Open the vendor page</Link></p>
                  <VendorGoods title={title} offers={goods} tips={tips} items={names} evidence={goodsEvidence} />
                </>
                : <EmptyTab reported={goodsReported} message="No agreed goods yet. A price needs 3 installs." />,
            },
            {
              id: "quests", label: "Quests", count: unreachable ? undefined : quests.length,
              panel: unreachable ? <Unreachable />
                : quests.length ? <DataTable
                  dense
                  caption={`Quests ${title} gives and takes`}
                  columns={[
                    { key: "role", header: "Role", cell: (q) => q.role },
                    { key: "quest", header: "Quest", cell: (q) => <EntityLink kind="quest" id={q.questId} name={q.title} /> },
                    { key: "reported", header: "Reported", cell: (q) => q.reported },
                  ]}
                  rows={quests}
                  rowKey={(q) => `${q.questId}-${q.role}`}
                />
                : <EmptyTab reported={questsReported} message="No agreed quest yet. A quest needs its giver or turn-in from 3 installs." />,
            },
            {
              id: "map", label: "Map", count: unreachable ? undefined : page.pins.length,
              panel: unreachable ? <Unreachable />
                : page.pins.length ? <DataTable dense caption={`Where ${title} stands`} columns={pinColumns} rows={page.pins} rowKey={(p) => String(p.mapId)} />
                : <EmptyTab message="No agreed position yet." />,
            },
          ]}
        />
        <div className="mt-6 space-y-6 empty:hidden">
          <LoreSection match={lore} />
          {!unreachable && (page.name !== null || dropped.length > 0 || zero !== undefined) && <AdSlot slot="inContent" />}
        </div>
      </article>
    </Container>
  );
}
