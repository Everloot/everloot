import { isEntryCardType, loadSiteCard } from "@/lib/site-card";
import { tooltipId, tooltipType } from "@/lib/tooltip";

/**
 * GET /card/<type>/<id>: item, npc, quest, object, spell, vendor and the game-file entry pages (ENTRY_CARD_TYPES in
 * lib/site-card.ts: achievement, faction, title, chain, zone, instance, item-set, mount, pet, currency, holiday,
 * family). The hover card on the site's own links (components/game/HoverCards)
 * and the chat's item card. Part of the site, not the API, like /search/suggest: it follows the pages' rules
 * (lib/site-card.ts), so other sites get no CORS and search engines a noindex, and it stays out of /api/, which carries
 * no game-file names. It sits outside /database/ because Cloudflare challenges every path there, and a background fetch
 * cannot answer a challenge; the old /database/card path still answers for pages cached before the move. Browsers keep
 * a card five minutes and the Worker's edge cache an hour (lib/cf-edge-cache.ts): on the Worker only
 * `CDN-Cache-Control` sets the edge lifetime, and `s-maxage` alone kept nothing, so every hover rendered the card again.
 * The edge keeps 200s only, each a whole card; a 404 is kept by the browser, and a 503 (a read failed) by nobody, so the
 * next hover asks again.
 */
export const dynamic = "force-dynamic";

const CACHE = {
  "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
  "CDN-Cache-Control": "max-age=3600",
  "X-Robots-Tag": "noindex",
};
const CACHE_404 = { "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600", "X-Robots-Tag": "noindex" };
const NO_STORE = { "Cache-Control": "no-store", "CDN-Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

export async function GET(_req: Request, ctx: { params: Promise<{ type: string; id: string }> }) {
  const params = await ctx.params;
  const type = params.type === "spell" || params.type === "vendor" || isEntryCardType(params.type) ? params.type : tooltipType(params.type);
  const id = tooltipId(params.id);
  if (!type || id === null) return Response.json({ ok: false, error: "No such card." }, { status: 404, headers: CACHE_404 });
  const result = await loadSiteCard(type, id);
  if (result.status !== 200) return Response.json({ ok: false, error: result.error }, { status: result.status, headers: result.status === 404 ? CACHE_404 : NO_STORE });
  return Response.json({ ok: true, card: result.body }, { headers: CACHE });
}
