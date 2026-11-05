/**
 * The old address of a seen character's page. A character has one page now, at /characters/<ruleset>/<realm>/<name>;
 * this answers 308 with it, the three segments copied exactly as the request spelled them (still encoded), and
 * the query kept. It reads nothing: the page it points to decides whether there is anything to show.
 */
export function GET(req: Request): Response {
  const url = new URL(req.url);
  url.pathname = url.pathname.replace(/^\/players\//, "/characters/");
  return new Response(null, { status: 308, headers: { Location: url.toString() } });
}

export const HEAD = GET;
