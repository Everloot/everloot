import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`NEXT_REDIRECT ${to}`); } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
const auth = vi.hoisted(() => ({ getUser: vi.fn(), assets: vi.fn(), launch: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getUser: auth.getUser, siteUrl: () => "https://everloot.app" }));
vi.mock("@/lib/game-assets", () => ({ loadSiteAssets: auth.assets, launchArt: auth.launch }));

import SignInPage from "./page";
import SignUpPage from "../sign-up/page";

const page = (params: Record<string, string> = {}) => ({ searchParams: Promise.resolve(params) });
const ART = { mapId: 249, name: "Onyxia's Lair", kind: "raid" as const, heldBack: false, url: "https://assets.example/onyxia.webp", width: 1920, small: null };

beforeEach(() => {
  vi.stubEnv("BNET_CLIENT_ID", "client");
  vi.stubEnv("BNET_CLIENT_SECRET", "secret");
  auth.getUser.mockReset().mockResolvedValue(null);
  auth.assets.mockReset().mockResolvedValue(null);
  auth.launch.mockReset().mockReturnValue(null);
});
afterEach(() => { vi.unstubAllEnvs(); });

test("the legacy page keeps its one Battle.net link, now a full-width button in the split layout", async () => {
  const html = renderToStaticMarkup(await SignInPage(page()));
  expect(html).toContain("data-auth-shell");
  expect(html).toContain(">Sign in</h1>");
  expect(html.match(/href="\/api\/auth\/bnet"/g)).toHaveLength(1);
  expect(html).toMatch(/<a href="\/api\/auth\/bnet" class="btn w-full[^"]*focus-visible:outline-accent">Sign in with Battle.net<\/a>/);
  // No other method shows without v2: no provider buttons, no email form, no divider.
  expect(html).not.toContain("Continue with");
  expect(html).not.toContain("<form");
  expect(html).not.toContain("or with your email");
  // Without the asset upload the panel is plain: no picture and no credit.
  expect(html).not.toContain("data-page-banner");
  expect(html).not.toContain("Art © Blizzard Entertainment");
});

test("with the art uploaded, the panel shows the home hero's picture and credits it as the home page does", async () => {
  auth.launch.mockReturnValue({ background: ART });
  for (const render of [() => SignInPage(page()), () => SignUpPage(page())]) {
    const html = renderToStaticMarkup(await render());
    expect(html).toContain(`src="${ART.url}"`);
    expect(html).toMatch(/<img[^>]*alt=""[^>]*aria-hidden="true"/);
    expect(html).toContain("Art © Blizzard Entertainment");
  }
});

test("v2 shows every configured provider with its logo, Battle.net as text, then email under a divider", async () => {
  vi.stubEnv("EVERLOOT_AUTH_V2", "1");
  for (const p of ["GOOGLE", "MICROSOFT", "TWITCH", "DISCORD"]) {
    vi.stubEnv(`${p}_CLIENT_ID`, "id");
    vi.stubEnv(`${p}_CLIENT_SECRET`, "secret");
  }
  vi.stubEnv("RESEND_API_KEY", "key");
  vi.stubEnv("EMAIL_FROM", "Everloot <hello@everloot.app>");
  for (const render of [() => SignInPage(page()), () => SignUpPage(page())]) {
    const html = renderToStaticMarkup(await render());
    for (const p of ["google", "microsoft", "twitch", "discord"]) expect(html).toContain(`data-provider-logo="${p}"`);
    expect(html).not.toContain('data-provider-logo="battlenet"');
    expect(html.indexOf("Sign in with Battle.net")).toBeLessThan(html.indexOf("Continue with Google"));
    expect(html.indexOf("Continue with Discord")).toBeLessThan(html.indexOf("or with your email"));
    expect(html.indexOf("or with your email")).toBeLessThan(html.indexOf("<form"));
  }
});

test("a sign-in error sits in its own box above the buttons", async () => {
  const html = renderToStaticMarkup(await SignInPage(page({ error: "access_denied" })));
  expect(html).toMatch(/<div class="rounded-card border border-danger[^"]*"><p role="alert" class="text-sm text-fg">Battle.net sign-in was cancelled/);
  expect(html.indexOf('role="alert"')).toBeLessThan(html.indexOf("/api/auth/bnet"));
});

test("a signed-in visitor is sent on before the decorative art is looked up", async () => {
  auth.getUser.mockResolvedValue({ id: "u1" });
  await expect(SignInPage(page({ returnTo: "/me" }))).rejects.toThrow("NEXT_REDIRECT /me");
  await expect(SignUpPage(page())).rejects.toThrow("NEXT_REDIRECT /account");
  expect(auth.assets).not.toHaveBeenCalled();
});
