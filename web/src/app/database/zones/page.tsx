import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ArtThumb from "@/components/game/ArtThumb";
import { Container, DataTable, DataTitle, filledColumns, FilterBar, ResultStrip, type SparseColumn } from "@/components/ui";
import { trailFor } from "@/lib/breadcrumbs";
import { loadSiteAssets } from "@/lib/game-assets";
import { loadWorldFacts } from "@/lib/rollup-compute";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";
import EdgeDegraded from "@/components/EdgeDegraded";
import { hasConfirmed, publicZones, zoneContents, zoneHref, type ZoneContents, type ZoneSummary } from "@/lib/zones";
import { byRank, nameMatches, Respelled, ListNote, listHref, listMetadata, listQuery, NameCell, nextSort, NoMatches, paged, pageParams, sortRows, type ListQuery, type Search } from "../list-parts";

export const dynamic = "force-dynamic";

const META = {
  title: "WoW Forever Zones",
  description: "Every zone of WoW: Forever by continent, with the dungeons and raids entered there and the NPCs, vendors and quests players have confirmed in each.",
  path: "/database/zones",
};

const SORTS = ["name", "continent", "npcs", "vendors", "quests", "instances"] as const;
type Sort = (typeof SORTS)[number];
// By continent, each one's zones A to Z, as the list has always read.
const DEFAULT_SORT = { key: "continent" as Sort, desc: false };

const href = (q: Partial<ListQuery<Sort>>) => listHref(META.path, [["q", q.q], ...pageParams(q)]);

export async function generateMetadata(props: { searchParams?: Promise<Search> }): Promise<Metadata> {
  const q = listQuery((await props.searchParams) ?? {}, SORTS);
  return listMetadata(META, Boolean(q) && !q!.q && !q!.sort && !q!.per, q?.page);
}

type Row = ZoneSummary & { contents: ZoneContents | null };

