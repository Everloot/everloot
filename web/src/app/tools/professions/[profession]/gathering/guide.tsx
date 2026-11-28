import Link from "next/link";
import { agreedObjectNames, type SkillRange } from "@kb/object-spawns";
import EdgeDegraded from "@/components/EdgeDegraded";
import EntityLink from "@/components/EntityLink";
import GameIcon from "@/components/game/GameIcon";
import ItemTip from "@/components/game/ItemTip";
import { Badge, Card, Container, Contribute, DataTable, EmptyState, Field, PageHeader, SectionHeading, type Column } from "@/components/ui";
import { trailFor } from "@/lib/breadcrumbs";
import { dataAgeLabel } from "@/lib/data-age";
import { HERB_IDS, killZones, nodeGatheringZones, professionTrainers } from "@/lib/farming";
import { GATHERING_RANKS, gatheringRank, reportedTrainerRanks, type GatheringSearch } from "@/lib/gathering-guide";
import { loadItemTips, loadSiteAssets } from "@/lib/game-assets";
import { loadListNames } from "@/lib/item-view";
import { shownItemName } from "@/lib/items";
import { loadProfessions } from "@/lib/profession-store";
import { professionHref, type ProfessionInfo } from "@/lib/professions";
import { RECHECK_SCOPES } from "@/lib/recheck-scopes";
import { computeRollups, loadWorldFacts } from "@/lib/rollup-compute";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";
import { npcRows } from "@/lib/world-lists";
import { pinLink } from "@/lib/world-map";
import { publicZones, zoneHref, zoneMapHref, type ZoneSummary } from "@/lib/zones";
import { LINK, MapName, ShowOnMap } from "../../../../database/entity";

const HERBS = new Set(HERB_IDS);
const plural = (n: number, word: string) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;
const RULE = <Badge tone="neutral">3 installs</Badge>;

const INFO = {
  herbalism: {
    title: "Herb zones", zone: "herb zone", list: "Herbs",
    start: "Learn Herbalism, enable Find Herbs on your minimap, and check the requirement on the herb before picking it.",
    source: "A zone shows once 3 installs place a herb spot there. Materials come from agreed loot on the same node type.",
    empty: "No herb zones yet: a zone shows once 3 installs gather from the same spot there.",
    collect: "Gather herbs", noItems: "No herb looted here at 3 installs yet.",
  },
  mining: {
    title: "Ore zones", zone: "ore zone", list: "Vein materials",
    start: "Learn Mining, bring a mining tool, and enable Find Minerals on your minimap. Check the vein in game before traveling farther for higher-rank ore.",
    source: "A zone shows once 3 installs place an ore spot there. Materials come from agreed loot on the same vein type.",
    empty: "No ore zones yet: a zone shows once 3 installs mine the same spot there.",
    collect: "Mine veins", noItems: "No vein material reported here by 3 installs yet.",
  },
  skinning: {
    title: "Where to find skinnable creatures", zone: "skinning candidate zone", list: "Skinned materials",
    start: "Learn Skinning, bring a skinning tool, and loot a skinnable creature before trying to skin it. Check the corpse in game for its skill requirement.",
    source: "Skinning loot and ranks identify the creature. Locations come from kill reports for that creature, with 3 installs required for each source.",
    empty: "No skinning candidate zones yet. A creature needs agreed skinning reports and an agreed kill zone to appear here.",
    collect: "Skin creatures", noItems: "No material from these creatures has 3 skinning reports yet.",
  },
  fishing: {
    title: "Fishing zones", zone: "fishing zone", list: "Catches",
    start: "Learn Fishing, equip a fishing pole, and cast into fishable water. Look for a trainer or Fishing book or quest when your skill stops advancing at its cap.",
    source: "A zone or catch shows after 3 installs report it in that zone. Reports cover the zone as a whole.",
    empty: "No fishing zones yet: a zone shows once 3 installs report catches there.",
    collect: "Open fishing loot", noItems: "No individual catch in this zone has 3 reports yet.",
  },
} as const;

type GuideZone = {
  zone: ZoneSummary;
  itemIds: number[];
  spots?: number;
  installs?: number;
  lowestSkill?: number;
  creatureIds?: number[];
  objectIds?: number[];
};

