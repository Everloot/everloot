import type { Metadata } from "next";
import Link from "@/components/Link";
import { notFound } from "next/navigation";
import { slugify } from "@kb/lore-slug";
import ArtThumb from "@/components/game/ArtThumb";
import { Badge, Container, DataTable, DataTitle, FilterBar, ResultStrip, type Column, type FilterControl, stripBelow } from "@/components/ui";
import { trailFor } from "@/lib/breadcrumbs";
import { bossRows, instanceHref, instanceRows, instanceTitle, levelLabel, loadInstanceSightings, type InstanceRow } from "@/lib/instances";
import { loadingArt, loadSiteAssets } from "@/lib/game-assets";
import { PLACEHOLDER } from "@/lib/item-names";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";
import EdgeDegraded from "@/components/EdgeDegraded";
import { wikiHref } from "@/lib/wiki";
import { prepPages } from "@/lib/wiki-dungeon";
import { parseZoneSegment, publicZones, zoneHref, zoneSlug } from "@/lib/zones";
import { byRank, countBy, facetRows, flag, LEVEL_BRACKETS, nameMatches, Respelled, ListNote, listHref, listMetadata, listQuery, NameCell, nextSort, NoMatches, paged, pageParams, range, rangeParam, sortRows, type ListQuery, type Search } from "../list-parts";
import { ANNOUNCED_DUNGEONS, ANNOUNCEMENT } from "./announced-dungeons";

export const dynamic = "force-dynamic";

const META = {
  title: "WoW Forever Dungeons and Raids",
  description: "Find WoW: Forever dungeons and raids by level, zone and type. See entrance and boss evidence, look up a prep guide or browse the new dungeons Blizzard announced for Forever.",
  path: "/database/instances",
};

const SORTS = ["name", "type", "level", "bosses", "zone"] as const;
type Sort = (typeof SORTS)[number];
// Lowest level first, as the list has always read; an instance the files give no level comes last.
const DEFAULT_SORT = { key: "level" as Sort, desc: false };

const TYPES = { dungeon: "Dungeon", raid: "Raid" } as const;
type InstanceType = keyof typeof TYPES;
type Level = NonNullable<InstanceRow["level"]>;
interface Query extends ListQuery<Sort> { level?: Level; zone?: string; type?: InstanceType; newOnly?: boolean }

const zones = new Map(publicZones().map((z) => [z.mapId, { key: zoneSlug(z.mapId, z.name), name: z.name, href: zoneHref(z.mapId, z.name) }]));
const riverglades = { key: "riverglades", name: "Riverglades", href: undefined };
type Zone = { key: string; name: string; href?: string };

function instanceQuery(search: Search): Query | null {
  const base = listQuery(search, SORTS);
  const level = range(search, "level"), newOnly = flag(search, "new");
  const zoneParam = typeof search.zone === "string" ? search.zone : undefined;
  const id = zoneParam && parseZoneSegment(zoneParam);
  const zone = zoneParam === riverglades.key ? riverglades.key : id ? zones.get(id)?.key : undefined;
  const type = typeof search.type === "string" ? search.type : undefined;
  if (!base || level === null || newOnly === null || (zoneParam !== undefined && !zone)) return null;
  if (type !== undefined && type !== "dungeon" && type !== "raid") return null;
  return { ...base, level, zone, type, newOnly };
}

const href = (q: Partial<Query>) => listHref(META.path, [
  ["q", q.q], ["level", rangeParam(q.level)], ["zone", q.zone], ["type", q.type], ["new", q.newOnly ? "1" : undefined], ...pageParams(q),
]);
const activeFilters = (q: Query) => [q.q, q.level, q.zone, q.type, q.newOnly].filter(Boolean).length;

export async function generateMetadata(props: { searchParams?: Promise<Search> }): Promise<Metadata> {
  const q = instanceQuery((await props.searchParams) ?? {});
  return listMetadata(META, Boolean(q && !activeFilters(q) && !q.sort && !q.per), q?.page);
}

const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";

