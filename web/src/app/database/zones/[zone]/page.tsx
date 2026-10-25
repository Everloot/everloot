import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import AdSlot from "@/components/AdSlot";
import ZonePreview from "@/components/ZonePreview";
import {
  AgreementMeter, Badge, Card, Container, DataTable, DataTitle, EmptyState, SectionHeading, Tabs,
  type Column, type TabItem,
} from "@/components/ui";
import { GAME_NAME_TITLE } from "@/components/EntityRelations";
import { loadQuestNames, loadSiteAssets } from "@/lib/game-assets";
import { CLIENT_LAYER } from "@/lib/items";
import { loadWorldFacts } from "@/lib/rollup-compute";
import { bossLine, entranceLinks, instanceHref, loadSightings } from "@/lib/instances";
import { confirmedLine, dayLabel } from "@/lib/report-labels";
import { pageMetadata } from "@/lib/seo";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";
import { WORLD_MAP } from "@/lib/world-map";
import {
  hasConfirmed, hasContent, parseZoneSegment, zoneByMapId, zoneContents, zoneHref, zoneMapHref,
  type ZoneEntrance, type ZoneNpc, type ZoneQuest, type ZoneTreasure,
} from "@/lib/zones";
import { zoneLore } from "@/lib/zone-lore";
import { EmptyTab } from "../../entity";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ zone: string }> };

const link = "text-accent hover:underline underline-offset-4";

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

  const [facts, seen] = await Promise.all([loadWorldFacts(), loadSightings()]);
  // Entrances come from the game files, so they show even when storage is down; player reports do not.
  const here = zoneContents(facts.unreachable ? { npcs: [], quests: [], vendors: [] } : facts, undefined, facts.unreachable ? {} : seen).get(zone.mapId);
  const lore = zoneLore(zone.name);
  const shape = WORLD_MAP.zones.find((z) => z.uiMapId === zone.mapId)!;
  const assets = await loadSiteAssets();
  const art = assets?.maps.find((m) => m.kind === "zone" && m.uiMapId === zone.mapId && !m.heldBack) ?? null;

  const npcs = (here?.npcs ?? []).filter((n) => !n.vendor);
  const vendors = (here?.npcs ?? []).filter((n) => n.vendor);
  const quests = here?.quests ?? [];
  const wikiTitles = quests.some((q) => !q.title) ? await loadQuestNames(CLIENT_LAYER.build.version) : null;
  const entrances = here?.entrances ?? [];
  const treasures = here?.treasures ?? [];
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
    { id: "dungeons", label: "Dungeons and raids", count: entrances.length, panel: <DataTable dense caption={`Dungeon and raid entrances in ${zone.name}`} columns={entranceColumns} rows={entrances} rowKey={(e) => `${e.names.join("|")}-${e.x}-${e.y}`} empty={empty("No dungeon or raid is entered from this zone.")} /> },
    { id: "objects", label: "Objects", count: treasures.length, panel: <DataTable dense caption={`Treasures players saw on the minimap in ${zone.name}`} columns={treasureColumns} rows={treasures} rowKey={(t) => `${t.objectId}-${t.x}-${t.y}`} empty={empty("No treasure has a confirmed position here yet. A pin needs 3 installs at the same spot.")} /> },
  ];
  // Storage down: an empty list would read as "nobody has seen anything", so only the game-file list stays.
  const tabs = facts.unreachable ? all.filter((t) => t.id === "dungeons") : all;

  return (
    <Container width="data">
      <article>
        {/* The database title row: name, continent, and the map link as a quiet control (the header keeps the one filled button). */}
        <DataTitle
          title={zone.name}
          meta={<span className="inline-flex items-center gap-2">{zone.continentName}<Badge tone="files">Zone outline · from game files</Badge></span>}
          trail={[
            { name: "Home", path: "/" },
            { name: "Database", path: "/database" },
            { name: "Zones", path: "/database/zones" },
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
            {!facts.unreachable && !hasConfirmed(here) && (
              <div className="mb-4">
                <EmptyState
                  message={`Players have not confirmed anything in ${zone.name} yet.${entrances.length ? " The dungeon and raid entrances here are read from the game files." : ""} A fact appears when 3 installs agree on it, and until then the lists below stay empty on purpose.`}
                />
              </div>
            )}
            <Tabs label={`Known in ${zone.name}`} tabs={tabs} />
          </section>
        </div>
        {!facts.unreachable && hasContent(here) && <AdSlot slot="inContent" />}
      </article>
    </Container>
  );
}
