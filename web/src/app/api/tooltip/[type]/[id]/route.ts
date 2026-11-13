import { attributionHeaders } from "@/lib/data-guard";
import { loadTooltip, tooltipId, tooltipType } from "@/lib/tooltip";
import { recordUsage } from "@/lib/usage-metrics";

/**
 * GET /api/tooltip/<type>/<id>: the hover card of one item, NPC, quest or object page, for the embeddable
 * script at /tooltips.js. Read-only and open to any website (CORS `*`, GET only). The CDN keeps an answer
 * for an hour and may serve it stale for a day while it refreshes, so a popular page costs us one read an
 * hour. One entity per request, no key and no per-IP quota: a visitor of a site that embeds the script
 * should not be counted against a bulk limit. Only requests the CDN did not answer are counted.
 */
export const dynamic = "force-dynamic";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET", "Access-Control-Max-Age": "86400" };
const CACHE = { "CDN-Cache-Control": "public, max-age=3600", "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400" };
// A 404 is cached briefly: players may report the page any minute.
const CACHE_404 = { "CDN-Cache-Control": "public, max-age=300", "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600" };
const NO_STORE = { "Cache-Control": "no-store" };

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(_req: Request, ctx: { params: Promise<{ type: string; id: string }> }) {
  recordUsage("api.tooltip");
  const params = await ctx.params;
  const type = tooltipType(params.type);
  const id = tooltipId(params.id);
  if (!type || id === null) {
    return Response.json({ ok: false, error: "Use /api/tooltip/<item|npc|quest|object>/<id>, with the id a positive whole number." }, { status: 404, headers: { ...CORS, ...CACHE_404 } });
  }
  const result = await loadTooltip(type, id);
  if (result.status !== 200) {
    return Response.json({ ok: false, error: result.error }, { status: result.status, headers: { ...CORS, ...(result.status === 404 ? CACHE_404 : NO_STORE) } });
  }
  return Response.json(result.body, { headers: { ...CORS, ...CACHE, ...attributionHeaders() } });
}
