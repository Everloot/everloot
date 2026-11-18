import { createRequire } from "node:module";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import { emptyMarket, foldMarket } from "../../../../../kb/src/market";
import type { ItemTip } from "./art";

const store = vi.hoisted(() => ({ loadMarket: vi.fn(), loadCorpus: vi.fn() }));
const sell = vi.hoisted(() => new Map<number, number>());
vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadMarket: store.loadMarket, loadCorpus: store.loadCorpus },
}));
// The game files' sell prices come with the tooltips, which live in private storage: stand in for them here.
vi.mock("./art", () => ({
  itemArt: async (ids: readonly number[]) => ({
    assets: null,
    tips: new Map(ids.filter((id) => sell.has(id)).map((id) => [id, {
      name: `Thing ${id}`, color: "#fff", quality: "common", icon: null, lines: [], partial: false, why: [], label: "", level: 1, required: 0, binding: 0,
      sellPrice: sell.get(id)!,
    } satisfies ItemTip])),
  }),
  auctionNames: async (ids: readonly number[]) => new Map(ids.map((id) => [id, `Thing ${id}`])),
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
const dayAgo = (n: number) => new Date(today.getTime() - n * 86_400_000).toISOString();
// [item id, market value]; 40 units each, so no market is thin unless asked.
const scans = (capturedAt: string, house: string, items: [number, number, number?][]) => ["install-a", "install-b", "install-c"].map((installId) => ({
  kind: "auction_snapshot", installId, eventId: `${installId}:${house}:${capturedAt}`, capturedAt, realm: "Forever", house,
  scanId: `${installId}-${house}-${capturedAt}`, part: 1, parts: 1, items: items.map(([id, market, units = 40]) => [id, 2, units, market, market]),
}));
const VENDOR = 2589, KEEP = 765, THIN = 1366, STALE = 25, NEUTRAL_ONLY = 2770;
const market = foldMarket(emptyMarket(), [
  ...scans(dayAgo(0), "Horde", [[VENDOR, 205], [KEEP, 33], [THIN, 10, 5], [NEUTRAL_ONLY, 100]]),
  ...scans(dayAgo(4), "Horde", [[STALE, 10]]),
  ...scans(dayAgo(0), "Neutral", [[NEUTRAL_ONLY, 100]]),
], today);

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
  sell.clear();
  // 205 less 5% is 194: a vendor's 250 is 56 more. 33 less 5% is 31: a vendor's 10 is less. 100 less 5% is 95; less 15%, 85.
  for (const [id, price] of [[VENDOR, 250], [KEEP, 10], [THIN, 500], [STALE, 500], [NEUTRAL_ONLY, 90]]) sell.set(id, price);
});

test("a house's list shows each item a vendor pays more for, with its prices, units and market day", async () => {
  const section = vendorSection(await realmPage({ house: "horde" }));
  expect(section, "the Vendor these section").not.toBeNull();
  expect(section!.querySelector("h2")?.textContent).toBe("Vendor these");
  expect(section!.textContent).toContain("the Horde auction house on Forever after its 5% cut");
  // Thin, stale and kept items are not on it, nor what only the neutral house would lose.
  expect(links(section!)).toEqual([`/database/items/${VENDOR}`]);
  const row = section!.querySelector("tbody tr")!;
  expect(row.querySelector("a")?.textContent).toBe("Thing 2589");
  // Vendor, market, after cut, difference, units, day.
  expect(cells(row).slice(1)).toEqual(["2 silver 50 copper", "2 silver 5 copper", "1 silver 94 copper", "56 copper", "40", today.toISOString().slice(0, 10)]);
});

test("the neutral house uses its 15% cut", async () => {
  const section = vendorSection(await realmPage({ house: "neutral" }));
  expect(section!.textContent).toContain("after its 15% cut");
  expect(links(section!)).toEqual([`/database/items/${NEUTRAL_ONLY}`]);
  // 100 less 15% is 85, 5 under the vendor's 90; the Horde house's 95 is not.
  expect(cells(section!.querySelector("tbody tr")!).slice(1, 5)).toEqual(["90 copper", "1 silver 0 copper", "85 copper", "5 copper"]);
});

test("with every house shown the list asks for a house, and a filter or later page leaves it out", async () => {
  const all = await realmPage({});
  expect(vendorSection(all)).toBeNull();
  expect(doc(all).querySelector("[data-vendor-hint]")?.innerHTML).toContain("house=horde#vendor-these");
  expect(vendorSection(await realmPage({ house: "horde", quality: "common" }))).toBeNull();
});

test("a house with nothing a vendor pays more for says so", async () => {
  sell.set(VENDOR, 1);
  const section = vendorSection(await realmPage({ house: "horde" }));
  expect(section!.querySelector("[data-empty-state]")?.textContent).toContain("No item with a current market here sells for less than a vendor pays");
});
