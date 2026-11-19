import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import { emptyMarket, foldMarket } from "@kb/market";

const store = vi.hoisted(() => ({ loadMarket: vi.fn(), boards: vi.fn(), live: vi.fn(), reportDates: vi.fn() }));
vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadMarket: store.loadMarket },
}));
// The page reads the stored boards alone; the live reader must never be asked, and no board may be built here.
vi.mock("@/lib/market-boards", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/market-boards")>()),
  storedMarketBoards: store.boards,
  loadMarketBoards: store.live,
}));
vi.mock("@/lib/auction-house", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/auction-house")>();
  return { ...real, realmBoards: vi.fn(real.realmBoards) };
});
vi.mock("@/lib/auction-report-store", () => ({ reportDates: store.reportDates }));
// Names come from the stored boards; the art is the item pages' own stored file, not read here.
vi.mock("../../art", () => ({
  itemArt: async () => ({ assets: null, tips: new Map() }),
  auctionNames: async (ids: number[], _tips: unknown, stored?: ReadonlyMap<number, string | null> | null) =>
    new Map(ids.flatMap((id) => (stored?.get(id) ? [[id, stored.get(id)!] as [number, string]] : []))),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("next/navigation", () => ({
  permanentRedirect: (url: string) => { throw new Error(`PERMANENT ${url}`); },
  notFound: () => { throw new Error("NOT_FOUND"); },
  useRouter: () => ({ push: () => {} }),
  usePathname: () => "/",
}));

import MarketChangesPage, { generateMetadata } from "./page";
import { boardsFromFile, buildMarketBoards, parseBoards } from "@/lib/market-boards";
import * as auctionHouse from "@/lib/auction-house";

const now = new Date();
const day = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86_400_000).toISOString().slice(0, 10);
const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86_400_000 - 60_000).toISOString();
/** One full scan per install; `items` are [itemId, unit market value, units]. */
const scans = (realm: string, faction: "Horde" | "Alliance", daysAgo: number, items: [number, number, number?][], installs = ["install-a", "install-b", "install-c"]) =>
  installs.map((installId) => ({
    kind: "auction_snapshot", installId, capturedAt: at(daysAgo), realm, faction,
    items: items.map(([id, value, units]) => [id, 2, units ?? 40, value, value]),
  }));

// Made-up ids. Horde: 101 rises, 102 falls, 103 is new, 104 has no baseline, 105 is thin today. Alliance: 101 is new.
const state = foldMarket(emptyMarket(), [
  ...scans("Forever", "Horde", 7, [[101, 100], [102, 200], [105, 50]]),
  ...scans("Forever", "Horde", 20, [[104, 100]]),
  ...scans("Forever", "Horde", 0, [[101, 125], [102, 150], [103, 10], [104, 130], [105, 900, 3]]),
  ...scans("Forever", "Alliance", 0, [[101, 300]]),
], now);
const NAMES = new Map([[101, "Made-up Cloth"], [102, "Made-up Herb"]]);
const names = async (ids: number[]) => new Map(ids.map((id) => [id, { name: NAMES.get(id) ?? null, quality: NAMES.has(id) ? "common" : null }]));

const props = (realm: string, search: Record<string, string> = {}) => ({ params: Promise.resolve({ realm }), searchParams: Promise.resolve(search) });
const page = async (realm: string, search: Record<string, string> = {}) => renderToStaticMarkup(await MarketChangesPage(props(realm, search)));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

beforeEach(async () => {
  store.loadMarket.mockReset().mockResolvedValue({ state, dataAsOf: at(0) });
  const view = boardsFromFile(parseBoards(JSON.stringify(await buildMarketBoards(state, at(0), now, names)))!);
  vi.mocked(auctionHouse.realmBoards).mockClear();
  store.boards.mockReset().mockResolvedValue(view);
  store.live.mockReset().mockImplementation(async () => { throw new Error("the live boards must not be read"); });
  store.reportDates.mockReset().mockResolvedValue([day(0)]);
});

test("the stored boards path: risers, fallers and the rows without a comparison, each with its days, scope and state", async () => {
  const html = await page("forever");
  const t = text(html);
  // The house the URL does not name is the busiest; every number names it.
  expect(t).toContain("Horde auction house");
  expect(t).toContain(`End: ${day(0)}`);
  expect(t).toContain(`Start: ${day(7)}`);
  expect(html).toContain('href="/tools/auctions/forever/101"');
  expect(t).toMatch(/Made-up Cloth.*1s 0c.*1s 25c.*\+25%.*rose/);
  expect(t).toMatch(/Made-up Herb.*2s 0c.*1s 50c.*−25%.*fell/);
  expect(t).toContain(`${day(7)} → ${day(0)}`);
  expect(t).toMatch(/Item 103.*new/);
  expect(t).toMatch(/Item 104.*no baseline/);
  expect(t).toMatch(/Item 105.*3 \(thin\).*thin/);
  expect(t).toContain("new: first public day inside the last 7 days");
  expect(t).toContain("1 riser · Forever, Horde auction house");
  expect(t).toContain("3 items: 1 new, 1 thin, 1 no baseline");
  expect(t).toContain("Units listed are offered inventory on the scan day, not sales");
  expect(t).toContain("Scans up to");
  expect(html).toContain(`href="/tools/auctions/report/${day(0)}"`);
  expect(html).toContain('href="/tools/auctions/forever?house=horde"');
  // Only the stored file was read: no live boards, no board built from the rollup.
  expect(store.live).not.toHaveBeenCalled();
  expect(auctionHouse.realmBoards).not.toHaveBeenCalled();

  const alliance = text(await page("forever", { house: "alliance" }));
  expect(alliance).toContain("Alliance auction house");
  expect(alliance).toContain("No item rose this week");
  expect(alliance).toMatch(/Made-up Cloth.*new/);
  // No report for the week's end day: no link.
  store.reportDates.mockResolvedValue([]);
  expect(await page("forever")).not.toContain("/tools/auctions/report/");
});

test("the metadata names the realm and house; only the plain view with a move is indexed", async () => {
  const plain = await generateMetadata(props("forever"));
  expect(plain.title).toBe("WoW Forever Forever Market Changes This Week");
  expect(String(plain.description)).toContain("the Horde auction house on Forever");
  expect(plain.alternates?.canonical).toBe("/tools/auctions/forever/changes");
  expect(plain.robots).toMatchObject({ index: true });
  expect((await generateMetadata(props("forever", { house: "horde" }))).robots).toMatchObject({ index: false });
  expect((await generateMetadata(props("forever", { house: "alliance" }))).robots).toMatchObject({ index: false });
  expect((await generateMetadata(props("a.b"))).robots).toMatchObject({ index: false });
});

test("spellings the realm page redirects or refuses are treated the same here", async () => {
  await expect(MarketChangesPage(props("Forever", { house: "horde" }))).rejects.toThrow("PERMANENT /tools/auctions/forever/changes?house=horde");
  await expect(MarketChangesPage(props("a.b"))).rejects.toThrow("NOT_FOUND");
  await expect(MarketChangesPage(props("forever", { house: "goblin" }))).rejects.toThrow("NOT_FOUND");
});

test("a realm or house with nothing public says so with the meter, and is not indexed", async () => {
  const t = text(await page("nowhere"));
  expect(t).toContain("No public prices in Nowhere yet");
  expect(t).toContain("Market changes: Nowhere");
  expect((await generateMetadata(props("nowhere"))).robots).toMatchObject({ index: false });
  const neutral = text(await page("forever", { house: "neutral" }));
  expect(neutral).toContain("No public prices in the Neutral auction house on Forever yet");
});

test("without stored boards the page says they are unavailable and never builds them", async () => {
  store.boards.mockResolvedValue(null);
  const html = await page("forever");
  const t = text(html);
  expect(t).toContain("The stored market boards are unavailable right now, so this week's changes are unrecorded, not zero.");
  expect(t).not.toContain("Risers");
  expect(html).not.toContain("data-realm-house-picker");
  expect(store.live).not.toHaveBeenCalled();
  expect(auctionHouse.realmBoards).not.toHaveBeenCalled();
  expect((await generateMetadata(props("forever"))).robots).toMatchObject({ index: false });
});
