export const AUCTION_ACTIVITY = "/tools/auctions/activity";

export function auctionActivityHref(itemId: number, name?: string | null, market?: string | null) {
  const query = new URLSearchParams({ item: String(itemId) });
  if (name) query.set("name", name);
  if (market) query.set("market", market);
  return `${AUCTION_ACTIVITY}?${query}`;
}
