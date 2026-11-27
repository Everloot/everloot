import type { Metadata } from "next";
import Link from "@/components/Link";
import { notFound } from "next/navigation";
import ArtThumb from "@/components/game/ArtThumb";
import { Badge, Container, DataTable, DataTitle, FilterBar, ResultStrip, type Column, stripBelow } from "@/components/ui";
import { trailFor } from "@/lib/breadcrumbs";
import { bossRows, compareInstances, instanceHref, instanceRows, instanceTitle, levelLabel, loadSightings, type InstanceRow } from "@/lib/instances";
import { loadingArt, loadSiteAssets } from "@/lib/game-assets";
import { PLACEHOLDER } from "@/lib/item-names";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";
import EdgeDegraded from "@/components/EdgeDegraded";
import { wikiHref } from "@/lib/wiki";
import { prepPages } from "@/lib/wiki-dungeon";
import { zoneHref } from "@/lib/zones";
import { byRank, nameMatches, Respelled, ListNote, listHref, listMetadata, listQuery, NameCell, nextSort, NoMatches, paged, pageParams, sortRows, type ListQuery, type Search } from "../list-parts";

export const dynamic = "force-dynamic";

const META = {
  title: "WoW Forever Dungeons and Raids",
  description: "Every dungeon and raid of WoW: Forever, one row each, lowest level first: its level from the game files, where it is entered, whether players have confirmed the entrance, the bosses they report, and its prep page or the raid builder.",
  path: "/database/instances",
};

const SORTS = ["name", "type", "level", "bosses", "zone"] as const;
type Sort = (typeof SORTS)[number];
// Lowest level first, as the list has always read; an instance the files give no level comes last.
const DEFAULT_SORT = { key: "level" as Sort, desc: false };

const href = (q: Partial<ListQuery<Sort>>) => listHref(META.path, [["q", q.q], ...pageParams(q)]);

export async function generateMetadata(props: { searchParams?: Promise<Search> }): Promise<Metadata> {
  const q = listQuery((await props.searchParams) ?? {}, SORTS);
  return listMetadata(META, Boolean(q) && !q!.q && !q!.sort && !q!.per, q?.page);
}

const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";

const NO_NAME = "The game files place no entrance for this instance, so the site has no name for it, and 3 installs have not confirmed one. It is listed by its id because players reported an entrance or a boss there.";
const FILES_NAME = "The game files place no entrance for this instance and 3 installs have not agreed on its name. The name is from the game files.";

