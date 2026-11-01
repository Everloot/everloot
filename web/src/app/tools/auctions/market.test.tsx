import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import { emptyMarket, foldMarket } from "../../../../../kb/src/market";

const store = vi.hoisted(() => ({ loadMarket: vi.fn(), loadCorpus: vi.fn() }));
vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadMarket: store.loadMarket, loadCorpus: store.loadCorpus },
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); },
  permanentRedirect: (url: string) => { throw new Error(`PERMANENT ${url}`); },
  notFound: () => { throw new Error("NOT_FOUND"); },
  useRouter: () => ({ push: () => {} }),
  usePathname: () => "/",
}));

import AuctionHousePage from "./page";
import RealmPage, { generateMetadata as realmMetadata } from "./[realm]/page";
import RealmItemPage, { generateMetadata as itemMetadata } from "./[realm]/[itemId]/page";
import CrossRealmItemPage, { generateMetadata as crossMetadata } from "./item/[itemId]/page";
import { MarketBox, loadMarketBox } from "./MarketBox";
import DatabaseItemPage from "../../database/items/[id]/page";
import { GET as sitemapIndex } from "../../auctions-sitemap.xml/route";
import { GET as sitemapChunk } from "../../auctions-sitemap/[n]/route";

const today = new Date();
const dayAgo = (n: number) => new Date(today.getTime() - n * 86_400_000).toISOString();
const scans = (capturedAt: string, items: number[][], realm = "Forever", installs = ["install-a", "install-b", "install-c"], extra: Record<string, unknown> = {}) => installs.map((installId, i) => ({
  kind: "auction_snapshot", installId, eventId: `${installId}:${capturedAt}`, capturedAt, realm,
  scanId: `${installId}-${capturedAt}`, part: 1, parts: 1, items: items.map(([id, min, market]) => [id, 2, 40 + i, min, market]), ...extra,
}));
const market = foldMarket(emptyMarket(), [
  // Today's Forever scans were read at the Horde auction house: the blend and the Horde house both get them.
  ...scans(dayAgo(0), [[2589, 200, 205], [765, 30, 33]], "Forever", undefined, { house: "Horde" }),
  ...scans(dayAgo(1), [[765, 28, 30]]),
  ...scans(dayAgo(3), [[2589, 180, 190]]),
  ...scans(dayAgo(7), [[765, 25, 27]]),
  ...scans(dayAgo(30), [[4306, 900, 950]]),
  ...scans(dayAgo(0), [[2589, 260, 300]], "Mal'Ganis"),
  ...scans(dayAgo(0), [[2589, 900, 999]], "Nightfall", ["install-x", "install-y"]),
], today);
// Three installs saw item 2589 named Linen Cloth: the name the item pages show.
const named = ["install-a", "install-b", "install-c"].map((installId, i) => ({ kind: "item_seen", installId, eventId: `seen-${i}`, itemId: 2589, name: "Linen Cloth", capturedAt: dayAgo(1) }));

// The rendered text of the markup: tags out, then any stray angle bracket (React escapes real ones as &lt;).
const text = (html: string) => html.replace(/<[^>]*>/g, "").replace(/[<>]/g, "");
const hub = async (searchParams: Record<string, string>) =>
  renderToStaticMarkup(await AuctionHousePage({ searchParams: Promise.resolve(searchParams) }));
const realm = (slug: string, search: Record<string, string> = {}) => ({ params: Promise.resolve({ realm: slug }), searchParams: Promise.resolve(search) });
const realmHtml = async (slug: string, search: Record<string, string> = {}) => renderToStaticMarkup(await RealmPage(realm(slug, search)));
const item = (slug: string, id: string) => ({ params: Promise.resolve({ realm: slug, itemId: id }) });

beforeEach(() => {
  store.loadMarket.mockReset().mockResolvedValue({ state: market, dataAsOf: new Date(today.getTime() - 4 * 60_000).toISOString() });
  store.loadCorpus.mockReset().mockResolvedValue({ uploads: 3, records: named, dataAsOf: "2026-10-20T06:30:00.000Z" });
});

