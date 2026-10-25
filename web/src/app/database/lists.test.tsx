import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const store = vi.hoisted(() => ({ loadCorpus: vi.fn() }));
vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadCorpus: store.loadCorpus },
}));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
// The quest titles a page may show from the Warcraft Wiki (none unless a test sets them).
const wiki = vi.hoisted(() => ({ titles: null as Map<number, { name: string; wikiPage: string }> | null }));
vi.mock("@/lib/game-assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/game-assets")>()),
  loadQuestNames: async () => (wiki.titles ? { version: "x", wiki: { name: "Warcraft Wiki", url: "https://warcraft.wiki.gg" }, names: wiki.titles } : null),
}));

import NpcList, { generateMetadata as npcMetadata } from "./npcs/page";
import QuestList, { generateMetadata as questMetadata } from "./quests/page";
import VendorList from "./vendors/page";

let n = 0;
const base = (installId: string) => ({ installId, eventId: `e${n++}`, capturedAt: "2026-10-10T00:00:00.000Z" });
const three = ["a", "b", "c"];
// Hogger: level 11, hostile, in Elwynn Forest (UiMap 1429); a vendor at 3 installs; a quest with a reward.
const sight = (installId: string, npcId: number, name: string, level: number, reaction: string, extra: Record<string, string> = {}) =>
  ({ ...base(installId), kind: "npc_sighting", positionKind: "npc", npcId, name, mapId: 1429, x: 40, y: 60, level, reaction, ...extra });
const records = [
  ...three.map((i) => sight(i, 448, "Hogger", 11, "hostile", { creatureType: "Humanoid", rank: "elite" })),
  ...three.map((i) => sight(i, 1, "Guard Thomas", 25, "friendly", { creatureType: "Humanoid", rank: "normal" })),
  ...three.map((i) => ({ ...base(i), kind: "loot", sourceEvidence: "loot-api", sourceNpcId: 448, items: [{ itemId: 1931, count: 1 }] })),
  ...three.map((i) => ({ ...base(i), kind: "quest", questId: 176, title: "Wanted: Hogger", level: 10, giverNpcId: 1, rewardItemIds: [1931], category: "Elwynn Forest", faction: "alliance", suggestedGroup: 5, tag: "dungeon" })),
  // Seen by three Alliance and three Horde installs: offered to both sides.
  ...["a", "b", "c", "d", "e", "f"].map((i, k) => ({ ...base(i), kind: "quest", questId: 7, title: "Kobold Camp Cleanup", level: 4, rewardItemIds: [], category: "Durotar", faction: k < 3 ? "alliance" : "horde" })),
  ...three.map((i) => ({ ...base(i), kind: "vendor", vendorNpcId: 1, items: [{ itemId: 159, priceCopper: 25 }] })),
];
const html = async (el: Promise<ReactNode>) => renderToStaticMarkup(await el);
const search = (s: Record<string, string> = {}) => ({ searchParams: Promise.resolve(s) });
/** The names linked in the table body, in order. */
const rows = (page: string, kind: string) => [...(page.split("<tbody>")[1] ?? "").matchAll(new RegExp(`href="/database/${kind}/(\\d+)"`, "g"))].map((m) => Number(m[1]));

beforeEach(() => wiki.titles = null);
beforeEach(() => store.loadCorpus.mockReset().mockResolvedValue({ uploads: 3, records, dataAsOf: `2026-10-10T00:00:${String(n++ % 60).padStart(2, "0")}.000Z` }));

