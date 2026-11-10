import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ArtThumb from "@/components/game/ArtThumb";
import { Badge, Container, DataTable, DataTitle, FilterBar, ResultStrip, type Column } from "@/components/ui";
import { trailFor } from "@/lib/breadcrumbs";
import { compareInstances, instanceHref, instanceRows, instanceTitle, levelLabel, loadSightings, type InstanceRow } from "@/lib/instances";
import { loadingArt, loadSiteAssets } from "@/lib/game-assets";
import { PLACEHOLDER } from "@/lib/item-names";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";
import EdgeDegraded from "@/components/EdgeDegraded";
import { wikiHref } from "@/lib/wiki";
import { prepPages } from "@/lib/wiki-dungeon";
import { zoneHref } from "@/lib/zones";
import { listHref, listMetadata, listQuery, nextSort, NoMatches, PER_PAGE, sortParam, sortRows, type ListQuery, type Search } from "../list-parts";

export const dynamic = "force-dynamic";

const META = {
  title: "WoW Forever Dungeons and Raids",
  description: "Every dungeon and raid of WoW: Forever, one row each, lowest level first: its level from the game files, where it is entered, whether players have confirmed the entrance, the bosses they report, and its prep page or the raid builder.",
  path: "/database/instances",
};

const SORTS = ["name", "type", "level"] as const;
type Sort = (typeof SORTS)[number];
// Lowest level first, as the list has always read; an instance the files give no level comes last.
const DEFAULT_SORT = { key: "level" as Sort, desc: false };

const href = (q: Partial<ListQuery<Sort>>) => listHref(META.path, [["q", q.q], ["sort", sortParam(q.sort)], ["page", q.page && q.page > 1 ? String(q.page) : undefined]]);

export async function generateMetadata(props: { searchParams?: Promise<Search> }): Promise<Metadata> {
  const q = listQuery((await props.searchParams) ?? {}, SORTS);
  return listMetadata(META, Boolean(q) && !q!.q && !q!.sort, q?.page);
}

const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";

const NO_NAME = "The game files place no entrance for this instance, so the site has no name for it, and 3 installs have not confirmed one. It is listed by its id because players reported an entrance or a boss there.";
const statisticName = (boss: string, name: string) =>
  `The game files place no entrance for this instance and 3 installs have not agreed on its name. The name is the files' own, from their kill statistic "${boss} Kills (${name})" for one of its bosses.`;

