import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { authV2Enabled, withAuth } from "@/lib/auth/auth";

// Battle.net uses our server-side sessions, not Supabase Auth JWTs. The browser
// receives an opaque cookie; only its hash is stored in the private sessions table.
export interface AccountUser { id: string; name: string }
interface UserRow { id: string; bnet_id: string; battletag: string }
export const SESSION_SECONDS = 30 * 24 * 60 * 60;

export function siteUrl(): string {
  const url = new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://everloot.app");
  if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.hostname === "localhost")) {
    throw new Error("Invalid site URL");
  }
  return url.origin;
}

/**
 * A request PostgREST refused: its status, and the error code and message its body gave, PostgreSQL's (42703, a column
 * that does not exist) or PostgREST's own (PGRST202, a function its schema cache does not have). Null and "" without.
 */
export class StorageError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly reason: string;
  constructor(status: number, code: string | null, reason: string) {
    super(`Authentication storage failed (${status})`);
    this.status = status;
    this.code = code;
    this.reason = reason;
  }
}

export async function authQuery<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("Authentication storage is not configured");
  const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/${path}`, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
    headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json", ...init.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { code?: unknown; message?: unknown } | null;
    throw new StorageError(response.status, typeof body?.code === "string" ? body.code : null, typeof body?.message === "string" ? body.message : "");
  }
  if (response.status === 204 || new Headers(init.headers).get("prefer")?.includes("return=minimal")) return undefined as T;
  return await response.json() as T;
}

async function sessionHash(): Promise<string | null> {
  const token = (await cookies()).get("everloot_session")?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  return createHash("sha256").update(token).digest("hex");
}

export async function getUser(): Promise<AccountUser | null> {
  if (authV2Enabled()) {
    const requestHeaders = await headers();
    const session = await withAuth((auth) => auth.api.getSession({ headers: requestHeaders }));
    return session ? { id: session.user.id, name: session.user.name } : null;
  }
  const hash = await sessionHash();
  if (!hash) return null;
  const sessions = await authQuery<Array<{ user_id: string }>>(
    `sessions?select=user_id&token_hash=eq.${hash}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`,
  );
  if (!sessions[0]) return null;
  const users = await authQuery<UserRow[]>(`users?select=id,bnet_id,battletag&id=eq.${encodeURIComponent(sessions[0].user_id)}&limit=1`);
  const user = users[0];
  return user ? { id: user.id, name: user.battletag } : null;
}

export async function createSession(profile: { id: string; battletag: string }): Promise<string> {
  const users = await authQuery<UserRow[]>("users?on_conflict=bnet_id&select=id,bnet_id,battletag", {
    method: "POST", headers: { prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ bnet_id: profile.id, battletag: profile.battletag, updated_at: new Date().toISOString() }),
  });
  if (!users[0]?.id) throw new Error("Authentication user was not saved");
  const token = randomBytes(32).toString("hex");
  await authQuery("sessions", {
    method: "POST", headers: { prefer: "return=minimal" },
    body: JSON.stringify({ user_id: users[0].id, token_hash: createHash("sha256").update(token).digest("hex"),
      expires_at: new Date(Date.now() + SESSION_SECONDS * 1000).toISOString() }),
  });
  return token;
}

export async function revokeSession(): Promise<void> {
  const hash = await sessionHash();
  if (hash) await authQuery(`sessions?token_hash=eq.${hash}`, { method: "DELETE", headers: { prefer: "return=minimal" } });
}

export async function requireAuth(): Promise<AccountUser> {
  const user = await getUser();
  if (!user) throw new Error("UNAUTHORIZED");
  return user;
}
