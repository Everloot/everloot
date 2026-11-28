import type { Metadata } from "next";
import Link from "@/components/Link";
import { notFound } from "next/navigation";
import { trailFor } from "@/lib/breadcrumbs";
import { objectList } from "@kb/object-page";
import { Container, DataTable, DataTitle, FilterBar, ResultStrip, type Column, stripBelow } from "@/components/ui";
import { loadObjectFacts, OBJECT_KIND_LABELS, objectTraits, type ObjectTraits } from "@/lib/objects";
import { objectNames } from "@/lib/names";
import { MAX_QUERY } from "@/lib/lore";
import { LINK } from "../entity";
import { byRank, nameMatches, Respelled, listHref, listMetadata, listQuery, NameCell, nextSort, NoMatches, NoObservations, paged, plural, pageParams, sortRows, Unreadable, type ListQuery, type Search } from "../list-parts";

const META = {
  title: "WoW Forever objects: chests, herbs and ore",
  description: "Chests, herbs, ore veins and fishing pools players looted in WoW: Forever, with what came out of them. A frequency is public after 3 install reports.",
  path: "/database/objects",
};
export const dynamic = "force-dynamic";

// "id" has no column of its own: it is kept so a link to the list sorted by id still opens.
const SORTS = ["name", "id", "type", "zone", "skill", "windows", "items", "installs"] as const;
type Sort = (typeof SORTS)[number];
// A to Z by the name players agree on; an object with no agreed name yet comes after the named ones.
const DEFAULT_SORT = { key: "name" as Sort, desc: false };
const NO_NAME = "No agreed name yet. A name needs 3 installs reporting the same one.";

const href = (q: Partial<ListQuery<Sort>>) => listHref("/database/objects", [["q", q.q], ...pageParams(q)]);

/** Keep the full search query when following an all-matches link; shared sort/page validation still applies. */
function objectQuery(search: Search) {
  const q = listQuery(search, SORTS);
  if (q && typeof search.q === "string") q.q = search.q.trim().slice(0, MAX_QUERY) || undefined;
  return q;
}

export async function generateMetadata(props: { searchParams?: Promise<Search> }): Promise<Metadata> {
  const q = objectQuery((await props.searchParams) ?? {});
  return listMetadata(META, Boolean(q) && !q!.q && !q!.sort && !q!.per, q?.page);
}

type Row = ReturnType<typeof objectList>[number];

export default async function ObjectsPage(props: { searchParams?: Promise<Search> }) {
  const q = objectQuery((await props.searchParams) ?? {});
  if (!q) notFound();
  const facts = await loadObjectFacts();
  const all = facts.unreachable ? [] : objectList(facts);
  const names = objectNames(facts);
  // Type, zone and the skill players had: each only where 3 installs agree (objectTraits).
  const traits = facts.unreachable ? new Map<number, ObjectTraits>() : objectTraits(facts);
  const kindOf = (o: Row) => { const k = traits.get(o.objectId)?.kind; return k ? OBJECT_KIND_LABELS[k] : null; };
  const zoneOf = (o: Row) => { const z = traits.get(o.objectId)?.zones ?? []; return z.length > 1 ? `${z[0]!.name} +${z.length - 1}` : z[0]?.name ?? null; };
  const skillOf = (o: Row) => traits.get(o.objectId)?.skill?.min ?? null;
  // Numbers still find unnamed objects; text matches only names players agree on.
  const id = q.q && /^#?\d+$/.test(q.q) ? Number(q.q.replace("#", "")) : null;
  const text = q.q?.toLowerCase();
  const { ranked, respelled } = nameMatches(all, text, id, (o) => names.get(o.objectId));
  const matched = text ? all.filter((o) => o.objectId === id || ranked!.has(o)) : all;
  const sort = q.sort ?? DEFAULT_SORT;
  const key = (o: Row): string | number | null => sort.key === "name" ? names.get(o.objectId)?.toLowerCase() ?? null
    : sort.key === "type" ? kindOf(o) : sort.key === "zone" ? zoneOf(o) : sort.key === "skill" ? skillOf(o)
    : sort.key === "windows" ? o.windows : sort.key === "items" ? o.items : sort.key === "installs" ? o.reporters : o.objectId;
  const rows = byRank(sortRows(matched, key, sort.desc, (o) => o.objectId), ranked, Boolean(q.sort));
  const { shown, pages, per } = paged(rows, q);
  const here = (over: Partial<ListQuery<Sort>>) => href({ ...q, page: 1, ...over });

  const dash = <span className="text-muted">—</span>;
  const columns: Column<Row>[] = [
    { key: "name", header: "Object", sortable: true, cell: (o) => {
      const name = names.get(o.objectId);
      // An object with no agreed name is listed by its id, with a line saying why.
      return (
        <span title={name ? undefined : NO_NAME}>
          <NameCell href={`/database/objects/${o.objectId}`} after={!name && <span className="text-meta text-muted">no agreed name yet</span>}>{name ?? `Object ${o.objectId}`}</NameCell>
        </span>
      );
    } },
    { key: "type", header: "Type", sortable: true, cell: (o) => kindOf(o) ?? dash },
    // The lowest rank among 3 or more installs that gathered it: what players had, not a requirement.
    { key: "skill", header: "Lowest skill", numeric: true, sortable: true, cell: (o) => skillOf(o) ?? dash },
    { key: "windows", header: "Loot windows", numeric: true, sortable: true, cell: (o) => o.windows },
    { key: "items", header: "Items seen", numeric: true, sortable: true, cell: (o) => o.items },
    { key: "zone", header: "Zone", sortable: true, cell: (o) => zoneOf(o) ?? dash },
    { key: "installs", header: "Installs", numeric: true, sortable: true, cell: (o) => o.reporters },
  ];
  const keep = Object.fromEntries(new URLSearchParams(href({ ...q, q: undefined, page: 1 }).split("?")[1] ?? ""));
  const strip = <ResultStrip total={rows.length} noun={rows.length === 1 ? "object" : "objects"} page={q.page} perPage={per} href={(page) => href({ ...q, page })} sizeHref={(n) => href({ ...q, per: n, page: 1 })} label="Object pages" />;
  const empty = facts.unreachable ? <Unreadable />
    : q.q ? <>
        <NoMatches noun="objects" chips={[{ label: `${id !== null ? "Id" : "Name"}: ${q.q}`, href: here({ q: undefined }) }]} clearHref="/database/objects" />
        {id !== null && <p className="pb-4 text-cell"><Link prefetch={false} href={`/database/objects/${id}`} className={LINK}>Open object {id}</Link></p>}
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
        {respelled && rows.length > 0 && <Respelled q={respelled} />}
        <div className="mt-2">
          <DataTable
            dense
            caption={`Objects with public loot observations: ${rows.length}`}
            columns={columns}
            rows={shown}
            rowKey={(o) => String(o.objectId)}
            sort={{ key: sort.key, direction: sort.desc ? "desc" : "asc" }}
            sortHref={(k, dir) => here({ sort: nextSort(k, dir, DEFAULT_SORT) })}
            meta={(o) => [kindOf(o), zoneOf(o), `${plural(o.windows, "loot window")} · ${plural(o.items, "item")} · ${plural(o.reporters, "install ID")}`].filter(Boolean).join(" · ")}
            empty={empty}
          />
        </div>
        {pages > 1 && <div className="mt-2">{stripBelow(strip)}</div>}
      </article>
    </Container>
  );
}
