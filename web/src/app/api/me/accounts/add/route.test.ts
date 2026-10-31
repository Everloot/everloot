import { serializeSignedCookie } from "better-call";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const ME = "11111111-2222-4333-8444-555555555555";
const SECRET = "test-secret-at-least-32-characters-long";
const auth = vi.hoisted(() => ({
  v2: true,
  api: { getSession: vi.fn(), listDeviceSessions: vi.fn() },
}));
vi.mock("@/lib/supabase/server", () => ({ getUser: vi.fn(), authQuery: vi.fn(), siteUrl: () => "https://everloot.app" }));
vi.mock("@/lib/auth/auth", () => ({
  authV2Enabled: () => auth.v2,
  withAuth: (run: (value: unknown) => unknown) => run({
    api: auth.api,
    $context: Promise.resolve({
      secret: "test-secret-at-least-32-characters-long",
      authCookies: { sessionToken: { name: "everloot.session_token", attributes: { httpOnly: true, sameSite: "lax", path: "/", secure: false, maxAge: 2592000 } } },
    }),
  }),
}));

import { GET } from "./route";
import { addAccountState } from "@/lib/auth/device-accounts";

const TOKEN = "t".repeat(32); // a session token is any opaque string; this one looks nothing like a secret
const device = (userId: string, token: string) => ({ session: { token }, user: { id: userId, name: "x" } });
const others = (n: number) => Array.from({ length: n }, (_, i) => device(`00000000-0000-4000-8000-00000000000${i + 1}`, `tok-${i}`));
const call = (cookie = "everloot.session_token=s") => GET(new Request("https://everloot.app/api/me/accounts/add", { headers: { cookie } }));

beforeEach(() => {
  vi.stubEnv("EVERLOOT_PROFILES", "1");
  auth.v2 = true;
  auth.api.getSession.mockReset().mockResolvedValue({ user: { id: ME, name: "Jaina#1" }, session: { token: TOKEN } });
  auth.api.listDeviceSessions.mockReset().mockResolvedValue([]);
});
afterEach(() => { vi.unstubAllEnvs(); });

test("404 without the profiles switch or Better Auth", async () => {
  vi.stubEnv("EVERLOOT_PROFILES", "0");
  expect((await call()).status).toBe(404);
  vi.stubEnv("EVERLOOT_PROFILES", "1");
  auth.v2 = false;
  expect((await call()).status).toBe(404);
  expect(auth.api.getSession).not.toHaveBeenCalled();
});

test("a session from before the plugin gets its multi-session cookie, signed exactly as Better Auth signs it", async () => {
  const res = await call();
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toBe("https://everloot.app/sign-in?add=1&ready=1");
  const cookies = res.headers.getSetCookie();
  const multi = cookies.find((c) => c.startsWith(`everloot.session_token_multi-${TOKEN.toLowerCase()}=`))!;
  const expected = await serializeSignedCookie(`everloot.session_token_multi-${TOKEN.toLowerCase()}`, TOKEN, SECRET, {});
  expect(multi.split(";")[0]).toBe(expected.split(";")[0]);
  expect(multi).toMatch(/HttpOnly/i);
  expect(multi).toMatch(/Path=\//);
  expect(multi).toMatch(/SameSite=lax/i);
  // The accounts already here, for the notice after a same-account Battle.net sign-in.
  expect(cookies.find((c) => c.startsWith("everloot_add_from="))).toMatch(new RegExp(`^everloot_add_from=${ME};.*Max-Age=600`));
});

test("a session that has its cookie keeps it; the accounts here are noted", async () => {
  auth.api.listDeviceSessions.mockResolvedValue([device(ME, TOKEN), ...others(2)]);
  const res = await call(`everloot.session_token=s; everloot.session_token_multi-${TOKEN.toLowerCase()}=x`);
  const cookies = res.headers.getSetCookie();
  expect(cookies.some((c) => c.includes("_multi-"))).toBe(false);
  expect(decodeURIComponent(cookies.find((c) => c.startsWith("everloot_add_from="))!.split(";")[0])).toBe(
    `everloot_add_from=${[ME, ...others(2).map((d) => d.user.id)].join(",")}`,
  );
});

test("at 5 accounts nothing is set and the sign-in page says the browser is full", async () => {
  auth.api.listDeviceSessions.mockResolvedValue(others(4));
  const res = await call();
  expect(res.headers.get("location")).toBe("https://everloot.app/sign-in?add=1&ready=1");
  expect(res.headers.getSetCookie()).toEqual([]);
  expect(await addAccountState(new Headers({ cookie: "everloot.session_token=s" }))).toBe("full");
});

test("signed out goes to the plain sign-in; the state helper says what the page should do", async () => {
  const headers = (cookie: string) => new Headers({ cookie });
  expect(await addAccountState(headers("everloot.session_token=s"))).toBe("needs-cookie");
  expect(await addAccountState(headers(`everloot.session_token=s; everloot.session_token_multi-${TOKEN.toLowerCase()}=x`))).toBe("ready");
  auth.api.getSession.mockResolvedValue(null);
  expect(await addAccountState(headers(""))).toBe("signed-out");
  expect((await call()).headers.get("location")).toBe("https://everloot.app/sign-in");
});
