import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import { emptyMarket, foldMarket } from "../../../../../kb/src/market";

// The ruleset tabs with the realm map as it might read on launch day; ./market.test.tsx covers the hub with the map empty.
const map = vi.hoisted(() => ({ realms: [] as { name: string; ruleset: string; region: string }[] }));
vi.mock("../../../data/realms", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../data/realms")>()),
  get REALMS() { return map.realms; },
}));
const store = vi.hoisted(() => ({ loadMarket: vi.fn(), loadCorpus: vi.fn() }));
vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadMarket: store.loadMarket, loadCorpus: store.loadCorpus },
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode; "aria-current"?: "page" }) => <a href={href} aria-current={rest["aria-current"]}>{children}</a>,
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); },
  notFound: () => { throw new Error("NOT_FOUND"); },
  permanentRedirect: (url: string) => { throw new Error(`REDIRECT ${url}`); },
  useRouter: () => ({ push: () => {} }),
  usePathname: () => "/",
}));

const today = new Date();
const scans = (realm: string, items: number[][]) => ["install-a", "install-b", "install-c"].map((installId, i) => ({
  kind: "auction_snapshot", faction: "Horde", installId, eventId: `${installId}:${realm}`, capturedAt: today.toISOString(), realm,
  scanId: `${installId}-${realm}`, part: 1, parts: 1, items: items.map(([id, min, market]) => [id, 2, 40 + i, min, market]),
}));
const market = foldMarket(emptyMarket(), [...scans("Mal'Ganis", [[2589, 200, 205]]), ...scans("Forever", [[765, 30, 33]])], today);

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
/** The ruleset tabs: label and href of each link in the "Ruleset" nav. */
function tabs(html: string): { label: string; href: string; current: boolean }[] {
  const nav = /<nav aria-label="Ruleset"[^>]*>(.*?)<\/nav>/.exec(html)?.[1] ?? "";
  return [...nav.matchAll(/<a href="([^"]*)"( aria-current="page")?>(.*?)<\/a>/g)].map((m) => ({ href: m[1]!.replace(/&amp;/g, "&"), current: Boolean(m[2]), label: text(m[3]!).trim() }));
}

async function hub(searchParams: Record<string, string>) {
  vi.resetModules();
  const { default: AuctionHousePage } = await import("./page");
  return renderToStaticMarkup(await AuctionHousePage({ searchParams: Promise.resolve(searchParams) }));
}

beforeEach(() => {
  map.realms = [];
  store.loadMarket.mockReset().mockResolvedValue({ state: market, dataAsOf: today.toISOString() });
  store.loadCorpus.mockReset().mockResolvedValue({ uploads: 0, records: [], dataAsOf: null });
});

test("with the map empty: four launch tabs at 0, Hardcore after launch, and every realm's prices under All", async () => {
  const html = await hub({});
  expect(tabs(html).map((t) => t.label)).toEqual(["All rulesets", "PvE (0)", "PvP (0)", "RP (0)", "RP-PvP (0)"]);
  expect(tabs(html)[0]!.current).toBe(true);
  expect(text(html)).toContain("Hardcore: after launch");
  expect(text(html)).toContain("Realms not mapped yet");
  expect(text(html)).toContain("Not mapped yet");
  expect(text(html)).toContain("Mal'Ganis");
  expect(text(html)).toContain("Forever");
});

test("with the map empty a ruleset tab says plainly that it has no prices yet, and shows no price", async () => {
  const pvp = text(await hub({ ruleset: "pvp" }));
  expect(pvp).toContain("No public prices on PvP realms yet");
  expect(pvp).not.toMatch(/\d+s \d+c/);
  expect(text(await hub({ ruleset: "hardcore" }))).toContain("Hardcore opens after launch, and no realm is on Hardcore yet");
});