test("the NPC list shows the agreed level, reaction, zone and drops, and filters and sorts by them in the URL", async () => {
  const all = await html(NpcList(search()));
  expect(rows(all, "npcs")).toEqual([1, 448]);
  expect(all).toContain(">Hostile<");
  expect(all).toContain(">Elwynn Forest<");
  expect(rows(await html(NpcList(search({ drops: "1" }))), "npcs")).toEqual([448]);
  expect(rows(await html(NpcList(search({ react: "f" }))), "npcs")).toEqual([1]);
  expect(rows(await html(NpcList(search({ level: "11-20" }))), "npcs")).toEqual([448]);
  expect(rows(await html(NpcList(search({ zone: "1429-elwynn-forest", q: "hog" }))), "npcs")).toEqual([448]);
  expect(rows(await html(NpcList(search({ sort: "-level" }))), "npcs")).toEqual([1, 448]);
  // The zone menu links the zone's page segment, so a filtered view reads as a place.
  expect(all).toContain('href="/database/npcs?zone=1429-elwynn-forest"');
  for (const bad of [{ react: "x" }, { level: "20-10" }, { zone: "99999" }, { sort: "price" }, { drops: "yes" }] as Record<string, string>[]) {
    await expect(html(NpcList(search(bad))), JSON.stringify(bad)).rejects.toThrow("NEXT_NOT_FOUND");
  }
});

test("the NPC list shows the agreed type and rank and filters by them", async () => {
  const all = await html(NpcList(search()));
  expect(all).toContain(">Humanoid<");
  expect(all).toContain(">Elite<");
  expect(rows(await html(NpcList(search({ rank: "elite" }))), "npcs")).toEqual([448]);
  expect(rows(await html(NpcList(search({ rank: "normal" }))), "npcs")).toEqual([1]);
  expect(rows(await html(NpcList(search({ type: "humanoid" }))), "npcs")).toEqual([1, 448]);
  expect(rows(await html(NpcList(search({ type: "beast" }))), "npcs")).toEqual([]);
  expect(rows(await html(NpcList(search({ sort: "-rank" }))), "npcs")).toEqual([448, 1]);
  expect(all).toContain('href="/database/npcs?type=humanoid"');
  for (const bad of [{ type: "dog" }, { rank: "epic" }] as Record<string, string>[]) {
    await expect(html(NpcList(search(bad))), JSON.stringify(bad)).rejects.toThrow("NEXT_NOT_FOUND");
  }
});

test("zero matches: one line, the filters as removable chips and Clear filters; an id offers its page", async () => {
  const none = await html(NpcList(search({ q: "999", drops: "1" })));
  expect(none).toContain("No NPCs match these filters.");
  expect(none).toContain('href="/database/npcs?q=999"');
  expect(none).toContain('href="/database/npcs/999"');
});

test("quests: level range and has-rewards filters, giver named, reward linked", async () => {
  const all = await html(QuestList(search()));
  expect(rows(all, "quests")).toEqual([7, 176]);
  expect(all).toContain(">Guard Thomas<");
  expect(all).toContain('href="/database/items/1931"');
  expect(rows(await html(QuestList(search({ rewards: "1" }))), "quests")).toEqual([176]);
  expect(rows(await html(QuestList(search({ level: "1-5" }))), "quests")).toEqual([7]);
  expect(rows(await html(QuestList(search({ sort: "name" }))), "quests")).toEqual([7, 176]);
});

test("quests show category, side and group, and filter by category and side", async () => {
  const all = await html(QuestList(search()));
  expect(all).toContain(">Elwynn Forest<");
  expect(all).toContain(">Alliance<");
  expect(all).toContain(">Both<");
  expect(all).toContain(">Dungeon, 5 players<");
  expect(rows(await html(QuestList(search({ side: "alliance" }))), "quests")).toEqual([176]);
  expect(rows(await html(QuestList(search({ side: "both" }))), "quests")).toEqual([7]);
  expect(rows(await html(QuestList(search({ side: "horde" }))), "quests")).toEqual([]);
  expect(rows(await html(QuestList(search({ category: "Durotar" }))), "quests")).toEqual([7]);
  expect(rows(await html(QuestList(search({ sort: "category" }))), "quests")).toEqual([7, 176]);
  await expect(html(QuestList(search({ side: "neutral" })))).rejects.toThrow("NEXT_NOT_FOUND");
});

