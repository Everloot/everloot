import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import EdgeDegraded from "@/components/EdgeDegraded";
import EntityLink from "@/components/EntityLink";
import GameIcon from "@/components/game/GameIcon";
import ItemTip from "@/components/game/ItemTip";
import { Badge, Card, Container, Contribute, DataTable, EmptyState, PageHeader, SectionHeading, type Column } from "@/components/ui";
import { trailFor } from "@/lib/breadcrumbs";
import { dataAgeLabel } from "@/lib/data-age";
import { HERBALISM_SKILL_LINE, herbIndex, herbZones, professionTrainers, type HerbZone } from "@/lib/farming";
import { loadItemTips, loadSiteAssets } from "@/lib/game-assets";
import { loadListNames } from "@/lib/item-view";
import { shownItemName } from "@/lib/items";
import { loadProfessions } from "@/lib/profession-store";
import { professionBySegment, professionHref } from "@/lib/professions";
import { computeRollups, loadWorldFacts } from "@/lib/rollup-compute";
import { pageMetadata } from "@/lib/seo";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";
import { npcRows } from "@/lib/world-lists";
import { pinLink } from "@/lib/world-map";
import { publicZones, zoneHref, type ZoneSummary } from "@/lib/zones";
import { LINK, MapName, ShowOnMap } from "../../../../database/entity";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ profession: string }> };

/** Only Herbalism has a gathering guide so far; every other profession's /gathering is a 404. */
const GUIDES = new Set(["herbalism"]);

export async function generateMetadata(props: Props): Promise<Metadata> {
  const p = professionBySegment((await props.params).profession);
  if (!p || !GUIDES.has(p.slug)) notFound();
  return pageMetadata({
    title: "WoW Forever Herbalism Gathering Guide",
    description: "Herb zones, the herbs looted in each and the Herbalism trainers players saw in WoW: Forever, from player uploads at 3 installs.",
    path: `${professionHref(p.slug)}/gathering`,
  });
}

const plural = (n: number, word: string) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;
const RULE = <Badge tone="neutral">3 installs</Badge>;

/**
 * Herbalism gathering, from player uploads only: the zones where 3 installs gathered from the same herb spot with
 * the herbs looted there, each herb with its zones, and the trainers players saw teach Herbalism. The game files tie
 * no herb to a skill or a zone and list no trainers, so nothing here comes from them except the herb item ids.
 */
