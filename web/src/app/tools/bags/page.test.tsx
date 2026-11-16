import { createRequire } from "node:module";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import { emptyMarket, foldMarket, formatCopper } from "../../../../../kb/src/market";
import { BAGS_BUILD, PLAIN_BAGS } from "@/lib/bags";

const store = vi.hoisted(() => ({ loadMarket: vi.fn(), loadCorpus: vi.fn() }));
vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadMarket: store.loadMarket, loadCorpus: store.loadCorpus },
}));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, usePathname: () => "/tools/bags" }));

import BagsPage from "./page";

const today = new Date();
const scans = (items: number[][], house: string) => ["install-a", "install-b", "install-c"].map((installId) => ({
  kind: "auction_snapshot", installId, eventId: `${installId}:${house}`, capturedAt: today.toISOString(), realm: "Forever",
  scanId: `${installId}-${house}`, part: 1, parts: 1, items: items.map(([id, min]) => [id, 1, 3, min, min]), house,
}));

// Three plain bag sizes from the committed file, and two bags of the biggest, so the cheaper one has to win.
const bySize = new Map<number, number[]>();
for (const [id, slots] of PLAIN_BAGS) bySize.set(slots, [...(bySize.get(slots) ?? []), id]);
const sizes = [...bySize.keys()].sort((a, b) => a - b);
const big = sizes.filter((s) => bySize.get(s)!.length >= 2).at(-1)!;
const [small, mid] = sizes.filter((s) => s < big);
const [bigA, bigB] = bySize.get(big)!;
const smallBag = bySize.get(small!)![0]!;
const midBag = bySize.get(mid!)![0]!;

const market = foldMarket(emptyMarket(), [
  // Horde: a small bag, two big ones (the second cheaper) and some cloth.
  ...scans([[smallBag, 1_000], [bigA!, 90_000], [bigB!, 60_000], [2589, 5]], "Horde"),
  // Alliance: the middle size only, cheaper than anything on the Horde side. It must never be read as Horde's.
  ...scans([[midBag, 777]], "Alliance"),
], today);

const { JSDOM } = createRequire(import.meta.url)("jsdom") as { JSDOM: new (html: string) => { window: { document: Document } } };
const text = (html: string) => {
  const document = new JSDOM(html).window.document;
  document.querySelectorAll('[aria-hidden="true"]').forEach((el) => el.remove());
  return (document.body.textContent ?? "").replace(/ gold/g, "g").replace(/ silver/g, "s").replace(/ copper/g, "c");
};
const page = async (search: Record<string, string>) => renderToStaticMarkup(await BagsPage({ searchParams: Promise.resolve(search) }));

beforeEach(() => {
  store.loadMarket.mockReset().mockResolvedValue({ state: market, dataAsOf: today.toISOString() });
  store.loadCorpus.mockReset().mockResolvedValue({ uploads: 0, records: [], dataAsOf: today.toISOString() });
});

test("one house's cheapest bag per size; a size priced only on another house says so, never 0", async () => {
  const html = text(await page({ realm: "forever", house: "horde", b1: String(small), b2: String(small), b3: String(small), b4: String(small) }));
  expect(html).toContain("Cheapest bag of each size");
  expect(html).toContain(formatCopper(60_000));
  expect(html).not.toContain(formatCopper(90_000));
  // The Alliance price is another market: the Horde page lists the size, with no price.
  expect(html).toContain("No public price on this house yet");
  expect(html).not.toContain(formatCopper(777));
});

test("upgrades over the smallest bag, cost per added slot, from the chosen house only", async () => {
  const html = await page({ realm: "forever", house: "horde", b1: String(small), b2: String(big), b3: String(big), b4: String(big) });
  const upgradesTable = text(html.slice(html.indexOf('id="bags-upgrades"')));
  expect(upgradesTable).toContain(`Swapping your smallest bag (${small} slots)`);
  expect(upgradesTable).toContain(`+${big - small!}`);
  expect(upgradesTable).toContain(formatCopper(Math.round(60_000 / (big - small!))));
  expect(upgradesTable).not.toContain(formatCopper(777));
});

test("the page says where the numbers come from and carries the market rule", async () => {
  const html = text(await page({ realm: "forever", house: "horde" }));
  expect(html).toContain(`Slot counts: found in game files, unconfirmed (build ${BAGS_BUILD})`);
  expect(html).toContain("Prices: players' auction scans");
  expect(html).toContain("How are market values made?");
  expect(html).toContain("Each auction house of a realm (Alliance, Horde, neutral) is its own market.");
});

test("without a realm the page asks for one; a house with no prices uses the empty state wording", async () => {
  expect(text(await page({}))).toContain("Pick a realm and an auction house to see what bags cost there.");
  expect(text(await page({ realm: "forever", house: "neutral" }))).toContain("No public prices in the Neutral auction house on Forever yet: a price shows once 3 reporters scan the same item there.");
});

test("with no rollup the page says prices are unrecorded, not zero", async () => {
  store.loadMarket.mockResolvedValue({ state: null, dataAsOf: null });
  expect(text(await page({ realm: "forever", house: "horde" }))).toContain("Market values are unavailable right now. They are unrecorded, not zero.");
});


test("bag pickers offer publicly priced sizes across houses, not unpriced test containers", async () => {
  const document = new JSDOM(await page({ realm: "forever", house: "horde" })).window.document;
  const pickers = document.querySelectorAll<HTMLSelectElement>('select[name^="b"]');
  expect(pickers).toHaveLength(4);
  for (const picker of pickers) {
    const values = [...picker.options].map((option) => option.value);
    expect(values).toContain("0");
    expect(values).toContain(String(small));
    expect(values).toContain(String(mid)); // Priced on Alliance, even while viewing Horde.
    expect(values).not.toContain("98");
    expect(values).not.toContain("40");
  }
});


test("a URL-selected unpriced bag stays selected while unused unpriced sizes stay hidden", async () => {
  const document = new JSDOM(await page({ realm: "forever", house: "horde", b1: "98" })).window.document;
  const selected = document.querySelector<HTMLSelectElement>('select[name="b1"]')!;
  expect(selected.value).toBe("98");
  expect([...selected.options].filter((option) => option.value === "0")).toHaveLength(1);
  expect([...selected.options].map((option) => option.value)).not.toContain("40");
  expect(text(document.documentElement.outerHTML)).toContain("Filling an empty bag slot");
});

test("saved bags remain selectable when market prices are unavailable", async () => {
  store.loadMarket.mockResolvedValue({ state: null, dataAsOf: null });
  const document = new JSDOM(await page({ b1: "98", b2: "40", b3: "invalid" })).window.document;
  expect(document.querySelector<HTMLSelectElement>('select[name="b1"]')!.value).toBe("98");
  expect(document.querySelector<HTMLSelectElement>('select[name="b2"]')!.value).toBe("40");
  expect(document.querySelector<HTMLSelectElement>('select[name="b3"]')!.value).toBe("0");
});