/** One row per instance: the entrance's zone, its confirmation, and the bosses players report. */
export default async function InstancesPage(props: { searchParams?: Promise<Search> }) {
  const q = listQuery((await props.searchParams) ?? {}, SORTS);
  if (!q) notFound();
  const seen = await loadSightings();
  const all = [...instanceRows(seen.unreachable ? {} : seen).values()];
  // The box takes a name or an id: an instance with no name yet is found by its number.
  const text = q.q?.toLowerCase();
  const id = text && /^#?\d+$/.test(text) ? Number(text.replace("#", "")) : null;
  const matched = all.filter((r) => !text || (id !== null ? r.instanceMapId === id : Boolean(r.name?.toLowerCase().includes(text))));
  const sort = q.sort ?? DEFAULT_SORT;
  // The plain list keeps its own order (level, then name); a level sorts by its low end, then its high end.
  const key = (r: InstanceRow): string | number | null => sort.key === "name" ? r.name?.toLowerCase() ?? null
    : sort.key === "type" ? (r.raid === null ? null : r.raid ? "raid" : "dungeon") : r.level ? r.level.min * 1000 + r.level.max : null;
  const rows = q.sort ? sortRows(matched, key, sort.desc, (r) => r.instanceMapId) : matched.sort(compareInstances);
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  if (q.page > pages) notFound();
  const shown = rows.slice((q.page - 1) * PER_PAGE, q.page * PER_PAGE);
  const here = (over: Partial<ListQuery<Sort>>) => href({ ...q, page: 1, ...over });
  // Each instance's own loading screen, small, before its name; a held-back one, or one the upload lacks, has none.
  const assets = await loadSiteAssets();
  const thumb = (r: InstanceRow) => { const art = loadingArt(assets, r.instanceMapId); return art ? art.small?.url ?? art.url : null; };
  const dash = <span className="text-muted">–</span>;
  const guides = prepPages();
  const columns: Column<InstanceRow>[] = [
    { key: "name", header: "Name", sortable: true, cell: (r) => {
      const src = thumb(r);
      const named = <Link href={instanceHref(r.instanceMapId, r.name)} className={link}>{instanceTitle(r)}</Link>;
      // An instance with no name is listed by its id, with a line saying why; one named only by a kill statistic says so.
      const name = r.statisticBoss ? (
        <span className="inline-flex flex-wrap items-baseline gap-x-2" title={statisticName(r.statisticBoss, r.name!)}>{named}<span className="inline-flex items-baseline gap-1.5 text-meta text-muted"><Badge tone="files" />name from a kill statistic</span></span>
      ) : r.name !== null ? named : (
        <span className="inline-flex flex-wrap items-baseline gap-x-2" title={NO_NAME}>{named}<span className="text-meta text-muted">no entrance in the game files</span></span>
      );
      return src ? <span className="flex min-w-0 items-center gap-2"><ArtThumb src={src} />{name}</span> : name;
    } },
    { key: "type", header: "Type", sortable: true, cell: (r) => (r.raid === null ? PLACEHOLDER : r.raid ? "Raid" : "Dungeon") },
    { key: "level", header: "Level", numeric: true, sortable: true, cell: (r) => levelLabel(r.level) ?? dash },
    { key: "zone", header: "Entered from", cell: (r) => {
      const at = r.files[0] ?? r.confirmed[0];
      return at ? <Link href={zoneHref(at.mapId, at.zoneName)} className={link}>{at.zoneName}</Link> : dash;
    } },
    { key: "confirmed", header: "Entrance confirmed", numeric: true, cell: (r) => (seen.unreachable ? PLACEHOLDER : r.confirmed.length ? `${Math.max(...r.confirmed.map((p) => p.installs))} installs` : dash) },
    // Player-first: the reported count, else the files' count marked unconfirmed, else a dash.
    { key: "bosses", header: "Bosses", numeric: true, cell: (r) => (!seen.unreachable && r.bosses.length
      ? r.bosses.length
      : r.encounters.length ? <span className="inline-flex items-baseline gap-1.5"><Badge tone="files" />{r.encounters.length}</span> : dash) },
    // A published prep page where one binds the instance; for a raid, the raid builder as well.
    { key: "guide", header: "Guide", cell: (r) => {
      const prep = guides.get(r.instanceMapId);
      const links = [
        ...(prep ? [<Link key="prep" href={wikiHref(prep.slug)} className={link}>Prep page</Link>] : []),
        ...(r.raid ? [<Link key="raid" href="/tools/raid" className={link}>Raid builder</Link>] : []),
      ];
      return links.length ? <span className="inline-flex flex-wrap gap-x-3">{links}</span> : dash;
    } },
  ];
  const keep = Object.fromEntries(new URLSearchParams(href({ ...q, q: undefined, page: 1 }).split("?")[1] ?? ""));
  const strip = <ResultStrip total={rows.length} noun={rows.length === 1 ? "instance" : "instances"} page={q.page} perPage={PER_PAGE} href={(page) => href({ ...q, page })} label="Instance pages" />;

  return (
    <Container width="data">
      <EdgeDegraded when={seen.unreachable} />
      <article>
        <DataTitle title="Dungeons and raids" aside={strip} trail={trailFor("/database/instances") ?? undefined} />
        {seen.unreachable && <p className="mb-3 text-meta text-warning">{STORAGE_UNREACHABLE} The entrances below are from the game files.</p>}
        {!seen.unreachable && (
          <p className="mb-3 max-w-reading text-meta text-fg-2">
            {q.sort ? "" : "Sorted by level, lowest first. "}The level is read from the game files, which give one level for most instances rather than a range; a dash there means the files give none. Entrances are read from the game files and confirmed once 3 installs zone in from the same place. A boss is counted once 3 installs report it; until then the count is the game files' own list, marked unconfirmed. A dash in the other columns means nobody has yet, not that there is none. Guide links to the instance's prep page once it is published, and to the raid builder for a raid.
          </p>
        )}
        <FilterBar
          label="Instance filters"
          search={{ action: META.path, value: q.q, placeholder: "Name or id", label: "Filter by name or id", keep }}
          controls={[]}
          active={q.q ? 1 : 0}
          clearHref={META.path}
        />
        <div className="mt-2">
          <DataTable
            dense
            caption="Dungeons and raids"
            columns={columns}
            rows={shown}
            rowKey={(r) => String(r.instanceMapId)}
            sort={{ key: sort.key, direction: sort.desc ? "desc" : "asc" }}
            sortHref={(k, dir) => here({ sort: nextSort(k, dir, DEFAULT_SORT) })}
            empty={<NoMatches noun="instances" chips={q.q ? [{ label: `Name: ${q.q}`, href: here({ q: undefined }) }] : []} clearHref={META.path} />}
          />
        </div>
        {pages > 1 && <div className="mt-2">{strip}</div>}
      </article>
    </Container>
  );
}
