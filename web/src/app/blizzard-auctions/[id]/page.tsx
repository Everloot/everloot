import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Container } from "@/components/ui";
import { loadBlizzardPrices } from "@/lib/blizzard-auctions";
import { shownItemName } from "@/lib/items";
import { loadShownNames } from "@/lib/shown-item-names";
import { BlizzardAuctions } from "./blizzard-auctions";

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

export const metadata: Metadata = {
  title: "Blizzard auction house data",
  description: "An item's auction house prices from Blizzard's API, with the time Blizzard published them.",
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ id: string }> };

export default async function BlizzardAuctionPage(props: Props) {
  const { id } = await props.params;
  if (!/^[1-9]\d{0,8}$/.test(id)) notFound();
  const itemId = Number(id);
  const [read, { agreed, matched }] = await Promise.all([loadBlizzardPrices(itemId), loadShownNames()]);
  const name = shownItemName(itemId, agreed, matched?.names)?.name ?? `Item ${itemId}`;
  return (
    <Container>
      <h1 className="text-title-sm text-fg [overflow-wrap:anywhere] sm:text-title">{name}: Blizzard auction house data</h1>
      <p className="mt-2 text-meta text-fg-2">
        {/* A plain link: the item page carries ads, so the move back loads its own document. */}
        <a href={`/database/items/${itemId}`} className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">Back to the item page</a>, where
        the prices players&apos; addons report are shown.
      </p>
      <BlizzardAuctions read={read} />
      <p className="mt-2 text-meta text-fg-2">Data from Blizzard Entertainment</p>
    </Container>
  );
}
