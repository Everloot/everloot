import { NextResponse } from "next/server";
import { loadSightings } from "@/lib/instances";
import { loadMapPins } from "@/lib/map-pins-store";
import { CONTINENTS, continentPinSet } from "@/lib/world-map";

export const dynamic = "force-dynamic";

// The pins change when the corpus snapshot does (the cron runs every ten minutes); the CDN answers repeat
// requests in between, so every visitor to /map does not rebuild them.
const CACHE = { "Cache-Control": "public, max-age=0, s-maxage=300", "X-Robots-Tag": "noindex" };
const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

/**
 * GET /api/map/pins?continent=<0|1>[&spoilers=1] — what the map draws on a continent besides the zones: dungeon
 * and raid entrances, flight masters and flight paths from the game files, the NPC and vendor points that 3
 * installs agree on, the entrances they confirmed and the treasures they saw on the minimap. The map page fetches it, so none of it is inlined in the page's HTML. Held-back zones' items
 * come only with `spoilers=1`. Install ids never leave the site: a pin carries its reporter count only.
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const continent = params.get("continent");
  const continentId = Number(continent);
  if (continent === null || !/^\d+$/.test(continent) || !CONTINENTS.some((c) => c.id === continentId)) {
    return NextResponse.json({ ok: false, error: "continent is 0 (Eastern Kingdoms) or 1 (Kalimdor)." }, { status: 400, headers: NO_STORE });
  }
  const spoilers = params.get("spoilers") === "1";
  const [view, seen] = await Promise.all([loadMapPins(), loadSightings()]);
  const facts = view.facts;
  const body = {
    ok: true,
    continent: continentId,
    spoilers,
    dataAsOf: view.unreachable ? null : view.dataAsOf ?? null,
    // Unreachable storage still answers with the game-file items; the player points are missing, not zero.
    unreachable: Boolean(view.unreachable),
    ...continentPinSet(continentId, facts, spoilers, undefined, seen.unreachable ? {} : seen),
  };
  // A degraded answer is not cached, so the next request tries storage again.
  return NextResponse.json(body, { headers: view.unreachable || seen.unreachable ? NO_STORE : CACHE });
}
