import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { pageMetadata } from "@/lib/seo";
import { formatCopper, MARKET_RULE, reportersText } from "../../../../../../../kb/src/market";
import { auctionSightingsFromRecords, handleAuctionHistory, handleStoredAuctionHistory } from "../../../../../../../kb/src/auction-history";
import { STORAGE_UNREACHABLE, uploadStore } from "@/lib/upload-store";
import { storedAuctionHistory } from "@/lib/auction-history-store";
import { marketDatasetJsonLd } from "@/lib/jsonld";
import JsonLd from "@/components/JsonLd";
import GameIcon from "@/components/game/GameIcon";
import { trailFor } from "@/lib/breadcrumbs";
import { Card, Container, Disclosure, EmptyState, PageHeader, SectionHeading, Tabs } from "@/components/ui";
import {
  AH_PATH, HOUSES, agreementSoFar, busiestHouse, crossRealmHref, findBoard, houseSlug, indexable, itemAcrossRealms, itemByHouse, itemHref, itemIdParam,
  itemLabel, money, realmBoards, realmHref, slugParam, slugWords,
} from "@/lib/auction-house";
import { auctionNames, itemArt } from "../../art";
import { Contribute, DayTable, Facts, HousePrices, PriceChart, PriceFacts, RealmPrices, UnnamedReason, itemQuality } from "../../parts";
import TimeAgo from "../../TimeAgo";

type Props = { params: Promise<{ realm: string; itemId: string }> };

export const revalidate = 300;
export async function generateStaticParams() {
  return [];
}

async function load(params: Props["params"]) {
  const raw = await params;
  const slug = slugParam(raw.realm);
  const itemId = itemIdParam(raw.itemId);
  if (!slug || !itemId || String(itemId) !== raw.itemId) notFound();
  const now = new Date();
  const market = await uploadStore.loadMarket();
  const boards = market.state ? realmBoards(market.state, now) : [];
  const board = findBoard(boards, slug);
  const houses = market.state ? itemByHouse(market.state, now, slug, itemId) : [];
  // The page leads with one house's price, the house with the most units listed; the Houses tab lists every house.
  const row = busiestHouse(houses);
  const others = itemAcrossRealms(boards, itemId).filter((r) => r.realm.key !== board?.realm.key);
  // Art only for an item with a public price somewhere: an id typed into the URL may be unreleased.
  const { tips } = await itemArt(row || others.length ? [itemId] : []);
  const names = await auctionNames([itemId], tips);
  return { raw, slug, itemId, now, market, board, row, others, houses, tip: tips.get(itemId), names, realm: board?.realm.name ?? slugWords(slug), label: itemLabel(itemId, names) };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { slug, itemId, row, realm, label } = await load(props.params);
  const description = row
    ? `${label} on ${realm} in WoW: Forever, ${row.house} auction house: market value ${money(row.value.market)}, minimum buyout ${formatCopper(row.value.min)}, and 60 days of prices from player scans.`
    : `No public auction price for ${label} on ${realm} in WoW: Forever yet. A price shows once 3 reporters scan the item in one auction house on this realm.`;
  return {
    ...pageMetadata({ title: `WoW Forever ${label} Price on ${realm}`, description, path: itemHref({ slug }, itemId) }),
    robots: { index: indexable(row?.value), follow: true },
  };
}

