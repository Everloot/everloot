import { NextResponse } from "next/server";
import { authV2Enabled, withAuth } from "@/lib/auth/auth";
import { deviceSessions, profilesOn, sessionCookie } from "@/lib/auth/device-accounts";
import { revokeSession, siteUrl } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  if (origin && origin !== siteUrl()) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  if (authV2Enabled()) return signOutOfBetterAuth(req);
  try {
    await revokeSession();
  } catch {
    return NextResponse.json({ error: "Logout is temporarily unavailable" }, { status: 503 });
  }
  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  clearV1Cookie(response);
  return response;
}

function clearV1Cookie(response: NextResponse) {
  response.cookies.set("everloot_session", "", {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 0, path: "/",
  });
}

async function signOutOfBetterAuth(req: Request) {
  // A v1 session left from before the cutover would come back if the flag were rolled back.
  // Best effort: the Better Auth sign-out below is what this request is for.
  await revokeSession().catch(() => {});
  try {
    const { out, next } = await endSession(req.headers);
    if (!out.ok) throw new Error("sign-out failed");
    const response = NextResponse.json(next === undefined ? { ok: true } : { ok: true, next }, { headers: { "Cache-Control": "no-store" } });
    // Before the appends: response.cookies.set rewrites the whole set-cookie header.
    clearV1Cookie(response);
    for (const cookie of out.headers.getSetCookie()) response.headers.append("set-cookie", cookie);
    return response;
  } catch {
    return NextResponse.json({ error: "Logout is temporarily unavailable" }, { status: 503 });
  }
}

// With account switching on (EVERLOOT_PROFILES), only the current account signs out, and the next account signed
// in on this browser, if any, becomes current; `next` tells the page which. Better Auth's own sign-out is never
// used then: the multi-session plugin's hook on it ends every account on the browser.
async function endSession(headers: Headers): Promise<{ out: Response; next?: boolean }> {
  return withAuth(async (auth) => {
    if (!profilesOn()) return { out: await auth.api.signOut({ headers, asResponse: true }) };
    const session = await auth.api.getSession({ headers, query: { disableRefresh: true } });
    if (!session) return { out: await expireSessionCookie(new Headers()), next: false };
    const others = (await deviceSessions(headers)).filter((s) => s.userId !== session.user.id);
    const out = await auth.api.revokeDeviceSession({ headers, body: { sessionToken: session.session.token }, asResponse: true });
    if (out.ok) return { out, next: others.length > 0 };
    // No multi-session cookie for this session (a sixth sign-in, or one from before the plugin): end this session
    // alone, then make the next account on this browser current.
    await (await auth.$context).internalAdapter.deleteSession(session.session.token);
    const set = new Headers();
    if (others.length > 0) {
      const next = await auth.api.setActiveSession({ headers, body: { sessionToken: others[0].token }, asResponse: true }).catch(() => null);
      if (next?.ok) {
        for (const cookie of next.headers.getSetCookie()) set.append("set-cookie", cookie);
        return { out: new Response(null, { headers: set }), next: true };
      }
    }
    return { out: await expireSessionCookie(set), next: false };
  });
}

async function expireSessionCookie(set: Headers): Promise<Response> {
  const { name, attributes } = await sessionCookie();
  const response = new NextResponse(null);
  response.cookies.set(name, "", { ...attributes, maxAge: 0 });
  for (const cookie of response.headers.getSetCookie()) set.append("set-cookie", cookie);
  return new Response(null, { headers: set });
}
