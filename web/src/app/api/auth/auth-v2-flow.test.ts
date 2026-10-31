import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { memoryAdapter } from "better-auth/adapters/memory";
import type { RateLimitStore } from "@/lib/auth/db";

// Real Better Auth on an in-memory database; only the Battle.net HTTP calls and next/headers are faked.
const state = vi.hoisted(() => ({
  auth: undefined as unknown,
  requestCookie: "",
  setCookie: undefined as unknown as ReturnType<typeof import("vitest").vi.fn>,
}));
vi.mock("@/lib/auth/auth", () => ({ authV2Enabled: () => true, withAuth: (run: (auth: unknown) => unknown) => run(state.auth) }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ cookie: state.requestCookie }),
  cookies: async () => ({ set: state.setCookie, get: () => undefined }),
}));

import { GET as bnetGET } from "./bnet/route";
import { GET as meGET } from "./me/route";
import { POST as logoutPOST } from "./logout/route";
import { GET as allGET, POST as allPOST } from "./[...all]/route";

const env = {
  NODE_ENV: "test",
  BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters",
  BETTER_AUTH_URL: "https://everloot.app",
  BNET_CLIENT_ID: "client",
  BNET_CLIENT_SECRET: "secret",
} as NodeJS.ProcessEnv;

const discovery = {
  issuer: "https://oauth.battle.net",
  authorization_endpoint: "https://oauth.battle.net/authorize",
  token_endpoint: "https://oauth.battle.net/token",
  userinfo_endpoint: "https://oauth.battle.net/userinfo",
  jwks_uri: "https://oauth.battle.net/jwks/certs",
  id_token_signing_alg_values_supported: ["RS256"],
};

type Row = Record<string, unknown>;
let db: Record<string, Row[]>;

let rateLimitRows: Map<string, { count: number; start: number }>;

// Same contract as pgRateLimitStore: a fixed window that starts at the first request.
function windowStore(): RateLimitStore {
  const rows = new Map<string, { count: number; start: number }>();
  rateLimitRows = rows;
  return {
    async consume(key, { window, max }) {
      const now = Date.now();
      const row = rows.get(key);
      const next = !row || now - row.start >= window * 1000 ? { count: 1, start: now } : { count: row.count + 1, start: row.start };
      rows.set(key, next);
      return next.count <= max ? { allowed: true, retryAfter: null } : { allowed: false, retryAfter: window };
    },
  };
}

beforeEach(async () => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://everloot.app");
  vi.stubEnv("BETTER_AUTH_URL", "https://everloot.app");
  vi.stubEnv("BNET_CLIENT_ID", "client");
  vi.stubEnv("BNET_CLIENT_SECRET", "secret");
  vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "server-key");
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === "https://oauth.battle.net/.well-known/openid-configuration") return Response.json(discovery);
    if (url.startsWith(discovery.token_endpoint)) return Response.json({ access_token: "at", token_type: "bearer", expires_in: 86400 });
    if (url.startsWith(discovery.userinfo_endpoint)) return Response.json({ sub: "123", id: 123, battletag: "Thrall#1" });
    if (url.includes("/rest/v1/entitlements")) return Response.json([]);
    throw new Error(`Unexpected fetch: ${url}`);
  }));
  db = { users: [], auth_session: [], auth_account: [], auth_verification: [] };
  // Loaded here, not through the mock factory: the real module imports the server module that imports the mock.
  const { createAuth } = await vi.importActual<typeof import("@/lib/auth/auth")>("@/lib/auth/auth");
  state.auth = createAuth({ database: memoryAdapter(db), rateLimitStore: windowStore(), env });
  state.requestCookie = "";
  state.setCookie = vi.fn();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const start = (ip: string, cookie?: string) =>
  bnetGET(new Request("https://everloot.app/api/auth/bnet", { headers: { "x-forwarded-for": ip, ...(cookie ? { cookie } : {}) } }));
const cookieHeader = (response: Response) => response.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

