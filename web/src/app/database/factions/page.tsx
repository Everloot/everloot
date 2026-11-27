import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { FactionEntry } from "@kb/completion";
import { Container, DataTable, DataTitle, FilterBar, ResultStrip, type Column, type FilterControl, stripBelow } from "@/components/ui";
import Link from "@/components/Link";
import { factionChildren, factionHref, factionInFiles, loadCatalog, type Listed } from "@/lib/completion-lists";
import { byRank, nameMatches, Respelled,
  ConfirmedCell, ConfirmationsUnread, listCaption, listHref, listMetadata, listQuery, NameCell, nextSort, NoMatches, noneListed, NoObservations, paged,
  pageParams, sortRows, Unreadable, type ListQuery, type Search,
} from "../list-parts";

const META = { title: "WoW Forever Faction List", description: "Reputation factions in WoW: Forever by name, header and ID. From the game files; confirmed once three installs report each the same way.", path: "/database/factions" };
export const dynamic = "force-dynamic";

const SORTS = ["name", "header", "id"] as const;
type Sort = (typeof SORTS)[number];
const DEFAULT_SORT = { key: "id" as Sort, desc: false };

/** A faction under the Alliance's or the Horde's header wears that side's colour (the faction colours are that fact's own). */
const sideTone = (header?: string) => (header && /\bAlliance\b/.test(header) ? "text-faction-alliance" : header && /\bHorde\b/.test(header) ? "text-faction-horde" : "text-fg");

interface FactionQuery extends ListQuery<Sort> { header?: string }

/** The list's filters from the URL: `q`, `header=Alliance`. */
function factionQuery(search: Search): FactionQuery | null {
  const base = listQuery(search, SORTS);
  if (!base) return null;
  const header = typeof search.header === "string" ? search.header.trim().slice(0, 60) : "";
  return { ...base, ...(header ? { header } : {}) };
}

const href = (q: Partial<FactionQuery>) => listHref("/database/factions", [
  ["q", q.q], ["header", q.header], ...pageParams(q),
]);
const filters = (q: FactionQuery) => Number(Boolean(q.q)) + Number(Boolean(q.header));

export async function generateMetadata(props: { searchParams?: Promise<Search> }): Promise<Metadata> {
  const q = factionQuery((await props.searchParams) ?? {});
  return listMetadata(META, Boolean(q) && filters(q!) === 0 && !q!.sort && !q!.per, q?.page);
}

export default async function FactionListPage(props: { searchParams?: Promise<Search> }) {
  const q = factionQuery((await props.searchParams) ?? {});
  if (!q) notFound();
  const catalog = await loadCatalog();
  const confirmations = catalog?.confirmations ?? false;
  const all = catalog?.factions ?? [];
  const text = q.q?.toLowerCase();
  const id = text && /^#?\d+$/.test(text) ? Number(text.replace("#", "")) : null;
  const { ranked, respelled } = nameMatches(all, text, id, (x) => x.name);
  const matched = all.filter((x) =>
    (!text || (id !== null ? x.factionId === id : ranked!.has(x))) && (!q.header || x.header === q.header));
  const sort = q.sort ?? DEFAULT_SORT;
  const key = (x: Listed<FactionEntry>): string | number | null => sort.key === "name" ? x.name.toLowerCase() : sort.key === "header" ? x.header?.toLowerCase() ?? null : x.factionId;
  const rows = byRank(sortRows(matched, key, sort.desc, (x) => x.factionId), ranked, Boolean(q.sort));
  const { shown, pages, per } = paged(rows, q);
  const here = (over: Partial<FactionQuery>) => href({ ...q, page: 1, ...over });

  const dash = <span className="text-muted">—</span>;
  const listed = new Set(all.map((x) => x.factionId));
  const columns: Column<Listed<FactionEntry>>[] = [
    { key: "name", header: "Name", sortable: true, cell: (x) => <NameCell href={factionHref(x.factionId, x.name)} tone={sideTone(x.header)}>{x.name}</NameCell> },
    { key: "header", header: "Header", sortable: true, cell: (x) => x.header ?? dash },
    // The parent the game files name, linked when it has a page; the count of the factions they list under this one.
    { key: "parent", header: "Parent", cell: (x) => {
      const p = factionInFiles(x.factionId)?.parent;
      if (!p) return dash;
      return listed.has(p.id) ? <Link href={factionHref(p.id, p.name)} className="underline decoration-edge underline-offset-4 hover:decoration-fg">{p.name}</Link> : p.name;
    } },
    { key: "children", header: "Sub-factions", numeric: true, cell: (x) => factionChildren(x.factionId).filter((c) => listed.has(c.id)).length || dash },
    { key: "confirmed", header: "Confirmed", cell: (x) => <ConfirmedCell entry={x} confirmations={confirmations} /> },
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
  const strip = <ResultStrip total={rows.length} noun={rows.length === 1 ? "faction" : "factions"} page={q.page} perPage={per} href={(page) => href({ ...q, page })} sizeHref={(n) => href({ ...q, per: n, page: 1 })} label="Faction pages" />;
  const chips = [
    ...(q.q ? [{ label: `Name: ${q.q}`, href: here({ q: undefined }) }] : []),
    ...(q.header ? [{ label: `Header: ${q.header}`, href: here({ header: undefined }) }] : []),
  ];
  const empty = !catalog ? <Unreadable />
    : filters(q) > 0 ? <NoMatches noun="factions" chips={chips} clearHref="/database/factions" />
    : <NoObservations>{noneListed("faction")}</NoObservations>;

  return (
    <Container width="data">
      <article>
        <DataTitle title="Factions" aside={strip} />
        {catalog && !confirmations && <ConfirmationsUnread />}
        <FilterBar
          label="Faction filters"
          search={{ action: "/database/factions", value: q.q, placeholder: "Name or id", label: "Filter by name or id", keep }}
          controls={controls}
          active={filters(q)}
          clearHref="/database/factions"
        />
        {respelled && rows.length > 0 && <Respelled q={respelled} />}
        <div className="mt-2">
          <DataTable
            dense
            caption={listCaption("factions", rows, confirmations)}
            columns={columns}
            rows={shown}
            rowKey={(x) => String(x.factionId)}
            sort={{ key: sort.key, direction: sort.desc ? "desc" : "asc" }}
            sortHref={(k, dir) => here({ sort: nextSort(k, dir, DEFAULT_SORT) })}
            meta={(x) => [x.header, `ID ${x.factionId}`].filter(Boolean).join(" · ")}
            empty={empty}
          />
        </div>
        {pages > 1 && <div className="mt-2">{stripBelow(strip)}</div>}
      </article>
    </Container>
  );
}
