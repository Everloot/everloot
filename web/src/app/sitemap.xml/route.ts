import { DATABASE_SITEMAP_HEADERS, databaseUnavailable } from "@/lib/database-sitemap";
import { escapeXml } from "@/lib/sitemap-xml";
import sitemap from "@/lib/site-sitemap";

// Rendered per request, as the database and auctions sitemaps are: built ahead of time it reflects only what the
// build could read (the Cloudflare build has no storage keys, so item names, zones and dungeons were missing).
// A successful answer gets an hour at the CDN, which the Worker's edge cache keeps too; a 503 stays uncached.
export const dynamic = "force-dynamic";

/** The site's sitemap (lib/site-sitemap.ts), or 503 while the storage it lists from cannot be read. */
export async function GET(): Promise<Response> {
  const entries = await sitemap();
  if (!entries) return databaseUnavailable();
  const urls = entries.map((e) => `<url><loc>${escapeXml(e.url)}</loc>${e.lastModified ? `<lastmod>${new Date(e.lastModified).toISOString()}</lastmod>` : ""}</url>`).join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
  return new Response(xml, { headers: DATABASE_SITEMAP_HEADERS });
}
