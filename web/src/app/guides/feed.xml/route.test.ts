import { afterEach, expect, test, vi } from "vitest";
const state = vi.hoisted(() => ({ guides: new Map(), records: [] as unknown[] }));
vi.mock("@/lib/guides", async (original) => ({ ...await original<typeof import("@/lib/guides")>(), loadGuides: () => state.guides }));
vi.mock("@/lib/talents/freshness-records", () => ({ PUBLISHED_CHANGES: state.records }));
import { GET, dynamic } from "./route";
afterEach(() => { state.guides.clear(); state.records.length = 0; });

test("empty global feed is RSS with bounded caches, no artificial date or query opt-ins", async () => {
  const response = GET();
  expect(dynamic).toBe("force-dynamic");
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("application/rss+xml; charset=utf-8");
  expect(response.headers.get("Cache-Control")).toBe("public, max-age=300, s-maxage=900");
  expect(response.headers.get("Vercel-CDN-Cache-Control")).toBe("max-age=900");
  const xml = await response.text();
  expect(xml).toContain("<rss");
  expect(xml).not.toMatch(/<item>|pubDate|lastBuildDate/);
});
