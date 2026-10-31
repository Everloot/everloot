import { afterEach, beforeEach, expect, test, vi } from "vitest";

const ME = "11111111-2222-4333-8444-555555555555";
const ALT = "22222222-3333-4444-8555-666666666666";

const auth = vi.hoisted(() => ({
  v2: true,
  getUser: vi.fn(),
  authQuery: vi.fn(),
  api: { listDeviceSessions: vi.fn(), setActiveSession: vi.fn() },
}));
vi.mock("@/lib/supabase/server", () => ({ getUser: auth.getUser, authQuery: auth.authQuery, siteUrl: () => "https://everloot.app" }));
vi.mock("@/lib/auth/auth", () => ({ authV2Enabled: () => auth.v2, withAuth: (run: (value: { api: typeof auth.api }) => unknown) => run({ api: auth.api }) }));

import { GET } from "./route";
import { POST } from "./switch/route";

const device = (userId: string, name: string, token: string) => ({ session: { token, userId }, user: { id: userId, name } });
const list = () => GET(new Request("https://everloot.app/api/me/accounts", { headers: { cookie: "everloot.session_token=a" } }));
const pick = (body: unknown, origin = "https://everloot.app") => POST(new Request("https://everloot.app/api/me/accounts/switch", {
  method: "POST", headers: { origin, "content-type": "application/json", cookie: "everloot.session_token=a" }, body: JSON.stringify(body),
}));

beforeEach(() => {
  vi.stubEnv("EVERLOOT_PROFILES", "1");
  auth.v2 = true;
  auth.getUser.mockReset().mockResolvedValue({ id: ME, name: "Jaina#1" });
  auth.authQuery.mockReset().mockResolvedValue([]);
  Object.values(auth.api).forEach((fn) => fn.mockReset());
  auth.api.listDeviceSessions.mockResolvedValue([device(ALT, "Thrall#2", "tok-alt"), device(ME, "Jaina#1", "tok-me")]);
});
afterEach(() => { vi.unstubAllEnvs(); });

test("with the switch off both routes are 404, and nothing is read", async () => {
  for (const value of ["0", "true", ""]) {
    vi.stubEnv("EVERLOOT_PROFILES", value);
    expect((await list()).status).toBe(404);
    expect((await pick({ userId: ALT })).status).toBe(404);
  }
  expect(auth.getUser).not.toHaveBeenCalled();
  expect(auth.api.listDeviceSessions).not.toHaveBeenCalled();
});

test("signed out is 401", async () => {
  auth.getUser.mockResolvedValue(null);
  expect((await list()).status).toBe(401);
  expect((await pick({ userId: ALT })).status).toBe(401);
  expect(auth.api.setActiveSession).not.toHaveBeenCalled();
});

test("lists the accounts on this browser, current first, with handles from profiles and no session tokens", async () => {
  auth.authQuery.mockResolvedValue([{ user_id: ALT, handle: "thrall", display_name: "Thrall" }]);
  const res = await list();
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("private, no-store");
  const body = await res.json();
  expect(body).toEqual([
    { userId: ME, displayName: "Jaina", handle: null, current: true },
    { userId: ALT, displayName: "Thrall", handle: "thrall", current: false },
  ]);
  expect(JSON.stringify(body)).not.toContain("tok-");
  expect(auth.authQuery.mock.calls[0][0]).toBe(`user_profiles?select=user_id,handle,display_name&user_id=in.(${ME},${ALT})`);
  expect(auth.api.listDeviceSessions.mock.calls[0][0].headers.get("cookie")).toContain("everloot.session_token");
});

test("without user_profiles yet the accounts show their sign-in names, without the BattleTag number as the header does", async () => {
  auth.authQuery.mockRejectedValue(new Error("Authentication storage failed (404)"));
  expect((await (await list()).json()).map((a: { displayName: string }) => a.displayName)).toEqual(["Jaina", "Thrall"]);
});

test("with the legacy session only the current account is listed, and only it can be picked", async () => {
  auth.v2 = false;
  expect(await (await list()).json()).toEqual([{ userId: ME, displayName: "Jaina", handle: null, current: true }]);
  expect(auth.api.listDeviceSessions).not.toHaveBeenCalled();
  expect((await pick({ userId: ALT })).status).toBe(404);
  expect((await pick({ userId: ME })).status).toBe(200);
});

test("switching makes the other account's session current and passes its cookies on", async () => {
  const headers = new Headers();
  headers.append("set-cookie", "everloot.session_token=tok-alt.sig; Path=/; HttpOnly");
  auth.api.setActiveSession.mockResolvedValue(new Response(JSON.stringify({}), { headers }));
  const res = await pick({ userId: ALT });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
  expect(auth.api.setActiveSession.mock.calls[0][0]).toMatchObject({ body: { sessionToken: "tok-alt" }, asResponse: true });
  expect(res.headers.getSetCookie()).toEqual(["everloot.session_token=tok-alt.sig; Path=/; HttpOnly"]);
});

test("an account not signed in here, a bad body or another site cannot switch", async () => {
  expect((await pick({ userId: "33333333-4444-4555-8666-777777777777" })).status).toBe(404);
  expect((await pick({ userId: "not-an-id" })).status).toBe(400);
  expect((await pick(null)).status).toBe(400);
  expect((await pick({ userId: ALT }, "https://evil.example")).status).toBe(403);
  expect(auth.api.setActiveSession).not.toHaveBeenCalled();
  // An expired session is refused by Better Auth.
  auth.api.setActiveSession.mockResolvedValue(Response.json({ code: "INVALID_SESSION_TOKEN" }, { status: 401 }));
  expect((await pick({ userId: ALT })).status).toBe(404);
});

test("fails closed when the session store is down", async () => {
  auth.api.listDeviceSessions.mockRejectedValue(new Error("ECONNREFUSED"));
  expect((await list()).status).toBe(503);
  expect((await pick({ userId: ALT })).status).toBe(503);
});
