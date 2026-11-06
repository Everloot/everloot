import type { Metadata } from "next";
import { redirect } from "next/navigation";
import JsonLd from "@/components/JsonLd";
import { webApplicationJsonLd } from "@/lib/jsonld";
import { pageMetadata } from "@/lib/seo";
import { crossRealmHref, itemIdParam, realmHref, realmSlug, slugParam } from "@/lib/auction-house";
import { browseView } from "./browse-view";

// The filters live in the query string, so the page is rendered for each request (the rollup is cached by the store).
export const dynamic = "force-dynamic";

const TITLE = "WoW Forever Auction House Prices";
const DESCRIPTION = "WoW: Forever auction house prices by realm: market value, minimum buyout and 60-day history, from player scans and Everloot's own.";

type Search = Record<string, string | string[] | undefined>;
type Props = { searchParams: Promise<Search> };

// Filtered, sorted and house views share this canonical, so search engines keep the plain list.
export const metadata: Metadata = {
  ...pageMetadata({ title: TITLE, description: DESCRIPTION, path: "/tools/auctions" }),
};

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function AuctionHousePage(props: Props) {
  const searchParams = await props.searchParams;
  // The old page's form: `realm` (and `item`) land on the realm and item pages.
  const realmText = one(searchParams.realm).trim().slice(0, 60);
  const legacyItem = itemIdParam(one(searchParams.item) || (realmText ? one(searchParams.q) : ""));
  const slug = realmText ? slugParam(realmSlug(realmText)) : null;
  if (slug) redirect(legacyItem ? `${realmHref({ slug })}/${legacyItem}` : realmHref({ slug }));
  if (legacyItem) redirect(crossRealmHref(legacyItem));
  const view = await browseView({ slug: null, search: Object.fromEntries(Object.entries(searchParams).filter(([k]) => k !== "realm" && k !== "item")) });
  // The page has no lead line, so the application is described by the meta description. Its name is the H1.
  return (
    <>
      <JsonLd data={webApplicationJsonLd({ name: "Auction House", path: "/tools/auctions", description: DESCRIPTION })} />
      {view}
    </>
  );
}
