import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { emptyMarket, foldMarket } from "../../../../../../kb/src/market";

const store = vi.hoisted(() => ({ loadMarket: vi.fn(), loadCorpus: vi.fn() }));
const blizzard = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadMarket: store.loadMarket, loadCorpus: store.loadCorpus },
}));
// Were the item page to read Blizzard data, it would get these rows.
vi.mock("@/lib/blizzard-auctions", () => ({ loadBlizzardPrices: blizzard.load }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href} data-next-link="">{children}</a>,
}));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NOT_FOUND"); },
  redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); },
  permanentRedirect: (url: string) => { throw new Error(`PERMANENT ${url}`); },
  useRouter: () => ({ push: () => {} }),
  usePathname: () => "/",
}));

import ItemPage from "./page";

const today = new Date();
const dayAgo = (n: number) => new Date(today.getTime() - n * 86_400_000).toISOString();
// Three installs report Linen Cloth (2589) on the Horde house, so the page has player prices, a name and an ad slot.
const installs = ["install-a", "install-b", "install-c"];
const scans = installs.map((installId, i) => ({
  kind: "auction_snapshot", installId, eventId: `${installId}:scan`, capturedAt: dayAgo(0), realm: "Forever", house: "Horde",
  scanId: `${installId}-scan`, part: 1, parts: 1, items: [[2589, 2, 40 + i, 200, 205]],
}));
const named = installs.map((installId, i) => ({ kind: "item_seen", installId, eventId: `seen-${i}`, itemId: 2589, name: "Linen Cloth", capturedAt: dayAgo(1) }));

const { JSDOM } = createRequire(import.meta.url)("jsdom") as { JSDOM: new (html: string) => { window: { document: Document } } };

beforeEach(() => {
  store.loadMarket.mockReset().mockResolvedValue({ state: foldMarket(emptyMarket(), scans, today), dataAsOf: today.toISOString() });
  store.loadCorpus.mockReset().mockResolvedValue({ uploads: 3, records: named, dataAsOf: dayAgo(1) });
  blizzard.load.mockReset().mockResolvedValue({ ok: true, rows: [
    { region: "us", houseId: 110, houseName: "Alliance Auction House", snapshotAt: "2026-11-13T12:22:37.000Z", minUnit: 31_337, typicalUnit: 42_424, quantity: 1_234, auctions: 17 },
  ] });
  vi.stubEnv("NEXT_PUBLIC_ADSENSE_CLIENT", "ca-pub-test");
});
afterEach(() => vi.unstubAllEnvs());

test("the item page, which carries ads, reads no Blizzard data and only links to the ad-free page", async () => {
  const html = renderToStaticMarkup(await ItemPage({ params: Promise.resolve({ id: "2589" }) }));
  expect(blizzard.load).not.toHaveBeenCalled();
  expect(html).toContain("adsbygoogle");
  expect(html).toContain("data-market-box");
  expect(html).not.toMatch(/31337|31,337|42424|42,424|Alliance, house 110|Data from Blizzard|data-blizzard-auctions/);
  const link = new JSDOM(html).window.document.querySelector('a[href="/blizzard-auctions/2589"]')!;
  expect(link.textContent).toBe("Blizzard auction house data for this item");
  // A plain link: next/link would prefetch the Blizzard page's data into this document.
  expect(link.hasAttribute("data-next-link")).toBe(false);
});

test("the item page's source names neither the loader nor the store", () => {
  const source = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");
  expect(source).not.toMatch(/blizzard_auction|loadBlizzardPrices|BlizzardPrice|BlizzardAuctions|lib\/blizzard-auctions/);
});