test("vendors list the agreed vendor with its name and zone", async () => {
  const page = await html(VendorList(search()));
  expect(page).toContain(">Guard Thomas<");
  expect(page).toContain(">Elwynn Forest<");
});

test("nothing uploaded yet: the empty meter, one sentence and a plain addon link, no button", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [], dataAsOf: "2026-10-10T00:00:00.000Z" });
  const page = await html(NpcList(search()));
  expect(page).toContain("data-empty-state");
  expect(page).toContain('href="/addon"');
  expect(page).not.toContain("btn");
  // Nothing to filter yet, so no filter bar; the line says what will appear and when.
  expect(page).not.toContain("NPC filters");
  expect(page).toContain("The addon starts recording when the game launches on November 4");
});

test("the plain lists are indexed, each page under its own URL; any filter, sort or search is noindex with the plain list as canonical", async () => {
  expect((await npcMetadata(search())).robots).toBeUndefined();
  expect((await questMetadata(search())).robots).toBeUndefined();
  for (const s of [{ zone: "1429-elwynn-forest" }, { sort: "name" }, { q: "hog" }, { sort: "name", page: "2" }] as Record<string, string>[]) {
    const m = await npcMetadata(search(s));
    expect(m.robots).toMatchObject({ index: false, follow: true });
    expect(m.alternates?.canonical).toBe("/database/npcs");
  }
  expect((await questMetadata(search({ rewards: "1" }))).robots).toMatchObject({ index: false });
  // A later page of the plain list is the only path to its rows: indexed, its own canonical, its own title.
  const second = await npcMetadata(search({ page: "2" }));
  expect(second.robots).toBeUndefined();
  expect(second.alternates?.canonical).toBe("/database/npcs?page=2");
  expect(String(second.title)).toMatch(/ – Page 2$/);
});

test("a quest a page can title from the Warcraft Wiki is listed beside the reported ones, its unknown cells left out or '—'", async () => {
  wiki.titles = new Map([[176, { name: "Wanted: Hogger", wikiPage: "x" }], [783, { name: "A Threat Within", wikiPage: "y" }]]);
  const page = await html(QuestList(search()));
  expect(rows(page, "quests")).toEqual([7, 176, 783]);
  expect(page).toContain(">A Threat Within<");
  expect(rows(await html(QuestList(search({ q: "threat" }))), "quests")).toEqual([783]);
  // Only the wiki rows: no column that none of them has a value for.
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [], dataAsOf: "2026-10-10T00:00:00.000Z" });
  const bare = await html(QuestList(search()));
  expect(rows(bare, "quests")).toEqual([176, 783]);
  const head = bare.split("<thead>")[1]!.split("</thead>")[0];
  for (const header of [">Giver<", ">Turn-in<", ">Rewards<", ">Category<"]) expect(head).not.toContain(header);
  expect(head).toContain(">Name<");
});

test("an NPC known only as a quest giver or a vendor is listed too", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 3, dataAsOf: "2026-10-10T00:00:00.000Z", records: [
    ...three.map((i) => ({ ...base(i), kind: "quest", questId: 9, title: "Report to Goldshire", level: 5, giverNpcId: 240, rewardItemIds: [] })),
    ...three.map((i) => ({ ...base(i), kind: "vendor", vendorNpcId: 74, items: [{ itemId: 159, priceCopper: 25 }] })),
  ] });
  const page = await html(NpcList(search()));
  expect(rows(page, "npcs")).toEqual([74, 240]);
  expect(page).toContain(">NPC 240<");
  expect(page.split("<thead>")[1]!.split("</thead>")[0]).not.toContain(">Reaction<");
});

test("with nothing to list, the one line stands alone, without column headers", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [], dataAsOf: "2026-10-10T00:00:00.000Z" });
  for (const page of [await html(NpcList(search())), await html(QuestList(search()))]) {
    expect(page).toContain("data-empty-state");
    expect(page).not.toContain("<th");
  }
});