/**
 * The old address of a seen character's page. A character has one page now, at /characters/<ruleset>/<realm>/<name>;
 * this sends the visitor there, the three segments copied exactly as the request spelled them (still encoded), and
 * the query kept. It reads nothing: the page it points to decides whether there is anything to show.
 *
 * A temporary 307, kept for an hour at most, until the owner confirms one address per character (showcase
 * decisions, row 7): a browser keeps a 308 for good, so undoing the move would leave old links pointing here.
 * It becomes a 308 once that is confirmed.
 */
export function GET(req: Request): Response {
  const url = new URL(req.url);
  url.pathname = url.pathname.replace(/^\/players\//, "/characters/");
  return new Response(null, { status: 307, headers: { Location: url.toString(), "Cache-Control": "public, max-age=3600" } });
}

export const HEAD = GET;
