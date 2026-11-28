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

import { readFileSync } from "node:fs";
import path from "node:path";
import { ENTITY_SLOTS, EntityPage, known } from "./entity";
import AchievementPage from "./achievements/[id]/page";
import BossPage from "./bosses/[boss]/page";
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

test("facts nobody has reported fold into one Not yet reported row with a single meter", () => {
  const html = renderToStaticMarkup(EntityPage({
    name: "Hogger",
    header: { trail: [], title: "Hogger" },
    facts: [
      { label: "Reported name", value: "Hogger" },
      { label: "Level", value: known(null) },
      { label: "Type", value: known(undefined) },
      { label: "Rank", value: known(null, 2) },
      { label: "Zone", value: known("") },
      { label: "XP", value: known(null) },
    ],
  }));
  const rows = [...html.matchAll(/<dt[^>]*>([^<]*)<\/dt>/g)].map((m) => m[1]);
  // Rank has 2 of 3 installs: its own meter says so, so it keeps its row.
  expect(rows).toEqual(["Reported name", "Rank", "Not yet reported"]);
  expect(html.match(/data-agreement="0"/g)).toHaveLength(1);
  // The labels are one left-aligned line of plain text under the row's label, never chips that read as buttons.
  const row = /<div([^>]*)><dt[^>]*>Not yet reported<\/dt><dd([^>]*)>(.*?)<\/dd>/.exec(html);
  expect(row?.[2]).not.toContain("text-right");
  expect(row?.[1]).toContain("flex-col");
  expect(row?.[3]).not.toMatch(/<li|rounded-full/);
  expect(row?.[3]).toMatch(/>level, type, zone, XP<\/span>/);
});

test("a folded Reported title or name reads as plain title or name, never 'Not yet reported … reported title'", () => {
  const html = renderToStaticMarkup(EntityPage({
    name: "Quest 5441",
    header: { trail: [], title: "Quest 5441" },
    facts: [
      { label: "Reported title", value: known(null) },
      { label: "Category", value: known(null) },
      { label: "Zone", value: known(null) },
    ],
  }));
  const row = /<dt[^>]*>Not yet reported<\/dt><dd[^>]*>(.*?)<\/dd>/.exec(html);
  expect(row?.[1]).toMatch(/>title, category, zone<\/span>/);
  expect(row?.[1]).not.toMatch(/reported/i);
});

test("quest and boss pages draw no box that would only repeat their header", async () => {
  // The quest has an agreed level, so its old box was "Wanted: Hogger / Level 10", the header's own words.
  for (const page of [QuestPage(id("176")), BossPage({ params: Promise.resolve({ boss: "2742-sneed" }) })]) {
    expect(renderToStaticMarkup(await page)).not.toContain("entity-box");
  }
});

test("at xl the quick facts stay in the main column beside the box, and the rail starts under the header", () => {
  const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
  const xl = css.slice(css.indexOf("Wide entity rails"));
  const block = xl.slice(0, xl.indexOf("\n}\n"));
  // Nothing of the top band goes to the rail: that is what left a void under the box as tall as the facts.
  expect(block).not.toMatch(/\.entity-(?:top|facts)[^{]*\{[^}]*grid-column:\s*2/);
  expect(block).not.toMatch(/\.entity-top\s*\{[^}]*display:\s*contents/);
  expect(block).toMatch(/\.entity-layout > \.entity-sidebar \{[^}]*grid-row: 2 \/ span 30/);
});

test("a spell page fills the changes slot only when the spell changed in a live build", async () => {
  // Vampiric Embrace's numbers changed in 1.60.1.71037; spell 2963 never changed.
  const changed = renderToStaticMarkup(await SpellPage(id("15286")));
  expect(changed).toContain('data-slot="changes"');
  expect(changed).toContain("1.60.1.71037");
  expect(renderToStaticMarkup(await SpellPage(id("2963")))).not.toContain('data-slot="changes"');
});
