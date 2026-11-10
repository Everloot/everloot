import { isScope, suggest, SUGGEST_LIMIT } from "@/lib/site-search";
import { MAX_QUERY } from "@/lib/lore";
import { admit } from "@/lib/data-guard";

/**
 * GET /api/suggest?q=<text>[&in=item|npc|quest|object]: up to 8 database pages for a search box as the visitor
 * types (the site's header and the database hub). An exact id first, then names players agree on (3 installs),
 * exact, then starting with the text, then containing it. Each row: type, id, label, href, and for items the
 * game files' quality number. No game-file names, icons or tooltip text: those stay on the pages.
 * Cached at the edge for a minute per query (the edge key trims and lower-cases q, lib/cf-edge-cache.ts), so typing costs
 * the site little. A request the edge does not answer spends the caller's per-IP quota, the one the per-question
 * endpoints use (lib/data-guard.ts). A site-internal route: it is not in the protocol or the OpenAPI document.
 */
export const dynamic = "force-dynamic";

// On the Worker only `CDN-Cache-Control` sets the edge lifetime (lib/cf-edge-cache.ts); `s-maxage` is for the rollback host.
const CACHE = { "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300", "CDN-Cache-Control": "max-age=60" };

export async function GET(req: Request) {
  const admitted = await admit(req, "mcp");
  if (admitted instanceof Response) return admitted;
  const params = new URL(req.url).searchParams;
  // Lower case, as the edge key has it: `?q=Thunder` and `?q=thunder%20` are one answer.
  const q = (params.get("q") ?? "").trim().toLowerCase();
  const scope = params.get("in");
  if (q.length > MAX_QUERY) return Response.json({ ok: false, error: `q is at most ${MAX_QUERY} characters.` }, { status: 400, headers: { "Cache-Control": "no-store" } });
  if (scope !== null && !isScope(scope)) return Response.json({ ok: false, error: "in must be one of item, npc, quest, object." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const results = q ? await suggest(q, scope ?? undefined) : [];
  return Response.json({ q, limit: SUGGEST_LIMIT, results }, { headers: CACHE });
}