/** One row per instance: the entrance's zone, its confirmation, and the bosses players report. */
export default async function InstancesPage(props: { searchParams?: Promise<Search> }) {
  const q = listQuery((await props.searchParams) ?? {}, SORTS);
  if (!q) notFound();
  const seen = await loadSightings();
  const all = [...instanceRows(seen.unreachable ? {} : seen).values()];
  // The box takes a name or an id: an instance with no name yet is found by its number.
  const text = q.q?.toLowerCase();
  const id = text && /^#?\d+$/.test(text) ? Number(text.replace("#", "")) : null;
  const { ranked, respelled } = nameMatches(all, text, id, (r) => r.name);
  const matched = all.filter((r) => !text || (id !== null ? r.instanceMapId === id : ranked!.has(r)));
  const sort = q.sort ?? DEFAULT_SORT;
  // The plain list keeps its own order (level, then name); a level sorts by its low end, then its high end.
  // The bosses the instance's page lists (bossRows: the files' encounters and any other reported one); they sort the column.
  const listedBosses = (r: InstanceRow) => bossRows(seen.unreachable ? { bosses: [], encounters: r.encounters } : r).length;
  const bossCount = (r: InstanceRow) => listedBosses(r) || null;
  const enteredFrom = (r: InstanceRow) => r.files[0] ?? r.confirmed[0];
  const key = (r: InstanceRow): string | number | null => sort.key === "name" ? r.name?.toLowerCase() ?? null
    : sort.key === "type" ? (r.raid === null ? null : r.raid ? "raid" : "dungeon") : sort.key === "bosses" ? bossCount(r)
    : sort.key === "zone" ? enteredFrom(r)?.zoneName.toLowerCase() ?? null : r.level ? r.level.min * 1000 + r.level.max : null;
  const rows = byRank(q.sort ? sortRows(matched, key, sort.desc, (r) => r.instanceMapId) : matched.sort(compareInstances), ranked, Boolean(q.sort));
  const { shown, pages, per } = paged(rows, q);
  const here = (over: Partial<ListQuery<Sort>>) => href({ ...q, page: 1, ...over });
  // Each instance's own loading screen, small, before its name; a held-back one, or one the upload lacks, has none.
  const assets = await loadSiteAssets();
  const thumb = (r: InstanceRow) => { const art = loadingArt(assets, r.instanceMapId); return art ? art.small?.url ?? art.url : null; };
  const dash = <span className="text-muted">—</span>;
  const guides = prepPages();
  const columns: Column<InstanceRow>[] = [
    { key: "name", header: "Name", sortable: true, cell: (r) => {
      const src = thumb(r);
      // An instance with no name is listed by its id, with a line saying why; one named only by a kill statistic says so.
      const why = r.statisticBoss
        ? <span className="inline-flex items-baseline gap-1.5 text-meta text-muted" title={FILES_NAME}><Badge tone="files" />name from the game files</span>
        : r.name === null ? <span className="text-meta text-muted" title={NO_NAME}>no entrance in the game files</span> : null;
      return (
        <NameCell href={instanceHref(r.instanceMapId, r.name)} icon={src && <ArtThumb src={src} />} after={why}>
          {instanceTitle(r)}
        </NameCell>
      );
    } },
    // What it is, its numbers, where it is entered, whether players confirmed that, and where to read more.
    { key: "type", header: "Type", sortable: true, cell: (r) => (r.raid === null ? PLACEHOLDER : r.raid ? "Raid" : "Dungeon") },
    { key: "level", header: "Level", numeric: true, sortable: true, cell: (r) => levelLabel(r.level) ?? dash },
    // The page's count: all of them when players confirmed every one, "7 of 8" when some, else the files' count marked
    // unconfirmed, else a dash.
    { key: "bosses", header: "Bosses", numeric: true, sortable: true, cell: (r) => {
      const listed = listedBosses(r);
      const reported = seen.unreachable ? 0 : r.bosses.length;
      if (reported) return reported >= listed ? reported : `${reported} of ${listed}`;
      return listed ? <span className="inline-flex items-baseline gap-1.5"><Badge tone="files" />{listed}</span> : dash;
    } },
    { key: "zone", header: "Entered from", sortable: true, cell: (r) => {
      const at = enteredFrom(r);
      return at ? <Link prefetch={false} href={zoneHref(at.mapId, at.zoneName)} className={link}>{at.zoneName}</Link> : dash;
    } },
    { key: "confirmed", header: "Entrance confirmed", numeric: true, cell: (r) => (seen.unreachable ? PLACEHOLDER : r.confirmed.length ? `${Math.max(...r.confirmed.map((p) => p.installs))} installs` : dash) },
    // A published prep page where one binds the instance; for a raid, the raid builder as well.
    { key: "guide", header: "Guide", cell: (r) => {
      const prep = guides.get(r.instanceMapId);
      const links = [
        ...(prep ? [<Link prefetch={false} key="prep" href={wikiHref(prep.slug)} className={link}>Prep page</Link>] : []),
        ...(r.raid ? [<Link prefetch={false} key="raid" href="/tools/raid" className={link}>Raid builder</Link>] : []),
      ];
      return links.length ? <span className="inline-flex flex-wrap gap-x-3">{links}</span> : dash;
    } },
  ];
  const keep = Object.fromEntries(new URLSearchParams(href({ ...q, q: undefined, page: 1 }).split("?")[1] ?? ""));
  // The hub counts the instances the game files place ("N in game files"); the list adds the ones known only from
  // players' reports. Say so, so the two numbers agree.
  const placed = all.filter((r) => r.files.length > 0).length;
  const extra = all.length - placed;
  const unnamed = all.some((r) => r.files.length === 0 && r.name === null);
  const countNote = extra > 0
    ? `${placed} are placed by the game files; ${extra} more ${extra === 1 ? "is" : "are"} known only from what players reported${unnamed ? (extra === 1 ? ", listed by its id until a name is known" : ", the unnamed ones listed by id") : ""}.`
    : null;
  const strip = <ResultStrip total={rows.length} noun={rows.length === 1 ? "instance" : "instances"} page={q.page} perPage={per} href={(page) => href({ ...q, page })} sizeHref={(n) => href({ ...q, per: n, page: 1 })} label="Instance pages" />;

  return (
    <Container width="data">
      <EdgeDegraded when={seen.unreachable} />
      <article>
        <DataTitle title="Dungeons and raids" aside={strip} trail={trailFor("/database/instances") ?? undefined} />
        {seen.unreachable && <p className="mb-3 text-meta text-warning">{STORAGE_UNREACHABLE} The entrances below are from the game files.</p>}
        {!seen.unreachable && (
          <ListNote>
            {q.sort ? "" : "Sorted by level, lowest first. "}The level is read from the game files, which give one level for most instances rather than a range; a dash there means the files give none. Entrances are read from the game files and confirmed once 3 installs zone in from the same place. A boss is counted once 3 installs report it; until then the count is the game files' own list, marked unconfirmed. Bosses reads 7 of 8 when 3 installs confirm 7 of the 8 bosses the instance's page lists. A dash in the other columns means nobody has yet, not that there is none. Guide links to the instance's prep page once it is published, and to the raid builder for a raid.
            {countNote && <span data-instance-count-note>{` Of the ${all.length} instances, ${countNote}`}</span>}
          </ListNote>
        )}
        <FilterBar
          label="Instance filters"
          search={{ action: META.path, value: q.q, placeholder: "Name or id", label: "Filter by name or id", keep }}
          controls={[]}
          active={q.q ? 1 : 0}
          clearHref={META.path}
        />
        {respelled && rows.length > 0 && <Respelled q={respelled} />}
        <div className="mt-2">
          <DataTable
            dense
            caption="Dungeons and raids"
            columns={columns}
            rows={shown}
            rowKey={(r) => String(r.instanceMapId)}
            sort={{ key: sort.key, direction: sort.desc ? "desc" : "asc" }}
            sortHref={(k, dir) => here({ sort: nextSort(k, dir, DEFAULT_SORT) })}
            meta={(r) => [r.raid === null ? null : r.raid ? "Raid" : "Dungeon", levelLabel(r.level) && `Level ${levelLabel(r.level)}`, enteredFrom(r)?.zoneName].filter(Boolean).join(" · ")}
            empty={<NoMatches noun="instances" chips={q.q ? [{ label: `Name: ${q.q}`, href: here({ q: undefined }) }] : []} clearHref={META.path} />}
          />
        </div>
        {pages > 1 && <div className="mt-2">{stripBelow(strip)}</div>}
      </article>
    </Container>
  );
}
