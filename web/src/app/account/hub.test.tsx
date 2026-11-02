import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, className, ...rest }: { href: string; children: ReactNode; className?: string; "aria-current"?: "page" }) =>
    <a href={href} className={className} aria-current={rest["aria-current"]}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

import YourEverlootHeader from "@/components/YourEverloot";
import Integrations from "./integrations";

afterEach(() => { vi.unstubAllEnvs(); });

const tabs = (html: string) => [...html.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => m[1]);

test("every hub page gets the site's page header and one tab row, its own tab marked current", () => {
  vi.stubEnv("EVERLOOT_PROFILES", "1");
  vi.stubEnv("EVERLOOT_SAVED_BUILDS", "1");
  const html = renderToStaticMarkup(<YourEverlootHeader current="/me" title="My builds" lede="Your saved builds." />);
  expect(html).toContain("data-page-header");
  expect(html).toContain(">My builds</h1>");
  expect(html).toContain('aria-label="Your Everloot"');
  expect(tabs(html)).toEqual(["/account", "/settings", "/me", "/tools/builds", "/tools/alts", "/upload"]);
  expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  expect(html).toMatch(/<a href="\/me"[^>]*aria-current="page"/);
});

test("pages behind a switch that is off are left out of the tabs", () => {
  const html = renderToStaticMarkup(<YourEverlootHeader current="/account" title="Your account" />);
  expect(tabs(html)).toEqual(["/account", "/tools/builds", "/tools/alts", "/upload"]);
});

test("linked logins show their provider's logo; Battle.net and email keep letters", () => {
  const html = renderToStaticMarkup(<Integrations methods={["battlenet", "google", "discord", "credential"]} name="Jaina" overview={null} />);
  expect(html).toContain('data-provider-logo="google"');
  expect(html).toContain('data-provider-logo="discord"');
  expect(html).not.toContain('data-provider-logo="battlenet"');
  expect(html).not.toContain('data-provider-logo="credential"');
  expect(html).toContain(">BN</span>");
  expect(html).toContain(">Em</span>");
});