test("the Battle.net start is rate limited per caller address and writes no database row", async () => {
  const statuses: number[] = [];
  for (let i = 0; i < 4; i++) {
    const res = await start("203.0.113.9");
    statuses.push(res.status);
    if (i < 3) expect(res.headers.get("location")).toContain("https://oauth.battle.net/authorize");
    else expect(res.headers.get("location")).toBeNull();
  }
  expect(statuses.slice(0, 3).every((s) => s >= 300 && s < 400)).toBe(true);
  expect(statuses[3]).toBe(429);
  // Another caller is not affected by the first one's bucket.
  expect((await start("198.51.100.7")).headers.get("location")).toContain("oauth.battle.net");
  expect(db.auth_verification).toEqual([]);
});

// Start at /api/auth/bnet, come back through the catch-all's callback, as a browser would.
async function signIn() {
  const first = await start("203.0.113.9");
  const authorize = new URL(first.headers.get("location") ?? "");
  const callback = await allGET(new Request(
    `https://everloot.app/api/auth/callback/battlenet?code=c&state=${encodeURIComponent(authorize.searchParams.get("state") ?? "")}`,
    { headers: { cookie: cookieHeader(first) } },
  ));
  const sessionCookie = callback.headers.getSetCookie().find((c) => c.startsWith("everloot.session_token="));
  expect(sessionCookie).toBeDefined();
  return (sessionCookie ?? "").split(";")[0];
}

test("sign-in through the allow-listed callback and sign-out through /api/auth/logout both work", async () => {
  const cookie = await signIn();
  state.requestCookie = cookie;
  expect((await (await meGET()).json()).user).toMatchObject({ name: "Thrall#1" });
  expect(db.auth_session).toHaveLength(1);

  const out = await logoutPOST(new Request("https://everloot.app/api/auth/logout", {
    method: "POST", headers: { origin: "https://everloot.app", cookie },
  }));
  expect(await out.json()).toEqual({ ok: true });
  expect(db.auth_session).toEqual([]);
  expect((await (await meGET()).json()).user).toBeNull();
});

test("Better Auth endpoints off the allow-list are 404 and do not touch the rate limiter", async () => {
  const cookie = await signIn();
  const before = new Map(rateLimitRows);
  const update = await allPOST(new Request("https://everloot.app/api/auth/update-user", {
    method: "POST", headers: { "content-type": "application/json", origin: "https://everloot.app", cookie },
    body: JSON.stringify({ name: "Hijacked#1" }),
  }));
  expect(update.status).toBe(404);
  expect((await allGET(new Request("https://everloot.app/api/auth/get-session", { headers: { cookie } }))).status).toBe(404);
  expect((await allGET(new Request("https://everloot.app/api/auth/no-such-path", { headers: { "x-forwarded-for": "198.51.100.99" } }))).status).toBe(404);
  expect(db.users[0].name).toBe("Thrall#1");
  expect(rateLimitRows).toEqual(before);
});

test("a session past its daily refresh gets a fresh 30-day cookie through me", async () => {
  state.requestCookie = await signIn();

  // Fresh session: nothing to refresh, so no cookie is written.
  expect((await (await meGET()).json()).user).toMatchObject({ name: "Thrall#1" });
  expect(state.setCookie).not.toHaveBeenCalled();

  // Two days later the session is older than updateAge, so Better Auth rolls it.
  const expiresAt = new Date(Date.now() + 28 * 24 * 60 * 60 * 1000);
  db.auth_session[0].expires_at = expiresAt;
  expect((await (await meGET()).json()).user).toMatchObject({ name: "Thrall#1" });
  expect(state.setCookie).toHaveBeenCalledWith("everloot.session_token", expect.any(String), expect.objectContaining({ maxAge: 60 * 60 * 24 * 30 }));
  expect((db.auth_session[0].expires_at as Date).getTime()).toBeGreaterThan(expiresAt.getTime() + 24 * 60 * 60 * 1000);
});
