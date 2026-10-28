import { loadNews, publishedPosts, renderNewsFeed } from "@/lib/news";

/** RSS of the news posts: published ones only, newest 50. */
export const dynamic = "force-static";
export const revalidate = 900;

export function GET(): Response {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://everloot.app";
  return new Response(renderNewsFeed(publishedPosts(loadNews()), { baseUrl, now: new Date(), limit: 50 }), {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=900",
    },
  });
}
