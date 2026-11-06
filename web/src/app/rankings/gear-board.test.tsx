import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

// The boards read ranked_gear_board, then the game files for every item; both are fed in here.
const auth = vi.hoisted(() => ({ authQuery: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ authQuery: auth.authQuery, getUser: vi.fn(), siteUrl: () => "https://everloot.app" }));
const files = vi.hoisted(() => ({ assets: { base: "https://assets.example/1", version: "1", label: "x" } as unknown, shows: (_id: number): boolean => true }));
// Item 1 a head (inventory type 1) at 60, item 2 a ring (11) at 50.
vi.mock("@/lib/game-assets", () => ({
  loadSiteAssets: async () => files.assets,
  loadItemTips: async (_a: unknown, ids: number[]) => new Map(ids.filter((id) => id <= 2).map((id) => [id, { level: id === 1 ? 60 : 50 }])),
}));
vi.mock("@/lib/shown-item-names", () => ({ loadShownNames: async () => ({ showsTip: (id: number) => files.shows(id) }) }));
vi.mock("@/lib/items", () => ({ CLIENT_LAYER: { items: [[1, 4, 1, 1, 4], [2, 4, 0, 11, 3]] } }));
vi.mock("next/link", () => ({ default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a> }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));

import ItemLevelPage, { generateMetadata } from "./item-level/page";
import GearScorePage from "./gear-score/page";
import { UNCHECKED_LINE, UNAVAILABLE_LINE } from "./gear-board";

const row = (name: string, realm: string, equipped: object[], at = "2026-11-06T10:00:00Z") =>
  ({ ruleset: "forever", realm, name, race: "Orc", class: "SHAMAN", faction: "Horde", level: 60, captured_at: at, data: { equipped } });
const HEAD = { slot: "HeadSlot", itemId: 1, itemLevel: 60 };
const RING = { slot: "Finger0Slot", itemId: 2, itemLevel: 50 };
const ROWS = [
  row("Ringo", "CAMWOW EU5 Realm 2 PvE", [RING]),
  row("Helmy", "CAMWOW US1 Realm 4 PvP", [HEAD]),
  row("Faker", "CAMWOW US1 Realm 4 PvP", [{ ...HEAD, itemLevel: 80 }]),
];
const html = async (page: Promise<ReactNode> | ReactNode) => renderToStaticMarkup(await page);
const search = (s: Record<string, string> = {}) => Promise.resolve(s);

beforeEach(() => {
  for (const k of ["EVERLOOT_LEADERBOARDS", "EVERLOOT_CHARACTER_LINKS", "EVERLOOT_SHOWCASE", "EVERLOOT_PRIVATE_SYNC"]) vi.stubEnv(k, "1");
  auth.authQuery.mockReset().mockResolvedValue(ROWS);
  files.assets = { base: "https://assets.example/1", version: "1", label: "x" };
  files.shows = () => true;
});
afterEach(() => { vi.unstubAllEnvs(); });

test("off, both boards are a 404 and nothing is read", async () => {
  vi.stubEnv("EVERLOOT_LEADERBOARDS", "");
  await expect(html(ItemLevelPage({ searchParams: search() }))).rejects.toThrow("NEXT_NOT_FOUND");
  vi.stubEnv("EVERLOOT_LEADERBOARDS", "1");
  vi.stubEnv("EVERLOOT_PRIVATE_SYNC", "");
  await expect(html(GearScorePage({ searchParams: search() }))).rejects.toThrow("NEXT_NOT_FOUND");
  expect(auth.authQuery).not.toHaveBeenCalled();
});

test("ranks by the board's number, links each character, and counts the gear it left out", async () => {
  const page = await html(GearScorePage({ searchParams: search() }));
  expect(auth.authQuery).toHaveBeenCalledWith("rpc/ranked_gear_board", expect.objectContaining({ method: "POST" }));
  expect(page.indexOf("Helmy")).toBeLessThan(page.indexOf("Ringo"));
  expect(page).toContain('href="/characters/forever/camwow-us1-realm-4-pvp/helmy"');
  expect(page).not.toContain("Faker");
  expect(page).toContain("Not counted: 1 character whose gear");
  expect(page).toContain('href="/methodology#gear-rankings"');
});

test("filters by ruleset and region from the realm name; an unknown value is a 404", async () => {
  const eu = await html(ItemLevelPage({ searchParams: search({ region: "eu" }) }));
  expect(eu).toContain("Ringo");
  expect(eu).not.toContain("Helmy");
  const pvp = await html(ItemLevelPage({ searchParams: search({ ruleset: "pvp" }) }));
  expect(pvp).toContain("Helmy");
  expect(pvp).not.toContain("Ringo");
  await expect(html(ItemLevelPage({ searchParams: search({ region: "mars" }) }))).rejects.toThrow("NEXT_NOT_FOUND");
});

test("an item a page may not show yet keeps that gear off the board", async () => {
  files.shows = (id) => id !== 1;
  const page = await html(ItemLevelPage({ searchParams: search() }));
  expect(page).not.toContain("Helmy");
  expect(page).toContain("Ringo");
});

test("without the game files nothing is ranked unchecked; storage down says so", async () => {
  files.assets = null;
  expect(await html(ItemLevelPage({ searchParams: search() }))).toContain(UNCHECKED_LINE);
  auth.authQuery.mockRejectedValueOnce(new Error("down"));
  expect(await html(ItemLevelPage({ searchParams: search() }))).toContain(UNAVAILABLE_LINE.replaceAll("'", "&#x27;"));
});

test("an empty board says how to get on it, and the boards are never indexed", async () => {
  auth.authQuery.mockResolvedValue([]);
  expect(await html(ItemLevelPage({ searchParams: search() }))).toContain("No ranked characters here yet");
  expect(generateMetadata().robots).toEqual({ index: false, follow: true });
});
