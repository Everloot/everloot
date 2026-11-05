import { MAX_QUERY } from "@/lib/lore";
import { peopleSearch } from "@/lib/people-search";

/**
 * GET /search/people?q=<text>: the characters and guilds whose name starts with the text, for the header
 * type-ahead and the /search page. Apart from /search/suggest on purpose: that answer is kept by browsers and
 * the CDN for minutes, and the hide forms promise a hidden name leaves search as soon as it is sent. This one is
 * never stored outside the server, whose caches a hide clears. Never indexed.
 */
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" };

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (q.length > MAX_QUERY) return Response.json({ ok: false, error: `q is at most ${MAX_QUERY} characters.` }, { status: 400, headers: HEADERS });
  const found = q ? await peopleSearch(q) : { characters: { results: [], total: 0 }, guilds: { results: [], total: 0 } };
  return Response.json({ q, ...found }, { headers: HEADERS });
}