export default async function GatheringGuide({ profession: p, searchParams = {}, embedded = false, sources }: {
  profession: ProfessionInfo; searchParams?: GatheringSearch; embedded?: boolean;
  sources?: { view: ReturnType<typeof loadProfessions>; assets: ReturnType<typeof loadSiteAssets>; names: ReturnType<typeof loadListNames> };
}) {
  const slug = p.slug as keyof typeof INFO;
  const info = INFO[slug];
  const profession = professionHref(p.slug);
  const path = `${profession}/gathering`;
  const gatheringPath = embedded ? profession : path;
  const { rank, invalid } = gatheringRank(searchParams.skill);
  const existingQuery = new URLSearchParams();
  if (embedded) for (const [key, value] of Object.entries(searchParams)) {
    if (key !== "skill" && value !== undefined) for (const part of Array.isArray(value) ? value : [value]) existingQuery.append(key, part);
  }
  const clearQuery = existingQuery.toString();
  const dedicatedHref = rank === null ? path : `${path}?skill=${rank}#gather-next`;
  const fishing = slug === "fishing";
  const skinning = slug === "skinning";
  const nodeKind = slug === "herbalism" ? "herb" : slug === "mining" ? "ore" : null;
  const viewRequest = sources?.view ?? loadProfessions();
  const [view, rollups, world, assets, shown] = await Promise.all([
    viewRequest, nodeKind ? viewRequest.then(({ corpus }) => computeRollups(corpus)) : null,
    viewRequest.then(({ corpus }) => loadWorldFacts(corpus)), sources?.assets ?? loadSiteAssets(), sources?.names ?? loadListNames(),
  ]);
  const zonesDown = view.unreachable || Boolean(nodeKind && rollups?.stats.unreachable) || (skinning && world.unreachable);
  const gatheringBackfill = !zonesDown && !nodeKind && view.gathering === undefined;
  const trainersDown = view.unreachable || world.unreachable;
  const mapZones = publicZones();
  const zonesById = new Map(mapZones.map((zone) => [zone.mapId, zone]));
  const zones = new Map<number, GuideZone>();
  const skinned = !view.unreachable && skinning ? view.gathering?.skinning ?? [] : [];
  if (!zonesDown && nodeKind) {
    for (const area of nodeGatheringZones(view.sightings, rollups?.rates ?? [], mapZones, nodeKind, nodeKind === "herb" ? HERBS : undefined)) {
      zones.set(area.zone.mapId, { zone: area.zone, itemIds: area.itemIds, spots: area.nodes, installs: area.installs, lowestSkill: area.skill?.min, objectIds: area.objectIds });
    }
  }
  if (!zonesDown && fishing) {
    for (const row of view.gathering?.fishing ?? []) {
      const zone = zonesById.get(row.mapId);
      if (zone) zones.set(zone.mapId, { zone, itemIds: row.itemIds, installs: row.installs });
    }
  }
  if (!zonesDown && skinning) {
    const locations = killZones(world.kills ?? [], mapZones);
    for (const row of skinned) {
      for (const zone of locations.get(row.npcId) ?? []) {
        const here = zones.get(zone.mapId) ?? { zone, itemIds: [], creatureIds: [] };
        here.creatureIds!.push(row.npcId);
        here.itemIds = [...new Set([...here.itemIds, ...row.itemIds])].sort((a, b) => a - b);
        if (row.skill) here.lowestSkill = Math.min(here.lowestSkill ?? Infinity, row.skill.min);
        zones.set(zone.mapId, here);
      }
    }
  }
  const zoneList = [...zones.values()].sort((a, b) =>
    (b.spots ?? b.creatureIds?.length ?? b.installs ?? 0) - (a.spots ?? a.creatureIds?.length ?? a.installs ?? 0) || a.zone.name.localeCompare(b.zone.name),
  );
  const trainerIds = trainersDown ? [] : professionTrainers(view.facts.trainers, p.id, p.name);
  const npcIds = new Set([...trainerIds.map((t) => t.npcId), ...skinned.map((row) => row.npcId)]);
  const npcs = new Map(npcIds.size ? npcRows(world, [], npcIds).map((n) => [n.npcId, n]) : []);
  const trainerRanks = reportedTrainerRanks(slug, p.id, view.facts.trainers);
  const trainers = trainerIds.map((t) => ({ ...t, npc: npcs.get(t.npcId) ?? null, ranks: trainerRanks.get(t.npcId) ?? [] }));
  const suggestions = rank === null ? [] : zoneList.filter((area) => area.lowestSkill !== undefined && area.lowestSkill <= rank)
    .sort((a, b) => b.lowestSkill! - a.lowestSkill!).slice(0, 6);
  // The Forever SkillLine description gives this rule above 100. Keep it distinct from successful rank reports.
  const levelLimit = skinning && rank !== null && rank > 100 ? Math.floor(rank / 5) : null;
  const levelBased = levelLimit !== null ? zoneList.filter((area) => area.lowestSkill === undefined
    && area.creatureIds?.some((id) => {
      const level = npcs.get(id)?.level;
      return level !== undefined && level !== null && level <= levelLimit;
    })).slice(0, 6) : [];
  const objectIds = new Set(zoneList.flatMap((zone) => zone.objectIds ?? []));
  const objectNames = objectIds.size ? agreedObjectNames(view.sightings.filter((row) => objectIds.has(row.objectId)), RECHECK_SCOPES) : new Map<number, string>();
  const itemZones = new Map<number, ZoneSummary[]>(slug === "herbalism" ? HERB_IDS.map((id) => [id, []]) : []);
  for (const zone of zoneList) {
    for (const id of zone.itemIds) {
      const list = itemZones.get(id) ?? [];
      list.push(zone.zone);
      itemZones.set(id, list);
    }
  }
  const index = [...itemZones].sort(([a], [b]) => a - b).map(([itemId, zones]) => ({ itemId, zones }));
  const ids = [...new Set([...itemZones.keys(), ...skinned.flatMap((row) => row.itemIds)])].filter(shown.showsTip);
  const tips = await loadItemTips(ids.length ? assets : null, ids);
  const materialName = (id: number) => shownItemName(id, shown.agreed, shown.matched?.names, tips.get(id))?.name ?? `Item ${id}`;
  const Material = ({ id }: { id: number }) => (
    <span data-herb={slug === "herbalism" ? id : undefined} className="inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full border border-line px-2.5 text-cell">
      {!tips.get(id)?.icon && <span aria-hidden="true" className="h-[18px] w-[18px] shrink-0 rounded-sm border border-line" />}
      <ItemTip tip={tips.get(id)} size={18}>
        <Link href={`/database/items/${id}`} className={LINK} prefetch={false}>{materialName(id)}</Link>
      </ItemTip>
    </span>
  );
  const ZoneLink = ({ zone }: { zone: ZoneSummary }) => <Link href={zoneHref(zone.mapId, zone.name)} className={LINK} prefetch={false}>{zone.name}</Link>;
  const Materials = ({ itemIds }: { itemIds: readonly number[] }) => <ul className="flex flex-wrap gap-2">{itemIds.map((id) => <li key={id}><Material id={id} /></li>)}</ul>;
  const Lowest = ({ skill }: { skill: SkillRange | null }) => skill ? <span>{skill.min}</span> : <span className="text-muted">Unrecorded</span>;
  const materialColumns: Column<(typeof index)[number]>[] = [
    { key: "item", header: slug === "herbalism" ? "Herb" : "Item", cell: (h) => <Material id={h.itemId} /> },
    { key: "zones", header: fishing ? "Caught in" : "Gathered in", cell: (h) => h.zones.length
      ? <span className="flex flex-wrap gap-x-3 gap-y-1">{h.zones.map((z) => <ZoneLink key={z.mapId} zone={z} />)}</span>
      : <span className="text-muted">No zone yet</span> },
  ];
  const trainerColumns: Column<(typeof trainers)[number]>[] = [
    { key: "trainer", header: "Trainer", cell: (t) => <EntityLink kind="npc" id={t.npcId} name={t.npc?.name} prefetch={false} /> },
    { key: "ranks", header: "Ranks seen", cell: (t) => t.ranks.length ? t.ranks.join(", ") : <span className="text-muted">Unrecorded</span> },
    { key: "zone", header: "Zone", cell: (t) => t.npc?.pins[0] ? <MapName mapId={t.npc.pins[0].mapId} /> : <span className="text-muted">Not placed yet</span> },
    { key: "at", header: "Position", numeric: true, cell: (t) => t.npc?.pins[0] ? `${t.npc.pins[0].x}, ${t.npc.pins[0].y}` : <span className="text-muted">—</span> },
    { key: "installs", header: "Installs", numeric: true, cell: (t) => t.installs },
    { key: "map", header: "Map", cell: (t) => {
      const pin = t.npc?.pins[0];
      const href = pin ? pinLink(pin.mapId, pin.x, pin.y) : null;
      return pin && href ? <ShowOnMap href={href} mapId={pin.mapId} x={pin.x} y={pin.y} /> : null;
    } },
  ];
  const creatureColumns: Column<(typeof skinned)[number]>[] = [
    { key: "creature", header: "Creature", cell: (row) => <EntityLink kind="npc" id={row.npcId} name={npcs.get(row.npcId)?.name} prefetch={false} /> },
    { key: "rank", header: "Lowest observed skill", numeric: true, cell: (row) => <Lowest skill={row.skill} /> },
    { key: "materials", header: "Skinned for", cell: (row) => row.itemIds.length ? <Materials itemIds={row.itemIds} /> : <span className="text-muted">Unrecorded</span> },
  ];
  const gathered = index.filter((h) => h.zones.length > 0).length;
  const unavailableMessage = gatheringBackfill ? "Gathering reports will appear after the next profession data refresh." : STORAGE_UNREACHABLE;

  const contents = (
    <div id={embedded && nodeKind ? "gather" : undefined} className="scroll-mt-24 space-y-8">
      <EdgeDegraded when={zonesDown || trainersDown} />
      <section id="gather-next" aria-labelledby="gather-next-heading" className="scroll-mt-24 space-y-3" data-section="next">
        <SectionHeading id="gather-next-heading" as="h2">Where to go next</SectionHeading>
        <Card className="space-y-3">
          <p className="max-w-prose text-cell text-fg-2">{info.start}</p>
          {slug === "mining" && <EntityLink kind="item" id={2901} name="Mining Pick" />}
          {skinning && <EntityLink kind="item" id={7005} name="Skinning Knife" />}
          {fishing && <EntityLink kind="item" id={6256} name="Fishing Pole" />}
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
            <Link href="#zones" className={LINK}>Browse zones</Link>
            <Link href="#trainers" className={LINK}>Find a trainer</Link>
            {embedded && <Link href={dedicatedHref} className={LINK} prefetch={false}>Open gathering guide</Link>}
          </div>
          {!fishing && <form action={`${gatheringPath}#gather-next`} method="get" className="flex flex-wrap items-end gap-3">
            {[...existingQuery].map(([key, value], index) => <input key={`${key}-${index}`} type="hidden" name={key} value={value} />)}
            <Field label="Current effective skill" name="skill" type="number" min={1} max={500} step={1} required mono
              defaultValue={rank ?? ""} aria-invalid={invalid || undefined} aria-describedby="gather-skill-note" />
            <button className="btn btn-primary" type="submit">Find zones</button>
            {rank !== null && <Link href={`${gatheringPath}${clearQuery ? `?${clearQuery}` : ""}#gather-next`} className="btn">Clear skill</Link>}
          </form>}
          {invalid && !fishing && <p role="alert" className="text-cell text-fg-2">Enter a whole skill rank from 1 to 500.</p>}
          <p id="gather-skill-note" className="max-w-prose text-meta text-fg-2">{fishing
            ? "Fishing reports do not include skill ranks. If fish keep getting away, try easier water or use a fishing lure."
            : "Effective skill includes racial and equipment bonuses. Successful observations do not establish skill-up chances or the minimum skill required."}</p>
          {!fishing && rank !== null && <div className="space-y-2">
            <h3 className="text-sm font-semibold text-fg">Where to try at skill {rank}</h3>
            {zonesDown || gatheringBackfill ? <p className="text-cell text-fg-2" role="status">{unavailableMessage}</p> : suggestions.length
              ? <ul className="flex flex-wrap gap-2">{suggestions.map((area) => <li key={area.zone.mapId}>
                  <Link href={`#gather-zone-${area.zone.mapId}`} className="btn">{area.zone.name} <span className="font-mono text-meta text-muted">observed at {area.lowestSkill}</span></Link>
                </li>)}</ul>
              : <p className="text-cell text-fg-2">No zones have enough reports of a successful gather at or below this skill. Check the zone list for other leads.</p>}
          </div>}
          {levelBased.length > 0 && <div className="space-y-2">
            <h3 className="text-sm font-semibold text-fg">More skinning leads by creature level</h3>
            <p className="text-cell text-fg-2">At skill {rank}, the client’s rule suggests skinnable creatures up to level {levelLimit}. Check the corpse requirement in game.</p>
            <ul className="flex flex-wrap gap-2">{levelBased.map((area) => <li key={area.zone.mapId}>
              <Link href={`#gather-zone-${area.zone.mapId}`} className="btn">{area.zone.name}</Link>
            </li>)}</ul>
          </div>}
        </Card>
      </section>

      <section id="zones" aria-labelledby="gather-zones" className="scroll-mt-24 space-y-3" data-section="zones">
        <SectionHeading id="gather-zones" as="h2">{info.title}</SectionHeading>
        <p className="flex flex-wrap items-center gap-2 text-meta text-fg-2">{RULE} {info.source}</p>
        {zonesDown || gatheringBackfill ? <p className="text-cell text-fg-2" role="status">{unavailableMessage}</p> : !zoneList.length
          ? <EmptyState message={info.empty} /> : <ul className="grid gap-3 sm:grid-cols-2">
            {zoneList.map((area) => {
              const zone = area.zone;
              return <li key={zone.mapId} id={`gather-zone-${zone.mapId}`} data-zone={zone.mapId} className="scroll-mt-24">
                <Card className="h-full space-y-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-lg text-fg"><ZoneLink zone={zone} /></h3>
                    <span className="text-meta text-fg-2">{zone.continentName}</span>
                  </div>
                  <p className="font-mono text-meta tabular-nums text-fg-2">
                    {area.spots !== undefined && `${plural(area.spots, "spot")} · `}
                    {area.installs !== undefined && `${plural(area.installs, "install")} agree`}
                    {area.creatureIds && `${area.creatureIds.length} confirmed ${area.creatureIds.length === 1 ? "creature" : "creatures"}`}
                    {area.lowestSkill !== undefined && ` · Lowest observed skill ${area.lowestSkill}`}
                  </p>
                  {area.objectIds?.some((id) => objectNames.has(id)) && <div className="flex flex-wrap gap-x-3 gap-y-1 text-cell">{area.objectIds.filter((id) => objectNames.has(id)).map((id) =>
                    <EntityLink key={id} kind="object" id={id} name={objectNames.get(id)} prefetch={false} />,
                  )}</div>}
                  {area.creatureIds && <ul className="flex flex-wrap gap-x-3 gap-y-1 text-cell">{area.creatureIds.map((id) => <li key={id}><EntityLink kind="npc" id={id} name={npcs.get(id)?.name} prefetch={false} /></li>)}</ul>}
                  {area.itemIds.length ? <Materials itemIds={area.itemIds} /> : <p className="text-cell text-fg-2">{info.noItems}</p>}
                  <Link href={zoneMapHref(zone.mapId)} className={`${LINK} text-sm`} aria-label={`Open ${zone.name} on the map`} prefetch={false}>Open zone map</Link>
                </Card>
              </li>;
            })}
          </ul>}
      </section>

      <section id={slug === "herbalism" ? "herbs" : "materials"} aria-labelledby="gather-materials" className="scroll-mt-24 space-y-3" data-section={slug === "herbalism" ? "herbs" : "materials"}>
        <SectionHeading id="gather-materials" as="h2">{info.list}</SectionHeading>
        <p className="flex flex-wrap items-center gap-2 text-meta text-fg-2">{RULE} {slug === "herbalism" ? "Every herb in the game files, with the zones above where players looted them." : "Materials reported by 3 installs, with the zones we can connect to the source."}</p>
        {zonesDown || gatheringBackfill ? <p className="text-cell text-fg-2" role="status">{unavailableMessage}</p> : <>
          {gathered === 0 && <EmptyState message={slug === "herbalism" ? "No herb gathered in a zone yet: a herb shows its zones once 3 installs loot it from an agreed herb spot." : "No materials have enough reports for a zone yet."} />}
          {index.length > 0 && <DataTable dense caption={`${info.list}: ${index.length}, ${gathered} gathered in a zone`} columns={materialColumns} rows={index} rowKey={(h) => String(h.itemId)} />}
        </>}
      </section>

      {skinned.length > 0 && <section id="creatures" aria-labelledby="gather-creatures" className="scroll-mt-24 space-y-3" data-section="creatures">
        <SectionHeading id="gather-creatures" as="h2">Creatures players skinned</SectionHeading>
        <DataTable dense caption="Confirmed skinning targets" columns={creatureColumns} rows={skinned} rowKey={(row) => String(row.npcId)} />
      </section>}

      <section id="trainers" aria-labelledby="gather-trainers" className="scroll-mt-24 space-y-3" data-section="trainers">
        <SectionHeading id="gather-trainers" as="h2">Trainers seen in uploads</SectionHeading>
        <p className="max-w-prose text-cell text-fg-2">Check your current skill cap in game and unlock the next rank before you reach it.</p>
        <ol className="grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label={`${p.name} training ranks`}>
          {GATHERING_RANKS.map(({ title, cap }) => <li className="rounded-control border border-line p-3" key={cap}>
            <p className="text-cell font-semibold text-fg">{title} <span className="text-meta font-normal text-fg-2">· Cap {cap}</span></p>
            {fishing && title === "Expert" ? <p className="mt-1 text-cell text-fg-2">Buy <a className={LINK} href="https://www.wowhead.com/forever/item=16083/expert-fishing-the-bass-and-you">The Bass and You</a> in Booty Bay.</p>
              : fishing && title === "Artisan" ? <p className="mt-1 text-cell text-fg-2">Complete <a className={LINK} href="https://www.wowhead.com/forever/quest=6607/nat-pagle-angler-extreme">Nat Pagle, Angler Extreme</a> in Dustwallow Marsh.</p>
              : <p className="mt-1 text-cell text-fg-2">Learn from a trainer.</p>}
          </li>)}
        </ol>
        <p className="flex flex-wrap items-center gap-2 text-meta text-fg-2">{RULE} Trainers whose {p.name} window 3 installs opened. The position is where 3 installs placed them; faction is not recorded.</p>
        {trainersDown ? <p className="text-cell text-fg-2" role="status">{STORAGE_UNREACHABLE}</p> : !trainers.length
          ? <EmptyState message={`No ${p.name} trainers yet: a trainer shows once 3 installs open their ${p.name} window.`} />
          : <DataTable dense caption={`${p.name} trainers: ${trainers.length}`} columns={trainerColumns} rows={trainers} rowKey={(t) => String(t.npcId)} />}
      </section>

      <Contribute id="gather-contribute" title="Share your gathering reports"
        note={`${info.collect} and open your ${p.name} trainer with the addon on. The Desktop App uploads when you log out.`} />
      {!embedded && <p className="text-cell text-fg-2"><Link href={profession} className={LINK}>{p.name} profession reference</Link></p>}
    </div>
  );
  if (embedded) return contents;
  const icon = assets?.professions.get(p.name.toLowerCase())?.icon;
  return (
    <Container width="data">
      <PageHeader trail={[...(trailFor(profession) ?? []), { name: "Gathering", path }]} title={`${p.name} gathering`}
        icon={icon ? <GameIcon src={icon} size={40} /> : undefined}
        lede={`Find ${p.name} zones, materials and trainers from WoW: Forever player reports.`}
        meta={<>{RULE}{!zonesDown && !gatheringBackfill && <span className="font-mono tabular-nums">{plural(zoneList.length, info.zone)}</span>}{!view.unreachable && <span>{dataAgeLabel(view.dataAsOf)}</span>}</>}
      />
      {contents}
    </Container>
  );
}
