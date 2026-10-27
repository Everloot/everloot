import { ServerResponse, type IncomingMessage } from "node:http";
import { NodeNextResponse } from "next/dist/server/base-http/node";
import { sendResponse } from "next/dist/server/send-response";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { afterEach, expect, test, vi } from "vitest";
import nextConfig from "../../next.config.js";
import { GET as databaseIndex } from "../app/database-sitemap.xml/route";
import { GET as databaseChunk } from "../app/database-sitemap/[n]/route";
import { GET as auctionsIndex } from "../app/auctions-sitemap.xml/route";
import { GET as auctionsChunk } from "../app/auctions-sitemap/[n]/route";
import * as database from "./database-sitemap";
import * as auctions from "./auctions-sitemap";
import { databaseUnavailable } from "./database-sitemap";
import { auctionsUnavailable } from "./auctions-sitemap";

afterEach(() => vi.restoreAllMocks());

// Next's router installs config headers first. Exercise its real Node sender, which
// keeps an existing header rather than replacing it with the route's Response value.
async function effectiveHeaders(path: string, response: Response) {
  const request = { method: "HEAD" } as IncomingMessage;
  const outgoing = new ServerResponse(request);
  const res = new NodeNextResponse(outgoing);
  for (const rule of await nextConfig.headers!()) {
    if (getPathMatch(rule.source)(path) === false) continue;
    for (const { key, value } of rule.headers) res.setHeader(key, value);
  }
  // HEAD only avoids streaming into a socket; GET handlers above produce the real
  // body and status. This characterizes header composition, not HTTP/CDN caching.
  await sendResponse({ method: "HEAD" } as never, res, response);
  expect(outgoing.statusCode).toBe(response.status);
  return res;
}

const chunk = (get: typeof databaseChunk, n: string) => get(new Request("https://everloot.app/"), { params: Promise.resolve({ n }) });
const routes = [
  { path: "/database-sitemap.xml", get: databaseIndex },
  { path: "/database-sitemap/0.xml", get: () => chunk(databaseChunk, "0.xml") },
  { path: "/auctions-sitemap.xml", get: auctionsIndex },
  { path: "/auctions-sitemap/0.xml", get: () => chunk(auctionsChunk, "0.xml") },
];

test("successful XML indexes and chunks retain their CDN policy through Next's Node sender", async () => {
  vi.spyOn(database, "databasePaths").mockResolvedValue(["/database/items/2589"]);
  vi.spyOn(auctions, "auctionPaths").mockResolvedValue(["/auctions"]);
  for (const { path, get } of routes) {
    const response = await get();
    expect(response.status, path).toBe(200);
    expect(await response.clone().text(), path).toContain("<?xml");
    const out = await effectiveHeaders(path, response);
    expect(out.getHeader("Content-Type"), path).toBe("application/xml; charset=utf-8");
    for (const key of ["Vercel-CDN-Cache-Control", "CDN-Cache-Control"]) {
      expect(out.getHeader(key), path).toBe("max-age=3600, stale-while-revalidate=86400");
    }
  }
});

test("unavailable indexes and chunks keep all three no-store headers after static config and Next's Node sender", async () => {
  vi.spyOn(database, "databasePaths").mockResolvedValue(null);
  vi.spyOn(auctions, "auctionPaths").mockResolvedValue(null);
  for (const { path, get } of routes) {
    const response = await get();
    expect(response.status, path).toBe(503);
    const out = await effectiveHeaders(path, response);
    for (const key of ["Cache-Control", "Vercel-CDN-Cache-Control", "CDN-Cache-Control"]) expect(out.getHeader(key), `${path}: ${key}`).toBe("no-store");
  }
});

test("malformed and out-of-range chunks never receive positive CDN caching", async () => {
  vi.spyOn(database, "databasePaths").mockResolvedValue([]);
  vi.spyOn(auctions, "auctionPaths").mockResolvedValue([]);
  for (const [prefix, get] of [["database", databaseChunk], ["auctions", auctionsChunk]] as const) {
    for (const n of ["bad.xml", "1.xml"]) {
      const path = `/${prefix}-sitemap/${n}`;
      const response = await chunk(get, n);
      expect(response.status, path).toBe(404);
      const out = await effectiveHeaders(path, response);
      for (const key of ["Vercel-CDN-Cache-Control", "CDN-Cache-Control"]) expect(out.getHeader(key), `${path}: ${key}`).toBeUndefined();
    }
  }
});

test("sitemap outage 503s tell the CDN not to cache them", () => {
  for (const res of [databaseUnavailable(), auctionsUnavailable()]) {
    expect(res.status).toBe(503);
    for (const key of ["Cache-Control", "Vercel-CDN-Cache-Control", "CDN-Cache-Control"]) expect(res.headers.get(key), key).toBe("no-store");
  }
});
