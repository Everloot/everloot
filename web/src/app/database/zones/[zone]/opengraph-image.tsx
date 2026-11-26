import { CARD_SIZE } from "@/lib/og-card";
import { parseZoneSegment, zoneByMapId } from "@/lib/zones";
import { shareImage } from "../../share-image";

export const alt = "A WoW Forever zone on Everloot";
export const size = CARD_SIZE;
export const contentType = "image/png";
export const dynamic = "force-dynamic";

// The zone page's card: the zone and its continent. No map picture: docs/ASSETS.md keeps game art on share cards to
// the item card. The page's 404.
export default async function Image({ params }: { params: Promise<{ zone: string }> }) {
  const id = parseZoneSegment((await params).zone);
  const zone = id === null ? undefined : zoneByMapId(id);
  return shareImage(zone && { type: "Zone", title: zone.name, facts: [zone.continentName] });
}
