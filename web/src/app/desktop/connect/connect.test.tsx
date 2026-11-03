import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`NEXT_REDIRECT ${to}`); } }));
const auth = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getUser: auth.getUser, siteUrl: () => "https://everloot.app" }));

import DesktopConnectPage from "./page";
import { desktopKeyPair } from "@/lib/desktop-connect";

let query: { port: string; state: string; pub: string };
const page = (q: object) => DesktopConnectPage({ searchParams: Promise.resolve(q) });

beforeEach(async () => {
  const app = await desktopKeyPair();
  query = { port: "51234", state: app.state, pub: app.pub };
  auth.getUser.mockReset().mockResolvedValue(null);
});

test("without the app's request the page says to start from the app, and asks nobody", async () => {
  const html = renderToStaticMarkup(await page({ port: "51234" }));
  expect(html).toContain("Open this page from the Everloot Desktop App");
  expect(auth.getUser).not.toHaveBeenCalled();
});

test("signed out, the visitor signs in and comes back to the same request", async () => {
  const back = `/desktop/connect?port=51234&state=${query.state}&pub=${query.pub}`;
  await expect(page(query)).rejects.toThrow(`NEXT_REDIRECT /sign-in?returnTo=${encodeURIComponent(back)}`);
});

test("signed in, the page names the account, says what the key does and offers Connect or Cancel", async () => {
  auth.getUser.mockResolvedValue({ id: "u1", name: "Volvik#1234" });
  const html = renderToStaticMarkup(await page(query));
  expect(html).toContain("Volvik#1234");
  expect(html).toContain("Everloot Desktop App");
  expect(html).toContain("never sees your Battle.net password");
  expect(html).toContain(">Connect</button>");
  expect(html).toContain(">Cancel</button>");
});

test("with character links on, the page says the key also sends the link codes typed in game; off, it does not", async () => {
  auth.getUser.mockResolvedValue({ id: "u1", name: "Volvik#1234" });
  expect(renderToStaticMarkup(await page(query))).not.toContain("/everloot link");
  vi.stubEnv("EVERLOOT_CHARACTER_LINKS", "1");
  try {
    expect(renderToStaticMarkup(await page(query))).toContain("Codes you type with <code>/everloot link</code> in game are sent to your account");
  } finally {
    vi.unstubAllEnvs();
  }
});

test("an account error says so instead of failing", async () => {
  auth.getUser.mockRejectedValue(new Error("db down"));
  expect(renderToStaticMarkup(await page(query))).toContain("Your account is unavailable right now");
});
