import type { Metadata } from "next";
import { Container, DataTable, DataTitle, type Column } from "@/components/ui";
import { CoinText } from "@/components/ui/Coins";
import { loadBlizzardHouseItems, type BlizzardHouseItem } from "@/lib/blizzard-auctions";
import { BLIZZARD_HOUSES, houseLabel } from "@/lib/blizzard-houses";
import { trailFor } from "@/lib/breadcrumbs";
import { shownItemName } from "@/lib/items";
import { loadShownNames } from "@/lib/shown-item-names";
import { formatCopper } from "../../../../kb/src/market";
import { blizzardTime } from "./[id]/blizzard-auctions";

// Same ad-free document boundary and shared-cache exclusion as the item page.
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Blizzard auction house data",
  description: "Browse Blizzard's WoW: Forever auction house prices by region and house.",
  robots: { index: false, follow: false },
};

type Search = Record<string, string | string[] | undefined>;
const one = (value: Search[string]) => Array.isArray(value) ? value[0] ?? "" : value ?? "";
const SORTS = { minUnit: "Min price", typicalUnit: "Typical price", quantity: "Quantity", auctions: "Auctions" };
const PER_PAGE = 50;
type NamedRow = BlizzardHouseItem & { name: string };

export default async function BlizzardAuctionBrowse({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const region = one(search.region) === "eu" ? "eu" : "us";
  const requestedHouse = Number(one(search.house));
  const house = BLIZZARD_HOUSES.has(requestedHouse) ? requestedHouse : 110;
  const q = one(search.q).trim().slice(0, 100);
  const sort = Object.hasOwn(SORTS, one(search.sort)) ? one(search.sort) as keyof typeof SORTS : "minUnit";
  const dir = one(search.dir) === "desc" ? "desc" : "asc";
  const [read, names] = await Promise.all([loadBlizzardHouseItems(region, house), loadShownNames()]);
  const allRows: NamedRow[] = read.ok ? read.rows.map((r) => ({
    ...r, name: shownItemName(r.itemId, names.agreed, names.matched?.names)?.name ?? `Item ${r.itemId}`,
  })) : [];
  const rows = allRows.filter((r) => r.name.toLocaleLowerCase("en-US").includes(q.toLocaleLowerCase("en-US")))
    .sort((a, b) => (a[sort] - b[sort]) * (dir === "asc" ? 1 : -1) || a.itemId - b.itemId || a.kind.localeCompare(b.kind));
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const requestedPage = Number(one(search.page));
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, pages) : 1;
  const href = (p: number) => `/blizzard-auctions?${new URLSearchParams({ region, house: String(house), q, sort, dir, page: String(p) })}`;
  const columns: Column<NamedRow>[] = [
    { key: "item", header: "Item", cell: (r) => <a className="text-fg underline underline-offset-4" href={`/blizzard-auctions/${r.itemId}`}>{r.name}</a> },
    { key: "kind", header: "Document", cell: (r) => r.kind === "items" ? "Items" : "Commodities" },
    { key: "min", header: "Min unit price", numeric: true, cell: (r) => <CoinText text={formatCopper(r.minUnit)} /> },
    { key: "typical", header: "Typical unit price", numeric: true, cell: (r) => <CoinText text={formatCopper(r.typicalUnit)} /> },
    { key: "quantity", header: "Quantity", numeric: true, cell: (r) => r.quantity.toLocaleString("en-US") },
    { key: "auctions", header: "Auctions", numeric: true, cell: (r) => r.auctions.toLocaleString("en-US") },
  ];
  const asOf = [...new Map(allRows.map((r) => [r.kind, r.snapshotAt])).entries()];
  return <Container>
    <DataTitle title="Blizzard auction house data" trail={trailFor("/blizzard-auctions")!} />
    <p className="mb-3 text-meta text-fg-2">Official unit buyout prices, kept apart from player-reported prices. Typical is the median unit price by quantity.</p>
    <form method="get" action="/blizzard-auctions" className="mb-4 flex flex-wrap items-end gap-3">
      <label className="text-meta">Region <select className="ctl" name="region" defaultValue={region}><option value="us">US</option><option value="eu">EU</option></select></label>
      <label className="text-meta">House <select className="ctl" name="house" defaultValue={house}>{[...BLIZZARD_HOUSES.keys()].map((id) => <option key={id} value={id}>{houseLabel(id, "")}</option>)}</select></label>
      <label className="text-meta">Item name <input className="ctl" name="q" type="search" defaultValue={q} maxLength={100} /></label>
      <label className="text-meta">Sort by <select className="ctl" name="sort" defaultValue={sort}>{Object.entries(SORTS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label className="text-meta">Order <select className="ctl" name="dir" defaultValue={dir}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label>
      <button type="submit" className="ctl border border-line px-3">Browse</button>
    </form>
    {names.degraded && <p className="mb-3 text-meta text-fg-2">Some item names could not be read. Name search may be incomplete; unnamed items show their IDs.</p>}
    {!read.ok ? <p role="status">{read.reason === "unavailable" ? "Blizzard auction house data is not available yet." : "Blizzard auction house data could not be read. Try again in a few minutes."}</p> : <>
      <p className="mb-3 text-meta text-fg-2">{region.toUpperCase()} · {houseLabel(house, "")}{asOf.map(([kind, at]) => <span key={kind}> · {kind === "items" ? "Items" : "Commodities"} as of <time dateTime={at}>{blizzardTime(at)}</time></span>)}</p>
      <DataTable caption="Blizzard auction house items" columns={columns} rows={rows.slice((page - 1) * PER_PAGE, page * PER_PAGE)} rowKey={(r) => `${r.itemId}:${r.kind}`}
        empty={<p>{q ? "No items match this name." : "No current Blizzard auction house data for this house yet."}</p>} />
      <nav aria-label="Auction results pages" className="mt-3 flex gap-4 text-meta">
        {page > 1 && <a href={href(page - 1)}>Previous</a>}
        <span>Page {page} of {pages} · {rows.length.toLocaleString("en-US")} results</span>
        {page < pages && <a href={href(page + 1)}>Next</a>}
      </nav>
    </>}
    <p className="mt-4 text-meta text-fg-2">Data from Blizzard Entertainment</p>
  </Container>;
}