export default async function GatheringPage(props: Props) {
  const segment = (await props.params).profession;
  const p = professionBySegment(segment);
  if (!p || !GUIDES.has(p.slug) || segment !== p.slug) notFound();
  const path = `${professionHref(p.slug)}/gathering`;

  const view = await loadProfessions();
  const [rollups, world, assets, shown] = await Promise.all([
    computeRollups(view.corpus), loadWorldFacts(view.corpus), loadSiteAssets(), loadListNames(),
  ]);
  const herbsDown = view.unreachable || rollups.stats.unreachable;
  const trainersDown = view.unreachable || world.unreachable;

  const zones: HerbZone[] = herbsDown ? [] : herbZones(view.sightings, rollups.rates, publicZones());
  const index = herbIndex(zones);
  const trainerIds = trainersDown ? [] : professionTrainers(view.facts.trainers, HERBALISM_SKILL_LINE, p.name);
  const npcs = new Map(trainerIds.length ? npcRows(world, rollups.rates).map((n) => [n.npcId, n]) : []);
  const trainers = trainerIds.map((t) => ({ ...t, npc: npcs.get(t.npcId) ?? null }));

  // Herb names and icons at runtime, under the item name rule, as on the profession page.
  const ids = index.map((h) => h.itemId).filter(shown.showsTip);
  const tips = await loadItemTips(ids.length ? assets : null, ids);
  const herbName = (id: number) => shownItemName(id, shown.agreed, shown.matched?.names, tips.get(id))?.name ?? null;
  const Herb = ({ id }: { id: number }) => (
    <span data-herb={id} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line px-2.5 text-cell">
      {!tips.get(id)?.icon && <span aria-hidden="true" className="h-[18px] w-[18px] shrink-0 rounded-sm border border-line" />}
      <ItemTip tip={tips.get(id)} size={18}>
        <Link href={`/database/items/${id}`} className={LINK}>{herbName(id) ?? `Item ${id}`}</Link>
      </ItemTip>
    </span>
  );
  const ZoneLink = ({ zone }: { zone: ZoneSummary }) => <Link href={zoneHref(zone.mapId, zone.name)} className={LINK}>{zone.name}</Link>;

  const herbColumns: Column<(typeof index)[number]>[] = [
    { key: "herb", header: "Herb", cell: (h) => <Herb id={h.itemId} /> },
    {
      key: "zones", header: "Gathered in", cell: (h) => h.zones.length
        ? <span className="flex flex-wrap gap-x-3 gap-y-1">{h.zones.map((z) => <ZoneLink key={z.mapId} zone={z} />)}</span>
        : <span className="text-muted">No zone yet</span>,
    },
  ];
  const trainerColumns: Column<(typeof trainers)[number]>[] = [
    { key: "trainer", header: "Trainer", cell: (t) => <EntityLink kind="npc" id={t.npcId} name={t.npc?.name} prefetch={false} /> },
    { key: "zone", header: "Zone", cell: (t) => (t.npc?.pins[0] ? <MapName mapId={t.npc.pins[0].mapId} /> : <span className="text-muted">Not placed yet</span>) },
    { key: "at", header: "Position", numeric: true, cell: (t) => (t.npc?.pins[0] ? `${t.npc.pins[0].x}, ${t.npc.pins[0].y}` : <span className="text-muted">—</span>) },
    { key: "installs", header: "Installs", numeric: true, cell: (t) => t.installs },
    {
      key: "map", header: "Map", cell: (t) => {
        const pin = t.npc?.pins[0];
        const href = pin ? pinLink(pin.mapId, pin.x, pin.y) : null;
        return pin && href ? <ShowOnMap href={href} mapId={pin.mapId} x={pin.x} y={pin.y} /> : null;
      },
    },
  ];
  const gathered = index.filter((h) => h.zones.length > 0).length;

  return (
    <Container width="data">
      <EdgeDegraded when={herbsDown || trainersDown} />
      <PageHeader
        trail={trailFor(path)!}
        title="Herbalism gathering"
        icon={assets?.professions.get(p.name.toLowerCase())?.icon ? <GameIcon src={assets.professions.get(p.name.toLowerCase())!.icon} size={40} /> : undefined}
        lede="Where players gathered herbs, what they looted there and the trainers they saw, from player uploads."
        meta={<>
          {RULE}
          {!herbsDown && <span className="font-mono tabular-nums">{plural(zones.length, "herb zone")}</span>}
          {!view.unreachable && <span>{dataAgeLabel(view.dataAsOf)}</span>}
        </>}
      />

      <div className="space-y-8">
        <section id="zones" aria-labelledby="gather-zones" className="scroll-mt-24 space-y-3" data-section="zones">
          <SectionHeading id="gather-zones" as="h2">Herb zones</SectionHeading>
          <p className="flex flex-wrap items-center gap-2 text-meta text-fg-2">
            {RULE} A zone shows once 3 installs gather from the same herb spot there; its herbs are the ones 3 installs looted from those nodes.
          </p>
          {herbsDown
            ? <p className="text-cell text-fg-2" role="status">{STORAGE_UNREACHABLE}</p>
            : zones.length === 0
              ? <EmptyState message="No herb zones yet: a zone shows once 3 installs gather from the same spot there." />
              : (
                <ul className="grid gap-3 sm:grid-cols-2">
                  {zones.map((z) => (
                    <li key={z.key} data-zone={z.zone.mapId}>
                      <Card className="h-full space-y-3">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <h3 className="text-lg text-fg"><ZoneLink zone={z.zone} /></h3>
                          <span className="text-meta text-fg-2">{z.zone.continentName}</span>
                        </div>
                        <p className="font-mono text-meta tabular-nums text-fg-2">{plural(z.nodes, "spot")} · {plural(z.installs, "install")} agree</p>
                        {z.herbs.length
                          ? <ul className="flex flex-wrap gap-2" aria-label={`Herbs looted in ${z.zone.name}`}>{z.herbs.map((id) => <li key={id}><Herb id={id} /></li>)}</ul>
                          : <p className="text-cell text-fg-2">No herb looted here at 3 installs yet.</p>}
                      </Card>
                    </li>
                  ))}
                </ul>
              )}
        </section>

        <section id="herbs" aria-labelledby="gather-herbs" className="scroll-mt-24 space-y-3" data-section="herbs">
          <SectionHeading id="gather-herbs" as="h2">Herbs</SectionHeading>
          <p className="flex flex-wrap items-center gap-2 text-meta text-fg-2">
            {RULE} Every herb in the game files, with the herb zones above where players looted it.
          </p>
          {herbsDown
            ? <p className="text-cell text-fg-2" role="status">{STORAGE_UNREACHABLE}</p>
            : (
              <>
                {gathered === 0 && <EmptyState message="No herb gathered in a zone yet: a herb shows its zones once 3 installs loot it from an agreed herb spot." />}
                <DataTable dense caption={`Herbs: ${index.length}, ${gathered} gathered in a zone`} columns={herbColumns} rows={index} rowKey={(h) => String(h.itemId)} />
              </>
            )}
        </section>

        <section id="trainers" aria-labelledby="gather-trainers" className="scroll-mt-24 space-y-3" data-section="trainers">
          <SectionHeading id="gather-trainers" as="h2">Trainers seen in uploads</SectionHeading>
          <p className="flex flex-wrap items-center gap-2 text-meta text-fg-2">
            {RULE} Trainers whose Herbalism window 3 installs opened (addons that name the trainer). The position is where 3 installs placed them; faction is not recorded.
          </p>
          {trainersDown
            ? <p className="text-cell text-fg-2" role="status">{STORAGE_UNREACHABLE}</p>
            : trainers.length === 0
              ? <EmptyState message="No Herbalism trainers yet: a trainer shows once 3 installs open their Herbalism window." />
              : <DataTable dense caption={`Herbalism trainers: ${trainers.length}`} columns={trainerColumns} rows={trainers} rowKey={(t) => String(t.npcId)} />}
        </section>

        <section aria-labelledby="gather-skill" className="space-y-2" data-section="skill">
          <SectionHeading id="gather-skill" as="h2">Skill ranges</SectionHeading>
          <p className="max-w-prose text-cell text-fg-2">
            The game files do not say which skill each herb needs, so this guide has no skill ranges yet. They will appear
            once the addon records your Herbalism skill when you loot an herb, and 3 installs agree.
          </p>
        </section>

        <Contribute
          id="gather-contribute"
          title="Add your herbs"
          note="Gather herbs and open your Herbalism trainer with the addon on. The Desktop App uploads when you log out; a zone, herb or trainer shows once 3 installs agree."
        />
        <p className="text-cell text-fg-2">
          Herbalism crafts and recipes are on the <Link href={professionHref(p.slug)} className={LINK}>Herbalism page</Link>.
        </p>
      </div>
    </Container>
  );
}
