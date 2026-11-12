import { NextResponse, type NextRequest } from "next/server";
import { HOME_REWRITE_HEADER, profilesOn } from "@/lib/profiles";

/**
 * `/` stays the cached landing page for visitors. With EVERLOOT_PROFILES on and a session cookie, it is
 * rewritten to the signed-in home (/home), which checks the session itself: a stale cookie gets the landing.
 */

/** Better Auth's session cookie (cookiePrefix "everloot"; "__Secure-" in production). */
export const BETTER_AUTH_COOKIES = ["everloot.session_token", "__Secure-everloot.session_token"] as const;
/** The legacy Battle.net session; it counts only while Better Auth is off (EVERLOOT_AUTH_V2). */
export const LEGACY_COOKIE = "everloot_session";

export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (path === "/ops" || path.startsWith("/ops/") || path === "/api/ops" || path.startsWith("/api/ops/")) {
    const response = NextResponse.next();
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    response.headers.set("CDN-Cache-Control", "no-store");
    response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    return response;
  }
  if (!profilesOn()) return NextResponse.next();
  const names = process.env.EVERLOOT_AUTH_V2 === "1" ? BETTER_AUTH_COOKIES : [LEGACY_COOKIE, ...BETTER_AUTH_COOKIES];
  if (!names.some((name) => req.cookies.get(name)?.value)) return NextResponse.next();
  const headers = new Headers(req.headers);
  headers.set(HOME_REWRITE_HEADER, "1");
  // The query goes along (?added=bnet after adding an account).
  const url = req.nextUrl.clone();
  url.pathname = "/home";
  return NextResponse.rewrite(url, { request: { headers } });
}

export const config = { matcher: ["/", "/ops/:path*", "/api/ops/:path*"] };
