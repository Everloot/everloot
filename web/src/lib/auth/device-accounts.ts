import { createHmac } from "node:crypto";
import type { DeviceAccount } from "@/lib/account-shell-types";
import { shortName } from "@/lib/profiles";
import { authQuery, type AccountUser } from "@/lib/supabase/server";
import { authV2Enabled, withAuth } from "./auth";

// The accounts signed in on one browser, for the account switcher
// (docs/design/specs/2026-10-20-account-shell-design.md, "Account switching").

export { profilesOn } from "@/lib/profiles";

/** The multi-session plugin's maximumSessions (auth.ts): a sixth sign-in would replace the current account. */
export const MAX_DEVICE_ACCOUNTS = 5;
/** Set while adding an account: the user ids already on this browser, to spot the same account signing in again. */
export const ADD_FROM_COOKIE = "everloot_add_from";

export interface DeviceSession { token: string; userId: string; name: string }

/**
 * The Better Auth sessions signed in on this browser, one per account, read from the multi-session cookies.
 * Empty with the legacy session, which knows only the current account. The tokens never leave the server.
 */
export async function deviceSessions(headers: Headers): Promise<DeviceSession[]> {
  if (!authV2Enabled()) return [];
  const sessions = await withAuth((auth) => auth.api.listDeviceSessions({ headers }));
  return sessions.map(({ session, user }) => ({ token: session.token, userId: user.id, name: user.name }));
}

/** The user ids signed in on this browser: the current account and every multi-session cookie's. */
export async function deviceUserIds(headers: Headers, current: AccountUser): Promise<string[]> {
  return [...new Set([current.id, ...(await deviceSessions(headers)).map((s) => s.userId)])];
}

/**
 * The multi-session cookie the plugin keeps for a session (better-auth/dist/plugins/multi-session): named
 * `<session cookie>_multi-<token in lower case>`, its value the token signed as better-call signs cookies
 * (`<token>.<base64 HMAC-SHA256 with the auth secret>`, URL-encoded), with the session cookie's attributes.
 */
export async function multiSessionCookie(token: string) {
  const context = await withAuth((auth) => auth.$context);
  const { name, attributes } = context.authCookies.sessionToken;
  const signature = createHmac("sha256", context.secret).update(token).digest("base64");
  return { name: `${name}_multi-${token.toLowerCase()}`, value: `${token}.${signature}`, attributes: cookieOptions(attributes) };
}

/** The session cookie's name and attributes, to delete it. */
export async function sessionCookie() {
  const { name, attributes } = (await withAuth((auth) => auth.$context)).authCookies.sessionToken;
  return { name, attributes: cookieOptions(attributes) };
}

type AuthCookieAttributes = { httpOnly?: boolean; secure?: boolean; sameSite?: string; path?: string; domain?: string; maxAge?: number };

/** Better Auth's cookie attributes as Next's response cookies take them. */
function cookieOptions(a: AuthCookieAttributes) {
  const sameSite = a.sameSite?.toLowerCase();
  return {
    httpOnly: a.httpOnly, secure: a.secure, path: a.path ?? "/", domain: a.domain, maxAge: a.maxAge,
    sameSite: sameSite === "lax" || sameSite === "strict" || sameSite === "none" ? sameSite : undefined,
  } as const;
}

const hasCookie = (headers: Headers, name: string) =>
  headers.get("cookie")?.split(/;\s*/).some((c) => c.split("=")[0].toLowerCase() === name.toLowerCase()) ?? false;

/**
 * Whether this browser can add an account now: `full` at 5 accounts, `needs-cookie` while the current session has
 * no multi-session cookie (GET /api/me/accounts/add sets it), `signed-out`, or `ready`.
 */
export async function addAccountState(headers: Headers): Promise<"signed-out" | "full" | "needs-cookie" | "ready"> {
  const session = await withAuth((auth) => auth.api.getSession({ headers, query: { disableRefresh: true } }));
  if (!session) return "signed-out";
  const ids = await deviceUserIds(headers, { id: session.user.id, name: session.user.name });
  if (ids.length >= MAX_DEVICE_ACCOUNTS) return "full";
  return hasCookie(headers, (await multiSessionCookie(session.session.token)).name) ? "ready" : "needs-cookie";
}

/** Whether the request carries this session's multi-session cookie. */
export async function hasMultiSessionCookie(headers: Headers, token: string): Promise<boolean> {
  return hasCookie(headers, (await multiSessionCookie(token)).name);
}

type ProfileRow ={ user_id: string; handle: string | null; display_name: string | null };

// Handles and display names from user_profiles. Until that table exists (or if the read fails) each account
// shows the name it signed in with and no handle.
async function profiles(userIds: string[]): Promise<Map<string, ProfileRow>> {
  try {
    const ids = userIds.map(encodeURIComponent).join(",");
    const rows = await authQuery<ProfileRow[]>(`user_profiles?select=user_id,handle,display_name&user_id=in.(${ids})`);
    return new Map(rows.map((row) => [row.user_id, row]));
  } catch {
    return new Map();
  }
}

/** The accounts signed in on this browser, the current one first. Names as the header shows them: no BattleTag number. */
export async function deviceAccounts(headers: Headers, current: AccountUser): Promise<DeviceAccount[]> {
  const others = (await deviceSessions(headers)).filter((s) => s.userId !== current.id);
  const accounts = [{ userId: current.id, name: current.name }, ...others.map(({ userId, name }) => ({ userId, name }))];
  const rows = await profiles(accounts.map((a) => a.userId));
  return accounts.map(({ userId, name }) => ({
    userId,
    displayName: rows.get(userId)?.display_name || shortName(name),
    handle: rows.get(userId)?.handle ?? null,
    current: userId === current.id,
  }));
}
