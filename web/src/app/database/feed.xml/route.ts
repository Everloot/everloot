import { renderRssChannel } from "../../../../../kb/src/changes";
import { loadDatabaseActivity } from "@/lib/database-activity-store";
import { absoluteUrl, SITE_URL } from "@/lib/seo";

export const dynamic = "force-dynamic";
const xml = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);

export async function GET(): Promise<Response> {
  const file = await loadDatabaseActivity();
  if (!file) return Response.json({ error: "Public facts are temporarily unavailable" }, { status: 503, headers: { "Cache-Control": "no-store", "CDN-Cache-Control": "no-store" } });
  const items = file.entries.map((e) => [
    "    <item>",
    `      <title>${xml(`${e.kind}: ${e.name}`)}</title>`,
    `      <link>${xml(absoluteUrl(e.path))}</link>`,
    `      <guid isPermaLink="false">database:${e.kind}:${e.id}</guid>`,
    `      <pubDate>${new Date(e.publicAt).toUTCString()}</pubDate>`,
    `      <category>${e.kind}</category>`,
    `      <description>${xml(`${e.installs} installs agree. Public since ${e.publicAt.slice(0, 10)}${e.estimated ? " (estimated from report capture dates)" : ""}.`)}</description>`,
    "    </item>",
  ].join("\n"));
  return new Response(renderRssChannel(items, { baseUrl: SITE_URL, now: new Date(file.generatedAt), path: "/database", title: "Everloot: new public database facts", description: "Entities whose facts reached three installs in the last 30 days." }), { headers: {
    "Content-Type": "application/rss+xml; charset=utf-8",
    "Cache-Control": "public, max-age=0, must-revalidate",
    "CDN-Cache-Control": "max-age=600, stale-while-revalidate=86400",
  } });
}
