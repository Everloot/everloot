import type { Metadata } from "next";
import { LAUNCH, LAUNCH_AT, longDate } from "@/data/wow-forever";
import Link from "@/components/Link";
import { notFound } from "next/navigation";
import { NPC_CREATURE_TYPES, NPC_RANKS, type NpcRank, type NpcReaction } from "@kb/world-pages";
import { Badge, Container, DataTable, DataTitle, filledColumns, FilterBar, ResultStrip, type FilterControl, type SparseColumn, stripBelow } from "@/components/ui";
import { computeRollups, loadWorldFacts } from "@/lib/rollup-compute";
import { bareNpcRow, npcRows, publicQuests, publicVendors, type NpcRow } from "@/lib/world-lists";
import { parseZoneSegment, publicZones, zoneHref, zoneSlug } from "@/lib/zones";
import { loadWikiEntityNames } from "@/lib/wiki-entity-names";
import { wikiNpcNames } from "@/lib/wiki-npc-names";
import { NAME_FROM } from "@/lib/items";
import { LINK } from "../entity";
import { byRank, countBy, facetRows, nameMatches, Respelled,
  flag, LEVEL_BRACKETS, listHref, listMetadata, listQuery, NameCell, nextSort, NoMatches, NoObservations, paged, pageParams, plural, range, rangeParam, sortRows, Unreadable,
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
  ["q", q.q], ["zone", zoneParam(q.zone)], ["level", rangeParam(q.level)], ["react", q.react], ["type", q.type], ["rank", q.rank], ["drops", q.drops ? "1" : undefined], ...pageParams(q),
]);
const filters = (q: NpcQuery) => Number(Boolean(q.q)) + Number(Boolean(q.zone)) + Number(Boolean(q.drops)) + Number(Boolean(q.level)) + Number(Boolean(q.react)) + Number(Boolean(q.type)) + Number(Boolean(q.rank));

export async function generateMetadata(props: { searchParams?: Promise<Search> }): Promise<Metadata> {
  const q = npcQuery((await props.searchParams) ?? {});
  return listMetadata(META, Boolean(q) && filters(q!) === 0 && !q!.sort && !q!.per, q?.page);
}

