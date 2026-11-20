import { createRequire } from "node:module";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import { emptyMarket, foldMarket, formatCopper } from "@kb/market";
import { DISENCHANT_BUILD } from "@/lib/disenchant";

const store = vi.hoisted(() => ({ loadMarket: vi.fn(), loadCorpus: vi.fn() }));
vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadMarket: store.loadMarket, loadCorpus: store.loadCorpus },
}));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, usePathname: () => "/tools/disenchanting" }));

import DisenchantingPage from "./page";

const DUST = 10940, ESSENCE = 10938;
// Items the committed game files place in band 4 (uncommon armor, item level 5 to 15).
const DISENCHANTED = 763, CHEAP = 1270, DEAR = 1561;
const today = new Date();
let n = 0;
const de = (installId: string, materials: [number, number][]) => ({
  installId, eventId: `de-${n++}`, capturedAt: today.toISOString(), kind: "loot", lootType: "disenchant",
  sourceEvidence: "loot-api", sourceItemId: DISENCHANTED, items: materials.map(([itemId, count]) => ({ itemId, count })),
});
// 4 disenchants from 3 installs: dust 4 units (1 each on average), essence 1 unit (0.25 each).
const records = [de("a", [[DUST, 1]]), de("b", [[DUST, 2]]), de("c", [[ESSENCE, 1]]), de("c", [[DUST, 1]])];

const scans = (items: number[][], house: string) => ["install-a", "install-b", "install-c"].map((installId) => ({
  kind: "auction_snapshot", installId, eventId: `${installId}:${house}`, capturedAt: today.toISOString(), realm: "Forever",
  scanId: `${installId}-${house}`, part: 1, parts: 1, items: items.map(([id, min]) => [id, 1, 3, min, min]), house,
}));
const market = foldMarket(emptyMarket(), [
  ...scans([[DUST, 1_000], [ESSENCE, 5_000], [CHEAP, 300], [DEAR, 100_000]], "Horde"),
  // Alliance prices the dust far higher: never read as Horde's.
  ...scans([[DUST, 900_000]], "Alliance"),
], today);

const { JSDOM } = createRequire(import.meta.url)("jsdom") as { JSDOM: new (html: string) => { window: { document: Document } } };
const doc = (html: string) => new JSDOM(html).window.document;
const text = (html: string) => {
  const document = doc(html);
  document.querySelectorAll('[aria-hidden="true"]').forEach((el) => el.remove());
  return (document.body.textContent ?? "").replace(/ gold/g, "g").replace(/ silver/g, "s").replace(/ copper/g, "c");
};
const page = async (search: Record<string, string>) => renderToStaticMarkup(await DisenchantingPage({ searchParams: Promise.resolve(search) }));
const section = (html: string, id: string) => {
  const el = doc(html).getElementById(id)?.closest("section");
  return el ? el.outerHTML : "";
};

beforeEach(() => {
  store.loadMarket.mockReset().mockResolvedValue({ state: market, dataAsOf: today.toISOString() });
  store.loadCorpus.mockReset().mockResolvedValue({ uploads: 3, records, dataAsOf: today.toISOString() });
});

test("each rated band lists its materials with chance and units, and its value on the chosen house", async () => {
  const html = await page({ realm: "forever", house: "horde" });
  const bands = text(section(html, "disenchant-bands"));
  expect(bands).toContain("Uncommon armor, item level 5 to 15");
  expect(bands).toContain("75% · 1 to 2 each");
  expect(bands).toContain("25% · 1 each");
  expect(bands).toContain("4 disenchants · 3 installs");
  // 1 dust x 1,000 + 0.25 essence x 5,000 = 2,250; after the 5% cut, 2,138.
  expect(bands).toContain(formatCopper(2_250));
  expect(bands).toContain(formatCopper(2_138));
  expect(bands).not.toContain(formatCopper(900_000));
});

test("buy to disenchant lists the items under their band's value after the cut, widest margin first", async () => {
  const html = await page({ realm: "forever", house: "horde" });
  const deals = section(html, "disenchant-deals");
  expect(deals).toContain(`/tools/auctions/forever/${CHEAP}`);
  expect(deals).not.toContain(`/tools/auctions/forever/${DEAR}`);
  expect(text(deals)).toContain(formatCopper(2_138 - 300));
  // Materials are priced on the house and list the bands that give them.
  const materials = text(section(html, "disenchant-materials"));
  expect(materials).toContain(formatCopper(1_000));
  expect(materials).toContain("Uncommon armor, item level 5 to 15: 75%");
});

test("a band short of 3 installs is listed as collecting, never with materials", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 2, records: records.filter((r) => r.installId !== "c"), dataAsOf: today.toISOString() });
  const html = text(await page({}));
  expect(html).toContain("No band has disenchants from 3 installs yet.");
  expect(html).toContain("Uncommon armor, item level 5 to 15: 2 disenchants from 2 installs, 1 more needed.");
  expect(html).not.toContain("75%");
});

test("without a realm the bands still show, and the page asks for a realm for prices", async () => {
  const html = await page({});
  expect(text(html)).toContain("Pick a realm and an auction house to see what each band is worth there");
  expect(text(section(html, "disenchant-bands"))).toContain("75% · 1 to 2 each");
  expect(section(html, "disenchant-bands")).not.toContain("After cut");
  expect(section(html, "disenchant-bands")).toContain(`/database/items/${DUST}`);
});

test("the page names its sources and its method, and an unreadable store is unrecorded, not zero", async () => {
  const html = text(await page({ realm: "forever", house: "horde" }));
  expect(html).toContain(`Bands: found in game files, unconfirmed (build ${DISENCHANT_BUILD})`);
  expect(html).toContain("What is a band?");
  expect(html).toContain("5% on the faction houses, 15% on the neutral one");
  store.loadMarket.mockResolvedValue({ state: null, dataAsOf: null });
  expect(text(await page({ realm: "forever", house: "horde" }))).toContain("Market values are unavailable right now. They are unrecorded, not zero.");
});

test("the realm and house picker reads ?realm= and ?house= as the old form did and replaces its selects", async () => {
  // A link saved from the old form (realm and house as select values) shows the same house.
  const html = await page({ realm: "forever", house: "horde" });
  expect(text(html)).toContain("Horde auction house on Forever");
  expect(html).toContain("data-realm-house-picker");
  expect(html).not.toMatch(/<select[^>]*name="(?:realm|house)"/);
  expect(html).toContain('href="/tools/disenchanting?realm=forever&amp;house=alliance"');
  expect(html).toContain('href="/tools/disenchanting?realm=forever&amp;house=neutral"');
});
