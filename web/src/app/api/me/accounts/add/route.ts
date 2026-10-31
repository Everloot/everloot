import { NextResponse } from "next/server";
import { authV2Enabled, withAuth } from "@/lib/auth/auth";
import {
  ADD_FROM_COOKIE, deviceUserIds, hasMultiSessionCookie, MAX_DEVICE_ACCOUNTS, multiSessionCookie, profilesOn,
} from "@/lib/auth/device-accounts";
import { siteUrl } from "@/lib/supabase/server";

/**
 * GET /api/me/accounts/add: the step before /sign-in?add=1 (that page sends the visitor here first).
 * - A session from before the multi-session plugin has no `_multi-` cookie, so the next sign-in would replace it
 *   and leave it unreachable. Its cookie is set here, signed as the plugin signs it.
 * - It notes the accounts already on this browser (ADD_FROM_COOKIE, 10 minutes), so the page the sign-in returns
 *   to can tell when the same Battle.net account signed in again.
 * Then back to /sign-in?add=1&ready=1, which refuses at 5 accounts. 404 unless EVERLOOT_PROFILES and Better Auth.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!profilesOn() || !authV2Enabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const to = (path: string) => NextResponse.redirect(new URL(path, siteUrl()), { status: 303, headers: { "Cache-Control": "private, no-store" } });
  try {
    const session = await withAuth((auth) => auth.api.getSession({ headers: req.headers, query: { disableRefresh: true } }));
    if (!session) return to("/sign-in");
    const ids = await deviceUserIds(req.headers, { id: session.user.id, name: session.user.name });
    const response = to("/sign-in?add=1&ready=1");
    if (ids.length >= MAX_DEVICE_ACCOUNTS) return response;
    if (!await hasMultiSessionCookie(req.headers, session.session.token)) {
      const multi = await multiSessionCookie(session.session.token);
      response.cookies.set(multi.name, multi.value, multi.attributes);
    }
    response.cookies.set(ADD_FROM_COOKIE, ids.join(","), {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 600,
    });
    return response;
  } catch {
    return to("/sign-in?add=1&ready=1");
  }
}
