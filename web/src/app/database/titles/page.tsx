import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { TitleEntry } from "../../../../../kb/src/completion";
import { Container, DataTable, DataTitle, FilterBar, ResultStrip, type Column } from "@/components/ui";
import { loadCatalog, titleDisplayName, titleHref, type Listed } from "@/lib/completion-lists";
import { LINK } from "../entity";
import {
  confirmedCell, ConfirmationsUnread, listCaption, listHref, listMetadata, listQuery, nextSort, NoMatches, noneListed, NoObservations, PER_PAGE,
  sortParam, sortRows, Unreadable, type ListQuery, type Search,
} from "../list-parts";

const META = { title: "WoW Forever Title List", description: "Player titles in WoW: Forever by name and ID. From the game files; confirmed once three installs report each the same way.", path: "/database/titles" };
export const dynamic = "force-dynamic";

const SORTS = ["name", "id"] as const;
type Sort = (typeof SORTS)[number];
const DEFAULT_SORT = { key: "id" as Sort, desc: false };

const href = (q: Partial<ListQuery<Sort>>) => listHref("/database/titles", [
  ["q", q.q], ["sort", sortParam(q.sort)], ["page", q.page && q.page > 1 ? String(q.page) : undefined],
]);

export async function generateMetadata(props: { searchParams?: Promise<Search> }): Promise<Metadata> {
  const q = listQuery((await props.searchParams) ?? {}, SORTS);
  return listMetadata(META, Boolean(q) && !q!.q && !q!.sort, q?.page);
}

export default async function TitleListPage(props: { searchParams?: Promise<Search> }) {
  const q = listQuery((await props.searchParams) ?? {}, SORTS);
  if (!q) notFound();
  const catalog = await loadCatalog();
  const all = catalog?.titles ?? [];
  const confirmations = catalog?.confirmations ?? false;
  const text = q.q?.toLowerCase();
  const id = text && /^#?\d+$/.test(text) ? Number(text.replace("#", "")) : null;
  const matched = all.filter((x) => !text || (id !== null ? x.titleId === id : x.name.toLowerCase().includes(text)));
  const sort = q.sort ?? DEFAULT_SORT;
  const rows = sortRows(matched, (x) => (sort.key === "name" ? x.name.toLowerCase() : x.titleId), sort.desc, (x) => x.titleId);
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  if (q.page > pages) notFound();
  const shown = rows.slice((q.page - 1) * PER_PAGE, q.page * PER_PAGE);
  const here = (over: Partial<ListQuery<Sort>>) => href({ ...q, page: 1, ...over });

  const columns: Column<Listed<TitleEntry>>[] = [
    { key: "name", header: "Name", sortable: true, cell: (x) => <Link href={titleHref(x.titleId, x.name)} className={LINK}>{titleDisplayName(x.name)}</Link> },
    { key: "confirmed", header: "Confirmed", cell: (x) => confirmedCell(x, confirmations) },
    { key: "id", header: "ID", numeric: true, sortable: true, cell: (x) => x.titleId },
  ];
  const keep = Object.fromEntries(new URLSearchParams(href({ ...q, q: undefined, page: 1 }).split("?")[1] ?? ""));
  const strip = <ResultStrip total={rows.length} noun={rows.length === 1 ? "title" : "titles"} page={q.page} perPage={PER_PAGE} href={(page) => href({ ...q, page })} label="Title pages" />;
  const chips = q.q ? [{ label: `Name: ${q.q}`, href: here({ q: undefined }) }] : [];
  const empty = !catalog ? <Unreadable />
    : q.q ? <NoMatches noun="titles" chips={chips} clearHref="/database/titles" />
    : <NoObservations>{noneListed("title")}</NoObservations>;

  return (
    <Container width="data">
      <article>
        <DataTitle title="Titles" aside={strip} />
        {catalog && !confirmations && <ConfirmationsUnread />}
        <FilterBar
          label="Title filters"
          search={{ action: "/database/titles", value: q.q, placeholder: "Name or id", label: "Filter by name or id", keep }}
          controls={[]}
          active={q.q ? 1 : 0}
          clearHref="/database/titles"
        />
        <div className="mt-2">
          <DataTable
            dense
            caption={listCaption("titles", rows, confirmations)}
            columns={columns}
            rows={shown}
            rowKey={(x) => String(x.titleId)}
            sort={{ key: sort.key, direction: sort.desc ? "desc" : "asc" }}
            sortHref={(k, dir) => here({ sort: nextSort(k, dir, DEFAULT_SORT) })}
            meta={(x) => `ID ${x.titleId}`}
            empty={empty}
          />
        </div>
        {pages > 1 && <div className="mt-2">{strip}</div>}
      </article>
    </Container>
  );
}
