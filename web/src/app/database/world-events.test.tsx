import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadCorpus: async () => ({ unreachable: false, records: [], dataAsOf: null }), loadCompletion: async () => ({ state: null, dataAsOf: null }) },
}));
// The manifest has the wolf's family icon and Bite's spell icon; the spell names file names Bite only.
const art = vi.hoisted(() => ({ assets: null as unknown, spells: null as unknown }));
vi.mock("@/lib/game-assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/game-assets")>()),
  loadSiteAssets: async () => art.assets,
  loadSpellNames: async () => art.spells,
}));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  permanentRedirect: (to: string) => { throw new Error(`REDIRECT ${to}`); },
}));
vi.mock("@/components/ui/OpenData", () => ({ default: ({ text }: { text: string }) => <pre data-open-data>{text}</pre> }));

import HolidayPage, { generateMetadata as holidayMeta } from "./holidays/[id]/page";
import HolidayListPage from "./holidays/page";
import PetFamilyPage from "./pet-families/[id]/page";
import PetFamilyListPage from "./pet-families/page";
import { siteSearch } from "@/lib/site-search";
import { lastsLabel, startLabel } from "@/lib/world-events";

const page = async (el: Promise<ReactNode> | ReactNode) => renderToStaticMarkup(await el);
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const factOf = (out: string, label: string) => new RegExp(`>${label}</dt><dd[^>]*>(.*?)</dd>`).exec(out)?.[1] ?? "";

beforeEach(() => {
  art.assets = { familyIcons: new Map([[1, "https://a.test/icons/132203.webp"]]), spellIcons: new Map([[17253, "https://a.test/icons/132278.webp"]]) };
  art.spells = { version: "1.60.1.71091", names: new Map([[17253, "Bite"], [17255, "Bite"]]) };
});

test("starts and durations read as the game would say them, in server time", () => {
  expect(startLabel({ month: 12, day: 15, hour: 6, minute: 0 })).toBe("Every year on 15 December at 06:00");
  expect(startLabel({ weekday: 0, hour: 14, minute: 0 })).toBe("Every Sunday at 14:00");
  expect(startLabel({ year: 2025, month: 1, day: 6, hour: 4, minute: 0 })).toBe("6 January 2025 at 04:00");
  expect([lastsLabel(432), lastsLabel(2), lastsLabel(24), lastsLabel(undefined)]).toEqual(["18 days", "2 hours", "1 day", null]);
});

test("a holiday page: the files' text in the box, when it starts and how long it lasts, labelled unconfirmed", async () => {
  const out = await page(HolidayPage(params("141-feast-of-winter-veil")));
  expect(out).toMatch(/<h1[^>]*>Feast of Winter Veil<\/h1>/);
  expect(out).toContain("Greatfather Winter is visiting");
  expect(factOf(out, "Start")).toContain("Every year on 15 December at 06:00");
  expect(factOf(out, "Lasts")).toBe("18 days");
  expect(out).toContain("found in game files, unconfirmed");
  expect((await holidayMeta(params("141-feast-of-winter-veil"))).description).toContain("Found in game files, unconfirmed");
});

test("a Darkmoon Faire page lists every dated start and links the site's Faire guide", async () => {
  const out = await page(HolidayPage(params("263-darkmoon-faire")));
  expect(factOf(out, "Starts")).toContain("6 January 2025 at 04:00");
  expect(factOf(out, "Guide")).toContain('href="/guides/darkmoon-faire"');
});

test("a holiday or family id the files do not list is a 404, and a wrong slug redirects", async () => {
  await expect(page(HolidayPage(params("1")))).rejects.toThrow("NEXT_NOT_FOUND");
  await expect(page(HolidayPage(params("141")))).rejects.toThrow("REDIRECT /database/holidays/141-feast-of-winter-veil");
  await expect(page(PetFamilyPage(params("16-voidwalker")))).rejects.toThrow("NEXT_NOT_FOUND");
});

test("a pet family page: its icon, hunters, and the spells on its skill line, ranks of one name together", async () => {
  const out = await page(PetFamilyPage(params("1-wolf")));
  expect(out).toMatch(/<h1[^>]*>Wolf<\/h1>/);
  expect(out).toContain('src="https://a.test/icons/132203.webp"');
  expect(factOf(out, "Tamed by")).toContain('href="/classes/hunter"');
  expect(out).toContain('<a href="/database/spells/17253">Bite</a>');
  expect(out).toContain("17253, 17255");
  // A spell the names file does not name keeps its own row by id.
  expect(out).toContain('<a href="/database/spells/24597">Spell 24597</a>');
});

test("the lists: holidays with their first start, families with their icon, demons left out", async () => {
  const holidays = await page(HolidayListPage());
  expect(holidays).toContain('href="/database/holidays/301-stranglethorn-fishing-extravaganza"');
  expect(holidays).toContain("Every Sunday at 14:00");
  const families = await page(PetFamilyListPage());
  expect(families).toContain("Hunter pet families in the game files: 19");
  expect(families).toContain('src="https://a.test/icons/132203.webp"');
  expect(families).not.toContain("Voidwalker");
});

test("search finds holidays and pet families by name or id", async () => {
  expect((await siteSearch("winter veil", { only: "holiday" }))[0]).toMatchObject({ type: "holiday", heading: "Holidays and world events" });
  expect((await siteSearch("winter veil", { only: "holiday" }))[0].results[0].href).toBe("/database/holidays/141-feast-of-winter-veil");
  expect((await siteSearch("wolf", { only: "family" }))[0].results[0]).toMatchObject({ label: "Wolf", href: "/database/pet-families/1-wolf", exact: true });
});
