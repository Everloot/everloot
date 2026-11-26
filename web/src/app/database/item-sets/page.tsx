import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ClientItemSet } from "@kb/client-item-sets";
import { Container, DataTable, DataTitle, FilterBar, ResultStrip, type Column } from "@/components/ui";
import { classLabel, type ClassSlug } from "@/lib/class-context";
import { loadItemSetNames } from "@/lib/game-assets";
import { itemSetClasses, itemSetHref, ITEM_SETS, ITEM_SETS_BUILD, ITEM_SETS_PATH } from "@/lib/item-sets";
import { CLIENT_LAYER } from "@/lib/items";
import { LINK } from "../entity";
import { byRank, listHref, listMetadata, listQuery, nameMatches, nextSort, NoMatches, PER_PAGE, Respelled, sortParam, sortRows, type ListQuery, type Search } from "../list-parts";

const META = { title: "WoW Forever Item Set List", description: "Item sets in WoW: Forever by name and ID, with their pieces and set bonuses. From the game files: found in game files, unconfirmed.", path: ITEM_SETS_PATH };
export const dynamic = "force-dynamic";

const SORTS = ["name", "pieces", "id"] as const;
type Sort = (typeof SORTS)[number];
const DEFAULT_SORT = { key: "id" as Sort, desc: false };

const href = (q: Partial<ListQuery<Sort>>) => listHref(ITEM_SETS_PATH, [
  ["q", q.q], ["sort", sortParam(q.sort)], ["page", q.page && q.page > 1 ? String(q.page) : undefined],
]);

export async function generateMetadata(props: { searchParams?: Promise<Search> }): Promise<Metadata> {
  const q = listQuery((await props.searchParams) ?? {}, SORTS);
  return listMetadata(META, Boolean(q) && !q!.q && !q!.sort, q?.page);
}

/** Every item set the game files list (data/game-data/client-item-sets.json), named from the private set names file. */
export default async function ItemSetListPage(props: { searchParams?: Promise<Search> }) {
  const q = listQuery((await props.searchParams) ?? {}, SORTS);
  if (!q) notFound();
  const names = await loadItemSetNames(CLIENT_LAYER.build.version);
  const nameOf = (s: ClientItemSet) => names?.names.get(s.id) ?? `Item set ${s.id}`;
  const text = q.q?.toLowerCase();
  const id = text && /^#?\d+$/.test(text) ? Number(text.replace("#", "")) : null;
  const { ranked, respelled } = nameMatches(ITEM_SETS, text, id, nameOf);
  const matched = ITEM_SETS.filter((s) => !text || (id !== null ? s.id === id : ranked!.has(s)));
  const sort = q.sort ?? DEFAULT_SORT;
  const key = (s: ClientItemSet) => (sort.key === "name" ? nameOf(s).toLowerCase() : sort.key === "pieces" ? s.items.length : s.id);
  const rows = byRank(sortRows([...matched], key, sort.desc, (s) => s.id), ranked, Boolean(q.sort));
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  if (q.page > pages) notFound();
  const shown = rows.slice((q.page - 1) * PER_PAGE, q.page * PER_PAGE);
  const here = (over: Partial<ListQuery<Sort>>) => href({ ...q, page: 1, ...over });

  const columns: Column<ClientItemSet>[] = [
    { key: "name", header: "Name", sortable: true, cell: (s) => <Link prefetch={false} href={itemSetHref(s.id)} className={LINK}>{nameOf(s)}</Link> },
    { key: "pieces", header: "Pieces", numeric: true, sortable: true, cell: (s) => s.items.length },
    { key: "bonuses", header: "Bonuses", numeric: true, cell: (s) => s.bonuses.length },
    { key: "classes", header: "Classes", cell: (s) => (itemSetClasses(s.items) as ClassSlug[] | null)?.map(classLabel).join(", ") ?? "—" },
    { key: "id", header: "ID", numeric: true, sortable: true, cell: (s) => s.id },
  ];
  const keep = Object.fromEntries(new URLSearchParams(href({ ...q, q: undefined, page: 1 }).split("?")[1] ?? ""));
  const strip = <ResultStrip total={rows.length} noun={rows.length === 1 ? "item set" : "item sets"} page={q.page} perPage={PER_PAGE} href={(page) => href({ ...q, page })} label="Item set pages" />;
  const chips = q.q ? [{ label: `Name: ${q.q}`, href: here({ q: undefined }) }] : [];

  return (
    <Container width="data">
      <article>
        <DataTitle title="Item sets" aside={strip} />
        <p className="mb-4 max-w-[70ch] text-meta text-fg-2">
          Every item set the game files list, build {ITEM_SETS_BUILD}: found in game files, unconfirmed. A set&apos;s page
          lists its pieces and its bonuses with the pieces each needs.
          {!names && " The set names could not be read just now, so the sets are listed by id."}
        </p>
        <FilterBar
          label="Item set filters"
          search={{ action: ITEM_SETS_PATH, value: q.q, placeholder: "Name or id", label: "Filter by name or id", keep }}
          controls={[]}
          active={q.q ? 1 : 0}
          clearHref={ITEM_SETS_PATH}
        />
        {respelled && rows.length > 0 && <Respelled q={respelled} />}
        <div className="mt-2">
          <DataTable
            dense
            caption={`Item sets, ${rows.length} found in game files, unconfirmed`}
            columns={columns}
            rows={shown}
            rowKey={(s) => String(s.id)}
            sort={{ key: sort.key, direction: sort.desc ? "desc" : "asc" }}
            sortHref={(k, dir) => here({ sort: nextSort(k, dir, DEFAULT_SORT) })}
            meta={(s) => `${s.items.length} pieces · ID ${s.id}`}
            empty={<NoMatches noun="item sets" chips={chips} clearHref={ITEM_SETS_PATH} />}
          />
        </div>
        {pages > 1 && <div className="mt-2">{strip}</div>}
      </article>
    </Container>
  );
}
