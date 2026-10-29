import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const v2 = vi.hoisted(() => {
  const deleteSession = vi.fn();
  return {
    enabled: true,
    v1Token: undefined as string | undefined,
    deleteSession,
    fake: {
      handler: vi.fn(),
      api: { getSession: vi.fn(), signOut: vi.fn(), listDeviceSessions: vi.fn(), revokeDeviceSession: vi.fn(), setActiveSession: vi.fn() },
      $context: Promise.resolve({
        secret: "secret",
        internalAdapter: { deleteSession },
        authCookies: { sessionToken: { name: "everloot.session_token", attributes: { httpOnly: true, sameSite: "lax", path: "/", secure: false } } },
      }),
    },
  };
});
vi.mock("@/lib/auth/auth", () => ({ authV2Enabled: () => v2.enabled, getAuth: () => v2.fake }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ cookie: "everloot.session_token=t" }),
  cookies: async () => ({ get: (name: string) => (name === "everloot_session" && v2.v1Token ? { value: v2.v1Token } : undefined) }),
}));

import { GET as meGET } from "./me/route";
import { GET as bnetGET } from "./bnet/route";
import { POST as logoutPOST } from "./logout/route";
import { GET as allGET, POST as allPOST } from "./[...all]/route";

beforeEach(() => {
  v2.enabled = true;
  v2.v1Token = undefined;
  v2.fake.handler.mockReset();
  v2.deleteSession.mockReset();
  Object.values(v2.fake.api).forEach((fn) => fn.mockReset());
  vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "server-key");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://everloot.app");
  vi.stubEnv("BNET_CLIENT_ID", "client");
  vi.stubEnv("BNET_CLIENT_SECRET", "secret");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

test("v2 me returns id and name from the Better Auth session", async () => {
  v2.fake.api.getSession.mockResolvedValue({ user: { id: USER_ID, name: "Thrall#1", email: "bnet-1@users.everloot.invalid" } });
  vi.stubGlobal("fetch", async () => Response.json([]));
  const response = await meGET();
  expect(await response.json()).toEqual({ user: { id: USER_ID, name: "Thrall#1", entitlements: [] } });
  expect(v2.fake.api.getSession.mock.calls[0][0].headers.get("cookie")).toContain("everloot.session_token");
});

test("v2 me is anonymous without a session", async () => {
  v2.fake.api.getSession.mockResolvedValue(null);
  expect(await (await meGET()).json()).toEqual({ user: null });
});

test("v2 fails closed when the database is down", async () => {
  v2.fake.api.getSession.mockRejectedValue(new Error("ECONNREFUSED"));
  expect((await meGET()).status).toBe(503);
});

test("v2 bnet start goes through the router with the caller address, so the rate limiter sees it", async () => {
  const headers = new Headers({ "content-type": "application/json" });
  headers.append("set-cookie", "everloot.oauth_state=s; Path=/; HttpOnly");
  headers.append("set-cookie", "everloot.other=o; Path=/; HttpOnly");
  v2.fake.handler.mockResolvedValue(
    new Response(JSON.stringify({ url: "https://oauth.battle.net/authorize?x=1", redirect: true }), { headers }),
  );
  const res = await bnetGET(new Request("https://everloot.app/api/auth/bnet", {
    headers: {
      "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "203.0.113.9", "x-real-ip": "203.0.113.9",
      cookie: "a=b", "x-ignored": "1",
    },
  }));
  expect(res.headers.get("location")).toBe("https://oauth.battle.net/authorize?x=1");
  expect(res.headers.getSetCookie()).toEqual(["everloot.oauth_state=s; Path=/; HttpOnly", "everloot.other=o; Path=/; HttpOnly"]);
  const forwarded = v2.fake.handler.mock.calls[0][0] as Request;
  expect(forwarded.method).toBe("POST");
  expect(forwarded.url).toBe("https://everloot.app/api/auth/sign-in/social");
  expect(Object.fromEntries(forwarded.headers)).toEqual({
    "content-type": "application/json", origin: "https://everloot.app",
    "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "203.0.113.9", "x-real-ip": "203.0.113.9", cookie: "a=b",
  });
  expect(await forwarded.json()).toEqual({ provider: "battlenet", callbackURL: "/" });
});

test("v2 bnet start ignores an empty BETTER_AUTH_URL and uses the site URL", async () => {
  vi.stubEnv("BETTER_AUTH_URL", " ");
  v2.fake.handler.mockResolvedValue(Response.json({ url: "https://oauth.battle.net/authorize?x=1", redirect: true }));
  await bnetGET(new Request("https://everloot.app/api/auth/bnet"));
  expect((v2.fake.handler.mock.calls[0][0] as Request).url).toBe("https://everloot.app/api/auth/sign-in/social");
});

test("v2 bnet start passes a refusal through instead of redirecting", async () => {
  v2.fake.handler.mockResolvedValue(Response.json({ message: "Too many requests" }, { status: 429 }));
  const res = await bnetGET(new Request("https://everloot.app/api/auth/bnet"));
  expect(res.status).toBe(429);
  expect(res.headers.get("location")).toBeNull();
});

test("v2 bnet start brings the visitor back to a path on this site, never to another site", async () => {
  v2.fake.handler.mockImplementation(async () => Response.json({ url: "https://oauth.battle.net/authorize?x=1", redirect: true }));
  await bnetGET(new Request("https://everloot.app/api/auth/bnet?returnTo=%2Ftools%2Ftalents%2Fmage%3Fsave%3D1"));
  expect(await (v2.fake.handler.mock.calls[0][0] as Request).json()).toEqual({ provider: "battlenet", callbackURL: "/tools/talents/mage?save=1" });
  await bnetGET(new Request("https://everloot.app/api/auth/bnet?returnTo=https%3A%2F%2Fevil.example"));
  expect(await (v2.fake.handler.mock.calls[1][0] as Request).json()).toEqual({ provider: "battlenet", callbackURL: "/" });
});

test("v2 bnet start is 503 until Battle.net is configured", async () => {
  vi.stubEnv("BNET_CLIENT_SECRET", "");
  const res = await bnetGET(new Request("https://everloot.app/api/auth/bnet"));
  expect(res.status).toBe(503);
  expect(v2.fake.handler).not.toHaveBeenCalled();
});

test("v2 logout signs out through Better Auth and refuses other origins", async () => {
  const headers = new Headers();
  headers.append("set-cookie", "everloot.session_token=; Max-Age=0; Path=/");
  v2.fake.api.signOut.mockResolvedValue(new Response(JSON.stringify({ success: true }), { headers }));
  const send = (origin: string) =>
    logoutPOST(new Request("https://everloot.app/api/auth/logout", { method: "POST", headers: { origin } }));

  expect((await send("https://evil.example")).status).toBe(403);
  expect(v2.fake.api.signOut).not.toHaveBeenCalled();

  const res = await send("https://everloot.app");
  expect(await res.json()).toEqual({ ok: true });
  expect(res.headers.getSetCookie()).toEqual([
    "everloot_session=; Path=/; Max-Age=0; HttpOnly; SameSite=lax",
    "everloot.session_token=; Max-Age=0; Path=/",
  ]);
});

test("v2 logout also ends a v1 session, so rolling the flag back cannot revive it", async () => {
  v2.v1Token = "a".repeat(64);
  v2.fake.api.signOut.mockResolvedValue(Response.json({ success: true }));
  const calls: Array<[string, RequestInit | undefined]> = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push([String(input), init]);
    return new Response(null, { status: 204 });
  });
  const res = await logoutPOST(new Request("https://everloot.app/api/auth/logout", { method: "POST", headers: { origin: "https://everloot.app" } }));
  expect(await res.json()).toEqual({ ok: true });
  const hash = createHash("sha256").update(v2.v1Token).digest("hex");
  expect(calls).toHaveLength(1);
  expect(calls[0][0]).toBe(`https://example.supabase.co/rest/v1/sessions?token_hash=eq.${hash}`);
  expect(calls[0][1]?.method).toBe("DELETE");
  expect(res.headers.getSetCookie()).toContain("everloot_session=; Path=/; Max-Age=0; HttpOnly; SameSite=lax");
});

