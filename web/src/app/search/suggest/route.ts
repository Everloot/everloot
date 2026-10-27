import { MAX_QUERY } from "@/lib/lore";
import { isScope, suggest, SUGGEST_LIMIT } from "@/lib/site-search";
import { loadShownSearchNames } from "@/lib/shown-search-names";
import { loadShownNames } from "@/lib/shown-item-names";
import { shownItemIcons } from "@/lib/item-icons";

/**
 * GET /search/suggest?q=<text>[&in=item|npc|quest|object]: the type-ahead under the site's own search boxes
 * (header, database hub, /search). Up to 8 pages, matched on the names those pages show, so a box finds what
 * the lists print. Part of the site, not the API: /api/suggest keeps the names players agree on, and this
 * route is left out of the API docs and of search engines.
 */
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300", "X-Robots-Tag": "noindex" };
const ERROR_HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const q = (params.get("q") ?? "").trim();
  const scope = params.get("in");
  if (q.length > MAX_QUERY) return Response.json({ ok: false, error: `q is at most ${MAX_QUERY} characters.` }, { status: 400, headers: ERROR_HEADERS });
  if (scope !== null && !isScope(scope)) return Response.json({ ok: false, error: "in must be one of item, npc, quest, object." }, { status: 400, headers: ERROR_HEADERS });
  // Names and icons use one publication-checked item fact set for this request.
  const shown = q ? loadShownNames() : undefined;
  const rows = q ? await suggest(q, scope ?? undefined, await loadShownSearchNames(shown)) : [];
  // Item rows carry the game icon where the item's page shows one.
  const icons = await shownItemIcons(rows.flatMap((r) => (r.type === "item" ? [r.id] : [])), shown);
  const results = rows.map((r) => (r.type === "item" && icons.has(r.id) ? { ...r, icon: icons.get(r.id) } : r));
  return Response.json({ q, limit: SUGGEST_LIMIT, results }, { headers: HEADERS });
}
