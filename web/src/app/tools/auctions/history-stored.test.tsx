import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import { emptyMarket, foldMarket } from "../../../../../kb/src/market";

const store = vi.hoisted(() => ({ loadMarket: vi.fn(), loadCorpus: vi.fn(), stored: vi.fn() }));
vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadMarket: store.loadMarket, loadCorpus: store.loadCorpus },
}));
vi.mock("@/lib/auction-history-store", () => ({ storedAuctionHistory: store.stored }));
// Names and art read their own stored files; this test is about the history's read alone.
vi.mock("./art", () => ({ itemArt: async () => ({ assets: null, tips: new Map() }), auctionNames: async () => new Map([[2589, "Linen Cloth"]]) }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("next/navigation", () => ({
  permanentRedirect: (url: string) => { throw new Error(`PERMANENT ${url}`); },
  notFound: () => { throw new Error("NOT_FOUND"); },
}));

import RealmItemPage from "./[realm]/[itemId]/page";

const today = new Date();
const capturedAt = new Date(today.getTime() - 60 * 60_000).toISOString();
const market = foldMarket(emptyMarket(), ["install-a", "install-b", "install-c"].map((installId, i) => ({
  kind: "auction_snapshot", faction: "Horde", installId, eventId: `${installId}:${capturedAt}`, capturedAt, realm: "Forever",
  scanId: `${installId}-${capturedAt}`, part: 1, parts: 1, items: [[2589, 2, 40 + i, 200, 205]],
})), today);
const scans = ["a", "b", "c"].map((installId) => ({
  kind: "auction_scan", installId, eventId: `scan-${installId}`, realm: "Forever", itemId: 2589, copper: 150, capturedAt: "2026-11-01T06:00:00Z", priceBasis: "unit",
}));
const page = async () => renderToStaticMarkup(await RealmItemPage({ params: Promise.resolve({ realm: "forever", itemId: "2589" }) }));

beforeEach(() => {
  store.loadMarket.mockReset().mockResolvedValue({ state: market, dataAsOf: today.toISOString() });
  store.loadCorpus.mockReset().mockResolvedValue({ uploads: 3, records: scans, dataAsOf: "2026-11-09T11:50:00.000Z" });
  store.stored.mockReset();
});

test("the history comes from the stored file and the corpus is not read", async () => {
  store.stored.mockResolvedValue({ points: [{ day: "2026-11-01", copper: 150, reporters: 3 }], dataAsOf: "2026-11-09T11:50:00.000Z" });
  const html = await page();
  expect(store.stored).toHaveBeenCalledWith("Forever", 2589);
  expect(store.loadCorpus).not.toHaveBeenCalled();
  expect(html).toContain("Single listings seen while browsing");
  expect(html).toContain("2026-11-01  1s 50c  3 reporters");
});

test("with no stored file the page reads the corpus as before, with the same answer", async () => {
  store.stored.mockResolvedValue(null);
  const html = await page();
  expect(store.loadCorpus).toHaveBeenCalledOnce();
  expect(html).toContain("2026-11-01  1s 50c  3 reporters");
});

test("with no stored file and the corpus out of reach the history says unrecorded, not empty", async () => {
  store.stored.mockResolvedValue(null);
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [], unreachable: true });
  const html = await page();
  expect(html).toContain("Storage unreachable. These figures are unrecorded, not zero.");
  expect(html).not.toContain("Price unrecorded. A day goes on the history");
});
