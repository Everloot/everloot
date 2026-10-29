import { projectGuideFeed, renderGuideFeed } from "@/lib/guide-feed";
import { loadGuides, publishedGuides } from "@/lib/guides";
import { siteUrl } from "@/lib/sitemap-xml";
import { PUBLISHED_CHANGES } from "@/lib/talents/freshness-records";

// Guides are immutable deployment content. Read the current deployment on every cache miss, with no ISR stale
// fallback. After a withdrawal deployment, edge caches expire within 900s, browser caches within another 300s.
// Subscribers may keep previously downloaded items; the server cannot delete those copies.
export const dynamic = "force-dynamic";

export function GET(): Response {
  const items = projectGuideFeed(publishedGuides(loadGuides()), PUBLISHED_CHANGES);
  return new Response(renderGuideFeed(items, { baseUrl: siteUrl() }), {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=900",
      "CDN-Cache-Control": "max-age=900",
    },
  });
}
