import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { trailFor } from "@/lib/breadcrumbs";
import { objectList } from "../../../../../kb/src/object-page";
import { Container, DataTable, DataTitle, FilterBar, ResultStrip, type Column } from "@/components/ui";
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

// "id" has no column of its own: it is kept so a link to the list sorted by id still opens.
const SORTS = ["name", "id", "windows", "items", "installs"] as const;
type Sort = (typeof SORTS)[number];
// A to Z by the name players agree on; an object with no agreed name yet comes after the named ones.
const DEFAULT_SORT = { key: "name" as Sort, desc: false };
const NO_NAME = "No agreed name yet. A name needs 3 installs reporting the same one.";

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
  // Numbers still find unnamed objects; text matches only names players agree on.
  const id = q.q && /^#?\d+$/.test(q.q) ? Number(q.q.replace("#", "")) : null;
  const text = q.q?.toLowerCase();
  const matched = text ? all.filter((o) => id !== null ? o.objectId === id : names.get(o.objectId)?.toLowerCase().includes(text)) : all;
  const sort = q.sort ?? DEFAULT_SORT;
  const key = (o: Row): string | number | null => sort.key === "name" ? names.get(o.objectId)?.toLowerCase() ?? null
    : sort.key === "windows" ? o.windows : sort.key === "items" ? o.items : sort.key === "installs" ? o.reporters : o.objectId;
  const rows = sortRows(matched, key, sort.desc, (o) => o.objectId);
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  if (q.page > pages) notFound();
  const shown = rows.slice((q.page - 1) * PER_PAGE, q.page * PER_PAGE);
  const here = (over: Partial<ListQuery<Sort>>) => href({ ...q, page: 1, ...over });

  const columns: Column<Row>[] = [
    { key: "name", header: "Object", sortable: true, cell: (o) => {
      const name = names.get(o.objectId);
      const link = <Link href={`/database/objects/${o.objectId}`} className={LINK}>{name ?? `Object ${o.objectId}`}</Link>;
      // An object with no agreed name is listed by its id, with a line saying why.
      return name ? link : <span className="inline-flex flex-wrap items-baseline gap-x-2" title={NO_NAME}>{link}<span className="text-meta text-muted">no agreed name yet</span></span>;
    } },
    { key: "windows", header: "Loot windows", numeric: true, sortable: true, cell: (o) => o.windows },
    { key: "items", header: "Items seen", numeric: true, sortable: true, cell: (o) => o.items },
    { key: "installs", header: "Installs", numeric: true, sortable: true, cell: (o) => o.reporters },
  ];
  const keep = Object.fromEntries(new URLSearchParams(href({ ...q, q: undefined, page: 1 }).split("?")[1] ?? ""));
  const strip = <ResultStrip total={rows.length} noun={rows.length === 1 ? "object" : "objects"} page={q.page} perPage={PER_PAGE} href={(page) => href({ ...q, page })} label="Object pages" />;
  const empty = facts.unreachable ? <Unreadable />
    : q.q ? <>
        <NoMatches noun="objects" chips={[{ label: `${id !== null ? "Id" : "Name"}: ${q.q}`, href: here({ q: undefined }) }]} clearHref="/database/objects" />
        {id !== null && <p className="pb-4 text-cell"><Link href={`/database/objects/${id}`} className={LINK}>Open object {id}</Link></p>}
      </>
    : <NoObservations>No object has public loot observations yet; each needs loot windows from 3 installs.</NoObservations>;

  return (
    <Container width="data">
      <article>
        <DataTitle title="Objects" trail={trailFor("/database/objects")!} aside={strip} />
        <FilterBar
          label="Object filters"
          search={{ action: "/database/objects", value: q.q, placeholder: "Name or id", label: "Find an object by name or id", keep }}
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
