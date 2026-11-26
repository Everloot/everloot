import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Container, DataTable, DataTitle, FilterBar, ResultStrip, type Column } from "@/components/ui";
import { CLIENT_LABEL } from "@kb/edges";
import { byRank, ListNote, listHref, listMetadata, listQuery, NameCell, nameMatches, nextSort, NoMatches, paged, pageParams, Respelled, sortRows, Unreadable, type ListQuery, type Search } from "./list-parts";

// The lists of mounts, companion pets, currencies and toys: the game files' entries, named and linked, filtered by
// name or id and paged like the other database lists. Each row links its own page (a toy, its item page).

export interface CollectibleRow { id: number; name: string; href: string; icon?: string | null }

/** A column between the name and the id; with `sortBy` its header sorts the list (?sort=<key>). */
export type CollectibleColumn<R> = Column<R> & { sortBy?: (row: R) => string | number | null };

const SORTS = ["name", "id"] as const;
type Sort = string;
const DEFAULT_SORT = { key: "id" as Sort, desc: false };

export interface CollectibleListProps<R extends CollectibleRow> {
  path: string; title: string; noun: [one: string, many: string];
  /** The game files' rows, or null when the file could not be read. */
  rows: R[] | null;
  /** Columns between the name and the id. */
  columns?: CollectibleColumn<R>[];
  /** One line under the title: where the list comes from and what confirms an entry. */
  note: string;
  search: Search;
}

const hrefOf = (path: string) => (q: Partial<ListQuery<Sort>>) => listHref(path, [["q", q.q], ...pageParams(q)]);

/** The list's robots and canonical: indexed only unfiltered, unsorted, at its own page size, each page under its own URL. */
export function collectibleListMetadata(meta: { title: string; description: string; path: string }, search: Search): Metadata {
  const q = listQuery(search, SORTS);
  return listMetadata(meta, Boolean(q) && !q!.q && !q!.sort && !q!.per, q?.page);
}

export function CollectibleList<R extends CollectibleRow>({ path, title, noun, rows: all, columns = [], note, search }: CollectibleListProps<R>) {
  const sortable = columns.filter((c) => c.sortBy);
  const q = listQuery(search, [...SORTS, ...sortable.map((c) => c.key)]);
  if (!q) notFound();
  const href = hrefOf(path);
  const rows0 = all ?? [];
  const text = q.q?.toLowerCase();
  const id = text && /^#?\d+$/.test(text) ? Number(text.replace("#", "")) : null;
  const { ranked, respelled } = nameMatches(rows0, text, id, (x) => x.name);
  const matched = rows0.filter((x) => !text || (id !== null ? x.id === id : ranked!.has(x)));
  const sort = q.sort ?? DEFAULT_SORT;
  const by = sortable.find((c) => c.key === sort.key)?.sortBy;
  const rows = byRank(sortRows(matched, (x) => (by ? by(x) : sort.key === "name" ? x.name.toLowerCase() : x.id), sort.desc, (x) => x.id), ranked, Boolean(q.sort));
  const { shown, pages, per } = paged(rows, q);
  const here = (over: Partial<ListQuery<Sort>>) => href({ ...q, page: 1, ...over });
  const cols: Column<R>[] = [
    { key: "name", header: "Name", sortable: true, cell: (x) => <NameCell href={x.href} icon={x.icon}>{x.name}</NameCell> },
    ...columns.map((c) => ({ ...c, sortable: Boolean(c.sortBy) })),
    { key: "id", header: "ID", numeric: true, sortable: true, cell: (x) => x.id },
  ];
  const keep = Object.fromEntries(new URLSearchParams(href({ ...q, q: undefined, page: 1 }).split("?")[1] ?? ""));
  const strip = <ResultStrip total={rows.length} noun={rows.length === 1 ? noun[0] : noun[1]} page={q.page} perPage={per} href={(page) => href({ ...q, page })} sizeHref={(n) => href({ ...q, per: n, page: 1 })} label={`${title} pages`} />;
  const chips = q.q ? [{ label: `Name: ${q.q}`, href: here({ q: undefined }) }] : [];
  const empty = all === null ? <Unreadable>The game files could not be read just now, so this list is unrecorded.</Unreadable>
    : q.q ? <NoMatches noun={noun[1]} chips={chips} clearHref={path} />
    : <p className="py-4 text-cell text-fg-2">No {noun[0]} is in the game files read so far.</p>;
  const label = noun[1].charAt(0).toUpperCase() + noun[1].slice(1);

  return (
    <Container width="data">
      <article>
        <DataTitle title={title} aside={strip} />
        <ListNote files>{note} {CLIENT_LABEL}.</ListNote>
        <FilterBar
          label={`${title} filters`}
          search={{ action: path, value: q.q, placeholder: "Name or id", label: "Filter by name or id", keep }}
          controls={[]}
          active={q.q ? 1 : 0}
          clearHref={path}
        />
        {respelled && rows.length > 0 && <Respelled q={respelled} />}
        <div className="mt-2">
          <DataTable
            dense
            caption={`${label} in the game files: ${rows.length}`}
            columns={cols}
            rows={shown}
            rowKey={(x) => String(x.id)}
            sort={{ key: sort.key, direction: sort.desc ? "desc" : "asc" }}
            sortHref={(k, dir) => here({ sort: nextSort(k, dir, DEFAULT_SORT) })}
            meta={(x) => `ID ${x.id}`}
            empty={empty}
          />
        </div>
        {pages > 1 && <div className="mt-2">{strip}</div>}
      </article>
    </Container>
  );
}
