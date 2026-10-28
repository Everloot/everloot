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
  kind: "auction_snapshot", installId, eventId: `${installId}:${capturedAt}`, capturedAt, realm: "Forever",
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
