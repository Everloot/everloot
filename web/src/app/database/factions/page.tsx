import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { FactionEntry } from "../../../../../kb/src/completion";
import { Container, DataTable, DataTitle, FilterBar, ResultStrip, type Column, type FilterControl } from "@/components/ui";
import { factionHref, loadCatalog, type Listed } from "@/lib/completion-lists";
import { LINK } from "../entity";
import {
  listHref, listMetadata, listQuery, nextSort, NoMatches, NoObservations, PER_PAGE, sortParam, sortRows, Unreadable,
  type ListQuery, type Search,
} from "../list-parts";

const META = { title: "WoW Forever Faction List", description: "Reputation factions in WoW: Forever by name, standing header and faction ID. A faction is listed once three players report it the same way.", path: "/database/factions" };
export const dynamic = "force-dynamic";

const SORTS = ["name", "header", "id"] as const;
type Sort = (typeof SORTS)[number];
const DEFAULT_SORT = { key: "id" as Sort, desc: false };

interface FactionQuery extends ListQuery<Sort> { header?: string }

/** The list's filters from the URL: `q`, `header=Alliance`. */
function factionQuery(search: Search): FactionQuery | null {
  const base = listQuery(search, SORTS);
  if (!base) return null;
  const header = typeof search.header === "string" ? search.header.trim().slice(0, 60) : "";
  return { ...base, ...(header ? { header } : {}) };
}

const href = (q: Partial<FactionQuery>) => listHref("/database/factions", [
  ["q", q.q], ["header", q.header], ["sort", sortParam(q.sort)], ["page", q.page && q.page > 1 ? String(q.page) : undefined],
]);
const filters = (q: FactionQuery) => Number(Boolean(q.q)) + Number(Boolean(q.header));

export async function generateMetadata(props: { searchParams?: Promise<Search> }): Promise<Metadata> {
  const q = factionQuery((await props.searchParams) ?? {});
  return listMetadata(META, Boolean(q) && filters(q!) === 0 && !q!.sort, q?.page);
}

export default async function FactionListPage(props: { searchParams?: Promise<Search> }) {
  const q = factionQuery((await props.searchParams) ?? {});
  if (!q) notFound();
  const catalog = await loadCatalog();
  const all = catalog?.factions ?? [];
  const text = q.q?.toLowerCase();
  const id = text && /^#?\d+$/.test(text) ? Number(text.replace("#", "")) : null;
  const matched = all.filter((x) =>
    (!text || (id !== null ? x.factionId === id : x.name.toLowerCase().includes(text))) && (!q.header || x.header === q.header));
  const sort = q.sort ?? DEFAULT_SORT;
  const key = (x: Listed<FactionEntry>): string | number | null => sort.key === "name" ? x.name.toLowerCase() : sort.key === "header" ? x.header?.toLowerCase() ?? null : x.factionId;
  const rows = sortRows(matched, key, sort.desc, (x) => x.factionId);
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  if (q.page > pages) notFound();
  const shown = rows.slice((q.page - 1) * PER_PAGE, q.page * PER_PAGE);
  const here = (over: Partial<FactionQuery>) => href({ ...q, page: 1, ...over });

  const dash = <span className="text-muted">—</span>;
  const columns: Column<Listed<FactionEntry>>[] = [
    { key: "name", header: "Name", sortable: true, cell: (x) => <Link href={factionHref(x.factionId, x.name)} className={LINK}>{x.name}</Link> },
    { key: "header", header: "Header", sortable: true, cell: (x) => x.header ?? dash },
    { key: "confirmed", header: "Confirmed", cell: (x) => (x.confirmed ? "Confirmed" : "Unconfirmed") },
    { key: "id", header: "ID", numeric: true, sortable: true, cell: (x) => x.factionId },
  ];

  const headers = [...new Set(all.flatMap((x) => (x.header ? [x.header] : [])))].sort((a, b) => a.localeCompare(b));
  const controls: FilterControl[] = [
    {
      type: "menu", key: "header", label: "Header",
      options: [{ label: "Any header", href: here({ header: undefined }), on: !q.header, reset: true }, ...headers.map((h) => ({
        label: h, href: here({ header: h }), on: q.header === h, count: all.filter((x) => x.header === h).length,
      }))],
    },
  ];
  const keep = Object.fromEntries(new URLSearchParams(href({ ...q, q: undefined, page: 1 }).split("?")[1] ?? ""));
  const strip = <ResultStrip total={rows.length} noun={rows.length === 1 ? "faction" : "factions"} page={q.page} perPage={PER_PAGE} href={(page) => href({ ...q, page })} label="Faction pages" />;
  const chips = [
    ...(q.q ? [{ label: `Name: ${q.q}`, href: here({ q: undefined }) }] : []),
    ...(q.header ? [{ label: `Header: ${q.header}`, href: here({ header: undefined }) }] : []),
  ];
  const empty = !catalog ? <Unreadable />
    : filters(q) > 0 ? <NoMatches noun="factions" chips={chips} clearHref="/database/factions" />
    : <NoObservations>No faction is listed yet; each appears once three players report it.</NoObservations>;

  return (
    <Container width="data">
      <article>
        <DataTitle title="Factions" aside={strip} />
        <FilterBar
          label="Faction filters"
          search={{ action: "/database/factions", value: q.q, placeholder: "Name or id", label: "Filter by name or id", keep }}
          controls={controls}
          active={filters(q)}
          clearHref="/database/factions"
        />
        <div className="mt-2">
          <DataTable
            dense
            caption={`Factions three players reported: ${rows.length}`}
            columns={columns}
            rows={shown}
            rowKey={(x) => String(x.factionId)}
            sort={{ key: sort.key, direction: sort.desc ? "desc" : "asc" }}
            sortHref={(k, dir) => here({ sort: nextSort(k, dir, DEFAULT_SORT) })}
            meta={(x) => [x.header, `ID ${x.factionId}`].filter(Boolean).join(" · ")}
            empty={empty}
          />
        </div>
        {pages > 1 && <div className="mt-2">{strip}</div>}
      </article>
    </Container>
  );
}
