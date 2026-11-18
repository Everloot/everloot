import { createRequire } from "node:module";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import { emptyMarket, foldMarket } from "../../../../../kb/src/market";
import type { StoredVendorHouse, StoredVendorRealm } from "@/lib/vendor-these-store";

const store = vi.hoisted(() => ({ loadMarket: vi.fn(), loadCorpus: vi.fn() }));
const stored = vi.hoisted(() => ({ read: vi.fn() }));
const art = vi.hoisted(() => ({ asked: [] as number[][] }));
vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadMarket: store.loadMarket, loadCorpus: store.loadCorpus },
}));
// The list is the cron's stored object: the page reads it and no tooltip for its rows.
vi.mock("@/lib/vendor-these-store", () => ({ storedVendorThese: stored.read }));
vi.mock("./art", () => ({
  itemArt: async (ids: readonly number[]) => { art.asked.push([...ids]); return { assets: null, tips: new Map() }; },
  auctionNames: async () => new Map(),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); },
  permanentRedirect: (url: string) => { throw new Error(`REDIRECT ${url}`); },
  notFound: () => { throw new Error("NOT_FOUND"); },
  useRouter: () => ({ push: () => {} }),
  usePathname: () => "/",
}));

import RealmPage from "./[realm]/page";

const today = new Date();
const day = today.toISOString().slice(0, 10);
const scans = (house: string, items: number[]) => ["install-a", "install-b", "install-c"].map((installId) => ({
  kind: "auction_snapshot", installId, eventId: `${installId}:${house}`, capturedAt: today.toISOString(), realm: "Forever", house,
  scanId: `${installId}-${house}`, part: 1, parts: 1, items: items.map((id) => [id, 2, 40, 205, 205]),
}));
const VENDOR = 2589;
const market = foldMarket(emptyMarket(), [...scans("Horde", [VENDOR, 765]), ...scans("Neutral", [VENDOR])], today);

const house = (over: Partial<StoredVendorHouse> = {}): StoredVendorHouse => ({
  house: "Horde", candidates: 2, unread: 0, total: 1,
  rows: [{ itemId: VENDOR, name: "Thing 2589", vendor: 250, market: 205, afterCut: 194, more: 56, quantity: 40, day }],
  ...over,
});
const realm = (houses: StoredVendorHouse[], dataAsOf: string | null = new Date(today.getTime() - 20 * 60_000).toISOString()): StoredVendorRealm =>
  ({ version: 1, dataAsOf, builtAt: today.toISOString(), realm: "Forever", houses });

const { JSDOM } = createRequire(import.meta.url)("jsdom") as { JSDOM: new (html: string) => { window: { document: Document } } };
const doc = (html: string) => new JSDOM(html).window.document;
const realmPage = async (search: Record<string, string>) =>
  renderToStaticMarkup(await RealmPage({ params: Promise.resolve({ realm: "forever" }), searchParams: Promise.resolve(search) }));
const vendorSection = (html: string) => doc(html).querySelector("[data-vendor-these]");
/** Each cell as a screen reader hears it: coins by their spoken text, not the drawn digits. */
const cells = (row: Element) => [...row.querySelectorAll(":scope > td")].map((td) => {
  const spoken = td.querySelector(":scope > span > .sr-only");
  return (spoken ?? td).textContent?.trim() ?? "";
});
const links = (section: Element) => [...section.querySelectorAll("tbody tr td:first-child a")].map((a) => a.getAttribute("href"));

beforeEach(() => {
  store.loadMarket.mockReset().mockResolvedValue({ state: market, dataAsOf: today.toISOString() });
  store.loadCorpus.mockReset().mockResolvedValue({ uploads: 0, records: [], dataAsOf: null });
  stored.read.mockReset().mockResolvedValue({ realm: realm([house(), house({ house: "Neutral", candidates: 1, total: 0, rows: [] })]), missing: false });
  art.asked = [];
});

