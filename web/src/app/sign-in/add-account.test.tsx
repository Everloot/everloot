import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`NEXT_REDIRECT ${to}`); } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ cookie: "everloot.session_token=s" }) }));
const auth = vi.hoisted(() => ({ getUser: vi.fn(), state: vi.fn(), assets: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getUser: auth.getUser, siteUrl: () => "https://everloot.app" }));
vi.mock("@/lib/game-assets", () => ({ loadSiteAssets: auth.assets, launchArt: () => null }));
vi.mock("@/lib/auth/device-accounts", async () => ({
  addAccountState: auth.state,
  MAX_DEVICE_ACCOUNTS: 5,
  profilesOn: (await import("@/lib/profiles")).profilesOn,
}));

import SignInPage from "./page";

const add = (extra: Record<string, string> = {}) => ({ searchParams: Promise.resolve({ add: "1", ...extra }) });

beforeEach(() => {
  vi.stubEnv("BNET_CLIENT_ID", "client");
  vi.stubEnv("BNET_CLIENT_SECRET", "secret");
  vi.stubEnv("EVERLOOT_AUTH_V2", "1");
  vi.stubEnv("EVERLOOT_PROFILES", "1");
  auth.getUser.mockReset().mockResolvedValue({ id: "u1", name: "Thrall#1" });
  auth.state.mockReset().mockResolvedValue("ready");
  auth.assets.mockReset().mockResolvedValue(null);
});
afterEach(() => { vi.unstubAllEnvs(); });

test("Add another account keeps the signed-in account on the page and comes back home, marked for Battle.net", async () => {
  const html = renderToStaticMarkup(await SignInPage(add({ ready: "1" })));
  expect(html).toContain(">Add another account</h1>");
  expect(html).toContain("Sign in with the account you want to add.");
  expect(html).toContain(`href="/api/auth/bnet?returnTo=${encodeURIComponent("/?added=bnet")}"`);
});

test("a session with no multi-session cookie goes to get one first, once", async () => {
  auth.state.mockResolvedValue("needs-cookie");
  await expect(SignInPage(add())).rejects.toThrow("NEXT_REDIRECT /api/me/accounts/add");
  // The redirect does not wait for the panel's art.
  expect(auth.assets).not.toHaveBeenCalled();
  // Back with ready=1 and still none: no loop, and no sign-in that would orphan the account.
  const html = renderToStaticMarkup(await SignInPage(add({ ready: "1" })));
  expect(html).toContain("Adding an account is unavailable right now.");
  expect(html).not.toContain("/api/auth/bnet");
});

test("at 5 accounts the page refuses instead of replacing the current one", async () => {
  auth.state.mockResolvedValue("full");
  const html = renderToStaticMarkup(await SignInPage(add({ ready: "1" })));
  expect(html).toContain("You are signed in to 5 accounts on this browser, the most it holds. Sign out of one to add another.");
  expect(html).not.toContain("/api/auth/bnet");
  auth.state.mockRejectedValue(new Error("down"));
  expect(renderToStaticMarkup(await SignInPage(add()))).toContain("unavailable right now");
});

test("signed out, add=1 is the plain sign-in", async () => {
  auth.state.mockResolvedValue("signed-out");
  auth.getUser.mockResolvedValue(null);
  const html = renderToStaticMarkup(await SignInPage(add()));
  expect(html).toContain(">Sign in</h1>");
  expect(html).toContain('href="/api/auth/bnet"');
});

test("without Better Auth or the profiles switch, a signed-in visitor is sent on as before", async () => {
  vi.stubEnv("EVERLOOT_AUTH_V2", "0");
  await expect(SignInPage(add())).rejects.toThrow("NEXT_REDIRECT /account");
  vi.stubEnv("EVERLOOT_AUTH_V2", "1");
  vi.stubEnv("EVERLOOT_PROFILES", "0");
  await expect(SignInPage(add())).rejects.toThrow("NEXT_REDIRECT /account");
  // add is exactly "1".
  vi.stubEnv("EVERLOOT_PROFILES", "1");
  await expect(SignInPage({ searchParams: Promise.resolve({ add: "yes" }) })).rejects.toThrow("NEXT_REDIRECT /account");
  expect(auth.state).not.toHaveBeenCalled();
});
