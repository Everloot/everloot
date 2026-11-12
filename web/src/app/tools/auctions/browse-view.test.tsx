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
  notFound: () => { throw new Error("NOT_FOUND"); },
  useRouter: () => ({ push: () => {} }),
  usePathname: () => "/",
}));

import AuctionHousePage from "./page";
import { ahQuery } from "./browse";

const today = new Date();
const dayAgo = (n: number) => new Date(today.getTime() - n * 86_400_000).toISOString();
const scans = (capturedAt: string, items: number[][]) => ["install-a", "install-b", "install-c"].map((installId, i) => ({
  kind: "auction_snapshot", faction: "Horde", installId, eventId: `${installId}:${capturedAt}`, capturedAt, realm: "Forever",
  scanId: `${installId}-${capturedAt}`, part: 1, parts: 1, items: items.map(([id, min, market]) => [id, 2, 40 + i, min, market]),
}));
// Two items with a week of history, so the "changed most" filter has rows.
const market = foldMarket(emptyMarket(), [
  ...scans(dayAgo(0), [[2589, 200, 205], [765, 30, 33]]),
  ...scans(dayAgo(3), [[2589, 180, 190]]),
  ...scans(dayAgo(7), [[765, 25, 27]]),
], today);

const hub = async (searchParams: Record<string, string>) =>
  renderToStaticMarkup(await AuctionHousePage({ searchParams: Promise.resolve(searchParams) }));

/** Where a sortable header points, as the query it carries. */
function headerQuery(html: string, label: string): URLSearchParams {
  const href = new RegExp(`<a href="([^"]*)"[^>]*>${label}`).exec(html)?.[1];
  expect(href, `a "${label}" header link`).toBeDefined();
  return new URLSearchParams(href!.replace(/&amp;/g, "&").split("?")[1] ?? "");
}

beforeEach(() => {
  store.loadMarket.mockReset().mockResolvedValue({ state: market, dataAsOf: new Date(today.getTime() - 4 * 60_000).toISOString() });
  store.loadCorpus.mockReset().mockResolvedValue({ uploads: 0, records: [], dataAsOf: null });
});

test("region browsing isolates recorded markets, scopes counts, and preserves the selection", async () => {
  const records = [
    ...scans(dayAgo(0), [[2589, 200, 205]]).map((r) => ({ ...r, realm: "CAMWOW US1 Realm 4 PvP" })),
    ...scans(dayAgo(0), [[765, 30, 33], [25, 50, 55]]).map((r) => ({ ...r, realm: "CAMWOW EU2 Realm 4 PvP" })),
    ...scans(dayAgo(0), [[1366, 80, 85]]),
  ];
  store.loadMarket.mockResolvedValue({ state: foldMarket(emptyMarket(), records, today), dataAsOf: today.toISOString() });
  const us = await hub({ region: "us", house: "horde" });
  expect(us).toContain('/tools/auctions/camwow-us1-realm-4-pvp/2589');
  expect(us).not.toContain('/tools/auctions/camwow-eu2-realm-4-pvp');
  expect(us).not.toContain('/tools/auctions/forever/1366');
  expect(us).toContain('name="region" value="us"');
  expect(us).toContain('title="CAMWOW US1 Realm 4 PvP"');
  expect(us).toContain('US1 · Realm 4');
  expect(headerQuery(us, "Units").get("region")).toBe("us");
  expect(us).toContain('region=us&amp;ruleset=pvp');
  expect(us).toMatch(/Horde.*?\(1\)/);
  const eu = await hub({ region: "eu" });
  expect(eu).toContain('/tools/auctions/camwow-eu2-realm-4-pvp/765');
  expect(eu).not.toContain('/tools/auctions/camwow-us1-realm-4-pvp');
  const unknown = await hub({ region: "unknown" });
  expect(unknown).toContain('/tools/auctions/forever/1366');
  expect(unknown).not.toContain('/tools/auctions/camwow-');
  const empty = await hub({ region: "tw" });
  expect(empty).toContain("No public prices in TW");
  expect(empty).not.toContain('/tools/auctions/camwow-');
  const numeric = await hub({ region: "eu", q: "765", house: "horde" });
  expect(numeric).toContain('/tools/auctions/camwow-eu2-realm-4-pvp/765');
  expect(numeric).not.toContain('/tools/auctions/camwow-us1-realm-4-pvp');
});

test("with the week's movers on and no sort named, the table is sorted by the change, so Units links to an explicit units sort the server reads back", async () => {
  const html = await hub({ moved: "1" });
  expect(html).toMatch(/<th[^>]*aria-sort="descending"[^>]*>(?:(?!<\/th>).)*7 days/);
  const units = headerQuery(html, "Units");
  expect(units.get("sort")).toBe("-units");
  expect(units.get("moved")).toBe("1");
  // The link is a real change of order: the server reads it back as units, most first, not as the change default.
  expect(ahQuery(Object.fromEntries(units))?.sort).toEqual({ key: "units", desc: true });
  const followed = await hub(Object.fromEntries(units));
  expect(followed).toMatch(/<th[^>]*aria-sort="descending"[^>]*>(?:(?!<\/th>).)*Units/);
});

test("without the movers filter, the units default stays implicit, and a link back to it drops the sort", async () => {
  const plain = await hub({});
  // Units is the current sort, most first: its header offers the other direction.
  expect(headerQuery(plain, "Units").get("sort")).toBe("units");
  // From another sort, Units most-first is the default and needs no parameter.
  const byChange = await hub({ sort: "-change" });
  expect(headerQuery(byChange, "Units").has("sort")).toBe(false);
});

test("with the movers filter on and an explicit sort, the change default is not applied to the other headers", async () => {
  const html = await hub({ moved: "1", sort: "-units" });
  // The change column is now the one to ask for: change, most first, is the moved default and needs no parameter.
  expect(headerQuery(html, "7 days").has("sort")).toBe(false);
});