export default async function RealmItemPage(props: Props) {
  const { raw, slug, itemId, now, market, row, others, houses, tip, names, realm, label } = await load(props.params);
  if (decodeURIComponent(raw.realm) !== slug) permanentRedirect(itemHref({ slug }, itemId));
  const state = market.state;
  const quality = itemQuality(itemId, tip, names.has(itemId)) ?? undefined;
  // The cron's stored days; the corpus only when there is no stored file to read.
  const stored = row ? await storedAuctionHistory(realm, itemId) : null;
  const corpus = row && !stored ? await uploadStore.loadCorpus() : null;
  const browse = stored ? handleStoredAuctionHistory({ realm, itemId }, stored.points) : corpus && (corpus.unreachable
    ? STORAGE_UNREACHABLE
    : handleAuctionHistory({ realm, itemId }, auctionSightingsFromRecords(corpus.records)));
  const path = itemHref({ slug }, itemId);
  const trail = [...trailFor(AH_PATH)!, { name: realm, path: realmHref({ slug }) }, { name: label, path }];
  const v = row?.value;

  return (
    <Container>
      {row && v && (
        <JsonLd data={marketDatasetJsonLd({
          name: `${label} auction prices on ${realm}, ${row.house} auction house`,
          description: `Public auction house prices for ${label} in the ${row.house} auction house on ${realm} in WoW: Forever: one row per public day (3 reporters, or Everloot's own scans), with market value, minimum buyout and units listed.`,
          path,
          apiPath: `/api/market/prices?realm=${encodeURIComponent(realm)}&house=${houseSlug(row.house)}`,
          from: row.points[0]!.day,
          to: row.points.at(-1)!.day,
          dataAsOf: market.dataAsOf,
        })} />
      )}
      <PageHeader
        trail={trail}
        icon={tip?.icon ? <GameIcon src={tip.icon} size={40} /> : undefined}
        title={label}
        quality={quality}
        lede={row
          ? `${row.house} auction house price on ${realm} in WoW: Forever. Each house is its own market${houses.length > 1 ? "; the Houses tab lists the others" : ""}.`
          : `Auction House price on ${realm} in WoW: Forever, one auction house at a time.`}
        meta={v && (
          <Facts items={[
            `${row.house} auction house`,
            row.updatedAt !== null ? <>Updated <TimeAgo key="t" at={row.updatedAt} renderedAt={now.getTime()} /></> : `Newest public day ${v.day}`,
            reportersText(v.reporters),
          ]} />
        )}
        actions={<>
          <Link href={crossRealmHref(itemId)} className="btn">All realms</Link>
          <Link href={`/database/items/${itemId}`} className="btn">Item details</Link>
        </>}
      />

      <div className="space-y-10">
        <UnnamedReason id={itemId} names={names} />

        {!state && (
          <Card><p className="text-fg-2" role="status">Market values are unavailable right now. They are unrecorded, not zero.</p></Card>
        )}

        {state && !v && (
          <EmptyState
            count={agreementSoFar(state, slug, itemId)}
            message={`No price for ${label} on ${realm} yet: it needs scans from 3 players in one auction house.`}
          />
        )}

        {row && v && (
          <>
            <PriceFacts facts={[
              { label: "Market value", value: money(v.market), note: v.market === null ? "No solid day in the last 14" : "Weighted over 14 days" },
              { label: "Min buyout", value: formatCopper(v.min), note: `On ${v.day}` },
              { label: "Historical", value: formatCopper(v.historical), note: "60-day median" },
              { label: "Units listed", value: v.quantity.toLocaleString("en-US"), note: v.thin ? "Thin: left out of the market value" : `On ${v.day}` },
            ]} />
            <section aria-labelledby="ah-chart">
              <SectionHeading id="ah-chart">Last 60 days, {row.house} auction house</SectionHeading>
              <Card><PriceChart points={row.points} /></Card>
            </section>
          </>
        )}

        {state && (row || others.length > 0) && (
          <Tabs
            label="Prices"
            tabs={[
              ...(row ? [{
                id: "houses", label: "Houses", count: houses.length,
                panel: houses.length
                  ? <div className="pt-4"><HousePrices rows={houses} caption={`${label} in each auction house on ${realm}`} now={now} /></div>
                  : <div className="pt-4"><EmptyState framed={false} count={Math.max(...HOUSES.map((h) => agreementSoFar(state, slug, itemId, h)))} message="No auction house has its own price for this item yet: a house's price needs scans from 3 players in that house." /></div>,
              }] : []),
              {
                id: "other-realms", label: "Other realms", count: others.length,
                panel: <div className="pt-4"><RealmPrices rows={others} caption={`${label} on other realms`} empty="No other realm has a public price for this item yet." /></div>,
              },
              ...(row ? [{
                id: "daily", label: "Daily values", count: row.points.length,
                panel: <div className="pt-4"><DayTable points={row.points} caption={`Public days for ${label} on ${realm}, ${row.house} auction house`} /></div>,
              }] : []),
            ]}
          />
        )}

        <Contribute />

        <div>
          <Disclosure summary="How are market values made?">
            <p>{MARKET_RULE}</p>
          </Disclosure>
          {browse && (
            <Disclosure summary="Single listings seen while browsing">
              <pre className="whitespace-pre-wrap text-sm text-fg">{browse}</pre>
            </Disclosure>
          )}
        </div>
      </div>

    </Container>
  );
}
