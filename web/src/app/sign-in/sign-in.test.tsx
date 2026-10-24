import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`NEXT_REDIRECT ${to}`); } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
const auth = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getUser: auth.getUser, siteUrl: () => "https://everloot.app" }));

import SignInPage from "./page";

const page = (params: Record<string, string | string[]> = {}) => ({ searchParams: Promise.resolve(params) });

beforeEach(() => {
  vi.stubEnv("BNET_CLIENT_ID", "client");
  vi.stubEnv("BNET_CLIENT_SECRET", "secret");
  auth.getUser.mockReset().mockResolvedValue(null);
});
afterEach(() => { vi.unstubAllEnvs(); });

test("a cancelled Battle.net sign-in is explained above the button, and the retry keeps the return path", async () => {
  const html = renderToStaticMarkup(await SignInPage(page({ error: "access_denied", returnTo: "/me" })));
  expect(html).toContain('<p role="alert" class="text-sm text-fg">Battle.net sign-in was cancelled. Try again when you are ready.</p>');
  expect(html).toContain(`href="/api/auth/bnet?returnTo=${encodeURIComponent("/me")}"`);
});

test("other reasons get their own sentence and the raw code never appears", async () => {
  expect(renderToStaticMarkup(await SignInPage(page({ error: "invalid_state" })))).toContain("That sign-in link is stale. Start again from here.");
  expect(renderToStaticMarkup(await SignInPage(page({ error: "server_config" })))).toContain("Battle.net sign-in is not set up on this site yet.");
  const html = renderToStaticMarkup(await SignInPage(page({ error: "something_odd" })));
  expect(html).toContain("Battle.net did not finish the sign-in. Try again in a minute.");
  expect(html).not.toContain("something_odd");
});

test("without an error there is no alert", async () => {
  expect(renderToStaticMarkup(await SignInPage(page()))).not.toContain('role="alert"');
  expect(renderToStaticMarkup(await SignInPage(page({ error: "" })))).not.toContain('role="alert"');
  expect(renderToStaticMarkup(await SignInPage(page({ error: ["access_denied"] })))).not.toContain('role="alert"');
});
