import { expect, test } from "vitest";
import { DATABASE_SITEMAP_HEADERS, databaseUnavailable } from "./database-sitemap";
import { AUCTIONS_SITEMAP_HEADERS, auctionsUnavailable } from "./auctions-sitemap";

test("sitemap outage 503s tell the CDN not to cache them", () => {
  for (const res of [databaseUnavailable(), auctionsUnavailable()]) {
    expect(res.status).toBe(503);
    for (const key of ["Cache-Control", "Vercel-CDN-Cache-Control", "CDN-Cache-Control"]) expect(res.headers.get(key), key).toBe("no-store");
  }
});

test("successful database and auctions sitemaps are cached at the CDN for an hour, stale for a day", () => {
  for (const h of [DATABASE_SITEMAP_HEADERS, AUCTIONS_SITEMAP_HEADERS] as Record<string, string>[]) {
    expect(h["Vercel-CDN-Cache-Control"]).toBe("max-age=3600, stale-while-revalidate=86400");
    expect(h["CDN-Cache-Control"]).toBe("max-age=3600, stale-while-revalidate=86400");
  }
});
