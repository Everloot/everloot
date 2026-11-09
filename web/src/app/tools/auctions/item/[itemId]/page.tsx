import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { pageMetadata } from "@/lib/seo";
import { formatCopper, MARKET_RULE } from "../../../../../../../kb/src/market";
import { uploadStore } from "@/lib/upload-store";
import { marketDatasetJsonLd } from "@/lib/jsonld";
import JsonLd from "@/components/JsonLd";
import GameIcon from "@/components/game/GameIcon";
import { trailFor } from "@/lib/breadcrumbs";
import { Card, Container, Disclosure, EmptyState, PageHeader, SectionHeading } from "@/components/ui";
import {
  AH_PATH, crossRealmHref, indexable, itemAcrossRealms, itemIdParam, itemLabel, realmBoards, type MarketRow,
} from "@/lib/auction-house";
import { auctionNames, itemArt } from "../../art";
import { Contribute, Facts, PriceFacts, RealmPrices, UnnamedReason, count, itemQuality } from "../../parts";

type Props = { params: Promise<{ itemId: string }> };

export const revalidate = 300;
export async function generateStaticParams() {
  return [];
}

async function load(params: Props["params"]) {
  const raw = (await params).itemId;
  const itemId = itemIdParam(raw);
  if (!itemId || String(itemId) !== raw) notFound();
  const now = new Date();
  const market = await uploadStore.loadMarket();
  const rows = market.state ? itemAcrossRealms(realmBoards(market.state, now), itemId) : [];
  const { tips } = await itemArt(rows.length ? [itemId] : []);
  const names = await auctionNames([itemId], tips);
  return { itemId, market, rows, tip: tips.get(itemId), names, label: itemLabel(itemId, names) };
}

/** The row with the lowest or highest market value; rows without one are skipped. */
function extreme(rows: MarketRow[], pick: (a: number, b: number) => boolean): MarketRow | null {
  let best: MarketRow | null = null;
  for (const r of rows) if (r.value.market !== null && (!best || pick(r.value.market, best.value.market!))) best = r;
  return best;
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { itemId, rows, label } = await load(props.params);
  const description = rows.length
    ? `${label} auction prices on ${count(rows.length, "realm")} in WoW: Forever: market value, minimum buyout and units listed side by side, from player scans.`
    : `No public auction price for ${label} in WoW: Forever yet. A price shows once 3 reporters scan the item on a realm; scans come from the Everloot addon.`;
  return {
    ...pageMetadata({ title: `WoW Forever ${label} Auction Prices`, description, path: crossRealmHref(itemId) }),
    robots: { index: rows.some((r) => indexable(r.value)), follow: true },
  };
}

export default async function CrossRealmItemPage(props: Props) {
  const { itemId, market, rows, tip, names, label } = await load(props.params);
  const state = market.state;
  const path = crossRealmHref(itemId);
  const low = extreme(rows, (a, b) => a < b);
  const high = extreme(rows, (a, b) => a > b);
  const days = rows.flatMap((r) => r.points.map((p) => p.day)).sort();

  return (
    <Container>
      {rows.length > 0 && (
        <JsonLd data={marketDatasetJsonLd({
          name: `${label} auction prices across realms`,
          description: `Public auction house prices for ${label} on every WoW: Forever realm with a public day (3 reporters, or Everloot's own scans): market value, minimum buyout, historical value and units listed.`,
          path,
          apiPath: "/api/market/prices",
          from: days[0]!,
          to: days.at(-1)!,
          dataAsOf: market.dataAsOf,
        })} />
      )}
      <PageHeader
        trail={[...trailFor(AH_PATH)!, { name: label, path }]}
        icon={tip?.icon ? <GameIcon src={tip.icon} size={40} /> : undefined}
        title={label}
        quality={itemQuality(itemId, tip, names.has(itemId)) ?? undefined}
        lede="Auction House prices on every realm with public scans."
        meta={rows.length > 0 && <Facts items={[count(rows.length, "realm"), `Newest public day ${days.at(-1)}`]} />}
        actions={<Link href={`/database/items/${itemId}`} className="btn">Item details</Link>}
      />

      <div className="space-y-10">
        <UnnamedReason id={itemId} names={names} />

        {!state && (
          <Card><p className="text-fg-2" role="status">Market values are unavailable right now. They are unrecorded, not zero.</p></Card>
        )}

        {state && rows.length === 0 && (
          <EmptyState message={`No price for ${label} yet: it needs scans from 3 players on one realm.`} />
        )}

        {rows.length > 0 && (
          <>
            <PriceFacts facts={[
              { label: "Realms", value: rows.length.toLocaleString("en-US"), note: "With a public price" },
              { label: "Lowest market value", value: low ? formatCopper(low.value.market!) : "unrecorded", note: low?.realm.name },
              { label: "Highest market value", value: high ? formatCopper(high.value.market!) : "unrecorded", note: high?.realm.name },
              { label: "Units listed", value: rows.reduce((n, r) => n + r.value.quantity, 0).toLocaleString("en-US"), note: "Newest day on each realm" },
            ]} />
            <section aria-labelledby="ah-realm-prices">
              <SectionHeading id="ah-realm-prices">By realm</SectionHeading>
              <RealmPrices rows={rows} caption={`${label} by realm`} empty="No realm has a public price for this item yet." />
            </section>
          </>
        )}

        <Contribute />

        <Disclosure summary="How are market values made?">
          <p>{MARKET_RULE}</p>
        </Disclosure>
      </div>

    </Container>
  );
}