test("with the map empty, a realm whose name ends in its ruleset is filed under that ruleset's tab", async () => {
  const named = foldMarket(emptyMarket(), [...scans("CAMWOW US1 Realm 4 PvP", [[2589, 200, 205]]), ...scans("Forever", [[765, 30, 33]])], today);
  store.loadMarket.mockResolvedValue({ state: named, dataAsOf: today.toISOString() });
  const all = await hub({});
  expect(tabs(all).map((t) => t.label)).toEqual(["All rulesets", "PvE (0)", "PvP (1)", "RP (0)", "RP-PvP (0)"]);
  const pvp = text(await hub({ ruleset: "pvp" }));
  expect(pvp).toContain("CAMWOW US1 Realm 4 PvP");
  // The name and its ruleset are split, the ruleset in its own colour, as in the addon's tooltip.
  expect(await hub({ ruleset: "pvp" })).toContain('US1 · Realm 4 <span data-ruleset="pvp" class="font-medium text-realm-pvp">PvP</span>');
  expect(pvp).not.toContain("Realms not mapped yet");
  expect(text(await hub({ ruleset: "normal" }))).not.toContain("CAMWOW");
});

test("a ruleset that is not one is a 404, as a bad house is", async () => {
  await expect(hub({ ruleset: "forever" })).rejects.toThrow("NOT_FOUND");
  await expect(hub({ ruleset: "PvP" })).rejects.toThrow("NOT_FOUND");
});

test("with realms mapped, a tab shows its realms only, keeps the house, and its realm links drop the ruleset", async () => {
  map.realms = [{ name: "Mal'Ganis", ruleset: "pvp", region: "us" }, { name: "Argent Dawn", ruleset: "normal", region: "us" }, { name: "Doomhowl", ruleset: "hardcore", region: "us" }];
  const all = await hub({});
  expect(tabs(all).map((t) => t.label)).toEqual(["All rulesets", "PvE (0)", "PvP (1)", "RP (0)", "RP-PvP (0)", "Hardcore (0)"]);
  expect(text(all)).not.toContain("after launch");
  expect(tabs(all).find((t) => t.label.startsWith("PvP"))!.href).toBe("/tools/auctions?ruleset=pvp");

  const pvp = await hub({ ruleset: "pvp", house: "horde" });
  expect(tabs(pvp).find((t) => t.current)!.label).toBe("PvP (1)");
  expect(tabs(pvp)[0]!.href).toBe("/tools/auctions?house=horde");
  const blend = await hub({ ruleset: "pvp" });
  expect(text(blend)).toContain("PvP Auction House");
  expect(text(blend)).toContain("Mal'Ganis");
  expect(blend).toContain('href="/tools/auctions/malganis"');
  expect(blend).not.toContain('href="/tools/auctions/forever"');

  // Mapped but no scans yet: the message says so, not that the ruleset is unmapped.
  const normal = text(await hub({ ruleset: "normal" }));
  expect(normal).toContain("No public prices on PvE realms yet");
  expect(normal).toContain("No public prices yet");
});

test("the summary's price movers are named in the same corpus read as the results", async () => {
  map.realms = [{ name: "Mal'Ganis", ruleset: "pvp", region: "us" }];
  const weekAgo = new Date(today.getTime() - 7 * 86_400_000);
  const at = (when: Date, realm: string, items: number[][]) => scans(realm, items).map((r) => ({ ...r, eventId: `${r.eventId}:${when.getTime()}`, scanId: `${r.scanId}-${when.getTime()}`, capturedAt: when.toISOString() }));
  const moving = foldMarket(emptyMarket(), [...at(weekAgo, "Mal'Ganis", [[2589, 100, 100]]), ...at(today, "Mal'Ganis", [[2589, 200, 200]])], today);
  store.loadMarket.mockResolvedValue({ state: moving, dataAsOf: today.toISOString() });
  const html = await hub({});
  expect(text(html)).toContain("+100%");
  expect(store.loadCorpus).toHaveBeenCalledTimes(1);
});
