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
// The game files' spell names (unread unless a test sets them).
const files = vi.hoisted(() => ({ spells: null as { version: string; names: Map<number, string> } | null }));
vi.mock("@/lib/game-assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/game-assets")>()),
  loadSpellNames: async () => files.spells,
  loadQuestNames: async () => (wiki.titles ? { version: "x", wiki: { name: "Warcraft Wiki", url: "https://warcraft.wiki.gg" }, names: wiki.titles } : null),
}));

import InstanceList, { generateMetadata as instanceMetadata } from "./instances/page";
import NpcList, { generateMetadata as npcMetadata } from "./npcs/page";
import ObjectList from "./objects/page";
import QuestList, { generateMetadata as questMetadata } from "./quests/page";
import SpellList from "./spells/page";
import VendorList from "./vendors/page";
import ZoneList, { generateMetadata as zoneMetadata } from "./zones/page";

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

/** The zones or instances linked in the table body, in order, by the id their page segment starts with. */
const places = (page: string, kind: string) => [...(page.split("<tbody>")[1] ?? "").matchAll(new RegExp(`href="/database/${kind}/(\\d+)[-"]`, "g"))].map((m) => Number(m[1]));

beforeEach(() => wiki.titles = null);
beforeEach(() => files.spells = null);
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

test("nothing uploaded yet: the empty meter and plain addon link stay, while the recording notice ends at launch", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [], dataAsOf: "2026-10-10T00:00:00.000Z" });
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    for (const date of ["2026-10-25T12:00:00Z", "2026-11-10T12:00:00Z"]) {
      vi.setSystemTime(new Date(date));
      const page = await html(NpcList(search()));
      expect(page).toContain("data-empty-state");
      expect(page).toContain('href="/addon"');
      expect(page).not.toContain("btn");
      expect(page).not.toContain("NPC filters");
      expect(page).toContain("NPC shows here once 3 installs agree on it.");
      if (date.startsWith("2026-10")) {
        expect(page).toContain("The addon starts recording when the game launches on November 4");
      } else {
        expect(page).not.toContain("The addon starts recording");
      }
    }
  } finally {
    vi.useRealTimers();
  }
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

test("the zone list filters by name and sorts by name or continent in the URL", async () => {
  // Dun Morogh (1426) and Duskwood (1431) are in the Eastern Kingdoms, Durotar (1411) and Dustwallow Marsh (1445) in Kalimdor.
  const all = places(await html(ZoneList(search())), "zones");
  expect(all.length).toBeGreaterThan(2);
  expect(all.indexOf(1431)).toBeLessThan(all.indexOf(1411));
  expect(places(await html(ZoneList(search({ q: "dur", sort: "name" }))), "zones")).toEqual([1411]);
  expect(places(await html(ZoneList(search({ q: "du", sort: "name" }))), "zones")).toEqual([1426, 1411, 1431, 1445]);
  expect(places(await html(ZoneList(search({ q: "du", sort: "-name" }))), "zones")).toEqual([1445, 1431, 1411, 1426]);
  expect(places(await html(ZoneList(search({ q: "DU" }))), "zones")).toEqual([1426, 1431, 1411, 1445]);
  expect(places(await html(ZoneList(search({ q: "du", sort: "-continent" }))), "zones")).toEqual([1445, 1411, 1431, 1426]);
  // The header links carry the search; the default order has no sort parameter.
  const sorted = await html(ZoneList(search({ q: "dur", sort: "name" })));
  expect(sorted).toContain('href="/database/zones?q=dur&amp;sort=-name"');
  expect(sorted).toContain('href="/database/zones?q=dur"');
  const none = await html(ZoneList(search({ q: "zzz" })));
  expect(none).toContain("No zones match these filters.");
  expect(none).toContain('href="/database/zones"');
  expect(none).not.toContain("data-empty-state");
  for (const bad of [{ sort: "level" }, { sort: "NAME" }, { page: "0" }, { page: "2" }] as Record<string, string>[]) {
    await expect(html(ZoneList(search(bad))), JSON.stringify(bad)).rejects.toThrow("NEXT_NOT_FOUND");
  }
  expect((await zoneMetadata(search())).robots).toBeUndefined();
  expect((await zoneMetadata(search({ q: "dur" }))).robots).toMatchObject({ index: false, follow: true });
});

