import { isIP } from "node:net";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { ipv6Subscriber } from "@/lib/intake-quota";
import { MAX_QUERY } from "@/lib/lore";
import { peopleSearch } from "@/lib/people-search";
import { edgeClientIp } from "@/lib/platform";

/**
 * GET /search/people?q=<text>: the characters and guilds whose name starts with the text, for the header
 * type-ahead and the /search page. Apart from /search/suggest on purpose: that answer is kept by browsers and
 * the CDN for minutes, and the hide forms promise a hidden name leaves search as soon as it is sent. This one is
 * never stored outside the server, whose caches a hide clears. Never indexed.
 */
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" };

/** The PEOPLE_SEARCH_LIMIT binding in web/wrangler.jsonc: lookups per address per minute. */
export const PEOPLE_PER_MINUTE = 60;

interface Limiter { limit(options: { key: string }): Promise<{ success: boolean }> }

/**
 * True when this address has used its lookups for the minute, so a script cannot read the census one prefix after
 * another. An IPv6 /64 counts as one address. Only on the Worker: elsewhere there is no edge address and no binding.
 * A limiter that throws lets the lookup through; refusing every search during an outage would cost more.
 */
async function overLimit(req: Request): Promise<boolean> {
  const ip = edgeClientIp(req, process.env);
  if (!ip || !isIP(ip)) return false;
  try {
    const limiter = (getCloudflareContext().env as { PEOPLE_SEARCH_LIMIT?: Limiter }).PEOPLE_SEARCH_LIMIT;
    if (!limiter) return false;
    return !(await limiter.limit({ key: isIP(ip) === 6 ? ipv6Subscriber(ip) : ip })).success;
  } catch {
    return false;
  }
}

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (q.length > MAX_QUERY) return Response.json({ ok: false, error: `q is at most ${MAX_QUERY} characters.` }, { status: 400, headers: HEADERS });
  if (await overLimit(req)) {
    return Response.json({ ok: false, error: "Too many name lookups from this address. Try again in a minute." },
      { status: 429, headers: { ...HEADERS, "Retry-After": "60" } });
  }
  // Empty text reads nothing: peopleSearch validates both prefixes before any lookup.
  return Response.json({ q, ...(await peopleSearch(q)) }, { headers: HEADERS });
}