export default async function ZonesPage(props: { searchParams?: Promise<Search> }) {
  const q = listQuery((await props.searchParams) ?? {}, SORTS);
  if (!q) notFound();
  const facts = await loadWorldFacts();
  const contents = zoneContents(facts.unreachable ? { npcs: [], quests: [], vendors: [] } : facts);
  const zones = publicZones();
  // Each zone's own map picture, small, before its name: the same picture the zone page shows, never a held-back one.
  const assets = await loadSiteAssets();
  const pictures = new Map((assets?.maps ?? []).filter((m) => m.kind === "zone" && !m.heldBack).map((m) => [m.uiMapId, m.smallUrl ?? m.url]));
  const noneConfirmed = !zones.some((z) => hasConfirmed(contents.get(z.mapId)));
  const text = q.q?.toLowerCase();
  const all = zones.map((z): Row => ({ ...z, contents: contents.get(z.mapId) ?? null }));
  const { ranked, respelled } = nameMatches(all, text, null, (z) => z.name);
  const matched = all.filter((z) => !text || ranked!.has(z));
  const sort = q.sort ?? DEFAULT_SORT;
  // The counts players confirmed in each zone: a count sort puts the busiest first; a zone with none sorts last.
  const npcCount = (c: ZoneContents) => c.npcs.filter((n) => !n.vendor).length;
  const vendorCount = (c: ZoneContents) => c.npcs.filter((n) => n.vendor).length;
  const questCount = (c: ZoneContents) => c.quests.length;
  const counted = (z: Row, pick: (c: ZoneContents) => number) => (z.contents === null || facts.unreachable ? null : pick(z.contents) || null);
  // A continent's zones stay A to Z inside it: the name is the second half of the continent key.
  const key = (z: Row): string | number | null => sort.key === "continent" ? `${z.continentName}\u0000${z.name}` : sort.key === "npcs" ? counted(z, npcCount)
    : sort.key === "vendors" ? counted(z, vendorCount) : sort.key === "quests" ? counted(z, questCount) : sort.key === "instances" ? z.contents?.entrances.length || null : z.name;
  const rows = byRank(sortRows(matched, key, sort.desc, (z) => z.mapId), ranked, Boolean(q.sort));
  const { shown, pages, per } = paged(rows, q);
  const here = (over: Partial<ListQuery<Sort>>) => href({ ...q, page: 1, ...over });

  // A count nobody has reported reads "—", never a wall of zeros; a column with none in any zone is left out.
  // Player counts are blank too while storage is down.
  const dash = <span className="text-muted">—</span>;
  const count = (pick: (c: ZoneContents) => number) => ({
    sortable: true,
    cell: (row: Row) => counted(row, pick) ?? dash,
    blank: (row: Row) => counted(row, pick) === null,
  });
  // The zone, what players confirmed in it, then the continent it is on.
  const columns: SparseColumn<Row>[] = filledColumns([
    { key: "name", header: "Zone", sortable: true, cell: (z) => {
      const src = pictures.get(z.mapId);
      return <NameCell href={zoneHref(z.mapId, z.name)} icon={src && <ArtThumb src={src} width={42} height={28} />}>{z.name}</NameCell>;
    } },
    { key: "npcs", header: "NPCs", numeric: true, ...count(npcCount) },
    { key: "vendors", header: "Vendors", numeric: true, ...count(vendorCount) },
    { key: "quests", header: "Quests", numeric: true, ...count(questCount) },
    { key: "instances", header: "Dungeons and raids", numeric: true, sortable: true, cell: (z) => z.contents?.entrances.length || dash, blank: (z) => !z.contents?.entrances.length },
    { key: "continent", header: "Continent", sortable: true, cell: (z) => z.continentName },
  ], rows);
  const keep = Object.fromEntries(new URLSearchParams(href({ ...q, q: undefined, page: 1 }).split("?")[1] ?? ""));
  const strip = <ResultStrip total={rows.length} noun={rows.length === 1 ? "zone" : "zones"} page={q.page} perPage={per} href={(page) => href({ ...q, page })} sizeHref={(n) => href({ ...q, per: n, page: 1 })} label="Zone pages" />;

  return (
    <Container width="data">
      <EdgeDegraded when={facts.unreachable} />
      <article>
        <DataTitle title="Zones" aside={strip} trail={trailFor("/database/zones") ?? undefined} />
        {facts.unreachable && <p className="mb-3 text-meta text-warning">{STORAGE_UNREACHABLE}</p>}
        {!facts.unreachable && (
          <ListNote>
            {noneConfirmed
              ? "Players have not confirmed anything in any zone yet, so there are no counts to show. "
              : "A dash means nobody has confirmed anything of that kind in the zone yet. It does not mean there is none. "}
            A fact appears when 3 installs agree on it.
          </ListNote>
        )}
        <FilterBar
          label="Zone filters"
          search={{ action: META.path, value: q.q, placeholder: "Zone name", label: "Filter by name", keep }}
          controls={[]}
          active={q.q ? 1 : 0}
          clearHref={META.path}
        />
        {respelled && rows.length > 0 && <Respelled q={respelled} />}
        <div className="mt-2">
          <DataTable
            dense
            caption={`Zones: ${rows.length}`}
            columns={columns}
            rows={shown}
            rowKey={(z) => String(z.mapId)}
            sort={{ key: sort.key, direction: sort.desc ? "desc" : "asc" }}
            sortHref={(k, dir) => here({ sort: nextSort(k, dir, DEFAULT_SORT) })}
            meta={(z) => [z.continentName, z.contents?.entrances.length ? `${z.contents.entrances.length} dungeons and raids` : ""].filter(Boolean).join(" · ")}
            empty={<NoMatches noun="zones" chips={q.q ? [{ label: `Name: ${q.q}`, href: here({ q: undefined }) }] : []} clearHref={META.path} />}
          />
        </div>
        {pages > 1 && <div className="mt-2">{strip}</div>}
      </article>
    </Container>
  );
}