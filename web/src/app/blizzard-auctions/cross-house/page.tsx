import type { Metadata } from "next";
import { Container, DataTable, Disclosure, PageHeader, type Column } from "@/components/ui";
import { CoinText } from "@/components/ui/Coins";
import { loadBlizzardHouseItems } from "@/lib/blizzard-auctions";
import { BLIZZARD_HOUSES, blizzardMarketQuery, houseLabel } from "@/lib/blizzard-houses";
import { loadShownNames } from "@/lib/shown-item-names";
import { shownItemName } from "@/lib/items";
import { formatCopper } from "@kb/market";
import { blizzardTime } from "../[id]/blizzard-auctions";
import { blackwaterHouse, crossHousePrices, factionHouseForComparison } from "./compare";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Blackwater price comparison",
  description: "Compare one-unit asking prices between Blackwater and a faction auction house.",
  robots: { index: false, follow: false },
};

const PATH = "/blizzard-auctions/cross-house";
type Search = Record<string, string | string[] | undefined>;
type Deal = ReturnType<typeof crossHousePrices>[number];
const one = (v: Search[string]) => typeof v === "string" ? v : "";
const coins = (n: number) => <CoinText text={formatCopper(n)} />;

export default async function CrossHousePage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const region = one(search.region) === "eu" ? "eu" : "us";
  const rawHouse = one(search.house);
  const faction = factionHouseForComparison(/^\d{3}$/.test(rawHouse) ? Number(rawHouse) : 110);
  const neutral = blackwaterHouse(faction)!;
  const name = (house: number) => houseLabel(house, "");
  const filter = one(search.q).trim().slice(0, 80);
  const rawDeposit = one(search.deposit).trim().slice(0, 10);
  const deposit = /^\d{1,9}$/.test(rawDeposit) ? Number(rawDeposit) : null;
  const [first, second, names] = await Promise.all([
    loadBlizzardHouseItems(region, faction), loadBlizzardHouseItems(region, neutral), loadShownNames(),
  ]);
  const itemName = (id: number) => shownItemName(id, names.agreed, names.matched?.names)?.name ?? `Item ${id}`;
  const both = first.ok && second.ok;
  const rows = both ? crossHousePrices(first.rows, second.rows, Date.now(), deposit)
    .filter((row) => !filter || String(row.itemId) === filter || itemName(row.itemId).toLowerCase().includes(filter.toLowerCase())) : [];
  const buyHouse = (row: Deal) => row.to === "blackwater" ? faction : neutral;
  const sellHouse = (row: Deal) => row.to === "blackwater" ? neutral : faction;
  const columns: Column<Deal>[] = [
    { key: "item", header: "Item", cell: (row) => <a className="underline underline-offset-4" href={`/blizzard-auctions/${row.itemId}?${blizzardMarketQuery({ region, house: buyHouse(row) })}`}>{itemName(row.itemId)}</a> },
    { key: "buy", header: "Source min per unit", cell: (row) => <>{name(buyHouse(row))} · {coins(row.buy)}<br /><time className="text-meta text-fg-2" dateTime={row.buyAt}>{blizzardTime(row.buyAt)}</time></> },
    { key: "sell", header: "Destination typical per unit", cell: (row) => <>{name(sellHouse(row))} · {coins(row.resale)}<br /><time className="text-meta text-fg-2" dateTime={row.sellAt}>{blizzardTime(row.sellAt)}</time></> },
    { key: "net", header: deposit === null ? "Est. before deposit" : "Est. after deposit", numeric: true, cell: (row) => coins(row.net) },
    { key: "breakEven", header: "Break-even ask", numeric: true, cell: (row) => coins(row.breakEven) },
    { key: "details", header: "Calculation", cell: (row) => <Disclosure summary="Show calculation">
      <p>Typical ask {coins(row.resale)} minus {Math.round(row.cut * 100)}% estimated sale cut, purchase {coins(row.buy)}{deposit === null ? ", deposit unknown" : <> and {coins(deposit)} deposit</>}.</p>
      <p>{row.buyQuantity.toLocaleString("en-US")} units listed at the source and {row.sellQuantity.toLocaleString("en-US")} at the destination across price levels.</p>
    </Disclosure> },
  ];
  return <Container width="data">
    <PageHeader title="Blackwater price comparison" lede="Compare one unit between a faction auction house and Blackwater on the same ruleset." />
    <p className="mb-3 text-meta"><a className="underline underline-offset-4" href={`/blizzard-auctions?${blizzardMarketQuery({ region, house: faction })}`}>Back to Blizzard auction prices</a></p>
    <form method="get" action={PATH} className="mb-4 flex flex-wrap items-end gap-3">
      <label className="text-meta">Region <select className="ctl" name="region" defaultValue={region}><option value="us">US</option><option value="eu">EU</option></select></label>
      <label className="text-meta">Faction house <select className="ctl" name="house" defaultValue={faction}>
        {[...BLIZZARD_HOUSES].filter(([, value]) => value.faction !== "blackwater").map(([id]) => <option key={id} value={id}>{name(id)}</option>)}
      </select></label>
      <label className="text-meta">Item name or ID <input className="ctl" type="search" name="q" maxLength={80} defaultValue={filter} /></label>
      <label className="text-meta">Lost deposit in copper <input className="ctl" name="deposit" inputMode="numeric" pattern="[0-9]{1,9}" maxLength={9} defaultValue={rawDeposit} /></label>
      <button type="submit" className="btn">Compare</button>
    </form>
    {rawDeposit && deposit === null && <p role="status" className="mb-3 text-meta text-warning">Enter a whole copper amount of up to nine digits for the deposit. The estimates below exclude it.</p>}
    <p className="mb-3 text-meta text-fg-2">{region.toUpperCase()} · {name(faction)} and {name(neutral)}. Both snapshots must be at most 3 hours old and no more than 90 minutes apart. The estimates use asking prices per unit. Actual purchases depend on the available stacks and price levels.</p>
    {!both ? <p role="status">A market could not be read. Both markets are needed for a comparison.</p>
      : <DataTable dense caption={`${Math.min(100, rows.length)} of ${rows.length} positive estimated price spreads`} columns={columns} rows={rows.slice(0, 100)}
        rowKey={(row) => `${row.itemId}:${row.kind}:${row.to}`} empty={<p>No positive comparison has matching, recent quotes for these filters.</p>} />}
    <p className="mt-4 text-meta text-fg-2">Data from Blizzard Entertainment</p>
  </Container>;
}