const NO_NAME = "The game files place no entrance for this instance, so the site has no name for it, and 3 installs have not confirmed one. It is listed by its id because players reported an entrance or a boss there.";
const FILES_NAME = "The game files place no entrance for this instance and 3 installs have not agreed on its name. The name is from the game files.";

type Announcement = (typeof ANNOUNCED_DUNGEONS)[number];
type Listing = { record: InstanceRow; announcement?: Announcement } | { record: undefined; announcement: Announcement };

function announcedRows(records: InstanceRow[]): Listing[] {
  // Only an already-public dungeon record may supply a canonical link. The known aliases are the client names.
  const byName = new Map(records.filter((r) => r.raid !== true && r.name).map((r) => [slugify(r.name!), r]));
  return ANNOUNCED_DUNGEONS.map((announcement) => ({
    announcement,
    record: byName.get(slugify(announcement.name)) ?? (announcement.alias ? byName.get(slugify(announcement.alias)) : undefined),
  }));
}

const listingName = ({ record, announcement }: Listing) => record?.name ?? announcement?.name ?? null;
const listingId = ({ record }: Listing) => record?.instanceMapId ?? Number.MAX_SAFE_INTEGER;
const listingType = ({ record, announcement }: Listing) => record?.raid === true ? "raid" : record?.raid === false || announcement ? "dungeon" : null;
const listingLevel = ({ record, announcement }: Listing) => record?.level ?? announcement?.level ?? null;

function listingZones({ record, announcement }: Listing): Zone[] {
  const entrances = [...(record?.files ?? []), ...(record?.confirmed ?? [])];
  const places = [...new Set(entrances.map((p) => p.mapId))].flatMap((id) => zones.get(id) ?? []);
  if (places.length || !announcement) return places;
  const id = announcement.zone.mapId;
  return id === undefined ? [riverglades] : [{ key: zoneSlug(id, announcement.zone.name), ...zones.get(id), name: announcement.zone.name }];
}

const overlaps = (a: Level, b: Level | null) => b !== null && a.min <= b.max && b.min <= a.max;

