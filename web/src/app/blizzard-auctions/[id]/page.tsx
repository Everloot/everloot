import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, Container } from "@/components/ui";
import { CoinText } from "@/components/ui/Coins";
import { loadBlizzardPrices, loadBlizzardHistory } from "@/lib/blizzard-auctions";
import { BLIZZARD_HOUSES, blizzardMarket, blizzardMarketQuery, houseLabel } from "@/lib/blizzard-houses";
import { shownItemName } from "@/lib/items";
import { loadShownNames } from "@/lib/shown-item-names";
import { formatCopper } from "@kb/market";
import { BlizzardAuctions, blizzardTime } from "./blizzard-auctions";
import { BlizzardHistory } from "./history";

/**
 * One item's Blizzard API auction prices (issue #1122), on a page of their own. Blizzard's Developer API Terms allow
 * no ads on a page showing their data, and AdSense loads on every other public page, the item page included
 * (app/layout.tsx). So this page is ad-free (data/ad-free-paths.json): it loads no ads or analytics, a move to it
 * from a page with ads loads a fresh document, and the item page only links here, reading nothing from Blizzard.
 *
 * Rendered on every request and kept by no shared cache (next.config.js, lib/cf-edge-cache.ts): a copy would
 * outlive the 30 days the data may be kept, or keep a failed read. Not for search: noindex, disallowed in
 * robots.txt and in no sitemap.
 */
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }>; searchParams?: Promise<{ region?: string | string[]; house?: string | string[] }> };

const TITLE = "Blizzard auction house data";
const validId = (id: string) => /^[1-9]\d{0,8}$/.test(id);
/** The item's shown name, as the heading uses it; "Item N" without one. */
const itemName = async (itemId: number) => {
  const { agreed, matched } = await loadShownNames();
  return shownItemName(itemId, agreed, matched?.names)?.name ?? `Item ${itemId}`;
};

/** The tab title names the item like the heading does; an id the page refuses keeps the plain title. */
export async function generateMetadata(props: Props): Promise<Metadata> {
  const { id } = await props.params;
  return {
    title: validId(id) ? `${await itemName(Number(id))}: ${TITLE}` : TITLE,
    description: "An item's auction house prices from Blizzard's API, with the time Blizzard published them.",
    robots: { index: false, follow: false },
  };
}

export default async function BlizzardAuctionPage(props: Props) {
  const { id } = await props.params;
  if (!validId(id)) notFound();
  const itemId = Number(id);
  const [read, history, name, search] = await Promise.all([loadBlizzardPrices(itemId), loadBlizzardHistory(itemId), itemName(itemId), props.searchParams]);
  const market = blizzardMarket(search?.region, search?.house);
  const scope = market ? `${market.region.toUpperCase()} · ${houseLabel(market.house, "")}` : undefined;
  const picked = market && read.ok ? read.rows.find((row) => row.region === market.region && row.houseId === market.house) : undefined;
  const browseHref = market ? `/blizzard-auctions?${blizzardMarketQuery(market)}` : "/blizzard-auctions";
  const scopedHistory = market && history.ok ? { ...history, rows: history.rows.filter((row) => row.region === market.region && row.houseId === market.house) } : history;
  return (
    <Container>
      <h1 className="text-title-sm text-fg [overflow-wrap:anywhere] sm:text-title">{name}: {TITLE}</h1>
      <p className="mt-2 text-meta text-fg-2">
        {/* A plain link: the item page carries ads, so the move back loads its own document. */}
        <a href={`/database/items/${itemId}`} className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">Back to the item page</a>, where
        the prices players&apos; addons report are shown.
      </p>
      {market && <Card className="mt-5 space-y-3">
        <h2 className="text-control font-semibold">{scope}</h2>
        {picked ? <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div><dt className="text-meta text-fg-2">Lowest buyout</dt><dd><CoinText text={formatCopper(picked.minUnit)} /></dd></div>
            <div><dt className="text-meta text-fg-2">Typical ask</dt><dd><CoinText text={formatCopper(picked.typicalUnit)} /></dd></div>
            <div><dt className="text-meta text-fg-2">Units listed</dt><dd>{picked.quantity.toLocaleString("en-US")}</dd></div>
          </dl>
          <p className="text-meta text-fg-2">Blizzard snapshot <time dateTime={picked.snapshotAt}>{blizzardTime(picked.snapshotAt)}</time>
            {Date.now() - Date.parse(picked.snapshotAt) > 3 * 3_600_000 && <span className="text-warning"> · Over 3 hours old</span>}
          </p>
        </> : <p role="status">{read.ok ? "No Blizzard quote for this item in the selected market." : "The selected market could not be read."}</p>}
        <form method="get" action={`/blizzard-auctions/${id}`} className="flex flex-wrap items-end gap-2">
          <label className="text-meta">Region <select className="ctl" name="region" defaultValue={market.region}><option value="us">US</option><option value="eu">EU</option></select></label>
          <label className="text-meta">House <select className="ctl" name="house" defaultValue={market.house}>{[...BLIZZARD_HOUSES.keys()].map((house) => <option key={house} value={house}>{houseLabel(house, "")}</option>)}</select></label>
          <button type="submit" className="btn">Change market</button>
        </form>
      </Card>}
      <p className="mt-4 text-meta"><a href={browseHref} className="text-fg underline underline-offset-4">Browse Blizzard auction house data</a></p>
      {market ? <>
        <BlizzardHistory read={scopedHistory} scope={scope} />
        <p className="mt-4 text-meta"><a href={`/blizzard-auctions/${id}`} className="text-fg underline underline-offset-4">Compare history across all houses</a></p>
        <BlizzardAuctions read={read} itemId={itemId} />
      </> : <><BlizzardAuctions read={read} itemId={itemId} /><BlizzardHistory read={history} /></>}
      <p className="mt-2 text-meta text-fg-2">Data from Blizzard Entertainment</p>
    </Container>
  );
}
