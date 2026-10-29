import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { authV2Enabled, getAuth } from "@/lib/auth/auth";
import { RETURN_COOKIE, safeReturnTo } from "@/lib/auth/return-to";
import { siteUrl } from "@/lib/supabase/server";

/**
 * GET /api/auth/bnet — Initiate Battle.net OAuth flow.
 * Redirects user to Battle.net authorization page. `?returnTo=/path` is where the visitor lands afterwards.
 */
export async function GET(req: Request) {
  const clientId = process.env.BNET_CLIENT_ID;
  const redirectUri = process.env.BNET_REDIRECT_URI ?? `${siteUrl()}/api/auth/bnet/callback`;
  const state = crypto.randomUUID();
  const returnTo = safeReturnTo(new URL(req.url).searchParams.get("returnTo"));

  if (!clientId || !process.env.BNET_CLIENT_SECRET) {
    return NextResponse.json({ error: "Battle.net sign-in is not configured" }, { status: 503 });
  }

  if (authV2Enabled()) return startBetterAuthSignIn(req, returnTo ?? "/");

  // Store state in cookie for CSRF protection
  const cookieStore = await cookies();
  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: 60 * 10, // 10 minutes
    path: "/",
  };
  cookieStore.set("bnet_oauth_state", state, cookieOptions);
  // A sign-in without a return path must not land on one left over from an earlier, abandoned sign-in.
  if (returnTo) cookieStore.set(RETURN_COOKIE, returnTo, cookieOptions);
  else cookieStore.delete(RETURN_COOKIE);

  const scope = "openid wow.profile";
  const authUrl = `https://oauth.battle.net/authorize?` +
    `client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(scope)}` +
    `&state=${encodeURIComponent(state)}`;

  return NextResponse.redirect(authUrl);
}

// The start goes through Better Auth's router, not api.signInSocial: only the router applies the rate
// limiter, and it keys on the caller's address, so that header travels with the request.
async function startBetterAuthSignIn(req: Request, callbackURL: string) {
  const headers = new Headers({ "content-type": "application/json", origin: siteUrl() });
  for (const name of ["cf-connecting-ip","x-forwarded-for", "x-real-ip", "cookie"]) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }
  const start = await getAuth().handler(new Request(`${process.env.BETTER_AUTH_URL?.trim() || siteUrl()}/api/auth/sign-in/social`, {
    method: "POST", headers, body: JSON.stringify({ provider: "battlenet", callbackURL }),
  }));
  const { url } = await start.json().catch(() => ({})) as { url?: string };
  if (!start.ok || !url) return NextResponse.json({ error: "Battle.net sign-in is unavailable" }, { status: start.ok ? 503 : start.status });
  const response = NextResponse.redirect(url);
  for (const cookie of start.headers.getSetCookie()) response.headers.append("set-cookie", cookie);
  return response;
}
