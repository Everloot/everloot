import { NextRequest } from "next/server";
import { afterEach, expect, test, vi } from "vitest";
import { adFreeDocumentOnly, config, middleware } from "./middleware";

const request = (cookie?: string) => new NextRequest("https://everloot.app/", { headers: cookie ? { cookie } : {} });
const rewrittenTo = (res: Response) => res.headers.get("x-middleware-rewrite");

afterEach(() => { vi.unstubAllEnvs(); });

test("middleware covers the home rewrite, private operations and the ad-free pages under every version prefix", () => {
  expect(config.matcher).toEqual([
    "/", "/ops/:path*", "/api/ops/:path*", "/blizzard-auctions/:path*", "/beta/blizzard-auctions/:path*", "/ptr/blizzard-auctions/:path*",
  ]);
});

test("a client-side move or prefetch to an ad-free page gets no page, only an uncached answer that makes the router load a document", async () => {
  const navigations: Record<string, string>[] = [
    { RSC: "1", "Next-Url": "/database/items/954" },
    { RSC: "1", "Next-Router-State-Tree": "%5B%22%22%5D" },
    { RSC: "1", "Next-Router-Prefetch": "1" },
    { "Next-Router-Prefetch": "1" },
    { "Next-Router-State-Tree": "%5B%22%22%5D" },
    { RSC: "1", "Next-Router-Segment-Prefetch": "/_tree" },
    // What reaches middleware in Next 15.5 once it has removed its flight headers (checked over HTTP).
    { "Next-Url": "/database/items/954" },
    { "Sec-Fetch-Dest": "empty", "Sec-Fetch-Mode": "cors" },
  ];
  for (const headers of navigations) {
    const response = middleware(new NextRequest("https://everloot.app/blizzard-auctions/954", { headers }));
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("x-middleware-next")).toBeNull();
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("cdn-cache-control")).toBe("no-store");
    expect(await response.text()).not.toMatch(/\d{3,}/);
  }
  // A document request passes through to the page, and other pages' RSC requests are left alone.
  expect(middleware(new NextRequest("https://everloot.app/blizzard-auctions/954")).headers.get("x-middleware-next")).toBe("1");
  const pageLoad = { "Sec-Fetch-Dest": "document", "Sec-Fetch-Mode": "navigate" };
  expect(middleware(new NextRequest("https://everloot.app/blizzard-auctions/954", { headers: pageLoad })).headers.get("x-middleware-next")).toBe("1");
  expect(middleware(new NextRequest("https://everloot.app/blizzard-auctions/954?_rsc=x")).headers.get("x-middleware-next")).toBe("1");
  expect(adFreeDocumentOnly(new NextRequest("https://everloot.app/database/items/954", { headers: { RSC: "1" } }))).toBeNull();
});

test("a signed-in page load of an ad-free page gets that page, not the signed-in home", () => {
  for (const [v2, cookie] of [["0", "everloot_session=fixture"], ["1", "everloot.session_token=fixture"]]) {
    vi.stubEnv("EVERLOOT_PROFILES", "1");
    vi.stubEnv("EVERLOOT_AUTH_V2", v2);
    const response = middleware(new NextRequest("https://everloot.app/blizzard-auctions/954", { headers: { cookie, "Sec-Fetch-Dest": "document" } }));
    expect(rewrittenTo(response)).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
    // `/` itself is still rewritten.
    expect(rewrittenTo(middleware(request(cookie)))).toContain("/home");
  }
});

test("operations responses forbid private and CDN caching independently of profile/session state", () => {
  for (const profiles of ["0", "1"]) {
    vi.stubEnv("EVERLOOT_PROFILES", profiles);
    for (const path of ["/ops", "/ops/", "/api/ops/summary", "/api/ops/contributors/opaque"]) {
      const response = middleware(new NextRequest(`https://everloot.app${path}`, { headers: { cookie: "everloot.session_token=fixture" } }));
      expect(rewrittenTo(response)).toBeNull();
      expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
      expect(response.headers.get("cdn-cache-control")).toBe("no-store");
      expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
    }
  }
});

