import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { objectList } from "../../../../../kb/src/object-page";
import { Container, DataTable, DataTitle, FilterBar, ResultStrip, type Column } from "@/components/ui";
import type { Crumb } from "@/lib/jsonld";
import { loadObjectFacts } from "@/lib/objects";
import { objectNames } from "@/lib/names";
import { LINK } from "../entity";
import { listHref, listMetadata, listQuery, nextSort, NoMatches, NoObservations, PER_PAGE, sortParam, sortRows, Unreadable, type ListQuery, type Search } from "../list-parts";

const META = {
  title: "WoW Forever objects: chests, herbs and ore",
  description: "Chests, herbs, ore veins and fishing pools players looted in WoW: Forever, with what came out of them. A frequency is public after 3 install reports.",
  path: "/database/objects",
};
export const dynamic = "force-dynamic";

const TRAIL: Crumb[] = [{ name: "Home", path: "/" }, { name: "Database", path: "/database" }, { name: "Objects", path: "/database/objects" }];
const SORTS = ["id", "windows", "items", "installs"] as const;
type Sort = (typeof SORTS)[number];
// Most-looted first, as the list has always read.
const DEFAULT_SORT = { key: "windows" as Sort, desc: true };

const href = (q: Partial<ListQuery<Sort>>) => listHref("/database/objects", [["q", q.q], ["sort", sortParam(q.sort)], ["page", q.page && q.page > 1 ? String(q.page) : undefined]]);

export async function generateMetadata(props: { searchParams?: Promise<Search> }): Promise<Metadata> {
  const q = listQuery((await props.searchParams) ?? {}, SORTS);
  return listMetadata(META, Boolean(q) && !q!.q && !q!.sort, q?.page);
}

type Row = ReturnType<typeof objectList>[number];

export default async function ObjectsPage(props: { searchParams?: Promise<Search> }) {
  const q = listQuery((await props.searchParams) ?? {}, SORTS);
  if (!q) notFound();
  const facts = await loadObjectFacts();
  const all = facts.unreachable ? [] : objectList(facts);
  const names = objectNames(facts);
  // The box takes an id: an object is found by its number, whether or not players agree on a name yet.
  const id = q.q && /^#?\d+$/.test(q.q) ? Number(q.q.replace("#", "")) : null;
  const matched = q.q ? all.filter((o) => o.objectId === id) : all;
  const sort = q.sort ?? DEFAULT_SORT;
  const rows = sortRows(matched, (o) => (sort.key === "windows" ? o.windows : sort.key === "items" ? o.items : sort.key === "installs" ? o.reporters : o.objectId), sort.desc, (o) => o.objectId);
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  if (q.page > pages) notFound();
  const shown = rows.slice((q.page - 1) * PER_PAGE, q.page * PER_PAGE);
  const here = (over: Partial<ListQuery<Sort>>) => href({ ...q, page: 1, ...over });

  const columns: Column<Row>[] = [
    { key: "id", header: "Object", sortable: true, cell: (o) => <Link href={`/database/objects/${o.objectId}`} className={LINK}>{names.get(o.objectId) ?? `Object ${o.objectId}`}</Link> },
    { key: "windows", header: "Loot windows", numeric: true, sortable: true, cell: (o) => o.windows },
    { key: "items", header: "Items seen", numeric: true, sortable: true, cell: (o) => o.items },
    { key: "installs", header: "Installs", numeric: true, sortable: true, cell: (o) => o.reporters },
  ];
  const keep = Object.fromEntries(new URLSearchParams(href({ ...q, q: undefined, page: 1 }).split("?")[1] ?? ""));
  const strip = <ResultStrip total={rows.length} noun={rows.length === 1 ? "object" : "objects"} page={q.page} perPage={PER_PAGE} href={(page) => href({ ...q, page })} label="Object pages" />;
  const empty = facts.unreachable ? <Unreadable />
    : q.q ? <>
        <NoMatches noun="objects" chips={[{ label: `Id: ${q.q}`, href: here({ q: undefined }) }]} clearHref="/database/objects" />
        {id !== null && <p className="pb-4 text-cell"><Link href={`/database/objects/${id}`} className={LINK}>Open object {id}</Link></p>}
      </>
    : <NoObservations>No object has public loot observations yet; each needs loot windows from 3 installs.</NoObservations>;

  return (
    <Container width="data">
      <article>
        <DataTitle title="Objects" trail={TRAIL} aside={strip} />
        <FilterBar
          label="Object filters"
          search={{ action: "/database/objects", value: q.q, placeholder: "Object id", label: "Find an object by id", keep }}
          controls={[]}
          active={q.q ? 1 : 0}
          clearHref="/database/objects"
        />
        <div className="mt-2">
          <DataTable
            dense
            caption={`Objects with public loot observations: ${rows.length}`}
            columns={columns}
            rows={shown}
            rowKey={(o) => String(o.objectId)}
            sort={{ key: sort.key, direction: sort.desc ? "desc" : "asc" }}
            sortHref={(k, dir) => here({ sort: nextSort(k, dir, DEFAULT_SORT) })}
            meta={(o) => `${o.windows} loot windows · ${o.items} items · ${o.reporters} install IDs`}
            empty={empty}
          />
        </div>
        {pages > 1 && <div className="mt-2">{strip}</div>}
      </article>
    </Container>
  );
}