test("the instance list filters by name or id and sorts by name, type or level in the URL", async () => {
  // Ragefire Chasm (389) is level 13 in the files, Molten Core (409) a level 60 raid; the files give Onyxia's Lair (249) no level.
  const plain = places(await html(InstanceList(search())), "instances");
  const up = places(await html(InstanceList(search({ sort: "level" }))), "instances");
  const down = places(await html(InstanceList(search({ sort: "-level" }))), "instances");
  expect(plain[0]).toBe(389);
  expect(up[0]).toBe(389);
  expect(up).toHaveLength(plain.length);
  expect(down.indexOf(409)).toBeLessThan(down.indexOf(389));
  // No level is last either way.
  expect(up.indexOf(389)).toBeLessThan(up.indexOf(249));
  expect(down.indexOf(389)).toBeLessThan(down.indexOf(249));
  const byName = places(await html(InstanceList(search({ sort: "name" }))), "instances");
  expect(byName.indexOf(409)).toBeLessThan(byName.indexOf(389));
  expect(places(await html(InstanceList(search({ sort: "-name" }))), "instances")).toEqual([...byName].reverse());
  // Dungeons before raids, and the other way round.
  const byType = places(await html(InstanceList(search({ sort: "type" }))), "instances");
  expect(byType.indexOf(389)).toBeLessThan(byType.indexOf(409));
  const byTypeDown = places(await html(InstanceList(search({ sort: "-type" }))), "instances");
  expect(byTypeDown.indexOf(409)).toBeLessThan(byTypeDown.indexOf(389));
  expect(places(await html(InstanceList(search({ q: "ragefire" }))), "instances")).toEqual([389]);
  expect(places(await html(InstanceList(search({ q: "409" }))), "instances")).toEqual([409]);
  const none = await html(InstanceList(search({ q: "zzz" })));
  expect(none).toContain("No instances match these filters.");
  expect(none).not.toContain("data-empty-state");
  for (const bad of [{ sort: "zone" }, { sort: "bosses" }, { page: "2" }] as Record<string, string>[]) {
    await expect(html(InstanceList(search(bad))), JSON.stringify(bad)).rejects.toThrow("NEXT_NOT_FOUND");
  }
  expect((await instanceMetadata(search())).robots).toBeUndefined();
  expect((await instanceMetadata(search({ sort: "name" }))).robots).toMatchObject({ index: false, follow: true });
});

test("the object list sorts by name by default, and a row with no agreed name says why", async () => {
  // Three installs agree on two names; nobody named object 35591, the most looted of the three.
  const chest = (installId: string, objectId: number, name?: string) =>
    ({ ...base(installId), kind: "loot", sourceEvidence: "loot-api", sourceObjectId: objectId, ...(name ? { sourceObjectName: name } : {}), items: [{ itemId: 2770, count: 1 }] });
  store.loadCorpus.mockResolvedValue({ uploads: 3, dataAsOf: "2026-10-10T00:01:00.000Z", records: [
    ...three.map((i) => chest(i, 1731, "Copper Vein")),
    ...three.map((i) => chest(i, 1618, "Battered Chest")),
    ...three.flatMap((i) => [chest(i, 35591), chest(i, 35591)]),
  ] });
  const all = await html(ObjectList(search()));
  expect(rows(all, "objects")).toEqual([1618, 1731, 35591]);
  expect(rows(await html(ObjectList(search({ sort: "-name" }))), "objects")).toEqual([1731, 1618, 35591]);
  expect(rows(await html(ObjectList(search({ sort: "-windows" }))), "objects")[0]).toBe(35591);
  expect(rows(await html(ObjectList(search({ sort: "id" }))), "objects")).toEqual([1618, 1731, 35591]);
  const unnamed = all.split("<tr").find((r) => r.includes('href="/database/objects/35591"')) ?? "";
  expect(unnamed).toContain(">Object 35591</a>");
  expect(unnamed).toContain("no agreed name yet");
  expect(unnamed).toContain('title="No agreed name yet. A name needs 3 installs reporting the same one."');
  expect(all.split("<tr").find((r) => r.includes('href="/database/objects/1731"'))).not.toContain("no agreed name yet");
  await expect(html(ObjectList(search({ sort: "price" })))).rejects.toThrow("NEXT_NOT_FOUND");
});

test("the spell list with no names read says the build's names could not be read, with no addon link", async () => {
  for (const spells of [null, { version: "x", names: new Map<number, string>() }]) {
    files.spells = spells;
    const page = await html(SpellList(search()));
    expect(page).toMatch(/The spell names for build [\d.]+ could not be read\./);
    expect(page).not.toContain('href="/addon"');
    expect(page).not.toContain("data-empty-state");
    expect(page).not.toContain("No spell is listed yet");
  }
  files.spells = { version: "x", names: new Map([[133, "Fireball"]]) };
  expect(await html(SpellList(search({ q: "frost" })))).toContain("No spells match these filters.");
});
