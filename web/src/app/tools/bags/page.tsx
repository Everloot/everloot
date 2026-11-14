import type { Metadata } from "next";
import Link from "next/link";
import type { AuctionHouse } from "@everloot/protocol";
import JsonLd from "@/components/JsonLd";
import { CoinText } from "@/components/ui/Coins";
import { Card, Container, DataTable, Disclosure, EmptyState, PageHeader, SectionHeading, type Column } from "@/components/ui";
import { trailFor } from "@/lib/breadcrumbs";
import { webApplicationJsonLd } from "@/lib/jsonld";
import { pageMetadata } from "@/lib/seo";
import { uploadStore } from "@/lib/upload-store";
import { AH_PATH, HOUSES, agreementSoFar, busiestHouse, findBoard, houseParam, houseSlug, itemHref, money, realmBoards, slugParam, type MarketRow } from "@/lib/auction-house";
import { BAGS_BUILD, BAG_SLOTS, bagsParam, cheapestBySize, pricedSizes, upgrades, type Upgrade } from "@/lib/bags";
import { MARKET_RULE, formatCopper } from "../../../../../kb/src/market";
import { auctionNames, itemArt, type ItemTip } from "../auctions/art";
import { Contribute, ItemLink, RealmName } from "../auctions/parts";

// The choices live in the query string, so the page is rendered for each request (the rollup is cached by the store).
export const dynamic = "force-dynamic";

const PATH = "/tools/bags";
const HEADING = "Bag upgrades";
const lede = "The cheapest way to more bag space on your auction house: the lowest buyout for each bag size, and what each added slot costs.";

export const metadata: Metadata = {
  ...pageMetadata({
    title: "WoW Forever Bag Upgrade Calculator",
    description: "The cheapest bag of each size on your WoW: Forever realm's auction house, and the cost per added slot of swapping your smallest bag.",
    path: PATH,
  }),
};

type Search = Record<string, string | string[] | undefined>;

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] ?? "" : value ?? "");
const days = (n: number) => (n <= 0 ? "today" : n === 1 ? "1 day ago" : `${n} days ago`);
const field = "ctl w-full min-w-0 border border-edge bg-panel px-3 text-fg focus:border-accent";
const NO_PRICE = "No public price on this house yet";

/** One bag size on the chosen house: its cheapest bag, or none with a public price there. */
interface SizeRow { slots: number; row: MarketRow | null }

