import { NextResponse, type NextRequest } from "next/server";
import { isAdFreePath } from "@/lib/document-boundary";
import { HOME_REWRITE_HEADER, profilesOn } from "@/lib/profiles";

/**
 * `/` stays the cached landing page for visitors. With EVERLOOT_PROFILES on and a session cookie, it is
 * rewritten to the signed-in home (/home), which checks the session itself: a stale cookie gets the landing.
 */

/** Better Auth's session cookie (cookiePrefix "everloot"; "__Secure-" in production). */
export const BETTER_AUTH_COOKIES = ["everloot.session_token", "__Secure-everloot.session_token"] as const;
/** The legacy Battle.net session; it counts only while Better Auth is off (EVERLOOT_AUTH_V2). */
export const LEGACY_COOKIE = "everloot_session";

/**
 * Whether a request is a fetch from an open page rather than a page load. Next removes its own flight headers (RSC,
 * the router state tree, the prefetch ones) and the `_rsc` query before middleware and pages see them, so two
 * signals that reach middleware are read instead: `Next-Url`, which Next's router sends with every client-side
 * move and prefetch (a browser never sends it on a page load), and the browser's own `Sec-Fetch-Dest`, which says
 * `document` (or `iframe`) only for a page load and `empty` for a fetch. The flight headers are checked too, in case
 * a later Next passes them through. A client without Sec-Fetch-Dest (an old browser, curl) still gets the page.
 */
export function isPageFetch(headers: Headers): boolean {
  const dest = headers.get("sec-fetch-dest");
  return headers.has("next-url") || (dest !== null && dest !== "document" && dest !== "iframe")
    || ["rsc", "next-router-prefetch", "next-router-state-tree", "next-router-segment-prefetch"].some((h) => headers.has(h));
}

/**
 * An ad-free page (data/ad-free-paths.json: Blizzard API data) must reach only a document of its own, one that never
 * loaded ads. A client-side move or prefetch fetches the page into the document that asked, which may have, so such
 * a request gets no page at all: a plain, uncached answer that is not an RSC payload, on which Next's router loads
 * the address as a new document. That page load gets the page.
 */
export function adFreeDocumentOnly(req: NextRequest): NextResponse | null {
  if (!isAdFreePath(req.nextUrl.pathname) || !isPageFetch(req.headers)) return null;
  return new NextResponse("This page loads as a document of its own.", {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "private, no-store, max-age=0",
      "CDN-Cache-Control": "no-store",
      "Vary": "Next-Url, Sec-Fetch-Dest, RSC, Next-Router-Prefetch, Next-Router-State-Tree, Next-Router-Segment-Prefetch",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });
}

export function middleware(req: NextRequest) {
  const adFree = adFreeDocumentOnly(req);
  if (adFree) return adFree;
  const path = req.nextUrl.pathname;
  if (path === "/ops" || path.startsWith("/ops/") || path === "/api/ops" || path.startsWith("/api/ops/")) {
    const response = NextResponse.next();
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    response.headers.set("CDN-Cache-Control", "no-store");
    response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    return response;
  }
  // The signed-in home replaces only `/`; every other matched page (the ad-free ones) passes through as it is.
  if (path !== "/" || !profilesOn()) return NextResponse.next();
  const names = process.env.EVERLOOT_AUTH_V2 === "1" ? BETTER_AUTH_COOKIES : [LEGACY_COOKIE, ...BETTER_AUTH_COOKIES];
  if (!names.some((name) => req.cookies.get(name)?.value)) return NextResponse.next();
  const headers = new Headers(req.headers);
  headers.set(HOME_REWRITE_HEADER, "1");
  // The query goes along (?added=bnet after adding an account).
  const url = req.nextUrl.clone();
  url.pathname = "/home";
  return NextResponse.rewrite(url, { request: { headers } });
}

// The ad-free pages under every version prefix (data/build-versions.json); adFreeDocumentOnly decides by the served one.
export const config = {
  matcher: [
    "/", "/ops/:path*", "/api/ops/:path*",
    "/blizzard-auctions/:path*", "/beta/blizzard-auctions/:path*", "/ptr/blizzard-auctions/:path*",
    "/armory/:path*", "/beta/armory/:path*", "/ptr/armory/:path*",
  ],
};
