import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { NPC_CREATURE_TYPES, NPC_RANKS, type NpcRank, type NpcReaction } from "../../../../../kb/src/world-pages";
import { Container, DataTable, DataTitle, filledColumns, FilterBar, ResultStrip, type FilterControl, type SparseColumn } from "@/components/ui";
import { computeRollups, loadWorldFacts } from "@/lib/rollup-compute";
import { bareNpcRow, npcRows, publicQuests, publicVendors, type NpcRow } from "@/lib/world-lists";
import { parseZoneSegment, publicZones, zoneSlug } from "@/lib/zones";
import { LINK } from "../entity";
import {
  flag, LEVEL_BRACKETS, listHref, listMetadata, listQuery, nextSort, NoMatches, NoObservations, PER_PAGE, range, rangeParam, sortParam, sortRows, Unreadable,
  type ListQuery, type Search,
} from "../list-parts";

const META = { title: "WoW Forever NPC Lookup", description: "Look up a WoW: Forever NPC by id. A name or a map pin becomes public only after three installs agree, and single reports stay queued.", path: "/database/npcs" };
export const dynamic = "force-dynamic";

const SORTS = ["name", "level", "type", "rank", "react", "zone", "drops", "id"] as const;
type Sort = (typeof SORTS)[number];
const DEFAULT_SORT = { key: "id" as Sort, desc: false };
const REACTIONS: Record<string, NpcReaction> = { f: "friendly", n: "neutral", h: "hostile" };
const REACTION_LABEL: Record<NpcReaction, string> = { friendly: "Friendly", neutral: "Neutral", hostile: "Hostile" };
const RANK_LABEL: Record<NpcRank, string> = { normal: "Normal", elite: "Elite", rare: "Rare", rare_elite: "Rare elite", boss: "Boss" };
/** A creature type in the URL: lower case, spaces and hyphens as one hyphen (`non-combat-pet`). */
const typeParam = (type: string) => type.toLowerCase().replace(/[^a-z]+/g, "-");
const TYPES = new Map(NPC_CREATURE_TYPES.map((t) => [typeParam(t), t]));
const rankParam = (rank: NpcRank) => rank.replace("_", "-");
const RANKS = new Map(NPC_RANKS.map((r) => [rankParam(r), r]));

interface NpcQuery extends ListQuery<Sort> { zone?: number; drops?: boolean; level?: { min: number; max: number }; react?: string; type?: string; rank?: string }

/** The NPC list's filters from the URL: `q`, `zone` (its page segment, `1429-elwynn-forest`), `drops=1`, `level=10-20`, `react=f|n|h`, `type=beast`, `rank=elite`. */
function npcQuery(search: Search): NpcQuery | null {
  const base = listQuery(search, SORTS);
  const drops = flag(search, "drops"), level = range(search, "level");
  const zoneRaw = typeof search.zone === "string" ? search.zone : undefined;
  const zone = zoneRaw === undefined ? undefined : parseZoneSegment(zoneRaw);
  const react = typeof search.react === "string" ? search.react : undefined;
  const type = typeof search.type === "string" ? search.type : undefined;
  const rank = typeof search.rank === "string" ? search.rank : undefined;
  if (!base || drops === null || level === null || zone === null) return null;
  if (zone !== undefined && !publicZones().some((z) => z.mapId === zone)) return null;
  if (react !== undefined && !REACTIONS[react]) return null;
  if (type !== undefined && !TYPES.has(type)) return null;
  if (rank !== undefined && !RANKS.has(rank)) return null;
  return { ...base, ...(zone ? { zone } : {}), ...(drops ? { drops } : {}), ...(level ? { level } : {}), ...(react ? { react } : {}), ...(type ? { type } : {}), ...(rank ? { rank } : {}) };
}

const zoneParam = (id?: number) => { const z = id === undefined ? undefined : publicZones().find((x) => x.mapId === id); return z ? zoneSlug(z.mapId, z.name) : undefined; };
const href = (q: Partial<NpcQuery>) => listHref("/database/npcs", [
  ["q", q.q], ["zone", zoneParam(q.zone)], ["level", rangeParam(q.level)], ["react", q.react], ["type", q.type], ["rank", q.rank], ["drops", q.drops ? "1" : undefined], ["sort", sortParam(q.sort)],
  ["page", q.page && q.page > 1 ? String(q.page) : undefined],
]);
const filters = (q: NpcQuery) => Number(Boolean(q.q)) + Number(Boolean(q.zone)) + Number(Boolean(q.drops)) + Number(Boolean(q.level)) + Number(Boolean(q.react)) + Number(Boolean(q.type)) + Number(Boolean(q.rank));