export default async function NpcListPage(props: { searchParams?: Promise<Search> }) {
  const q = npcQuery((await props.searchParams) ?? {});
  if (!q) notFound();
  const [facts, { rates }, wiki] = await Promise.all([loadWorldFacts(), computeRollups(), loadWikiEntityNames("npc")]);
  // The name each NPC's own page shows (shownNpcName): the agreed one, else the Warcraft Wiki name a unanimous report matches.
  const wikiNames = wikiNpcNames(facts, wiki);
  const fromWiki = new Set<number>();
  const reported = facts.unreachable ? [] : npcRows(facts, rates).map((n) => {
    const hit = n.name ? undefined : wikiNames?.get(n.npcId);
    if (!hit) return n;
    fromWiki.add(n.npcId);
    return { ...n, name: hit.name };
  });
  // An NPC known from a public quest (its giver or turn-in) or a vendor with agreed prices has a page too, so it is
  // listed like the rest, its unknown cells "—".
  const known = new Set(reported.map((n) => n.npcId));
  const linked = facts.unreachable ? [] : [...publicQuests(facts).flatMap((x) => [x.giverNpcId, x.turnInNpcId]), ...publicVendors(facts).map((v) => v.vendorNpcId)];
  const all = [...reported, ...[...new Set(linked)].filter((n): n is number => n !== null && !known.has(n)).map(bareNpcRow)];
  const text = q.q?.toLowerCase();
  const id = text && /^#?\d+$/.test(text) ? Number(text.replace("#", "")) : null;
  const { ranked, respelled } = nameMatches(all, text, id, (n) => n.name);
  const inLevel = (n: NpcRow, r: { min: number; max: number }) => n.level !== null && n.level >= r.min && n.level <= r.max;
  // Each menu counts what the list would hold with every other filter on (facetRows), so no choice empties the list.
  const { matched, without } = facetRows(all, {
    q: text ? (n: NpcRow) => (id !== null ? n.npcId === id : ranked!.has(n)) : null,
    zone: q.zone ? (n: NpcRow) => n.zone?.mapId === q.zone : null,
    drops: q.drops ? (n: NpcRow) => n.drops > 0 : null,
    level: q.level ? (n: NpcRow) => inLevel(n, q.level!) : null,
    react: q.react ? (n: NpcRow) => n.reaction === REACTIONS[q.react!] : null,
    type: q.type ? (n: NpcRow) => n.creatureType === TYPES.get(q.type!) : null,
    rank: q.rank ? (n: NpcRow) => n.rank === RANKS.get(q.rank!) : null,
  });
  const sort = q.sort ?? DEFAULT_SORT;
  const key = (n: NpcRow): string | number | null => sort.key === "name" ? n.name?.toLowerCase() ?? null : sort.key === "level" ? n.level
    : sort.key === "type" ? n.creatureType?.toLowerCase() ?? null : sort.key === "rank" ? (n.rank ? NPC_RANKS.indexOf(n.rank) : null)
    : sort.key === "react" ? n.reaction : sort.key === "zone" ? n.zone?.name ?? null : sort.key === "drops" ? n.drops : n.npcId;
  const rows = byRank(sortRows(matched, key, sort.desc, (n) => n.npcId), ranked, Boolean(q.sort));
  const { shown, pages, per } = paged(rows, q);
  const here = (over: Partial<NpcQuery>) => href({ ...q, page: 1, ...over });

  const dash = <span className="text-muted">—</span>;
  // What it is (type, rank, reaction), its numbers (level, drops), where it stands, its id.
  const columns: SparseColumn<NpcRow>[] = [
    { key: "name", header: "Name", sortable: true, cell: (n) => <NameCell href={`/database/npcs/${n.npcId}`} after={fromWiki.has(n.npcId) && <span className="sr-only"> ({NAME_FROM.wiki.toLowerCase()})</span>}>{n.name ?? `NPC ${n.npcId}`}</NameCell> },
    { key: "type", header: "Type", sortable: true, cell: (n) => n.creatureType ?? dash, blank: (n) => !n.creatureType },
    // A rank above normal (elite, rare, boss) is what you scan the list for, so it is a badge.
    { key: "rank", header: "Rank", sortable: true, cell: (n) => (!n.rank ? dash : n.rank === "normal" ? RANK_LABEL[n.rank] : <Badge tone="neutral">{RANK_LABEL[n.rank]}</Badge>), blank: (n) => !n.rank },
    { key: "react", header: "Reaction", sortable: true, cell: (n) => (n.reaction ? REACTION_LABEL[n.reaction] : dash), blank: (n) => !n.reaction },
    { key: "level", header: "Level", numeric: true, sortable: true, cell: (n) => n.level ?? dash, blank: (n) => n.level === null },
    { key: "drops", header: "Drops", numeric: true, sortable: true, cell: (n) => n.drops || dash, blank: (n) => !n.drops },
    { key: "zone", header: "Zone", sortable: true, cell: (n) => (n.zone ? <Link prefetch={false} href={zoneHref(n.zone.mapId, n.zone.name)} className={LINK}>{n.zone.name}</Link> : dash), blank: (n) => !n.zone },
    { key: "id", header: "ID", numeric: true, sortable: true, cell: (n) => n.npcId },
  ];

  const zones = [...new Map(all.filter((n) => n.zone).map((n) => [n.zone!.mapId, n.zone!])).values()].sort((a, b) => a.name.localeCompare(b.name));
  const inZone = countBy(without.zone, (n) => n.zone?.mapId), ofType = countBy(without.type, (n) => n.creatureType), ofRank = countBy(without.rank, (n) => n.rank);
  const ofReaction = countBy(without.react, (n) => n.reaction);
  const controls: FilterControl[] = [
    {
      type: "menu", key: "zone", label: "Zone",
      options: [{ label: "Any zone", href: here({ zone: undefined }), on: !q.zone, reset: true }, ...zones.map((z) => ({
        label: z.name, href: here({ zone: z.mapId }), on: q.zone === z.mapId, count: inZone.get(z.mapId) ?? 0,
      }))],
    },
    {
      type: "menu", key: "level", label: "Level",
      options: [{ label: "Any level", href: here({ level: undefined }), on: !q.level, reset: true }, ...LEVEL_BRACKETS.map((b) => ({
        label: `${b.min}–${b.max}`, href: here({ level: b }), on: q.level?.min === b.min && q.level?.max === b.max, count: without.level.filter((n) => inLevel(n, b)).length,
      }))],
    },
    {
      type: "menu", key: "react", label: "Reaction",
      options: [{ label: "Any reaction", href: here({ react: undefined }), on: !q.react, reset: true }, ...Object.entries(REACTIONS).map(([k, r]) => ({
        label: REACTION_LABEL[r], href: here({ react: k }), on: q.react === k, count: ofReaction.get(r) ?? 0,
      }))],
    },
    {
      type: "menu", key: "type", label: "Type",
      options: [{ label: "Any type", href: here({ type: undefined }), on: !q.type, reset: true }, ...[...TYPES].map(([k, t]) => ({
        label: t, href: here({ type: k }), on: q.type === k, count: ofType.get(t) ?? 0,
      })).filter((o) => o.count > 0 || o.on)],
    },
    {
      type: "menu", key: "rank", label: "Rank",
      options: [{ label: "Any rank", href: here({ rank: undefined }), on: !q.rank, reset: true }, ...[...RANKS].map(([k, r]) => ({
        label: RANK_LABEL[r], href: here({ rank: k }), on: q.rank === k, count: ofRank.get(r) ?? 0,
      })).filter((o) => o.count > 0 || o.on)],
    },
    { type: "toggle", key: "drops", label: "Has drops", href: here({ drops: q.drops ? undefined : true }), on: Boolean(q.drops) },
  ];
  const keep = Object.fromEntries(new URLSearchParams(href({ ...q, q: undefined, page: 1 }).split("?")[1] ?? ""));
  const strip = <ResultStrip total={rows.length} noun={rows.length === 1 ? "NPC" : "NPCs"} page={q.page} perPage={per} href={(page) => href({ ...q, page })} sizeHref={(n) => href({ ...q, per: n, page: 1 })} label="NPC pages" />;
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
        {id !== null && <p className="pb-4 text-cell"><Link prefetch={false} href={`/database/npcs/${id}`} className={LINK}>Open NPC {id}</Link></p>}
      </>
    : <NoObservations>{`NPCs are listed once players report them. ${Date.now() < Date.parse(LAUNCH_AT) ? `The addon starts recording when the game launches on ${longDate(LAUNCH.date)}, and an` : "An"} NPC shows here once 3 installs agree on it.`}</NoObservations>;

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
        {respelled && rows.length > 0 && <Respelled q={respelled} />}
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
            meta={(n) => [n.creatureType, n.rank && n.rank !== "normal" && RANK_LABEL[n.rank], n.reaction && REACTION_LABEL[n.reaction], n.level !== null && `Level ${n.level}`, n.drops > 0 && plural(n.drops, "drop"), n.zone?.name, `ID ${n.npcId}`].filter(Boolean).join(" · ")}
            empty={empty}
          />
        )}</div>
        {pages > 1 && <div className="mt-2">{stripBelow(strip)}</div>}
      </article>
    </Container>
  );
}