test("with a session cookie, / is the signed-in home, marked as the rewrite", () => {
  vi.stubEnv("EVERLOOT_PROFILES", "1");
  for (const cookie of [`everloot_session=${"a".repeat(64)}`, "everloot.session_token=abc.def", "__Secure-everloot.session_token=abc.def"]) {
    const res = middleware(request(`theme=dark; ${cookie}`));
    expect(rewrittenTo(res)).toBe("https://everloot.app/home");
    expect(res.headers.get("x-middleware-request-x-everloot-home")).toBe("1");
  }
});

test("the query goes along with the rewrite", () => {
  vi.stubEnv("EVERLOOT_PROFILES", "1");
  const res = middleware(new NextRequest("https://everloot.app/?added=bnet", { headers: { cookie: "everloot.session_token=abc.def" } }));
  expect(rewrittenTo(res)).toBe("https://everloot.app/home?added=bnet");
});

test("with Better Auth on, only its cookie counts: a leftover legacy cookie is not a session", () => {
  vi.stubEnv("EVERLOOT_PROFILES", "1");
  vi.stubEnv("EVERLOOT_AUTH_V2", "1");
  expect(rewrittenTo(middleware(request(`everloot_session=${"a".repeat(64)}`)))).toBeNull();
  expect(rewrittenTo(middleware(request("__Secure-everloot.session_token=abc.def")))).toBe("https://everloot.app/home");
});

test("without one, or with only other cookies, / stays the landing page", () => {
  vi.stubEnv("EVERLOOT_PROFILES", "1");
  expect(rewrittenTo(middleware(request()))).toBeNull();
  expect(rewrittenTo(middleware(request("everloot_return_to=/me; everloot.session_data=x; everloot_session=")))).toBeNull();
});

test("with the switch off nothing is rewritten", () => {
  for (const value of ["", "0", "true"]) {
    vi.stubEnv("EVERLOOT_PROFILES", value);
    expect(rewrittenTo(middleware(request("everloot.session_token=abc.def")))).toBeNull();
  }
});

test("every PROFILES and SAVED_BUILDS combination: only PROFILES decides, for a legacy session as for Better Auth's", () => {
  vi.stubEnv("EVERLOOT_AUTH_V2", "");
  for (const profiles of ["", "0", "1"]) {
    for (const savedBuilds of ["", "0", "1"]) {
      vi.stubEnv("EVERLOOT_PROFILES", profiles);
      vi.stubEnv("EVERLOOT_SAVED_BUILDS", savedBuilds);
      for (const cookie of [`everloot_session=${"a".repeat(64)}`, "everloot.session_token=abc.def"]) {
        expect(rewrittenTo(middleware(request(cookie))), `${profiles}/${savedBuilds}`).toBe(profiles === "1" ? "https://everloot.app/home" : null);
      }
      expect(rewrittenTo(middleware(request()))).toBeNull();
    }
  }
});

test("the rewrite caches nothing itself: a signed-in / carries no cache or cookie headers from here", () => {
  // /home renders per request (force-dynamic, noindex), so the per-user page is never stored for the next visitor.
  vi.stubEnv("EVERLOOT_PROFILES", "1");
  const signedIn = middleware(request(`everloot_session=${"a".repeat(64)}`));
  const visitor = middleware(request());
  expect(rewrittenTo(signedIn)).toBe("https://everloot.app/home");
  expect(rewrittenTo(visitor)).toBeNull();
  for (const res of [signedIn, visitor]) {
    for (const name of ["cache-control", "cdn-cache-control", "vercel-cdn-cache-control", "expires", "set-cookie", "vary"]) {
      expect(res.headers.get(name), name).toBeNull();
    }
  }
});
