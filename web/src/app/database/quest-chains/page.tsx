import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ChainEntry } from "../../../../../kb/src/completion";
import { Container, DataTable, DataTitle, FilterBar, ResultStrip, type Column } from "@/components/ui";
import { chainHref, loadCatalog, type Listed } from "@/lib/completion-lists";
import { LINK } from "../entity";
import {
  confirmedCell, ConfirmationsUnread, listCaption, listHref, listMetadata, listQuery, nextSort, NoMatches, noneListed, NoObservations, PER_PAGE,
  sortParam, sortRows, Unreadable, type ListQuery, type Search,
} from "../list-parts";

const META = { title: "WoW Forever Quest Chain List", description: "Quest chains in WoW: Forever by quest count and quest line ID. From the game files; confirmed once three players report each the same way.", path: "/database/quest-chains" };
export const dynamic = "force-dynamic";

const SORTS = ["name", "quests", "id"] as const;
type Sort = (typeof SORTS)[number];
const DEFAULT_SORT = { key: "id" as Sort, desc: false };

const href = (q: Partial<ListQuery<Sort>>) => listHref("/database/quest-chains", [
  ["q", q.q], ["sort", sortParam(q.sort)], ["page", q.page && q.page > 1 ? String(q.page) : undefined],
]);

export async function generateMetadata(props: { searchParams?: Promise<Search> }): Promise<Metadata> {
  const q = listQuery((await props.searchParams) ?? {}, SORTS);
  return listMetadata(META, Boolean(q) && !q!.q && !q!.sort, q?.page);
}

export default async function QuestChainListPage(props: { searchParams?: Promise<Search> }) {
  const q = listQuery((await props.searchParams) ?? {}, SORTS);
  if (!q) notFound();
  const catalog = await loadCatalog();
  const confirmations = catalog?.confirmations ?? false;
  const all = catalog?.chains ?? [];
  const text = q.q?.toLowerCase();
  const id = text && /^#?\d+$/.test(text) ? Number(text.replace("#", "")) : null;
  const matched = all.filter((x) => !text || (id !== null ? x.questLineId === id : x.name.toLowerCase().includes(text)));
  const sort = q.sort ?? DEFAULT_SORT;
  const rows = sortRows(matched, (x) => (sort.key === "name" ? x.name.toLowerCase() : sort.key === "quests" ? x.questIds.length : x.questLineId), sort.desc, (x) => x.questLineId);
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  if (q.page > pages) notFound();
  const shown = rows.slice((q.page - 1) * PER_PAGE, q.page * PER_PAGE);
  const here = (over: Partial<ListQuery<Sort>>) => href({ ...q, page: 1, ...over });

  // A chain cut at 80 quests has more than it lists.
  const count = (x: ChainEntry) => (x.truncated ? `${x.questIds.length}+` : x.questIds.length);
  const columns: Column<Listed<ChainEntry>>[] = [
    { key: "name", header: "Name", sortable: true, cell: (x) => <Link href={chainHref(x.questLineId, x.name)} className={LINK}>{x.name}</Link> },
    { key: "quests", header: "Quests", numeric: true, sortable: true, cell: count },
    { key: "confirmed", header: "Confirmed", cell: (x) => confirmedCell(x, confirmations) },
    { key: "id", header: "ID", numeric: true, sortable: true, cell: (x) => x.questLineId },
  ];
  const keep = Object.fromEntries(new URLSearchParams(href({ ...q, q: undefined, page: 1 }).split("?")[1] ?? ""));
  const strip = <ResultStrip total={rows.length} noun={rows.length === 1 ? "quest chain" : "quest chains"} page={q.page} perPage={PER_PAGE} href={(page) => href({ ...q, page })} label="Quest chain pages" />;
  const chips = q.q ? [{ label: `Name: ${q.q}`, href: here({ q: undefined }) }] : [];
  const empty = !catalog ? <Unreadable />
    : q.q ? <NoMatches noun="quest chains" chips={chips} clearHref="/database/quest-chains" />
    : <NoObservations>{noneListed("quest chain")}</NoObservations>;

  return (
    <Container width="data">
      <article>
        <DataTitle title="Quest chains" aside={strip} />
        {catalog && !confirmations && <ConfirmationsUnread />}
        <FilterBar
          label="Quest chain filters"
          search={{ action: "/database/quest-chains", value: q.q, placeholder: "Name or id", label: "Filter by name or id", keep }}
          controls={[]}
          active={q.q ? 1 : 0}
          clearHref="/database/quest-chains"
        />
        <div className="mt-2">
          <DataTable
            dense
            caption={listCaption("quest chains", rows, confirmations)}
            columns={columns}
            rows={shown}
            rowKey={(x) => String(x.questLineId)}
            sort={{ key: sort.key, direction: sort.desc ? "desc" : "asc" }}
            sortHref={(k, dir) => here({ sort: nextSort(k, dir, DEFAULT_SORT) })}
            meta={(x) => `${count(x)} quests · ID ${x.questLineId}`}
            empty={empty}
          />
        </div>
        {pages > 1 && <div className="mt-2">{strip}</div>}
      </article>
    </Container>
  );
}