test("the hub is the browse view across realms: names, realms, house switch, category tree and the way to add a realm", async () => {
  const html = await hub({});
  const words = text(html);
  expect(html).toContain("Auction House");
  expect(words).toContain("Updated 4 min ago");
  expect(html).toContain('href="/tools/auctions/forever"');
  expect(html).toContain('href="/tools/auctions/malganis"');
  // Two reporters are not enough: Nightfall is not listed.
  expect(html).not.toContain("Nightfall");
  expect(html).toContain('href="/tools/auctions/forever/2589"');
  expect(words).toContain("Linen Cloth");
  expect(words).toContain("Item 765");
  expect(html).not.toContain("Item 2589");
  // The house switch, the game's categories, the week's change and its trend line.
  expect(html).toContain('href="/tools/auctions?house=horde"');
  expect(words).toMatch(/All houses \(3\)/);
  expect(words).toMatch(/Horde \(2\)/);
  expect(words).toMatch(/Alliance \(0\)/);
  expect(html).toContain('href="/tools/auctions?class=trade-goods"');
  expect(words).toContain("+22%");
  expect(html).toContain("data-sparkline");
  expect(html).toContain('href="/addon"');
  expect(html).toContain('href="/addon#desktop"');
});

test("on a phone the tree is one closed Category control and the house tabs drop their counts from view", async () => {
  const html = await realmHtml("forever", { class: "armor", sub: "leather" });
  // The phone control: closed, naming the current category; the rail is drawn from lg up only.
  const control = /<details data-category-control="[^"]*" class="lg:hidden">([\s\S]*?)<\/details>/.exec(html);
  expect(control).not.toBeNull();
  expect(control![0]).not.toContain(" open");
  expect(text(control![1]!)).toContain("Category: Armor › Leather");
  expect(html).toContain('<div class="hidden lg:block"><nav aria-label="Categories">');
  expect(text(await realmHtml("forever"))).toContain("Category: All");
  // Short tab labels; the counts and "houses" are read out on a phone but drawn only from sm up.
  const tabs = /data-link-tabs[\s\S]*?<\/nav>/.exec(html)![0];
  expect(tabs.match(/data-house-count="[^"]*" class="sr-only[^"]*sm:not-sr-only/g)).toHaveLength(4);
  expect(tabs).toContain('<span class="sr-only sm:not-sr-only"> houses</span>');
});

test("the old page's links and an item id land on the item pages; a word filters by name", async () => {
  await expect(hub({ realm: "Forever" })).rejects.toThrow("REDIRECT /tools/auctions/forever");
  await expect(hub({ realm: "Mal'Ganis", q: "2589" })).rejects.toThrow("REDIRECT /tools/auctions/malganis/2589");
  await expect(hub({ realm: "Forever", item: "2589" })).rejects.toThrow("REDIRECT /tools/auctions/forever/2589");
  await expect(hub({ q: "2589" })).rejects.toThrow("REDIRECT /tools/auctions/item/2589");
  await expect(realmHtml("forever", { q: "765" })).rejects.toThrow("REDIRECT /tools/auctions/forever/765");
  const words = text(await hub({ q: "linen" }));
  expect(words).toContain("Linen Cloth");
  expect(words).not.toContain("Item 765");
  expect(text(await hub({ q: "copper ore" }))).toContain("No items match these filters.");
});

test("a realm page sorts, filters and switches house in the URL; only its plain list is indexed", async () => {
  const html = await realmHtml("forever");
  expect(html).toContain('href="/tools/auctions/forever/2589"');
  expect(html).toContain("1s 98c"); // weighted market: (205*15 + 190*12) / 27 = 198
  expect(html).toContain("2s 0c");
  // Only historical days: the market value is unrecorded, never zero.
  expect(text(html)).toMatch(/Item 4306[\s\S]*unrecorded/);
  // Sortable headers are links; a number column sorts high to low first, and a sort keeps the other filters.
  expect(html).toContain('href="/tools/auctions/forever?sort=-market"');
  expect(await realmHtml("forever", { quality: "common" })).toContain('href="/tools/auctions/forever?quality=common&amp;sort=-market"');
  expect((await realmMetadata(realm("forever"))).robots).toMatchObject({ index: true });
  expect((await realmMetadata(realm("forever", { sort: "market" }))).robots).toMatchObject({ index: false });
  expect((await realmMetadata(realm("forever", { house: "horde" }))).robots).toMatchObject({ index: false });

  const horde = text(await realmHtml("forever", { house: "horde" }));
  expect(horde).toContain("Linen Cloth");
  expect(horde).not.toContain("Item 4306");
  const cloth = text(await realmHtml("forever", { class: "trade-goods", sub: "cloth" }));
  expect(cloth).toContain("Linen Cloth");
  expect(cloth).not.toContain("Item 765");

  await expect(RealmPage(realm("Forever", { house: "horde" }))).rejects.toThrow("PERMANENT /tools/auctions/forever?house=horde");
  await expect(RealmPage(realm("a.b"))).rejects.toThrow("NOT_FOUND");
  await expect(RealmPage(realm("forever", { house: "goblin" }))).rejects.toThrow("NOT_FOUND");
  await expect(RealmPage(realm("forever", { page: "9" }))).rejects.toThrow("NOT_FOUND");
});

test("an empty realm or house shows the meter at its count, says why, and is not indexed", async () => {
  const html = await realmHtml("nightfall");
  expect(text(html)).toContain("No public prices in Nightfall yet: a price shows once 3 players scan the same item there.");
  expect(html).toContain('data-agreement="2"');
  expect(html).toContain('href="/addon"');
  expect((await realmMetadata(realm("nightfall"))).robots).toMatchObject({ index: false });
  const alliance = await realmHtml("forever", { house: "alliance" });
  expect(text(alliance)).toContain("No public prices in the Alliance auction house on Forever yet");
  expect(alliance).toContain('data-agreement="0"');
});

test("with no realm public yet, the hub says when it last checked, not that it was updated", async () => {
  store.loadMarket.mockResolvedValue({ state: emptyMarket(), dataAsOf: new Date(today.getTime() - 4 * 60_000).toISOString() });
  const words = text(await hub({}));
  expect(words).toContain("No realm has public prices yet");
  expect(words).toContain("Checked 4 min ago");
  expect(words).not.toContain("Updated");
});

test("an item page shows its value, a 60-day chart, each house, the other realms, its age and a Dataset", async () => {
  const html = renderToStaticMarkup(await RealmItemPage(item("forever", "2589")));
  const words = text(html);
  expect(words).toContain("Market value1s 98c");
  expect(words).toContain("Updated");
  expect(html).toContain("<svg");
  expect(html).toContain('href="/tools/auctions/malganis/2589"');
  expect(html).toContain('href="/tools/auctions/item/2589"');
  // The houses: Horde has its own price from today's scans.
  expect(words).toMatch(/Houses \(1\)/);
  expect(words).toMatch(/Horde2s 5c2s 0c/);
  // The day list: three days ago the value was 1s 90c.
  expect(html).toMatch(/<td[^>]*>[^<]*<\/td><td[^>]*>1s 90c<\/td>/);
  expect(html).toContain('"@type":"Dataset"');
  expect(html).not.toMatch(/"@type":"(Product|Offer|AggregateRating|Review)"/);
  const meta = await itemMetadata(item("forever", "2589"));
  expect(meta.title).toBe("WoW Forever Linen Cloth Price on Forever");
  expect(meta.alternates?.canonical).toBe("/tools/auctions/forever/2589");
  expect(meta.robots).toMatchObject({ index: true });
});

test("an item with no market value in 14 days, or none at all, is not indexed, and says what it needs", async () => {
  expect((await itemMetadata(item("forever", "4306"))).robots).toMatchObject({ index: false });
  const html = renderToStaticMarkup(await RealmItemPage(item("forever", "9999")));
  expect(text(html)).toContain("No price for Item 9999 on Forever yet: it needs scans from 3 players.");
  expect(html).toContain('data-agreement="0"');
  expect(html).not.toContain('"@type":"Dataset"');
  expect((await itemMetadata(item("forever", "9999"))).robots).toMatchObject({ index: false });
  await expect(RealmItemPage(item("forever", "02589"))).rejects.toThrow("NOT_FOUND");
});

test("the cross-realm page compares every realm with a price", async () => {
  const props = { params: Promise.resolve({ itemId: "2589" }) };
  const html = text(renderToStaticMarkup(await CrossRealmItemPage(props)));
  expect(html).toContain("Linen Cloth");
  expect(html).toContain("Lowest market value1s 98c");
  expect(html).toContain("Highest market value3s 0c");
  expect(html).toContain("Mal&#x27;Ganis");
  expect((await crossMetadata(props)).robots).toMatchObject({ index: true });
  expect((await crossMetadata({ params: Promise.resolve({ itemId: "9999" }) })).robots).toMatchObject({ index: false });
});

test("the item database page gets a small Auction House box only when a price is public", async () => {
  const rows = await loadMarketBox(2589, today);
  expect(rows.map((r) => [r.realm.name, r.house, r.value.market])).toEqual([["Forever", null, 198], ["Forever", "Horde", 205], ["Mal'Ganis", null, 300]]);
  const box = renderToStaticMarkup(<MarketBox itemId={2589} rows={rows} />);
  expect(text(box)).toContain("Auction House");
  expect(box).toContain('href="/tools/auctions/item/2589"');
  expect(box).toContain('href="/tools/auctions/forever/2589"');
  expect(await loadMarketBox(9999, today)).toEqual([]);
  expect(renderToStaticMarkup(<MarketBox itemId={9999} rows={[]} />)).toBe("");
  expect(renderToStaticMarkup(await DatabaseItemPage({ params: Promise.resolve({ id: "2589" }) }))).toContain("data-market-box");
  expect(renderToStaticMarkup(await DatabaseItemPage({ params: Promise.resolve({ id: "765" }) }))).toContain("data-market-box");
  expect(renderToStaticMarkup(await DatabaseItemPage({ params: Promise.resolve({ id: "4306" }) }))).toContain("data-market-box");
  expect(renderToStaticMarkup(await DatabaseItemPage({ params: Promise.resolve({ id: "2592" }) }))).not.toContain("data-market-box");
  store.loadMarket.mockRejectedValue(new Error("down"));
  expect(await loadMarketBox(2589, today)).toEqual([]);
});

test("the Auction House sitemap lists only the indexable pages", async () => {
  expect(await (await sitemapIndex()).text()).toContain("/auctions-sitemap/0.xml");
  const xml = await (await sitemapChunk(new Request("https://everloot.app/auctions-sitemap/0.xml"), { params: Promise.resolve({ n: "0.xml" }) })).text();
  expect(xml).toContain("/tools/auctions/forever/2589</loc>");
  expect(xml).toContain("/tools/auctions/item/2589</loc>");
  expect(xml).not.toContain("4306");
  expect(xml).not.toContain("nightfall");
  store.loadMarket.mockResolvedValue({ state: null, dataAsOf: null, unreachable: true });
  expect((await sitemapIndex()).status).toBe(503);
});

test("an unreadable rollup is unavailable, not zero", async () => {
  store.loadMarket.mockResolvedValue({ state: null, dataAsOf: null, unreachable: true });
  for (const html of [await hub({}), await realmHtml("forever"), renderToStaticMarkup(await RealmItemPage(item("forever", "2589")))]) {
    expect(html).toContain("unavailable");
    expect(html).not.toContain("0c");
  }
});
