import { expect, test } from "vitest";
import { databaseUnavailable } from "./database-sitemap";
import { auctionsUnavailable } from "./auctions-sitemap";

test("sitemap outage 503s tell the CDN not to cache them", () => {
  for (const res of [databaseUnavailable(), auctionsUnavailable()]) {
    expect(res.status).toBe(503);
    for (const key of ["Cache-Control", "Vercel-CDN-Cache-Control", "CDN-Cache-Control"]) expect(res.headers.get(key), key).toBe("no-store");
  }
});