test("v2 logout still signs out when the v1 session cannot be revoked", async () => {
  v2.v1Token = "b".repeat(64);
  v2.fake.api.signOut.mockResolvedValue(Response.json({ success: true }));
  vi.stubGlobal("fetch", async () => { throw new TypeError("fetch failed"); });
  const res = await logoutPOST(new Request("https://everloot.app/api/auth/logout", { method: "POST", headers: { origin: "https://everloot.app" } }));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
  expect(v2.fake.api.signOut).toHaveBeenCalledTimes(1);
  expect(res.headers.getSetCookie()).toContain("everloot_session=; Path=/; Max-Age=0; HttpOnly; SameSite=lax");
});

test("with account switching on, logout ends only this account and says whether another one took over", async () => {
  vi.stubEnv("EVERLOOT_PROFILES", "1");
  const ALT = "00000000-0000-4000-8000-000000000002";
  v2.fake.api.getSession.mockResolvedValue({ user: { id: USER_ID, name: "Thrall#1" }, session: { token: "tok-me" } });
  v2.fake.api.listDeviceSessions.mockResolvedValue([
    { session: { token: "tok-me" }, user: { id: USER_ID, name: "Thrall#1" } },
    { session: { token: "tok-alt" }, user: { id: ALT, name: "Jaina#2" } },
  ]);
  const headers = new Headers();
  headers.append("set-cookie", "everloot.session_token=tok-alt.sig; Path=/");
  v2.fake.api.revokeDeviceSession.mockResolvedValue(new Response(JSON.stringify({ status: true }), { headers }));
  const send = () => logoutPOST(new Request("https://everloot.app/api/auth/logout", { method: "POST", headers: { origin: "https://everloot.app" } }));

  const res = await send();
  expect(await res.json()).toEqual({ ok: true, next: true });
  expect(v2.fake.api.getSession.mock.calls[0][0].query).toEqual({ disableRefresh: true });
  expect(v2.fake.api.revokeDeviceSession.mock.calls[0][0]).toMatchObject({ body: { sessionToken: "tok-me" }, asResponse: true });
  expect(v2.fake.api.signOut).not.toHaveBeenCalled();
  expect(res.headers.getSetCookie()).toContain("everloot.session_token=tok-alt.sig; Path=/");

  // The last account on this browser: signed out for good.
  v2.fake.api.listDeviceSessions.mockResolvedValue([{ session: { token: "tok-me" }, user: { id: USER_ID, name: "Thrall#1" } }]);
  expect(await (await send()).json()).toEqual({ ok: true, next: false });

  // A session with no multi-session cookie (a sixth sign-in, or one from before the plugin) ends alone: its row is
  // deleted and its cookie expired, never Better Auth's sign-out, whose plugin hook ends every account.
  v2.fake.api.revokeDeviceSession.mockResolvedValue(Response.json({ code: "INVALID_SESSION_TOKEN" }, { status: 401 }));
  const alone = await send();
  expect(await alone.json()).toEqual({ ok: true, next: false });
  expect(v2.deleteSession).toHaveBeenCalledWith("tok-me");
  expect(alone.headers.getSetCookie().some((c) => /^everloot\.session_token=; .*Max-Age=0/.test(c))).toBe(true);
  expect(v2.fake.api.signOut).not.toHaveBeenCalled();

  // ... and with other accounts here, the next one becomes current.
  v2.deleteSession.mockClear();
  v2.fake.api.listDeviceSessions.mockResolvedValue([
    { session: { token: "tok-alt" }, user: { id: ALT, name: "Jaina#2" } },
    { session: { token: "tok-3" }, user: { id: "00000000-0000-4000-8000-000000000003", name: "Rexxar#3" } },
  ]);
  const switched = new Headers();
  switched.append("set-cookie", "everloot.session_token=tok-alt.sig; Path=/");
  v2.fake.api.setActiveSession.mockResolvedValue(new Response(JSON.stringify({}), { headers: switched }));
  const handedOver = await send();
  expect(await handedOver.json()).toEqual({ ok: true, next: true });
  expect(v2.deleteSession).toHaveBeenCalledWith("tok-me");
  expect(v2.fake.api.setActiveSession.mock.calls[0][0]).toMatchObject({ body: { sessionToken: "tok-alt" } });
  expect(handedOver.headers.getSetCookie()).toContain("everloot.session_token=tok-alt.sig; Path=/");
  expect(v2.fake.api.signOut).not.toHaveBeenCalled();

  // No session at all: nothing to revoke, the cookie is expired, the other accounts are left alone.
  v2.fake.api.getSession.mockResolvedValue(null);
  expect(await (await send()).json()).toEqual({ ok: true, next: false });
  expect(v2.fake.api.signOut).not.toHaveBeenCalled();
});