export default async function BagsPage(props: { searchParams: Promise<Search> }) {
  const search = await props.searchParams;
  const slug = slugParam(one(search.realm)) ?? null;
  const asked = houseParam(one(search.house) || undefined);
  const current = bagsParam(search);
  const now = new Date();
  const market = await uploadStore.loadMarket();
  const state = market.state;
  const realms = state ? realmBoards(state, now) : [];
  const realm = slug ? findBoard(realms, slug) : null;
  // A house is its own market: with none asked for, the realm's busiest house, named on the page; never a blend.
  const house: AuctionHouse | null = asked ?? (realm ? busiestHouse(realm.rows)?.house ?? null : null);
  const board = state && slug && house ? findBoard(realmBoards(state, now, house), slug) : null;
  const cheapest = board ? cheapestBySize(board.rows) : new Map<number, MarketRow>();
  // Sizes some house prices, so a size only bags that bind when picked up come in never lists.
  const sizes = [...new Set([...pricedSizes(realms), ...cheapest.keys()])].sort((a, b) => a - b);
  const pickerSizes = [...new Set([...sizes, ...current])].filter((slots) => slots > 0).sort((a, b) => a - b);
  const sizeRows: SizeRow[] = sizes.map((slots) => ({ slots, row: cheapest.get(slots) ?? null }));
  const swaps = upgrades(cheapest, current);

  const ids = [...cheapest.values()].map((r) => r.value.itemId);
  const tips: Map<number, ItemTip> = ids.length ? (await itemArt(ids)).tips : new Map();
  const names = await auctionNames(ids, tips);
  const realmName = realm?.realm.name ?? null;
  const where = house && realmName ? `the ${house} auction house on ${realmName}` : null;

  const bagLink = (row: MarketRow) => <ItemLink id={row.value.itemId} href={itemHref(row.realm, row.value.itemId)} tip={tips.get(row.value.itemId)} names={names} />;
  const sizeColumns: Column<SizeRow>[] = [
    { key: "slots", header: "Slots", numeric: true, cell: (s) => s.slots },
    { key: "bag", header: "Cheapest bag", cell: (s) => (s.row ? bagLink(s.row) : <span className="text-fg-2">{NO_PRICE}</span>) },
    { key: "min", header: "Min buyout", numeric: true, cell: (s) => (s.row ? <CoinText text={formatCopper(s.row.value.min)} /> : <span className="text-muted">—</span>) },
    { key: "market", header: "Market value", numeric: true, cell: (s) => (s.row ? <span className={s.row.value.market === null ? "text-muted" : undefined}><CoinText text={money(s.row.value.market)} /></span> : <span className="text-muted">—</span>) },
    { key: "day", header: "Price day", numeric: true, nowrap: true, cell: (s) => (s.row ? <>{s.row.value.day} <span className="text-muted">({days(s.row.value.ageDays)})</span></> : <span className="text-muted">—</span>) },
  ];
  const swapColumns: Column<Upgrade>[] = [
    { key: "slots", header: "Slots", numeric: true, cell: (u) => u.slots },
    { key: "bag", header: "Bag", cell: (u) => bagLink(u.row) },
    { key: "cost", header: "Cost", numeric: true, cell: (u) => <CoinText text={formatCopper(u.row.value.min)} /> },
    { key: "added", header: "Added slots", numeric: true, cell: (u) => `+${u.added}` },
    { key: "per", header: "Per added slot", numeric: true, cell: (u) => <CoinText text={formatCopper(Math.round(u.perSlot))} /> },
  ];
  const smallest = Math.min(...current);

  let body;
  if (!state) {
    body = <Card><p className="text-fg-2" role="status">Market values are unavailable right now. They are unrecorded, not zero.</p></Card>;
  } else if (!slug || !house) {
    body = <EmptyState message={realms.length ? "Pick a realm and an auction house to see what bags cost there." : "No realm has public prices yet: a realm shows here once 3 reporters scan the same item there."} />;
  } else if (!board) {
    body = <EmptyState count={agreementSoFar(state, slug, undefined, house)} message={`No public prices in the ${house} auction house on ${realmName ?? "this realm"} yet: a price shows once 3 reporters scan the same item there.`} />;
  } else {
    body = (
      <div className="space-y-8">
        <section aria-labelledby="bags-sizes">
          <SectionHeading id="bags-sizes" note={`Plain bags only, by the newest public minimum buyout in ${where}.`}>Cheapest bag of each size</SectionHeading>
          <DataTable
            dense
            caption={`Cheapest bag of each size in ${where}`}
            columns={sizeColumns}
            rows={sizeRows}
            rowKey={(s) => String(s.slots)}
            meta={(s) => (s.row ? <><CoinText text={formatCopper(s.row.value.min)} />{` · ${s.row.value.day}`}</> : NO_PRICE)}
            empty={<EmptyState framed={false} message="No plain bag has a public price on any house yet: a price shows once 3 reporters scan the same bag." />}
          />
        </section>
        <section aria-labelledby="bags-upgrades">
          <SectionHeading id="bags-upgrades" note={smallest > 0 ? `Swapping your smallest bag (${smallest} slots) for a bigger one, the best value first.` : "Filling an empty bag slot, the best value first."}>Upgrades</SectionHeading>
          <DataTable
            dense
            caption={`Bag upgrades in ${where}, cheapest per added slot first`}
            columns={swapColumns}
            rows={swaps}
            rowKey={(u) => String(u.slots)}
            meta={(u) => <><CoinText text={formatCopper(u.row.value.min)} />{` · +${u.added} slots · `}<CoinText text={formatCopper(Math.round(u.perSlot))} />{" per slot"}</>}
            empty={<EmptyState framed={false} message={`No bag bigger than ${smallest} slots has a public price on this house yet.`} />}
          />
        </section>
      </div>
    );
  }

  return (
    <Container width="data">
      <JsonLd data={webApplicationJsonLd({ name: HEADING, path: PATH, description: lede })} />
      <PageHeader
        trail={trailFor(PATH)!}
        title={HEADING}
        lede={lede}
        meta={where ? <span>{house} auction house on <RealmName name={realmName!} /></span> : undefined}
        actions={<Link href={AH_PATH} className="btn">Auction House</Link>}
      />
      <div className="space-y-8">
        <Card>
          <form action={PATH} method="get" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block min-w-0 space-y-1 text-sm">
              <span className="block text-muted">Realm</span>
              <select name="realm" defaultValue={realm?.realm.slug ?? ""} className={field}>
                <option value="">Choose a realm</option>
                {realms.map((b) => <option key={b.realm.slug} value={b.realm.slug}>{b.realm.name}</option>)}
              </select>
            </label>
            <label className="block min-w-0 space-y-1 text-sm">
              <span className="block text-muted">Auction house</span>
              <select name="house" defaultValue={house ? houseSlug(house) : houseSlug(HOUSES[0]!)} className={field}>
                {HOUSES.map((h) => <option key={h} value={houseSlug(h)}>{h}</option>)}
              </select>
            </label>
            <fieldset className="min-w-0 space-y-1 text-sm sm:col-span-2 lg:col-span-3">
              <legend className="text-muted">Your {BAG_SLOTS} bags (the backpack is fixed)</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {current.map((slots, i) => (
                  <label key={i} className="block min-w-0">
                    <span className="sr-only">Bag {i + 1}</span>
                    <select name={`b${i + 1}`} defaultValue={String(slots)} className={field}>
                      <option value="0">Empty</option>
                      {pickerSizes.map((n) => <option key={n} value={String(n)}>{n} slots</option>)}
                    </select>
                  </label>
                ))}
              </div>
            </fieldset>
            <div><button type="submit" className="btn">Show bags</button></div>
          </form>
        </Card>
        <div className="space-y-3">
          <p data-bag-sources className="text-meta text-fg-2">
            {`Slot counts: found in game files, unconfirmed (build ${BAGS_BUILD}). Prices: players' auction scans, one auction house at a time.`}
          </p>
          {body}
        </div>
        <Contribute />
        <div>
          <Disclosure summary="Which bags are listed?">
            <p>Plain bags, the ones any item fits in; profession, soul and ammo bags are left out. A size is listed once some auction house has a public price for a bag of that size, so bags that bind when picked up, which never reach an auction house, do not appear. Each row is the bag with the lowest newest public minimum buyout on the house you chose; the cost per added slot is that buyout divided by the slots it adds over your smallest bag.</p>
          </Disclosure>
          <Disclosure summary="How are market values made?">
            <p>{MARKET_RULE}</p>
          </Disclosure>
        </div>
      </div>
    </Container>
  );
}
