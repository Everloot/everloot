import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { pageMetadata } from "@/lib/seo";
import { uploadStore } from "@/lib/upload-store";
import { findBoard, indexable, realmBoards, realmHref, slugParam, slugWords } from "@/lib/auction-house";
import { ahHref, ahQuery } from "../browse";
import { browseView, isPlainView } from "../browse-view";
import { count } from "../parts";

type Search = Record<string, string | string[] | undefined>;
type Props = { params: Promise<{ realm: string }>; searchParams?: Promise<Search> };

// The filters live in the query string, so the page is rendered for each request (the rollup is cached by the store).
export const dynamic = "force-dynamic";

export async function generateMetadata(props: Props): Promise<Metadata> {
  const slug = slugParam((await props.params).realm);
  if (!slug) return { robots: { index: false, follow: true } };
  const market = await uploadStore.loadMarket();
  const board = market.state ? findBoard(realmBoards(market.state, new Date()), slug) : null;
  const name = board?.realm.name ?? slugWords(slug);
  const items = board ? count(board.items, "item") : "the items";
  const q = ahQuery((await props.searchParams) ?? {});
  return {
    ...pageMetadata({
      title: `WoW Forever ${name} Auction House Prices`,
      description: `Auction house prices on ${name} in WoW: Forever: market value, minimum buyout, units listed and the biggest price moves for ${items}, by category and house, from scans players upload.`,
      path: realmHref({ slug }),
    }),
    // Indexed only as the plain list, and only with a market value on it.
    robots: { index: Boolean(q && isPlainView(q) && board?.rows.some((r) => indexable(r.value))), follow: true },
  };
}

export default async function RealmPage(props: Props) {
  const raw = (await props.params).realm;
  const slug = slugParam(raw);
  if (!slug) notFound();
  const search = (await props.searchParams) ?? {};
  if (decodeURIComponent(raw) !== slug) {
    const q = ahQuery(search);
    permanentRedirect(q ? ahHref(realmHref({ slug }), q) : realmHref({ slug }));
  }
  return browseView({ slug, search });
}
