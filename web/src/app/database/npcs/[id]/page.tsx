import type { Metadata } from "next";
import AdSlot from "@/components/AdSlot";
import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import { notFound } from "next/navigation";
import { npcPage, npcTraits, type NpcPin, type NpcRank } from "../../../../../../kb/src/world-pages";
import { pendingForNpc, pendingLine } from "../../../../../../kb/src/pending-loot";
import { npcLootTable } from "../../../../../../kb/src/loot-tables";
import { computeRollups, loadLootTables, loadWorldFacts } from "@/lib/rollup-compute";
import { pinLink, WORLD_MAP } from "@/lib/world-map";
import { zoneByMapId, zoneHref } from "@/lib/zones";
import { trailFor } from "@/lib/breadcrumbs";
import { Container, DataTable, Facts, InShort, OpenData, Tabs, TooltipFrame, type Column } from "@/components/ui";
import { EmptyTab, EntityHeader, EntityTop, known, LINK, Unreachable } from "../../entity";
import { NpcLootPanel } from "../../loot-tables";
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

/**
 * An id no upload mentions: no sighting, no vendor or quest row naming it, no loot window from it, counted or not. The game
 * files the site reads hold no NPC table, so that is a 404, not an empty page. Unreachable storage rules nothing out.
 */
function unknownNpc(npcId: number, facts: Awaited<ReturnType<typeof loadWorldFacts>>, rollup: Awaited<ReturnType<typeof computeRollups>>): boolean {
  if (facts.unreachable || rollup.stats.unreachable) return false;
  return !facts.npcs.some((r) => r.npcId === npcId)
    && !facts.vendors.some((r) => r.vendorNpcId === npcId)
    && !facts.quests.some((r) => r.giverNpcId === npcId || r.turnInNpcId === npcId)
    && !rollup.rates.some((r) => r.sourceNpcId === npcId)
    && !rollup.measuredZeros.some((r) => r.sourceNpcId === npcId)
    && !pendingForNpc(facts.pending, npcId);
}

export async function generateMetadata(props: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const params = await props.params;
  if (!/^[1-9]\d*$/.test(params.id)) return { robots: { index: false, follow: true } };
  const npcId = Number(params.id);
  const [facts, rollup] = await Promise.all([loadWorldFacts(), computeRollups()]);
  if (unknownNpc(npcId, facts, rollup)) notFound();
  const page = npcPage(npcId, facts);
  const name = !facts.unreachable && page.name ? page.name : `NPC ${npcId}`;
  return {
    ...pageMetadata({ title: entityTitle(name, "NPC"), description: npcDescription({ name, id: npcId, positions: facts.unreachable ? 0 : page.pins.length }), path: `/database/npcs/${npcId}` }),
    robots: { index: npcIndexable(page, facts.unreachable), follow: true },
  };
}

/** `UnitClassification` in words, as the game shows it. */
const RANK_LABELS: Record<NpcRank, string> = { normal: "Normal", elite: "Elite", rare: "Rare", rare_elite: "Rare elite", boss: "Boss" };

const pinColumns: Column<NpcPin>[] = [
  { key: "map", header: "Map", numeric: true, cell: (p) => p.mapId },
  { key: "at", header: "Position", numeric: true, cell: (p) => `${p.x}, ${p.y}` },
  { key: "installs", header: "Reporters", numeric: true, cell: (p) => p.reporters },
  { key: "show", header: "", cell: (p) => { const href = pinLink(p.mapId, p.x, p.y); return href ? <Link href={href} className={LINK}>Show on the map</Link> : null; } },
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
  // Level and rank, each shown when 3 installs report the same one.
  const traits = npcTraits(facts.npcs.filter((r) => r.npcId === npcId), facts.recheck);
  const pending = !unreachable && page.pendingLoot ? <p className="py-2 text-meta text-fg-2">{pendingLine(page.pendingLoot)}</p> : null;
  const title = unreachable ? `NPC ${page.npcId}` : page.name ?? `NPC ${page.npcId}`;
  const zero = rollup.measuredZeros.find((row) => row.public && row.sourceNpcId === npcId);
  const dropped = rollup.rates.filter((row) => row.public && row.sourceNpcId === npcId);
  const firstPin = unreachable ? undefined : page.pins[0];
  const zone = firstPin ? zoneByMapId(firstPin.mapId) : undefined;
  // Item names (and icons, when the game files have them) for the drop list; an item nobody named stays "Item N".
  const itemFacts = unreachable || dropped.length === 0 ? null : await loadItemFacts();
  const names = itemFacts && !itemFacts.unreachable ? itemNames(itemFacts) : new Map<number, string>();
  const assets = dropped.length > 0 || zone ? await loadSiteAssets() : null;
  const tips = await loadItemTips(assets, dropped.map((row) => row.itemId));
  const art = zone ? assets?.maps.find((m) => m.kind === "zone" && m.uiMapId === zone.mapId && !m.heldBack) : undefined;
  const lore = !unreachable && page.name ? await loreForEntity("npc", page.name) : null;
  // The loot table with each number's windows, installs and dates; its public rows are the rates above.
  const loot = await loadLootTables();
  const lootTable = npcLootTable(loot.tables, npcId);
  const trail = [...trailFor("/database/npcs")!, { name: title, path: `/database/npcs/${npcId}` }];
  const named = title !== `NPC ${npcId}`;
  // The page in three lines: where it is, what players reported, and where the name came from.
  const now = Date.now();
  const summary = entitySummary({
    identity: zone
      ? `Seen in ${zone.name}`
      : firstPin
        ? `Seen at map ${firstPin.mapId}, ${firstPin.x}, ${firstPin.y}`
        : "No position has been reported yet",
    observed: observedLine(
      [dropped.length ? `${dropped.length} ${dropped.length === 1 ? "item drops" : "item drops"}` : null, page.pins.length ? `${page.pins.length} ${page.pins.length === 1 ? "map position" : "map positions"}` : null],
      null,
      now,
    ),
    named,
  });

  return (
    <Container width="data">
      <article>
        <EntityHeader trail={trail} title={title} meta={["NPC", zone?.name, named ? <span className="tabular-nums">ID {npcId}</span> : null]} />
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
                { label: "Reported name", value: known(page.name) },
                { label: "Level", value: known(traits.level), numeric: true },
                { label: "Rank", value: known(traits.rank && RANK_LABELS[traits.rank]) },
                { label: "Zone", value: zone ? <Link href={zoneHref(zone.mapId, zone.name)} className={LINK}>{zone.name}</Link> : known(null) },
                { label: "Map positions", value: known(page.pins.length || null), numeric: true },
                { label: "Drops", value: known(zero ? `None in ${zero.kills} windows` : dropped.length ? `${dropped.length} items` : null) },
              ]}
            />
          )}
        />
        <InShort summary="In short" bullets={summary} note={<Link href="/database#reading" className={LINK}>How to read these numbers</Link>} />
        <OpenData
          text={[`${title} (npc ${npcId})`, ...summary, `Source: https://everloot.app/database/npcs/${npcId}`].join("\n")}
          jsonHref={`/api/tooltip/npc/${npcId}`}
        />
        <Tabs
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
