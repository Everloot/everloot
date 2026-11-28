import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import { emptyMarket, foldMarket } from "@kb/market";

const store = vi.hoisted(() => ({ loadMarket: vi.fn(), loadCorpus: vi.fn() }));
vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadMarket: store.loadMarket, loadCorpus: store.loadCorpus },
}));
vi.mock("next/link", () => ({
  default: ({ href, children, prefetch }: { href: string; children: ReactNode; prefetch?: boolean }) => <a href={href} data-prefetch={prefetch === undefined ? undefined : String(prefetch)}>{children}</a>,
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
  expect(us).toMatch(/<td[^>]*><a href="\/tools\/auctions\/camwow-us1-realm-4-pvp\?house=horde&amp;region=us"/);
  expect(us).toContain('title="US1 · Realm 4 PvP"');
  expect(us).toContain('US1 · Realm 4');
  // The phone line under the item names the realm as the Realm column does, not by its recorded code.
  expect(us).toMatch(/<div class="dt-meta"><span><span title="US1 · Realm 4 PvP">US1 · Realm 4/);
  expect(us).not.toContain('<span>CAMWOW US1 Realm 4 PvP</span>');
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

test("pending realm links retain the selected region and exclude other regions", async () => {
  const records = ["CAMWOW US1 Realm 9 RP", "CAMWOW EU1 Realm 9 RP"].flatMap((realm) =>
    scans(dayAgo(0), [[2589, 200, 205]]).slice(0, 1).map((r) => ({ ...r, realm })));
  store.loadMarket.mockResolvedValue({ state: foldMarket(emptyMarket(), records, today), dataAsOf: today.toISOString() });
  const html = await hub({ region: "us" });
  expect(html).toContain('href="/tools/auctions/camwow-us1-realm-9-rp?region=us"');
  expect(html).not.toContain('/tools/auctions/camwow-eu1-realm-9-rp');
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

/** Every element under `node`, through children and element-valued props (not into components' own output). */
function elements(node: unknown, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) node.forEach((n) => elements(n, out));
  else if (isValidElement(node)) {
    out.push(node);
    for (const value of Object.values(node.props as Record<string, unknown>)) elements(value, out);
  }
  return out;
}

test("a result row hands its prices to the client as amounts, so the page's flight data does not carry each coin's markup", async () => {
  const { default: ClientCoins } = await import("./ClientCoins");
  const { CoinText } = await import("@/components/ui/Coins");
  const table = elements(await AuctionHousePage({ searchParams: Promise.resolve({ house: "horde" }) }))
    .find((el) => (el.props as { meta?: unknown; columns?: unknown }).columns && typeof (el.props as { meta?: unknown }).meta === "function") as ReactElement<{ columns: { key: string; cell: (row: unknown) => ReactNode }[]; rows: unknown[]; meta: (row: unknown) => ReactNode }>;
  const row = table.props.rows.find((r) => (r as { row: { value: { itemId: number } } }).row.value.itemId === 2589)!;
  const cell = (key: string) => elements(table.props.columns.find((c) => c.key === key)!.cell(row));
  for (const parts of [cell("market"), cell("min"), elements(table.props.meta(row))]) {
    expect(parts.filter((el) => el.type === ClientCoins).map((el) => typeof (el.props as { copper: unknown }).copper)).toEqual(["number"]);
    expect(parts.some((el) => el.type === CoinText)).toBe(false);
  }
  // The server HTML is the same coins as before: the spoken price and the sprite's references.
  const html = await hub({ house: "horde" });
  // 2589's minimum buyout today is 200 copper.
  // A zero coin below the largest is left out, as the game prints a price: "2s", not "2s 0c".
  expect(html).toContain('<span class="sr-only">2 silver</span><span aria-hidden="true"><span>2<svg aria-hidden="true" class="coin"><use href="#coin-s"></use></svg></span></span>');
});

test("a result row's item link loads on click, not all at once as the page opens", async () => {
  const { ItemLink } = await import("./parts");
  const html = renderToStaticMarkup(<ItemLink id={2589} href="/tools/auctions/forever/2589" tip={undefined} names={new Map()} />);
  expect(html).toContain('<a href="/tools/auctions/forever/2589" data-prefetch="false">');
});

test("an item the files give only an icon for shows that icon beside its shown name, and an unnamed one draws none", async () => {
  const { ItemLink } = await import("./parts");
  const icon = "https://assets.example/icons/132381.webp";
  const named = renderToStaticMarkup(<ItemLink id={9399} href="/tools/auctions/forever/9399" tip={undefined} icon={icon} names={new Map([[9399, "Precision Arrow"]])} />);
  expect(named).toMatch(/<img src="https:\/\/assets\.example\/icons\/132381\.webp"[^>]*data-game-icon[^>]*>(?:<[^>]*>)*<a href="\/tools\/auctions\/forever\/9399"[^>]*>Precision Arrow<\/a>/);
  const unnamed = renderToStaticMarkup(<ItemLink id={9399} href="/tools/auctions/forever/9399" tip={undefined} icon={icon} names={new Map()} />);
  expect(unnamed).not.toContain("<img");
});

test("a 7-day cell with no change to show says why on hover, on keyboard focus and to screen readers", async () => {
  // 2589 has today's day and one 3 days back: nothing 7 to 10 days before today to compare with.
  const fresh = await hub({ house: "horde" });
  expect(fresh).toMatch(/<span tabindex="0" title="(No public scan 7 to 10 days before [^"]+ to compare with)"><span aria-hidden="true" class="text-muted">—<\/span><span class="sr-only">\1<\/span><\/span>/);
  // No public scan in the last two days: the week's change needs a newest day of today or yesterday.
  const stale = foldMarket(emptyMarket(), [...scans(dayAgo(7), [[2589, 200, 205]]), ...scans(dayAgo(14), [[2589, 180, 190]])], today);
  store.loadMarket.mockResolvedValue({ state: stale, dataAsOf: today.toISOString() });
  const html = await hub({ house: "horde" });
  expect(html).toMatch(/<span tabindex="0" title="(No public scan since [^"]+: a 7-day change needs one from today or yesterday)"><span aria-hidden="true" class="text-muted">—<\/span><span class="sr-only">\1<\/span><\/span>/);
});

test("current prices, the community report and AH Ledger deals are discoverable together under the title", async () => {
  const html = await hub({});
  const title = html.indexOf("<h1");
  const blizzard = html.indexOf('href="/blizzard-auctions"');
  expect(title).toBeGreaterThanOrEqual(0);
  expect(html.split('href="/blizzard-auctions"')).toHaveLength(2);
  expect(blizzard).toBeGreaterThan(html.indexOf("</header>"));
  const tools = html.match(/<nav aria-label="Auction House tools"[\s\S]*?<\/nav>/)?.[0];
  expect(tools).toContain('href="/blizzard-auctions"');
  expect(tools).toContain('href="/tools/auctions/report"');
  expect(tools).toContain('href="#market-deals"');
});
