import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { RETURN_COOKIE, safeReturnTo } from "@/lib/auth/return-to";
import { createSession, SESSION_SECONDS, siteUrl } from "@/lib/supabase/server";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const jar = await cookies();
  const storedState = jar.get("bnet_oauth_state")?.value;
  const returnTo = safeReturnTo(jar.get(RETURN_COOKIE)?.value) ?? "";
  jar.delete("bnet_oauth_state");
  jar.delete(RETURN_COOKIE);
  // A failed sign-in lands back on the sign-in page, which explains the reason and keeps the return path for a retry.
  const failure = (reason: string) =>
    NextResponse.redirect(`${siteUrl()}/sign-in?error=${reason}${returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : ""}`);
  if (!state || !storedState || state !== storedState) return failure("invalid_state");
  if (url.searchParams.has("error")) return failure("access_denied");
  if (!code) return failure("missing_code");
  const clientId = process.env.BNET_CLIENT_ID?.trim();
  const clientSecret = process.env.BNET_CLIENT_SECRET?.trim();
  const redirectUri = process.env.BNET_REDIRECT_URI || `${siteUrl()}/api/auth/bnet/callback`;
  if (!clientId || !clientSecret) return failure("server_config");
  try {
    const tokenRes = await fetch("https://oauth.battle.net/token", {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(10_000),
      headers: { "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}` },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
    });
    if (!tokenRes.ok) throw new Error("token_exchange_failed");
    const tokens = await tokenRes.json() as { access_token?: string };
    if (!tokens.access_token) throw new Error("missing_access_token");
    const profileRes = await fetch("https://oauth.battle.net/userinfo", {
      cache: "no-store", signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!profileRes.ok) throw new Error("profile_fetch_failed");
    const profile = await profileRes.json() as { sub?: string; id?: number; battletag?: string };
    const id = profile.sub || (Number.isSafeInteger(profile.id) ? String(profile.id) : "");
    if (!/^\d+$/.test(id) || !profile.battletag) throw new Error("invalid_profile");
    // Provider tokens are used only for this request and are never persisted.
    const token = await createSession({ id, battletag: profile.battletag });
    const response = NextResponse.redirect(`${siteUrl()}${returnTo}`);
    response.cookies.set("everloot_session", token, {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: SESSION_SECONDS, path: "/",
    });
    return response;
  } catch {
    return failure("callback_failed");
  }
}