export async function generateMetadata(props: { searchParams?: Promise<Search> }): Promise<Metadata> {
  const q = npcQuery((await props.searchParams) ?? {});
  return listMetadata(META, Boolean(q) && filters(q!) === 0 && !q!.sort, q?.page);
}

export default async function NpcListPage(props: { searchParams?: Promise<Search> }) {
  const q = npcQuery((await props.searchParams) ?? {});
  if (!q) notFound();
  const [facts, { rates }] = await Promise.all([loadWorldFacts(), computeRollups()]);
  const reported = facts.unreachable ? [] : npcRows(facts, rates);
  // An NPC known from a public quest (its giver or turn-in) or a vendor with agreed prices has a page too, so it is
  // listed like the rest, its unknown cells "—".
  const known = new Set(reported.map((n) => n.npcId));
  const linked = facts.unreachable ? [] : [...publicQuests(facts).flatMap((x) => [x.giverNpcId, x.turnInNpcId]), ...publicVendors(facts).map((v) => v.vendorNpcId)];
  const all = [...reported, ...[...new Set(linked)].filter((n): n is number => n !== null && !known.has(n)).map(bareNpcRow)];
  const text = q.q?.toLowerCase();
  const id = text && /^#?\d+$/.test(text) ? Number(text.replace("#", "")) : null;
  const matched = all.filter((n) =>
    (!text || (id !== null ? n.npcId === id : Boolean(n.name?.toLowerCase().includes(text))))
    && (!q.zone || n.zone?.mapId === q.zone) && (!q.drops || n.drops > 0)
    && (!q.level || (n.level !== null && n.level >= q.level.min && n.level <= q.level.max))
    && (!q.react || n.reaction === REACTIONS[q.react])
    && (!q.type || n.creatureType === TYPES.get(q.type)) && (!q.rank || n.rank === RANKS.get(q.rank)));
  const sort = q.sort ?? DEFAULT_SORT;
  const key = (n: NpcRow): string | number | null => sort.key === "name" ? n.name?.toLowerCase() ?? null : sort.key === "level" ? n.level
    : sort.key === "type" ? n.creatureType?.toLowerCase() ?? null : sort.key === "rank" ? (n.rank ? NPC_RANKS.indexOf(n.rank) : null)
    : sort.key === "react" ? n.reaction : sort.key === "zone" ? n.zone?.name ?? null : sort.key === "drops" ? n.drops : n.npcId;
  const rows = sortRows(matched, key, sort.desc, (n) => n.npcId);
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  if (q.page > pages) notFound();
  const shown = rows.slice((q.page - 1) * PER_PAGE, q.page * PER_PAGE);
  const here = (over: Partial<NpcQuery>) => href({ ...q, page: 1, ...over });

  const dash = <span className="text-muted">—</span>;
  const columns: SparseColumn<NpcRow>[] = [
    { key: "name", header: "Name", sortable: true, cell: (n) => <Link href={`/database/npcs/${n.npcId}`} className={LINK}>{n.name ?? `NPC ${n.npcId}`}</Link> },
    { key: "level", header: "Level", numeric: true, sortable: true, cell: (n) => n.level ?? dash, blank: (n) => n.level === null },
    { key: "type", header: "Type", sortable: true, cell: (n) => n.creatureType ?? dash, blank: (n) => !n.creatureType },
    { key: "rank", header: "Rank", sortable: true, cell: (n) => (n.rank ? RANK_LABEL[n.rank] : dash), blank: (n) => !n.rank },
    { key: "react", header: "Reaction", sortable: true, cell: (n) => (n.reaction ? REACTION_LABEL[n.reaction] : dash), blank: (n) => !n.reaction },
    { key: "zone", header: "Zone", sortable: true, cell: (n) => n.zone?.name ?? dash, blank: (n) => !n.zone },
    { key: "drops", header: "Drops", numeric: true, sortable: true, cell: (n) => n.drops || dash, blank: (n) => !n.drops },
    { key: "id", header: "ID", numeric: true, sortable: true, cell: (n) => n.npcId },
  ];

  const zones = [...new Map(all.filter((n) => n.zone).map((n) => [n.zone!.mapId, n.zone!])).values()].sort((a, b) => a.name.localeCompare(b.name));
  const controls: FilterControl[] = [
    {
      type: "menu", key: "zone", label: "Zone",
      options: [{ label: "Any zone", href: here({ zone: undefined }), on: !q.zone, reset: true }, ...zones.map((z) => ({
        label: z.name, href: here({ zone: z.mapId }), on: q.zone === z.mapId, count: all.filter((n) => n.zone?.mapId === z.mapId).length,
      }))],
    },
    {
      type: "menu", key: "level", label: "Level",
      options: [{ label: "Any level", href: here({ level: undefined }), on: !q.level, reset: true }, ...LEVEL_BRACKETS.map((b) => ({
        label: `${b.min}–${b.max}`, href: here({ level: b }), on: q.level?.min === b.min && q.level?.max === b.max,
      }))],
    },
    {
      type: "menu", key: "react", label: "Reaction",
      options: [{ label: "Any reaction", href: here({ react: undefined }), on: !q.react, reset: true }, ...Object.entries(REACTIONS).map(([k, r]) => ({
        label: REACTION_LABEL[r], href: here({ react: k }), on: q.react === k,
      }))],
    },
    {
      type: "menu", key: "type", label: "Type",
      options: [{ label: "Any type", href: here({ type: undefined }), on: !q.type, reset: true }, ...[...TYPES].map(([k, t]) => ({
        label: t, href: here({ type: k }), on: q.type === k, count: all.filter((n) => n.creatureType === t).length,
      })).filter((o) => o.count > 0 || o.on)],
    },
    {
      type: "menu", key: "rank", label: "Rank",
      options: [{ label: "Any rank", href: here({ rank: undefined }), on: !q.rank, reset: true }, ...[...RANKS].map(([k, r]) => ({
        label: RANK_LABEL[r], href: here({ rank: k }), on: q.rank === k, count: all.filter((n) => n.rank === r).length,
      })).filter((o) => o.count > 0 || o.on)],
    },
    { type: "toggle", key: "drops", label: "Has drops", href: here({ drops: q.drops ? undefined : true }), on: Boolean(q.drops) },
  ];
  const keep = Object.fromEntries(new URLSearchParams(href({ ...q, q: undefined, page: 1 }).split("?")[1] ?? ""));
  const strip = <ResultStrip total={rows.length} noun={rows.length === 1 ? "NPC" : "NPCs"} page={q.page} perPage={PER_PAGE} href={(page) => href({ ...q, page })} label="NPC pages" />;
  const chips = [
    ...(q.q ? [{ label: `Name: ${q.q}`, href: here({ q: undefined }) }] : []),
    ...(q.zone ? [{ label: zones.find((z) => z.mapId === q.zone)?.name ?? "Zone", href: here({ zone: undefined }) }] : []),
    ...(q.level ? [{ label: `Level ${rangeParam(q.level)}`, href: here({ level: undefined }) }] : []),
    ...(q.react ? [{ label: REACTION_LABEL[REACTIONS[q.react]], href: here({ react: undefined }) }] : []),
    ...(q.type ? [{ label: TYPES.get(q.type)!, href: here({ type: undefined }) }] : []),
    ...(q.rank ? [{ label: RANK_LABEL[RANKS.get(q.rank)!], href: here({ rank: undefined }) }] : []),
    ...(q.drops ? [{ label: "Has drops", href: here({ drops: undefined }) }] : []),
  ];
  const empty = facts.unreachable ? <Unreadable />
    : filters(q) > 0 ? <>
        <NoMatches noun="NPCs" chips={chips} clearHref="/database/npcs" />
        {id !== null && <p className="pb-4 text-cell"><Link href={`/database/npcs/${id}`} className={LINK}>Open NPC {id}</Link></p>}
      </>
    : <NoObservations>NPCs are listed once players report them. The addon starts recording when the game launches on November 4, and an NPC shows here once 3 installs agree on it.</NoObservations>;

  return (
    <Container width="data">
      <article>
        <DataTitle title="NPCs" aside={strip} />
        {/* With no NPC to filter, a row of controls over one line says nothing. */}
        {all.length > 0 && <FilterBar
          label="NPC filters"
          search={{ action: "/database/npcs", value: q.q, placeholder: "Name or id", label: "Filter by name or id", keep }}
          controls={controls}
          active={filters(q)}
          clearHref="/database/npcs"
        />}
        {/* With nothing to list at all, the one line says so without a row of column headers over it. */}
        <div className="mt-2">{all.length === 0 ? empty : (
          <DataTable
            dense
            caption={`NPCs: ${rows.length}`}
            // A column no NPC in the result has a value for is left out.
            columns={filledColumns(columns, rows)}
            rows={shown}
            rowKey={(n) => String(n.npcId)}
            sort={{ key: sort.key, direction: sort.desc ? "desc" : "asc" }}
            sortHref={(k, dir) => here({ sort: nextSort(k, dir, DEFAULT_SORT) })}
            meta={(n) => [n.level !== null && `Level ${n.level}`, n.rank && n.rank !== "normal" && RANK_LABEL[n.rank], n.creatureType, n.reaction && REACTION_LABEL[n.reaction], n.zone?.name, n.drops > 0 && `${n.drops} drops`, `ID ${n.npcId}`].filter(Boolean).join(" · ")}
            empty={empty}
          />
        )}</div>
        {pages > 1 && <div className="mt-2">{strip}</div>}
      </article>
    </Container>
  );
}