test("with account switching off, logout signs out of every account on the browser as before", async () => {
  v2.fake.api.signOut.mockResolvedValue(Response.json({ success: true }));
  const res = await logoutPOST(new Request("https://everloot.app/api/auth/logout", { method: "POST", headers: { origin: "https://everloot.app" } }));
  expect(await res.json()).toEqual({ ok: true });
  expect(v2.fake.api.getSession).not.toHaveBeenCalled();
  expect(v2.fake.api.revokeDeviceSession).not.toHaveBeenCalled();
});

test("v2 logout fails closed when sign-out errors", async () => {
  v2.fake.api.signOut.mockRejectedValue(new Error("ECONNREFUSED"));
  const res = await logoutPOST(new Request("https://everloot.app/api/auth/logout", { method: "POST" }));
  expect(res.status).toBe(503);
});

test("the catch-all route hands only the Battle.net callback and the error page to Better Auth", async () => {
  v2.fake.handler.mockImplementation(async () => new Response("handled"));
  for (const path of ["/api/auth/callback/battlenet?code=c&state=s", "/api/auth/error?error=state_mismatch"]) {
    expect(await (await allGET(new Request(`https://everloot.app${path}`))).text()).toBe("handled");
  }
  expect(v2.fake.handler).toHaveBeenCalledTimes(2);
});

