import { loadTimeline, filterTimeline, renderFeed, timelineDegraded } from "@/lib/changes";
import { keepBrieflyIf } from "@/lib/degraded-render";

/** RSS of the changes timeline: WoW: Forever entries only, newest 50. */
export const dynamic = "force-static";
export const revalidate = 900;

export async function GET(): Promise<Response> {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://everloot.app";
  const entries = filterTimeline(await loadTimeline(), "all", "forever");
  // The bundled posts (the build's render, or a store outage) are kept seconds, not 15 minutes.
  await keepBrieflyIf(await timelineDegraded());
  return new Response(renderFeed(entries, { baseUrl, now: new Date(), limit: 50 }), {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=900",
    },
  });
}
