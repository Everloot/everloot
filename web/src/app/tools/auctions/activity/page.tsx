import { Container, PageHeader } from "@/components/ui";
import { isAhledgerMarket } from "@/lib/ahledger";
import { AUCTION_ACTIVITY } from "@/lib/auction-activity-link";
import { itemIdParam } from "@/lib/auction-house";
import { pageMetadata } from "@/lib/seo";
import MarketTiming from "./market-timing";
import SaleReport from "./sale-report";

export const metadata = {
  ...pageMetadata({
    title: "Auction House Activity",
    description: "Review your top-selling products, sale hours, and market timing for WoW: Forever items.",
    path: AUCTION_ACTIVITY,
  }),
  robots: { index: false, follow: true },
};

export default async function AuctionActivityPage({ searchParams }: { searchParams: Promise<{ item?: string; name?: string; market?: string }> }) {
  const query = await searchParams;
  const itemId = itemIdParam(typeof query.item === "string" ? query.item : "");
  const name = itemId && typeof query.name === "string" ? query.name.trim().slice(0, 80) : undefined;
  const market = typeof query.market === "string" && isAhledgerMarket(query.market) ? query.market : undefined;
  return (
    <Container width="data" className="space-y-6 pb-8">
      <PageHeader title="Auction House Activity" actions={<a className="btn" href="/tools/auctions">Auction House prices</a>} />
      <SaleReport initialName={name || undefined} />
      <section className="space-y-3 rounded-card border border-line bg-panel p-4" aria-labelledby="timing-title">
        <h2 id="timing-title" className="text-xl font-semibold">Market timing by item</h2>
        <MarketTiming initialItem={itemId} initialMarket={market} />
      </section>
    </Container>
  );
}
