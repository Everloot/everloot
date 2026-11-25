"use client";

import Coins from "@/components/ui/Coins";

/**
 * Coins drawn by a client component, for server tables with hundreds of prices: the page's RSC payload then carries
 * each amount instead of a second copy of every coin's SVG. The server HTML is the same as Coins'.
 */
export default function ClientCoins({ copper }: { copper: number | null }) {
  return <Coins copper={copper} />;
}
