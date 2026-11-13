import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { BlizzardPrice } from "@/lib/blizzard-auctions";

const blizzard = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/lib/blizzard-auctions", () => ({ loadBlizzardPrices: blizzard.load }));
vi.mock("@/lib/shown-item-names", () => ({
  loadShownNames: async () => ({ agreed: new Map([[2589, "Linen Cloth"]]), matched: null }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NOT_FOUND"); },
}));
const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));

import BlizzardAuctionPage, { dynamic, metadata } from "./page";
import { BlizzardAuctions, blizzardTime } from "./blizzard-auctions";

// Invented Blizzard rows. House 110's items and commodities were published at different times.
const rows: BlizzardPrice[] = [
  { region: "us", houseId: 110, houseName: "Alliance Auction House", snapshotAt: "2026-11-13T12:22:37.000Z", minUnit: 31_337, typicalUnit: 42_424, quantity: 1_234, auctions: 17 },
  { region: "eu", houseId: 116, houseName: "Blackwater Auction House", snapshotAt: "2026-11-13T12:20:05.000Z", minUnit: 31_338, typicalUnit: 42_425, quantity: 3, auctions: 2 },
];

const { JSDOM } = createRequire(import.meta.url)("jsdom") as { JSDOM: new (html: string) => { window: { document: Document } } };
const dom = (html: string) => new JSDOM(html).window.document;
const render = async (id = "2589") => renderToStaticMarkup(await BlizzardAuctionPage({ params: Promise.resolve({ id }) }));

beforeEach(() => {
  request.headers = new Headers();
  blizzard.load.mockReset().mockResolvedValue({ ok: true, rows });
  vi.stubEnv("NEXT_PUBLIC_ADSENSE_CLIENT", "ca-pub-test");
});
afterEach(() => vi.unstubAllEnvs());

test("the section names its source and the oldest snapshot time, and each row keeps its own time", () => {
  const doc = dom(renderToStaticMarkup(<BlizzardAuctions read={{ ok: true, rows }} />));
  const heading = doc.querySelector("h2")!;
  expect(heading.textContent).toBe("Blizzard auction house data, as of 13 Nov 2026, 12:20 UTC");
  expect(heading.querySelector("time")!.getAttribute("datetime")).toBe("2026-11-13T12:20:05.000Z");
  const trs = [...doc.querySelectorAll("tbody tr")];
  expect(trs.map((tr) => tr.textContent)).toEqual([
    expect.stringContaining("Alliance, house 110"),
    expect.stringContaining("Blackwater, house 116"),
  ]);
  expect(trs.map((tr) => tr.querySelector("time")!.getAttribute("datetime"))).toEqual(["2026-11-13T12:22:37.000Z", "2026-11-13T12:20:05.000Z"]);
  expect(blizzardTime("2026-01-02T03:04:59Z")).toBe("2 Jan 2026, 03:04 UTC");
});

test("a client-side move or prefetch (an RSC request) gets no prices, only a reload into a document of its own", async () => {
  for (const [name, value] of [["RSC", "1"], ["Next-Router-Prefetch", "1"]] as const) {
    request.headers = new Headers({ [name]: value });
    blizzard.load.mockClear();
    const html = await render();
    expect(blizzard.load).not.toHaveBeenCalled();
    expect(html).not.toContain("data-blizzard-auctions");
    expect(html).not.toContain("31");
    expect(html).toContain("Loading the Blizzard auction house data");
  }
  // A document request reads and shows them.
  request.headers = new Headers();
  expect(await render()).toContain("data-blizzard-auctions");
  expect(blizzard.load).toHaveBeenCalledWith(2589);
});

test("a failed read says it could not be read, apart from an item with no data yet", () => {
  const unread = dom(renderToStaticMarkup(<BlizzardAuctions read={{ ok: false }} />));
  const empty = dom(renderToStaticMarkup(<BlizzardAuctions read={{ ok: true, rows: [] }} />));
  expect(unread.querySelector("[data-blizzard-auctions]")!.getAttribute("data-blizzard-auctions")).toBe("unread");
  expect(unread.querySelector("h2")!.textContent).toBe("Blizzard auction house data could not be read");
  expect(empty.querySelector("[data-blizzard-auctions]")!.getAttribute("data-blizzard-auctions")).toBe("empty");
  expect(empty.querySelector("h2")!.textContent).toBe("No Blizzard auction house data for this item yet");
  for (const doc of [unread, empty]) expect(doc.querySelector("table")).toBeNull();
});

test("the page credits Blizzard, names the item, links back with a plain link and places no ad", async () => {
  const html = await render();
  expect(blizzard.load).toHaveBeenCalledWith(2589);
  const doc = dom(html);
  expect(doc.querySelector("h1")!.textContent).toBe("Linen Cloth: Blizzard auction house data");
  expect(doc.body.textContent).toContain("Data from Blizzard Entertainment");
  expect(doc.querySelector('[data-blizzard-auctions="rows"]')).not.toBeNull();
  expect(doc.querySelector('a[href="/database/items/2589"]')!.textContent).toBe("Back to the item page");
  expect(html).not.toMatch(/adsbygoogle|googlesyndication/);
  expect(doc.querySelector('aside[aria-label="Advertisement"]')).toBeNull();
  // Each state carries the credit and no ad.
  for (const read of [{ ok: false }, { ok: true, rows: [] }]) {
    blizzard.load.mockResolvedValue(read);
    const other = await render();
    expect(other).toContain("Data from Blizzard Entertainment");
    expect(other).not.toMatch(/adsbygoogle|googlesyndication/);
  }
  await expect(render("weapons")).rejects.toThrow("NOT_FOUND");
  await expect(render("0")).rejects.toThrow("NOT_FOUND");
});

test("the page is rendered per request and kept out of search", () => {
  expect(dynamic).toBe("force-dynamic");
  expect(metadata.robots).toEqual({ index: false, follow: false });
});

test("nothing in the route's tree can place an ad", () => {
  const dir = fileURLToPath(new URL(".", import.meta.url));
  for (const file of readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && !f.includes(".test."))) {
    expect(readFileSync(join(dir, file), "utf8"), file).not.toMatch(/AdSlot|adsbygoogle|googlesyndication|OptionalScripts|CookieConsent/);
  }
});
