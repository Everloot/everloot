import { LORE_CHUNK, LORE_SITEMAP_HEADERS, loreUnavailable, lorePaths } from "@/lib/lore-forever";
import { siteUrl } from "@/lib/sitemap-xml";

export const dynamic = "force-dynamic";

/** Sitemap index for the lore copies about something in WoW: Forever: one chunk per LORE_CHUNK pages (chunk 0 may be empty). */
export async function GET(): Promise<Response> {
  const paths = await lorePaths();
  if (!paths) return loreUnavailable();
  const chunks = Math.max(1, Math.ceil(paths.length / LORE_CHUNK));
  const entries = Array.from({ length: chunks }, (_, n) => `<sitemap><loc>${siteUrl()}/lore-sitemap/${n}.xml</loc></sitemap>`).join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</sitemapindex>`;
  return new Response(xml, { headers: LORE_SITEMAP_HEADERS });
}
