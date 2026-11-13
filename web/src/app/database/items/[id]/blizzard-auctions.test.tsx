import { createRequire } from "node:module";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { emptyMarket, foldMarket } from "../../../../../../kb/src/market";
import type { BlizzardPrice } from "@/lib/blizzard-auctions";

const store = vi.hoisted(() => ({ loadMarket: vi.fn(), loadCorpus: vi.fn() }));
const blizzard = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadMarket: store.loadMarket, loadCorpus: store.loadCorpus },
}));
vi.mock("@/lib/blizzard-auctions", () => ({ loadBlizzardPrices: blizzard.load }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NOT_FOUND"); },
  redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); },
  permanentRedirect: (url: string) => { throw new Error(`PERMANENT ${url}`); },
  useRouter: () => ({ push: () => {} }),
  usePathname: () => "/",
}));

import ItemPage from "./page";
import { BlizzardAuctions, blizzardTime } from "./blizzard-auctions";

const today = new Date();
const dayAgo = (n: number) => new Date(today.getTime() - n * 86_400_000).toISOString();
// Three installs report Linen Cloth (2589) on the Horde house, so the page has player prices, a name and an ad slot.
const installs = ["install-a", "install-b", "install-c"];
const scans = installs.map((installId, i) => ({
  kind: "auction_snapshot", installId, eventId: `${installId}:scan`, capturedAt: dayAgo(0), realm: "Forever", house: "Horde",
  scanId: `${installId}-scan`, part: 1, parts: 1, items: [[2589, 2, 40 + i, 200, 205]],
}));
const named = installs.map((installId, i) => ({ kind: "item_seen", installId, eventId: `seen-${i}`, itemId: 2589, name: "Linen Cloth", capturedAt: dayAgo(1) }));

// Invented Blizzard rows, with prices no player scan above has, so a leak into the wrong place is visible.
const rows: BlizzardPrice[] = [
  { region: "us", houseId: 110, houseName: "Alliance Auction House", snapshotAt: "2026-11-13T12:22:37.000Z", minUnit: 31_337, typicalUnit: 42_424, quantity: 1_234, auctions: 17 },
  { region: "eu", houseId: 116, houseName: "Blackwater Auction House", snapshotAt: "2026-11-13T12:20:05.000Z", minUnit: 31_338, typicalUnit: 42_425, quantity: 3, auctions: 2 },
];

const { JSDOM } = createRequire(import.meta.url)("jsdom") as { JSDOM: new (html: string) => { window: { document: Document } } };
const dom = (html: string) => new JSDOM(html).window.document;
const page = async () => renderToStaticMarkup(await ItemPage({ params: Promise.resolve({ id: "2589" }) }));

beforeEach(() => {
  store.loadMarket.mockReset().mockResolvedValue({ state: foldMarket(emptyMarket(), scans, today), dataAsOf: today.toISOString() });
  store.loadCorpus.mockReset().mockResolvedValue({ uploads: 3, records: named, dataAsOf: dayAgo(1) });
  blizzard.load.mockReset().mockResolvedValue([]);
  vi.stubEnv("NEXT_PUBLIC_ADSENSE_CLIENT", "ca-pub-test");
});
afterEach(() => vi.unstubAllEnvs());

test("the section names its source and the oldest snapshot time, and credits Blizzard", () => {
  const doc = dom(renderToStaticMarkup(<BlizzardAuctions rows={rows} />));
  const heading = doc.querySelector("h2")!;
  expect(heading.textContent).toBe("Blizzard auction house data, as of 13 Nov 2026, 12:20 UTC");
  expect(heading.querySelector("time")!.getAttribute("datetime")).toBe("2026-11-13T12:20:05.000Z");
  expect(doc.body.textContent).toContain("Data from Blizzard Entertainment");
  expect([...doc.querySelectorAll("tbody tr")].map((tr) => tr.textContent)).toEqual([
    expect.stringContaining("Alliance, house 110"),
    expect.stringContaining("Blackwater, house 116"),
  ]);
  expect(blizzardTime("2026-01-02T03:04:59Z")).toBe("2 Jan 2026, 03:04 UTC");
  expect(renderToStaticMarkup(<BlizzardAuctions rows={[]} />)).toBe("");
});

test("the item page shows Blizzard prices in their own section, apart from player prices, and then places no ad", async () => {
  blizzard.load.mockResolvedValue(rows);
  const html = await page();
  expect(blizzard.load).toHaveBeenCalledWith(2589);
  const doc = dom(html);
  const section = doc.querySelector("[data-blizzard-auctions]")!;
  const market = doc.querySelector("[data-market-box]")!;
  expect(section).not.toBeNull();
  expect(market).not.toBeNull();
  expect(section.contains(market) || market.contains(section)).toBe(false);
  expect(market.textContent).not.toMatch(/313|424|Blizzard/);
  // No ad unit, and no Blizzard number in the copy/JSON block or the structured data.
  expect(html).not.toContain("adsbygoogle");
  expect(doc.querySelector('aside[aria-label="Advertisement"]')).toBeNull();
  for (const el of doc.querySelectorAll('script[type="application/ld+json"], [data-open-data], textarea, pre'))
    expect(el.textContent ?? "").not.toMatch(/31337|31,337|42424|42,424|Blizzard auction/);
});

test("without Blizzard rows (tables missing or empty) the page renders as before, ad slot included", async () => {
  const html = await page();
  expect(html).not.toContain("data-blizzard-auctions");
  expect(html).not.toContain("Blizzard auction house data");
  expect(html).toContain("data-market-box");
  expect(html).toContain("adsbygoogle");
});
