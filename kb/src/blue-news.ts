import type { BluePost } from "./blue-posts.js";
import { clampText, isoTime } from "./text-safety.js";

export const NEWS_HOST = "https://news.blizzard.com";
export const NEWS_INDEX = `${NEWS_HOST}/en-us/feed/world-of-warcraft`;
const gameOf = (text: string) => /\b(?:wow|world.of.warcraft)(?:\s*:\s*|[-\s])forever\b/i.test(text) ? "forever"
  : /\bclassic\b|season.of.discovery/i.test(text) ? "classic" : null;

/** Only public English WoW article links on Blizzard's own host; no redirect or arbitrary URL fetching. */
export function newsLinks(html: string): string[] {
  const links = new Map<string, string>();
  for (const match of html.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)) {
    let url: URL;
    try { url = new URL(match[1], NEWS_HOST); } catch { continue; }
    const pathname = url.pathname.replace(/\/$/, "");
    const path = /^\/en-us\/article\/(\d{1,15})\/([a-z0-9-]+)$/.exec(pathname);
    if (url.origin !== NEWS_HOST || url.username || url.password || !path || !gameOf(path[2])) continue;
    links.set(path[1], `${NEWS_HOST}${pathname}`);
  }
  return [...links.values()];
}

/** Store structured announcement metadata only. Article bodies and item/spell text are never copied. */
export function parseNewsArticle(html: string, url: string, now: Date): BluePost | null {
  const link = newsLinks(`<a href="${url}">`)[0];
  if (!link) return null;
  for (const match of html.matchAll(/<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: Record<string, unknown>;
    try { data = JSON.parse(match[1]); } catch { continue; }
    if (!data || data["@type"] !== "NewsArticle") continue;
    const title = clampText(data.headline, 200);
    const game = gameOf(title);
    const postedAt = isoTime(data.datePublished);
    if (!title || !game || !postedAt) return null;
    return {
      id: `news:${new URL(link).pathname.split("/")[3]}`, source: "news", url: link,
      title, author: "Blizzard Entertainment", role: "Blizzard News", category: "Blizzard News", game,
      postedAt, editedAt: isoTime(data.dateModified), kind: /hotfix/i.test(title) ? "hotfix" : "post",
      excerpt: "", firstSeen: now.toISOString(),
    };
  }
  return null;
}
