import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import type { BlizzardHouseItem } from "@/lib/blizzard-auctions";
import { trailFor } from "@/lib/breadcrumbs";
import Page, { dynamic, metadata } from "./page";
import { BlizzardHistory } from "./[id]/history";

const store = vi.hoisted(() => ({ load: vi.fn(), degraded: false }));
vi.mock("@/lib/blizzard-auctions", () => ({ loadBlizzardHouseItems: store.load }));
vi.mock("@/lib/shown-item-names", () => ({ loadShownNames: async () => ({ agreed: new Map(), matched: null, degraded: store.degraded }) }));
const { JSDOM } = createRequire(import.meta.url)("jsdom") as { JSDOM: new (html: string) => { window: { document: Document } } };
const render = async (search: Record<string, string | string[]> = {}) => new JSDOM(renderToStaticMarkup(await Page({ searchParams: Promise.resolve(search) }))).window.document;
const row = (itemId: number): BlizzardHouseItem => ({ itemId, kind: "items", snapshotAt: "2026-11-15T10:00:00.000Z", minUnit: itemId, typicalUnit: 1000 - itemId, quantity: itemId * 2, auctions: itemId });
beforeEach(() => {
  store.load.mockReset().mockResolvedValue({ ok: true, rows: Array.from({ length: 55 }, (_, i) => row(i + 1)) });
  store.degraded = false;
});

test("browse has labelled filters, bounded server pages, house labels, publish time and credit", async () => {
  const doc = await render();
  expect(store.load).toHaveBeenCalledWith("us", 110);
  expect(doc.querySelectorAll("tbody tr")).toHaveLength(50);
  expect(doc.querySelector('a[href="/blizzard-auctions/1"]')).not.toBeNull();
  expect(doc.querySelectorAll("label")).toHaveLength(5);
  expect(doc.querySelector('select[name="house"]')!.textContent).toContain("Roleplay PvP, Horde");
  expect(doc.querySelector("time")!.getAttribute("datetime")).toBe(row(1).snapshotAt);
  expect(doc.body.textContent).toContain("Data from Blizzard Entertainment");
  expect(doc.querySelector('nav[aria-label="Auction results pages"]')!.textContent).toContain("Page 1 of 2");
  const next = doc.querySelector('nav a')!.getAttribute("href")!;
  const second = await render(Object.fromEntries(new URL(next, "https://example.test").searchParams));
  expect(second.querySelectorAll("tbody tr")).toHaveLength(5);
  expect(second.querySelector('a[href="/blizzard-auctions/51"]')).not.toBeNull();
});

test("search and all numeric sorts run before pagination, with URL state retained", async () => {
  for (const sort of ["minUnit", "quantity", "auctions"]) {
    const doc = await render({ region: "eu", house: "124", sort, dir: "desc" });
    expect(doc.querySelector("tbody a")!.getAttribute("href")).toBe("/blizzard-auctions/55");
    expect(doc.querySelector("nav a")!.getAttribute("href")).toContain(`sort=${sort}`);
    expect(store.load).toHaveBeenLastCalledWith("eu", 124);
  }
  const typical = await render({ sort: "typicalUnit" });
  expect(typical.querySelector("tbody a")!.getAttribute("href")).toBe("/blizzard-auctions/55");
  const filtered = await render({ q: "iTeM 55", page: "999" });
  expect(filtered.querySelectorAll("tbody tr")).toHaveLength(1);
  expect(filtered.querySelector("tbody a")!.textContent).toBe("Item 55");
  expect(filtered.querySelector("nav")!.textContent).toContain("Page 1 of 1");
  await render({ region: "kr", house: "-1", page: "bad", sort: "toString", dir: "bad", q: ["55", "1"] });
  expect(store.load).toHaveBeenLastCalledWith("us", 110);
});

test("missing migration and failed reads never become empty prices; names can degrade separately", async () => {
  for (const reason of ["unavailable", "failed"]) {
    store.load.mockResolvedValue({ ok: false, reason });
    const doc = await render();
    expect(doc.querySelector("[role=status]")!.textContent).toContain(reason === "unavailable" ? "not available yet" : "could not be read");
    expect(doc.querySelector("table")).toBeNull();
    expect(doc.body.textContent).not.toContain("No current");
  }
  store.load.mockResolvedValue({ ok: true, rows: [] });
  expect((await render()).body.textContent).toContain("No current Blizzard");
  expect((await render({ q: "999" })).body.textContent).toContain("No items match");
  store.degraded = true;
  expect((await render()).body.textContent).toContain("Name search may be incomplete");
});

test("history shows daily min and typical per house and kind, without filling missing days", () => {
  const price = { region: "us" as const, houseId: 110, houseName: "Alliance Auction House", kind: "items" as const, day: "2026-11-15", snapshotAt: row(1).snapshotAt, minUnit: 10, typicalUnit: 20, quantity: 4, auctions: 2 };
  const doc = new JSDOM(renderToStaticMarkup(<BlizzardHistory read={{ ok: true, rows: [price, { ...price, region: "eu", day: "2026-11-14", kind: "commodities" }] }} />)).window.document;
  expect(doc.querySelectorAll("table")).toHaveLength(2);
  expect(doc.querySelectorAll("tbody tr")).toHaveLength(2);
  expect(doc.querySelectorAll("th")[2].textContent).toBe("Min unit price");
  expect(doc.querySelectorAll("th")[3].textContent).toBe("Typical unit price");
  expect(doc.querySelector("h3")!.textContent).toContain("US");
  for (const reason of ["unavailable", "failed"] as const) {
    const html = renderToStaticMarkup(<BlizzardHistory read={{ ok: false, reason }} />);
    expect(html).toContain(reason === "unavailable" ? "not available yet" : "could not be read");
    expect(html).not.toContain("No Blizzard");
  }
});

test("browse is dynamic, noindex, has one layout-owned breadcrumb and only page readers", async () => {
  expect(dynamic).toBe("force-dynamic");
  expect(metadata.robots).toEqual({ index: false, follow: false });
  expect(trailFor("/blizzard-auctions")!.map((c) => c.path)).toEqual(["/", "/blizzard-auctions"]);
  const html = (await render()).documentElement.outerHTML;
  expect(html).not.toMatch(/BreadcrumbList|adsbygoogle|googlesyndication|posthog/);
  const tools = readFileSync(new URL("../tools/auctions/page.tsx", import.meta.url), "utf8");
  expect(tools).toContain('href="/blizzard-auctions"');
  expect(tools).not.toMatch(/loadBlizzard|from ["'].*blizzard-auctions/);
});
