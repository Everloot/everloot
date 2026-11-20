import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Container, DataTable, DataTitle, FilterBar, ResultStrip, type Column } from "@/components/ui";
import { loadWorldFacts } from "@/lib/rollup-compute";
import { npcRows, publicVendors } from "@/lib/world-lists";
import { LINK } from "../entity";
import { listHref, listMetadata, listQuery, nextSort, NoMatches, NoObservations, PER_PAGE, sortParam, sortRows, Unreadable, type ListQuery, type Search } from "../list-parts";

const META = { title: "WoW Forever Vendor Lookup", description: "Look up a WoW: Forever vendor by id. A price is shown only after three installs agree on the item and the price in copper.", path: "/database/vendors" };
export const dynamic = "force-dynamic";

const SORTS = ["name", "zone", "items", "id"] as const;
type Sort = (typeof SORTS)[number];
const DEFAULT_SORT = { key: "id" as Sort, desc: false };

const href = (q: Partial<ListQuery<Sort>>) => listHref("/database/vendors", [["q", q.q], ["sort", sortParam(q.sort)], ["page", q.page && q.page > 1 ? String(q.page) : undefined]]);

export async function generateMetadata(props: { searchParams?: Promise<Search> }): Promise<Metadata> {
  const q = listQuery((await props.searchParams) ?? {}, SORTS);
  return listMetadata(META, Boolean(q) && !q!.q && !q!.sort, q?.page);
}

interface VendorRow { id: number; name: string | null; zone: string | null; items: number }

export default async function VendorListPage(props: { searchParams?: Promise<Search> }) {
  const q = listQuery((await props.searchParams) ?? {}, SORTS);
  if (!q) notFound();
  const facts = await loadWorldFacts();
  const npcs = new Map((facts.unreachable ? [] : npcRows(facts, [])).map((n) => [n.npcId, n]));
  const all: VendorRow[] = (facts.unreachable ? [] : publicVendors(facts)).map((v) => ({
    id: v.vendorNpcId, name: npcs.get(v.vendorNpcId)?.name ?? null, zone: npcs.get(v.vendorNpcId)?.zone?.name ?? null, items: new Set(v.offers.map((o) => o.itemId)).size,
  }));
  const text = q.q?.toLowerCase();
  const id = text && /^#?\d+$/.test(text) ? Number(text.replace("#", "")) : null;
  const matched = all.filter((v) => !text || (id !== null ? v.id === id : Boolean(v.name?.toLowerCase().includes(text))));
  const sort = q.sort ?? DEFAULT_SORT;
  const rows = sortRows(matched, (v) => (sort.key === "name" ? v.name?.toLowerCase() ?? null : sort.key === "zone" ? v.zone : sort.key === "items" ? v.items : v.id), sort.desc, (v) => v.id);
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  if (q.page > pages) notFound();
  const shown = rows.slice((q.page - 1) * PER_PAGE, q.page * PER_PAGE);
  const here = (over: Partial<ListQuery<Sort>>) => href({ ...q, page: 1, ...over });

  const dash = <span className="text-muted">—</span>;
  const columns: Column<VendorRow>[] = [
    { key: "name", header: "Vendor", sortable: true, cell: (v) => <Link prefetch={false} href={`/database/vendors/${v.id}`} className={LINK}>{v.name ?? `Vendor NPC ${v.id}`}</Link> },
    { key: "zone", header: "Zone", sortable: true, cell: (v) => v.zone ?? dash },
    { key: "items", header: "Items", numeric: true, sortable: true, cell: (v) => v.items },
    { key: "id", header: "ID", numeric: true, sortable: true, cell: (v) => v.id },
  ];
  const keep = Object.fromEntries(new URLSearchParams(href({ ...q, q: undefined, page: 1 }).split("?")[1] ?? ""));
  const strip = <ResultStrip total={rows.length} noun={rows.length === 1 ? "vendor" : "vendors"} page={q.page} perPage={PER_PAGE} href={(page) => href({ ...q, page })} label="Vendor pages" />;
  const empty = facts.unreachable ? <Unreadable />
    : q.q ? <NoMatches noun="vendors" chips={[{ label: `Name: ${q.q}`, href: here({ q: undefined }) }]} clearHref="/database/vendors" />
    : <NoObservations>No vendor has an agreed price yet; each shows here once 3 installs agree on an item and its copper.</NoObservations>;

  return (
    <Container width="data">
      <article>
        <DataTitle title="Vendors" aside={strip} />
        <FilterBar
          label="Vendor filters"
          search={{ action: "/database/vendors", value: q.q, placeholder: "Name or id", label: "Filter by name or id", keep }}
          controls={[]}
          active={q.q ? 1 : 0}
          clearHref="/database/vendors"
        />
        {!facts.unreachable && (
          <p data-list-rule className="mt-2 max-w-reading text-meta text-fg-2">
            A vendor is listed once 3 installs agree on an item and its price. <Link prefetch={false} href="/addon" className={LINK}>Get the addon</Link>.
          </p>
        )}
        <div className="mt-2">
          <DataTable
            dense
            caption={`Vendors with agreed prices: ${rows.length}`}
            columns={columns}
            rows={shown}
            rowKey={(v) => String(v.id)}
            sort={{ key: sort.key, direction: sort.desc ? "desc" : "asc" }}
            sortHref={(k, dir) => here({ sort: nextSort(k, dir, DEFAULT_SORT) })}
            meta={(v) => [v.zone, `${v.items} item${v.items === 1 ? "" : "s"}`, `ID ${v.id}`].filter(Boolean).join(" · ")}
            empty={empty}
          />
        </div>
        {pages > 1 && <div className="mt-2">{strip}</div>}
      </article>
    </Container>
  );
}
