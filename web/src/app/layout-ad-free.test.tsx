// @vitest-environment jsdom
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { PREFIXES, SERVED } from "@/lib/build-versions";

// The root layout as it is, with its two gates (DocumentBoundary, OptionalScripts) real. The chrome around them is
// stubbed: it reads storage, the session or the build's files, none of which decides where AdSense loads.
let pathname: string | null = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("next/script", () => ({ default: ({ src, id }: { src: string; id: string }) => <script id={id} data-src={src} /> }));
vi.mock("@/app/fonts", () => ({ fontVariables: "" }));
vi.mock("@/components/Header", () => ({ default: () => <header /> }));
vi.mock("@/components/Footer", () => ({ default: () => <footer /> }));
vi.mock("@/components/BugReport", () => ({ default: () => null }));
vi.mock("@/components/Breadcrumbs", () => ({ default: () => null }));
vi.mock("@/components/NavPending", () => ({ NavPendingBar: () => null }));
vi.mock("@/components/game/HoverCards", () => ({ default: () => null }));
vi.mock("@/components/CookieConsent", () => ({ default: () => <div data-consent-banner="" /> }));

import RootLayout from "./layout";

const served = PREFIXES[SERVED.id] ?? "";

/** The document was loaded at `loadedAt`; the app now shows `now`. Rendered as the layout renders in that document. */
function render(loadedAt: string, now: string, page: ReactNode = <p data-page="">page</p>) {
  vi.spyOn(performance, "getEntriesByType").mockImplementation((type) => (type === "navigation" ? [{ name: `http://localhost:3000${loadedAt}` } as PerformanceEntry] : []));
  pathname = now;
  return renderToStaticMarkup(<RootLayout>{page}</RootLayout>);
}

beforeEach(() => vi.stubEnv("NEXT_PUBLIC_ADSENSE_CLIENT", "ca-pub-test"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

test("an item page loads AdSense and the consent banner", () => {
  const html = render("/database/items/2589", "/database/items/2589");
  expect(html).toContain("pagead2.googlesyndication.com");
  expect(html).toContain("data-consent-banner");
  expect(html).toContain("data-page");
});

test("the Blizzard auction page loads neither, under the served version's prefix too", () => {
  for (const path of ["/blizzard-auctions/2589", ...(served ? [`${served}/blizzard-auctions/2589`] : [])]) {
    const html = render(path, path);
    expect(html, path).not.toMatch(/googlesyndication|adsbygoogle|data-consent-banner/);
    expect(html, path).toContain("data-page");
  }
});

test("a move from an item page to the Blizzard page does not mount it in the item page's document, nor the scripts", () => {
  const html = render("/database/items/2589", "/blizzard-auctions/2589");
  // DocumentBoundary holds the page back (it reloads, components/document-boundary.test.tsx), and OptionalScripts stays out.
  expect(html).not.toContain("data-page");
  expect(html).not.toMatch(/googlesyndication|data-consent-banner/);
  // And back: the item page is not mounted in the Blizzard page's document either.
  expect(render("/blizzard-auctions/2589", "/database/items/2589")).not.toContain("data-page");
});