test.each([
  ["GET", "/api/auth/get-session"],
  ["POST", "/api/auth/update-user"],
  ["POST", "/api/auth/sign-in/social"],
  ["POST", "/api/auth/sign-out"],
  ["GET", "/api/auth/list-accounts"],
  ["POST", "/api/auth/callback/battlenet"],
  ["GET", "/api/auth/callback/github"],
  ["GET", "/api/auth/anything-at-all"],
])("the catch-all route answers %s %s with 404 and never reaches Better Auth", async (method, path) => {
  const request = new Request(`https://everloot.app${path}`, { method });
  const response = await (method === "GET" ? allGET : allPOST)(request);
  expect(response.status).toBe(404);
  expect(v2.fake.handler).not.toHaveBeenCalled();
});

test("with the flag off the catch-all route is 404", async () => {
  v2.enabled = false;
  const request = new Request("https://everloot.app/api/auth/callback/battlenet");
  expect((await allGET(request)).status).toBe(404);
  expect((await allPOST(request)).status).toBe(404);
  expect(v2.fake.handler).not.toHaveBeenCalled();
});

test("the catch-all route hands the email links and forms to Better Auth", async () => {
  v2.fake.handler.mockImplementation(async () => new Response("handled"));
  for (const path of ["/api/auth/verify-email?token=t&callbackURL=/account", "/api/auth/reset-password/tok?callbackURL=/reset-password"]) {
    expect(await (await allGET(new Request(`https://everloot.app${path}`))).text()).toBe("handled");
  }
  for (const path of ["sign-up/email", "sign-in/email", "send-verification-email", "request-password-reset", "reset-password"]) {
    const request = new Request(`https://everloot.app/api/auth/${path}`, { method: "POST", headers: { origin: "https://everloot.app" } });
    expect(await (await allPOST(request)).text()).toBe("handled");
  }
  expect(v2.fake.handler).toHaveBeenCalledTimes(7);
});

test.each([
  ["another site", { origin: "https://evil.example" }],
  ["no origin", {}],
] as [string, Record<string, string>][])("an email form posted from %s is refused before Better Auth", async (_, headers) => {
  const response = await allPOST(new Request("https://everloot.app/api/auth/sign-in/email", { method: "POST", headers }));
  expect(response.status).toBe(403);
  expect(v2.fake.handler).not.toHaveBeenCalled();
});

test.each([
  ["GET", "/api/auth/reset-password/tok/extra"],
  ["GET", "/api/auth/reset-password"],
  ["POST", "/api/auth/change-password"],
  ["POST", "/api/auth/delete-user"],
])("the catch-all route still answers %s %s with 404", async (method, path) => {
  const request = new Request(`https://everloot.app${path}`, { method, headers: { origin: "https://everloot.app" } });
  expect((await (method === "GET" ? allGET : allPOST)(request)).status).toBe(404);
  expect(v2.fake.handler).not.toHaveBeenCalled();
});
