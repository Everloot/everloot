import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/auth";
import { deviceSessions, profilesOn } from "@/lib/auth/device-accounts";
import { validId } from "@/lib/saved-builds";
import { getUser, siteUrl } from "@/lib/supabase/server";

/**
 * POST /api/me/accounts/switch {userId}: makes another account signed in on this browser the current one.
 * The browser names the account; the server picks its session from the multi-session cookies, so session
 * tokens never reach the page. 404 while EVERLOOT_PROFILES is off.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };
const fail = (status: number, error: string) => NextResponse.json({ error }, { status, headers: NO_STORE });

export async function POST(req: Request) {
  if (!profilesOn()) return fail(404, "Not found");
  if (req.headers.get("origin") !== siteUrl()) return fail(403, "Invalid origin");
  let body: unknown = null;
  try { body = await req.json(); } catch {}
  const userId = (body as { userId?: unknown } | null)?.userId;
  if (!validId(userId)) return fail(400, "Choose an account.");
  try {
    const user = await getUser();
    if (!user) return fail(401, "Sign in first.");
    if (userId === user.id) return NextResponse.json({ ok: true }, { headers: NO_STORE });
    const target = (await deviceSessions(req.headers)).find((s) => s.userId === userId);
    if (!target) return fail(404, "That account is not signed in on this browser.");
    const out = await withAuth((auth) => auth.api.setActiveSession({ headers: req.headers, body: { sessionToken: target.token }, asResponse: true }));
    if (!out.ok) return fail(404, "That account is not signed in on this browser.");
    const response = NextResponse.json({ ok: true }, { headers: NO_STORE });
    for (const cookie of out.headers.getSetCookie()) response.headers.append("set-cookie", cookie);
    return response;
  } catch {
    return fail(503, "Switching accounts is unavailable right now.");
  }
}
