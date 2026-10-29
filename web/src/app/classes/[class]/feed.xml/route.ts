import { projectGuideFeed, renderGuideFeed } from "@/lib/guide-feed";
import { loadGuides, publishedGuides } from "@/lib/guides";
import { siteUrl } from "@/lib/sitemap-xml";
import { isTalentClass } from "@/lib/talents/catalogs";
import { PUBLISHED_CHANGES } from "@/lib/talents/freshness-records";

// Same deployment/finite-cache withdrawal policy as /guides/feed.xml; no ISR stale fallback.
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ class: string }> }): Promise<Response> {
  const { class: classSlug } = await params;
  if (!isTalentClass(classSlug)) return new Response("Not found", { status: 404 });
  const items = projectGuideFeed(publishedGuides(loadGuides()), PUBLISHED_CHANGES, classSlug);
  return new Response(renderGuideFeed(items, { baseUrl: siteUrl(), classSlug }), {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=900",
      "CDN-Cache-Control": "max-age=900",
    },
  });
}
