import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

/**
 * Every database entity page fills the one EntityPage template, so its slots come in the same order on every type:
 * header, top band, notices, side column (media, In short), main, related, map, changes, screenshots, comments, and
 * the open-data row with its Report wrong data link last. Each page is rendered from fixtures: three installs'
 * reports for the player-data types, the committed game files for the rest.
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
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  permanentRedirect: (url: string) => { throw new Error(`PERMANENT ${url}`); },
  redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); },
  useRouter: () => ({ push: () => {} }),
  usePathname: () => "/",
}));

import { ENTITY_SLOTS } from "./entity";
import AchievementPage from "./achievements/[id]/page";
import CurrencyPage from "./currencies/[id]/page";
import FactionPage from "./factions/[id]/page";
import HolidayPage from "./holidays/[id]/page";
import InstancePage from "./instances/[instance]/page";
import ItemSetPage from "./item-sets/[id]/page";
import ItemPage from "./items/[id]/page";
import MountPage from "./mounts/[id]/page";
import NpcPage from "./npcs/[id]/page";
import ObjectPage from "./objects/[id]/page";
import PetFamilyPage from "./pet-families/[id]/page";
import PetPage from "./pets/[id]/page";
import QuestChainPage from "./quest-chains/[id]/page";
import QuestPage from "./quests/[id]/page";
import SpellPage from "./spells/[id]/page";
import TitlePage from "./titles/[id]/page";
import VendorPage from "./vendors/[id]/page";
import ZonePage from "./zones/[zone]/page";

let n = 0;
const base = (installId: string) => ({ installId, eventId: `e${n++}`, capturedAt: "2026-10-10T00:00:00.000Z" });
const three = ["install-a", "install-b", "install-c"];
// Three installs agree on Linen Cloth, an NPC that drops it, a guard who is a vendor and a quest giver, and a chest.
const records = [
  ...three.map((i) => ({ ...base(i), kind: "item_seen", itemId: 2589, name: "Linen Cloth" })),
  ...three.map((i) => ({ ...base(i), kind: "loot", sourceEvidence: "loot-api", sourceNpcId: 1501, items: [{ itemId: 2589, count: 1 }] })),
  ...three.map((i) => ({ ...base(i), kind: "loot", sourceEvidence: "loot-api", sourceObjectId: 1731, items: [{ itemId: 2770, count: 1 }] })),
  ...three.map((i) => ({ ...base(i), kind: "npc_sighting", positionKind: "npc", npcId: 1, name: "Guard Thomas", mapId: 1429, x: 40, y: 60, level: 25, reaction: "friendly" })),
  ...three.map((i) => ({ ...base(i), kind: "vendor", vendorNpcId: 1, items: [{ itemId: 159, priceCopper: 25 }] })),
  ...three.map((i) => ({ ...base(i), kind: "quest", questId: 176, title: "Wanted: Hogger", level: 10, giverNpcId: 1, rewardItemIds: [] })),
];

beforeEach(() => store.loadCorpus.mockReset().mockResolvedValue({ uploads: 3, records, dataAsOf: "2026-10-10T00:00:00.000Z" }));

const id = (value: string) => ({ params: Promise.resolve({ id: value }) });
const PAGES: [string, () => Promise<ReactNode>][] = [
  ["item", () => ItemPage(id("2589"))],
  ["NPC", () => NpcPage(id("1501"))],
  ["quest", () => QuestPage(id("176"))],
  ["object", () => ObjectPage(id("1731"))],
  ["vendor", () => VendorPage(id("1"))],
  ["spell", () => SpellPage(id("2963"))],
  ["achievement", () => AchievementPage(id("627-explore-dun-morogh"))],
  ["faction", () => FactionPage(id("21-booty-bay"))],
  ["title", () => TitlePage(id("144-bloodsail-admiral"))],
  ["quest chain", () => QuestChainPage(id("5963-to-have-loved-and-lost"))],
  ["item set", () => ItemSetPage(id("1"))],
  ["mount", () => MountPage(id("6-brown-horse"))],
  ["companion pet", () => PetPage(id("39-mechanical-squirrel"))],
  ["currency", () => CurrencyPage(id("515-darkmoon-prize-ticket"))],
  ["holiday", () => HolidayPage(id("141-feast-of-winter-veil"))],
  ["hunter pet family", () => PetFamilyPage(id("1-wolf"))],
  ["zone", () => ZonePage({ params: Promise.resolve({ zone: "1419-blasted-lands" }) })],
  ["instance", () => InstancePage({ params: Promise.resolve({ instance: "389-ragefire-chasm" }) })],
];

test.each(PAGES)("the %s page fills the entity template's slots in its one order", async (_, page) => {
  const html = renderToStaticMarkup(await page());
  const slots = [...html.matchAll(/data-slot="([a-z]+)"/g)].map((m) => m[1]);
  // Every page has a header, a top band or side column, and the open-data row, which is last.
  expect(slots[0]).toBe("header");
  expect(slots).toContain("summary");
  expect(slots.at(-1)).toBe("footer");
  // Each slot at most once, in the template's order.
  expect(slots).toEqual(ENTITY_SLOTS.filter((slot) => slots.includes(slot)));
  const footer = html.slice(html.indexOf('data-slot="footer"'));
  expect(footer).toContain("Copy for AI");
  expect(footer).toContain("Report wrong data");
});
