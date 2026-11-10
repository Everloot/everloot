import { LORE_CHUNK, LORE_SITEMAP_HEADERS, loreUnavailable, lorePaths } from "@/lib/lore-forever";
import { chunkNumber, escapeXml, siteUrl } from "@/lib/sitemap-xml";

export const dynamic = "force-dynamic";

/** One chunk of the lore copies about something in WoW: Forever: NPCs, then items, then quests. */
export async function GET(_req: Request, ctx: { params: Promise<{ n: string }> }): Promise<Response> {
  const n = chunkNumber((await ctx.params).n);
  if (n === null) return new Response("Not found", { status: 404 });
  const paths = await lorePaths();
  if (!paths) return loreUnavailable();
  const chunk = paths.slice(n * LORE_CHUNK, (n + 1) * LORE_CHUNK);
  if (chunk.length === 0 && n > 0) return new Response("Not found", { status: 404 });
  const base = siteUrl();
  const urls = chunk.map((path) => `<url><loc>${escapeXml(`${base}${path}`)}</loc></url>`).join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
  return new Response(xml, { headers: LORE_SITEMAP_HEADERS });
}
