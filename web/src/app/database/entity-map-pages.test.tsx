import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

/**
 * The entity pages fill the template's map slot with the positions they list: an NPC's, a vendor's, a quest's giver,
 * a zone's NPCs and places. The map comes before the tabs, the pin tables stay, and nothing shows without map art or
 * without 3 installs agreeing on a position.
 */

const store = vi.hoisted(() => ({ loadCorpus: vi.fn() }));
vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: {
    loadCorpus: store.loadCorpus,
    loadMarket: async () => ({ state: null, dataAsOf: null, unreachable: true }),
    loadCompletion: async () => ({ state: null, dataAsOf: null, unreachable: true }),
  },
}));
const assets = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/lib/game-assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/game-assets")>()),
  loadSiteAssets: async () => assets.value,
}));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  permanentRedirect: (url: string) => { throw new Error(`PERMANENT ${url}`); },
}));

import NpcPage from "./npcs/[id]/page";
import QuestPage from "./quests/[id]/page";
import VendorPage from "./vendors/[id]/page";
import ZonePage from "./zones/[zone]/page";

let n = 0;
const base = (installId: string) => ({ installId, eventId: `e${n++}`, capturedAt: "2026-10-10T00:00:00.000Z" });
const installs = (count: number) => ["install-a", "install-b", "install-c"].slice(0, count);
// Guard Thomas stands in Elwynn Forest (UiMap 1429), sells goods and gives a quest: the zone lists him as a vendor.
const records = (count: number) => [
  ...installs(count).map((i) => ({ ...base(i), kind: "npc_sighting", positionKind: "npc", npcId: 1, name: "Guard Thomas", mapId: 1429, x: 40, y: 60, level: 25, reaction: "friendly" })),
  ...installs(3).map((i) => ({ ...base(i), kind: "vendor", vendorNpcId: 1, items: [{ itemId: 159, priceCopper: 25 }] })),
  ...installs(3).map((i) => ({ ...base(i), kind: "quest", questId: 176, title: "Wanted: Hogger", level: 10, giverNpcId: 1, rewardItemIds: [] })),
];
const rect = { left: 0, top: 0, right: 1, bottom: 1 };
const ELWYNN_ART = { maps: [{ uiMapId: 1429, kind: "zone", name: "Elwynn Forest", continentId: 0, heldBack: false, url: "https://a.test/maps/1429.webp", smallUrl: null, rect }], poi: new Map() };

beforeEach(() => {
  store.loadCorpus.mockReset().mockResolvedValue({ uploads: 3, records: records(3), dataAsOf: "2026-10-10T00:00:00.000Z" });
  assets.value = ELWYNN_ART;
});

const id = (value: string) => ({ params: Promise.resolve({ id: value }) });
const PAGES: [string, () => Promise<ReactNode>, string][] = [
  ["NPC", () => NpcPage(id("1")), "npc"],
  ["vendor", () => VendorPage(id("1")), "vendor"],
  ["quest", () => QuestPage(id("176")), "giver"],
  ["zone", () => ZonePage({ params: Promise.resolve({ zone: "1429-elwynn-forest" }), searchParams: Promise.resolve({}) }), "vendor"],
];
const mapSlot = (html: string) => html.split('data-slot="map"')[1]?.split('data-slot="main"')[0] ?? "";

test.each(PAGES)("the %s page shows its agreed position on the zone's map, before the tabs", async (_, page, kind) => {
  const html = renderToStaticMarkup(await page());
  expect(html).toContain('data-slot="map"');
  expect(html.indexOf('data-slot="map"')).toBeLessThan(html.indexOf('data-slot="main"'));
  const map = mapSlot(html);
  expect(map).toContain('src="https://a.test/maps/1429.webp"');
  expect(map).toContain("left:40%;top:60%");
  expect(map).toContain(`data-mark="${kind}" data-agreed="true"`);
  expect(map).toContain("Open on the world map");
});

test("the NPC page keeps its pin table, the accessible version of the map", async () => {
  const html = renderToStaticMarkup(await NpcPage(id("1")));
  expect(html).toContain("Where Guard Thomas stands");
  // The map slot replaces the top band's thumbnail of the same zone.
  expect(html).not.toContain("data-map-thumb");
  expect(mapSlot(html)).toContain('href="/map?zone=1429&amp;x=40&amp;y=60"');
});

test.each(PAGES)("the %s page has no map without map art", async (_, page) => {
  assets.value = null;
  expect(renderToStaticMarkup(await page())).not.toContain('data-slot="map"');
});

test("a position fewer than 3 installs agree on is not drawn", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 2, records: records(2), dataAsOf: "2026-10-10T00:00:00.000Z" });
  for (const [, page] of PAGES.slice(0, 3)) {
    const html = renderToStaticMarkup(await page());
    expect(html).not.toContain('data-slot="map"');
  }
  // The zone still draws the places the game files name, hollow, and no NPC.
  const zone = mapSlot(renderToStaticMarkup(await PAGES[3]![1]()));
  expect(zone).toContain('data-mark="place"');
  expect(zone).not.toContain('data-mark="vendor"');
});

test("a zone's map adds the places the game files name, hollow, and replaces the side column's preview", async () => {
  const html = renderToStaticMarkup(await PAGES[3]![1]());
  expect(mapSlot(html)).toContain('data-mark="place" data-agreed="false"');
  expect(mapSlot(html)).toContain("Maclure Vineyards");
  expect(html).not.toContain("data-zone-preview");
});
