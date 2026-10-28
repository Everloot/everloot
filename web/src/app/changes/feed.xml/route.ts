import { loadTimeline, filterTimeline, renderFeed } from "@/lib/changes";

/** RSS of the changes timeline: WoW: Forever entries only, newest 50. */
export const dynamic = "force-static";
export const revalidate = 900;

export async function GET(): Promise<Response> {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://everloot.app";
  const entries = filterTimeline(await loadTimeline(), "all", "forever");
  return new Response(renderFeed(entries, { baseUrl, now: new Date(), limit: 50 }), {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=900",
    },
  });
}
