import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ArtThumb from "@/components/game/ArtThumb";
import { Container, DataTable, DataTitle, filledColumns, FilterBar, ResultStrip, type SparseColumn } from "@/components/ui";
import { trailFor } from "@/lib/breadcrumbs";
import { loadSiteAssets } from "@/lib/game-assets";
import { loadWorldFacts } from "@/lib/rollup-compute";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";
import EdgeDegraded from "@/components/EdgeDegraded";
import { hasConfirmed, publicZones, zoneContents, zoneHref, type ZoneContents, type ZoneSummary } from "@/lib/zones";
import { listHref, listMetadata, listQuery, nextSort, NoMatches, PER_PAGE, sortParam, sortRows, type ListQuery, type Search } from "../list-parts";

export const dynamic = "force-dynamic";

const META = {
  title: "WoW Forever Zones",
  description: "Every zone of WoW: Forever by continent, with the dungeons and raids entered there and the NPCs, vendors and quests players have confirmed in each.",
  path: "/database/zones",
};

const SORTS = ["name", "continent"] as const;
type Sort = (typeof SORTS)[number];
// By continent, each one's zones A to Z, as the list has always read.
const DEFAULT_SORT = { key: "continent" as Sort, desc: false };

const href = (q: Partial<ListQuery<Sort>>) => listHref(META.path, [["q", q.q], ["sort", sortParam(q.sort)], ["page", q.page && q.page > 1 ? String(q.page) : undefined]]);

export async function generateMetadata(props: { searchParams?: Promise<Search> }): Promise<Metadata> {
  const q = listQuery((await props.searchParams) ?? {}, SORTS);
  return listMetadata(META, Boolean(q) && !q!.q && !q!.sort, q?.page);
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
  const matched = zones.filter((z) => !text || z.name.toLowerCase().includes(text)).map((z): Row => ({ ...z, contents: contents.get(z.mapId) ?? null }));
  const sort = q.sort ?? DEFAULT_SORT;
  // A continent's zones stay A to Z inside it: the name is the second half of the continent key.
  const rows = sortRows(matched, (z) => (sort.key === "continent" ? `${z.continentName}\u0000${z.name}` : z.name), sort.desc, (z) => z.mapId);
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  if (q.page > pages) notFound();
  const shown = rows.slice((q.page - 1) * PER_PAGE, q.page * PER_PAGE);
  const here = (over: Partial<ListQuery<Sort>>) => href({ ...q, page: 1, ...over });

  // A count nobody has reported reads "—", never a wall of zeros; a column with none in any zone is left out.
  // Player counts are blank too while storage is down.
  const dash = <span className="text-muted">—</span>;
  const count = (pick: (c: ZoneContents) => number) => ({
    cell: (row: Row) => (row.contents === null || facts.unreachable ? 0 : pick(row.contents)) || dash,
    blank: (row: Row) => row.contents === null || facts.unreachable || pick(row.contents) === 0,
  });
  const columns: SparseColumn<Row>[] = filledColumns([
    { key: "name", header: "Zone", sortable: true, cell: (z) => {
      const src = pictures.get(z.mapId);
      const name = <Link href={zoneHref(z.mapId, z.name)} className="text-fg hover:underline underline-offset-4">{z.name}</Link>;
      return src ? <span className="flex min-w-0 items-center gap-2"><ArtThumb src={src} width={42} height={28} />{name}</span> : name;
    } },
    { key: "continent", header: "Continent", sortable: true, cell: (z) => z.continentName },
    { key: "npcs", header: "NPCs", numeric: true, ...count((c) => c.npcs.filter((n) => !n.vendor).length) },
    { key: "vendors", header: "Vendors", numeric: true, ...count((c) => c.npcs.filter((n) => n.vendor).length) },
    { key: "quests", header: "Quests", numeric: true, ...count((c) => c.quests.length) },
    { key: "instances", header: "Dungeons and raids", numeric: true, cell: (z) => z.contents?.entrances.length || dash, blank: (z) => !z.contents?.entrances.length },
  ], rows);
  const keep = Object.fromEntries(new URLSearchParams(href({ ...q, q: undefined, page: 1 }).split("?")[1] ?? ""));
  const strip = <ResultStrip total={rows.length} noun={rows.length === 1 ? "zone" : "zones"} page={q.page} perPage={PER_PAGE} href={(page) => href({ ...q, page })} label="Zone pages" />;

  return (
    <Container width="data">
      <EdgeDegraded when={facts.unreachable} />
      <article>
        <DataTitle title="Zones" aside={strip} trail={trailFor("/database/zones") ?? undefined} />
        {facts.unreachable && <p className="mb-3 text-meta text-warning">{STORAGE_UNREACHABLE}</p>}
        {!facts.unreachable && (
          <p className="mb-3 max-w-reading text-meta text-fg-2">
            {noneConfirmed
              ? "Players have not confirmed anything in any zone yet, so there are no counts to show. "
              : "A dash means nobody has confirmed anything of that kind in the zone yet. It does not mean there is none. "}
            A fact appears when 3 installs agree on it.
          </p>
        )}
        <FilterBar
          label="Zone filters"
          search={{ action: META.path, value: q.q, placeholder: "Zone name", label: "Filter by name", keep }}
          controls={[]}
          active={q.q ? 1 : 0}
          clearHref={META.path}
        />
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