/** One row per instance: the entrance's zone, its confirmation, and the bosses players report. */
export default async function InstancesPage(props: { searchParams?: Promise<Search> }) {
  const q = instanceQuery((await props.searchParams) ?? {});
  if (!q) notFound();
  const seen = await loadInstanceSightings();
  const all = [...instanceRows(seen.unreachable ? {} : seen).values()];
  const listings: Listing[] = q.newOnly ? announcedRows(all) : all.map((record) => ({ record }));
  const zoneOptions = new Map(listings.flatMap(listingZones).map((zone) => [zone.key, zone]));
  const zoneLabel = q.zone && (zoneOptions.get(q.zone)?.name ?? [...zones.values()].find((z) => z.key === q.zone)?.name ?? riverglades.name);
  // The box takes a name or an id: an instance with no name yet is found by its number.
  const text = q.q?.toLowerCase();
  const id = text && /^#?\d+$/.test(text) ? Number(text.replace("#", "")) : null;
  const { ranked, respelled } = nameMatches(listings, text, id, listingName);
  const { matched, without } = facetRows(listings, {
    name: text ? (r) => id !== null ? r.record?.instanceMapId === id : ranked!.has(r) : null,
    level: q.level ? (r) => overlaps(q.level!, listingLevel(r)) : null,
    zone: q.zone ? (r) => listingZones(r).some((z) => z.key === q.zone) : null,
    type: q.type ? (r) => listingType(r) === q.type : null,
  });
  const sort = q.sort ?? DEFAULT_SORT;
  const listedBosses = ({ record }: Listing) => record ? bossRows(record).length : 0;
  const enteredFrom = (r: Listing) => {
    const places = listingZones(r);
    return places.find((p) => p.key === q.zone) ?? places[0];
  };
  const key = (r: Listing): string | number | null => {
    const level = listingLevel(r);
    if (sort.key === "name") return listingName(r)?.toLowerCase() ?? null;
    if (sort.key === "type") return listingType(r);
    if (sort.key === "bosses") return listedBosses(r) || null;
    if (sort.key === "zone") return enteredFrom(r)?.name.toLowerCase() ?? null;
    return level ? level.min * 1000 + level.max : null;
  };
  const titleOf = (r: Listing) => r.record ? instanceTitle(r.record) : r.announcement.name;
  const rows = byRank(q.sort ? sortRows(matched, key, sort.desc, listingId) : matched.sort((a, b) =>
    (listingLevel(a)?.min ?? Infinity) - (listingLevel(b)?.min ?? Infinity)
    || (listingLevel(a)?.max ?? Infinity) - (listingLevel(b)?.max ?? Infinity)
    || titleOf(a).localeCompare(titleOf(b)) || listingId(a) - listingId(b)), ranked, Boolean(q.sort));
  const { shown, pages, per } = paged(rows, q);
  const here = (over: Partial<Query>) => href({ ...q, page: 1, ...over });
  const clearHref = href({ sort: q.sort, per: q.per });
  // Each instance's own loading screen, small, before its name; a held-back one, or one the upload lacks, has none.
  const hasRecords = shown.some((r) => r.record);
  const assets = hasRecords ? await loadSiteAssets() : null;
  const thumb = (r: InstanceRow) => { const art = loadingArt(assets, r.instanceMapId); return art ? art.small?.url ?? art.url : null; };
  const dash = <span className="text-muted">—</span>;
  const guides = hasRecords ? prepPages() : null;
  const isAnnouncedZone = ({ record, announcement }: Listing) => announcement && !record?.files.length && !record?.confirmed.length;
  const entranceCoverage = ({ record }: Listing) => {
    if (seen.unreachable) return record?.files.length ? "Entrance in game files" : "Entrance reports unavailable";
    if (!record) return "Entrance unrecorded";
    if (record.confirmed.length) return `${Math.max(...record.confirmed.map((p) => p.installs))} installs`;
    if (record.files.length) return "Entrance in game files";
    return record.reported ? "Entrance awaiting agreement" : "Entrance unrecorded";
  };
  const mobileBosses = (r: Listing) => {
    const listed = listedBosses(r);
    const confirmed = r.record?.bosses.length ?? 0;
    if (confirmed && confirmed < listed) return `${confirmed} of ${listed} bosses confirmed`;
    if (confirmed) return `${confirmed} ${confirmed === 1 ? "boss" : "bosses"} confirmed`;
    if (listed) return `${listed} ${listed === 1 ? "boss" : "bosses"} in game files`;
    return seen.unreachable ? "Boss reports unavailable" : "Bosses unrecorded";
  };
  const columns: Column<Listing>[] = [
    { key: "name", header: "Name", sortable: true, cell: ({ record: r, announcement }) => {
      if (!r) return (
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-fg">{announcement.name}</span>
          <span className="text-meta text-muted">Blizzard announcement</span>
        </span>
      );
      const src = thumb(r);
      // An instance with no name is listed by its id, with a line saying why; one named only by a kill statistic says so.
      const why = r.statisticBoss
        ? <span className="inline-flex items-baseline gap-1.5 text-meta text-muted" title={FILES_NAME}><Badge tone="files" />name from the game files</span>
        : r.name === null ? <span className="text-meta text-muted" title={NO_NAME}>no entrance in the game files</span> : null;
      return (
        <div className="flex flex-wrap items-baseline gap-x-2">
          <NameCell href={instanceHref(r.instanceMapId, r.name)} icon={src && <ArtThumb src={src} />} after={why}>
            {instanceTitle(r)}
          </NameCell>
          {announcement && <span className="text-meta text-muted">New in Forever</span>}
        </div>
      );
    } },
    // What it is, its numbers, where it is entered, whether players confirmed that, and where to read more.
    { key: "type", header: "Type", sortable: true, cell: (r) => { const type = listingType(r); return type ? TYPES[type] : PLACEHOLDER; } },
    { key: "level", header: "Level", numeric: true, sortable: true, cell: (r) => {
      const level = levelLabel(listingLevel(r));
      return !level ? dash : !r.record?.level && r.announcement ? <>{level} <span className="text-meta text-muted">announced</span></> : level;
    } },
    // The page's count: all of them when players confirmed every one, "7 of 8" when some, else the files' count marked
    // unconfirmed, else a dash.
    { key: "bosses", header: "Bosses", numeric: true, sortable: true, cell: (r) => {
      const listed = listedBosses(r);
      const reported = r.record?.bosses.length ?? 0;
      if (reported) return reported >= listed ? reported : `${reported} of ${listed}`;
      return listed ? <span className="inline-flex items-baseline gap-1.5"><Badge tone="files" />{listed}</span> : dash;
    } },
    { key: "zone", header: q.newOnly ? "Zone" : "Entered from", sortable: true, cell: (r) => {
      const at = enteredFrom(r);
      return at ? <>{at.href ? <Link prefetch={false} href={at.href} className={link}>{at.name}</Link> : at.name}
        {isAnnouncedZone(r) && <span className="ml-1 text-meta text-muted">announced</span>}</> : dash;
    } },
    { key: "confirmed", header: "Entrance confirmed", numeric: true, cell: (r) => {
      if (r.record?.confirmed.length || q.newOnly) return entranceCoverage(r);
      return seen.unreachable ? PLACEHOLDER : dash;
    } },
    // A published prep page where one binds the instance; for a raid, the raid builder as well.
    { key: "guide", header: "Guide", cell: ({ record, announcement }) => {
      const prep = record && guides?.get(record.instanceMapId);
      const links = [
        ...(prep ? [<Link prefetch={false} key="prep" href={wikiHref(prep.slug)} className={link}>Prep page</Link>] : []),
        ...(record?.raid ? [<Link prefetch={false} key="raid" href="/tools/raid" className={link}>Raid builder</Link>] : []),
      ];
      if (links.length) return <span className="inline-flex flex-wrap gap-x-3">{links}</span>;
      return announcement ? <a href={ANNOUNCEMENT} className={link}>Blizzard overview</a> : dash;
    } },
  ];
  const countsByZone = countBy(without.zone.flatMap(listingZones), (zone) => zone.key);
  const countsByType = countBy(without.type, listingType);
  const brackets = [...LEVEL_BRACKETS];
  if (q.level && !brackets.some((b) => rangeParam(b) === rangeParam(q.level))) brackets.push(q.level);
  const controls: FilterControl[] = [
    {
      type: "menu", key: "level", label: "Level",
      options: [{ label: "Any level", href: here({ level: undefined }), on: !q.level, reset: true },
        ...brackets.map((level) => ({
          label: levelLabel(level), href: here({ level }), on: rangeParam(level) === rangeParam(q.level),
          count: without.level.filter((r) => overlaps(level, listingLevel(r))).length,
        }))],
    },
    {
      type: "menu", key: "zone", label: "Zone",
      options: [{ label: "Any zone", href: here({ zone: undefined }), on: !q.zone, reset: true },
        ...[...zoneOptions.values()].sort((a, b) => a.name.localeCompare(b.name)).map((zone) => ({
          label: zone.name, href: here({ zone: zone.key }), on: q.zone === zone.key, count: countsByZone.get(zone.key) ?? 0,
        })),
        ...(q.zone && !zoneOptions.has(q.zone) ? [{ label: zoneLabel, href: here({ zone: q.zone }), on: true, count: 0 }] : [])],
    },
    {
      type: "menu", key: "type", label: "Type",
      options: [{ label: "Any type", href: here({ type: undefined }), on: !q.type, reset: true },
        ...(Object.keys(TYPES) as InstanceType[]).map((type) => ({
          label: TYPES[type], href: here({ type }), on: q.type === type, count: countsByType.get(type) ?? 0,
        }))],
    },
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
  const chips = [
    ...(q.q ? [{ label: q.q, href: here({ q: undefined }) }] : []),
    ...(q.level ? [{ label: `Level ${levelLabel(q.level)}`, href: here({ level: undefined }) }] : []),
    ...(q.zone && zoneLabel ? [{ label: zoneLabel, href: here({ zone: undefined }) }] : []),
    ...(q.type ? [{ label: TYPES[q.type], href: here({ type: undefined }) }] : []),
    ...(q.newOnly ? [{ label: "New in Forever", href: here({ newOnly: undefined }) }] : []),
  ];

  return (
    <Container width="data">
      <EdgeDegraded when={seen.unreachable} />
      <article>
        <DataTitle title="Dungeons and raids" meta={!q.newOnly && extra > 0 && !seen.unreachable ? `${placed} in game files · ${extra} from player reports only` : undefined} aside={strip} trail={trailFor(META.path) ?? undefined} />
        {seen.unreachable && <p className="mb-2 text-meta text-warning">{STORAGE_UNREACHABLE}</p>}
        <nav aria-label="Instance views" className="mb-2 flex flex-wrap gap-2">
          <Link prefetch={false} href={here({ newOnly: undefined })} aria-current={!q.newOnly ? "page" : undefined} className={`ctl inline-flex items-center border px-3 ${q.newOnly ? "border-edge text-fg-2" : "border-accent text-fg"}`}>Database records</Link>
          <Link prefetch={false} href={here({ newOnly: true })} aria-current={q.newOnly ? "page" : undefined} className={`ctl inline-flex items-center border px-3 ${q.newOnly ? "border-accent text-fg" : "border-edge text-fg-2"}`}>New in Forever</Link>
        </nav>
        <FilterBar
          label="Instance filters"
          search={{ action: META.path, value: q.q, placeholder: "Name or id", label: "Filter by name or id", keep }}
          controls={controls}
          active={activeFilters(q) - Number(Boolean(q.newOnly))}
          clearHref={here({ q: undefined, level: undefined, zone: undefined, type: undefined })}
        />
        {respelled && rows.length > 0 && <Respelled q={respelled} />}
        <div className="mt-2">
          <DataTable
            dense
            caption={q.newOnly ? "New in Forever" : "Dungeons and raids"}
            columns={columns}
            rows={shown}
            rowKey={(r) => r.record ? String(r.record.instanceMapId) : r.announcement.name}
            sort={{ key: sort.key, direction: sort.desc ? "desc" : "asc" }}
            sortHref={(k, dir) => here({ sort: nextSort(k, dir, DEFAULT_SORT) })}
            meta={(r) => {
              const type = listingType(r), level = levelLabel(listingLevel(r)), zone = enteredFrom(r);
              const prep = r.record && guides?.get(r.record.instanceMapId);
              return <>
                {[type && TYPES[type], level && `Level ${level}${!r.record?.level && r.announcement ? " (announced)" : ""}`,
                  zone && `${zone.name}${isAnnouncedZone(r) ? " (announced)" : ""}`].filter(Boolean).join(" · ")}
                <div>
                  {r.record?.confirmed.length ? `Entrance confirmed · ${entranceCoverage(r)}` : entranceCoverage(r)}
                  {" · "}{mobileBosses(r)}
                  {prep && <>{" · "}<Link prefetch={false} href={wikiHref(prep.slug)} className={link}>Prep page</Link></>}
                  {!prep && r.announcement && <>{" · "}<a href={ANNOUNCEMENT} className={link}>Blizzard overview</a></>}
                </div>
              </>;
            }}
            empty={<NoMatches noun="instances" chips={chips} clearHref={clearHref} />}
          />
        </div>
        {pages > 1 && <div className="mt-2">{stripBelow(strip)}</div>}
        <div className="mt-3">
          <ListNote>
            {q.newOnly && <>Announced ranges and zones come from <a href={ANNOUNCEMENT} className={link}>Blizzard’s dungeon overview</a>. </>}
            Game-file levels are shown where available. Entrances and bosses are confirmed when three installs agree.
            {!seen.unreachable && " Bosses reads 7 of 8 when 3 installs confirm 7 of the 8 bosses the instance's page lists."}
            {!q.newOnly && countNote && <span data-instance-count-note>{` Of the ${all.length} instances, ${countNote}`}</span>}
          </ListNote>
        </div>
      </article>
    </Container>
  );
}