test("a picked house shows its stored list, linking each item to the realm's own price page, with the data's age", async () => {
  const section = vendorSection(await realmPage({ house: "horde" }));
  expect(section, "the Vendor these section").not.toBeNull();
  expect(stored.read).toHaveBeenCalledWith("forever");
  expect(section!.querySelector("h2")?.textContent).toBe("Vendor these");
  expect(section!.textContent).toContain("the Horde auction house on Forever after its 5% cut");
  // The realm's item price page, as the rest of the auction tool links; never /database.
  expect(links(section!)).toEqual([`/tools/auctions/forever/${VENDOR}`]);
  const row = section!.querySelector("tbody tr")!;
  expect(row.querySelector("a")?.textContent).toBe("Thing 2589");
  expect(cells(row).slice(1)).toEqual(["2 silver 50 copper", "2 silver 5 copper", "1 silver 94 copper", "56 copper", "40", day]);
  expect(section!.querySelector("[data-vendor-age] time")?.textContent).toBe("20 min ago");
  expect(section!.querySelector("[data-vendor-incomplete]")).toBeNull();
});

test("the list reads no tooltip: an item only on the list is never asked for", async () => {
  const ONLY_LISTED = 4321;
  const rows = [...house().rows, { itemId: ONLY_LISTED, name: null, vendor: 90, market: 50, afterCut: 47, more: 43, quantity: 30, day }];
  stored.read.mockResolvedValue({ realm: realm([house({ total: 2, rows })]), missing: false });
  const section = vendorSection(await realmPage({ house: "horde" }));
  expect(links(section!)).toEqual([`/tools/auctions/forever/${VENDOR}`, `/tools/auctions/forever/${ONLY_LISTED}`]);
  expect(section!.querySelectorAll("tbody tr")[1]?.querySelector("a")?.textContent).toBe(`Item ${ONLY_LISTED}`);
  expect(art.asked.flat()).not.toContain(ONLY_LISTED);
});

test("the neutral house reads its own list and cut, and an empty one says so", async () => {
  const section = vendorSection(await realmPage({ house: "neutral" }));
  expect(section!.textContent).toContain("after its 15% cut");
  expect(section!.querySelector("[data-empty-state]")?.textContent).toContain("No item with a current market here sells for less than a vendor pays");
});

test("a list that is not built yet says so", async () => {
  stored.read.mockResolvedValue({ realm: null, missing: true });
  const section = vendorSection(await realmPage({ house: "horde" }));
  expect(section!.querySelector("[data-vendor-missing]")?.textContent).toContain("isn't built yet");
  expect(section!.querySelector("table")).toBeNull();
  // A realm object from before this house had a market is not built for it either.
  stored.read.mockResolvedValue({ realm: realm([house({ house: "Neutral" })]), missing: false });
  expect(vendorSection(await realmPage({ house: "horde" }))!.querySelector("[data-vendor-missing]")).not.toBeNull();
});

test("a list built while some vendor prices could not be read says it is incomplete, with counts", async () => {
  stored.read.mockResolvedValue({ realm: realm([house({ candidates: 2, unread: 1 })]), missing: false });
  const section = vendorSection(await realmPage({ house: "horde" }));
  expect(links(section!)).toEqual([`/tools/auctions/forever/${VENDOR}`]);
  expect(section!.querySelector("[data-vendor-incomplete]")?.textContent).toBe("Incomplete: 1 of 2 items with a current market here had no vendor price available when this was built and is left out.");
});

test("no vendor price at all, or a store that cannot be read, is unavailable, not an empty list", async () => {
  stored.read.mockResolvedValue({ realm: realm([house({ candidates: 2, unread: 2, total: 0, rows: [] })]), missing: false });
  let section = vendorSection(await realmPage({ house: "horde" }));
  expect(section!.querySelector("[data-vendor-unavailable]")?.textContent).toContain("Vendor prices are unavailable right now");
  expect(section!.querySelector("[data-empty-state]")).toBeNull();
  stored.read.mockResolvedValue({ realm: null, missing: false });
  section = vendorSection(await realmPage({ house: "horde" }));
  expect(section!.querySelector("[data-vendor-unavailable]")).not.toBeNull();
});

test("every house shown asks for a house; a filter or later page leaves the list out and reads nothing", async () => {
  const all = await realmPage({});
  expect(vendorSection(all)).toBeNull();
  expect(doc(all).querySelector("[data-vendor-hint]")?.innerHTML).toContain("house=horde#vendor-these");
  expect(vendorSection(await realmPage({ house: "horde", quality: "common" }))).toBeNull();
  expect(stored.read).not.toHaveBeenCalled();
});

test("the old vendor=1 link still shows the list", async () => {
  expect(vendorSection(await realmPage({ house: "horde", vendor: "1" }))).not.toBeNull();
});
