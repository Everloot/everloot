import type { Metadata } from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The item, NPC and quest pages' own social cards: the name, its type and the installs line, text only, under
// the pages' rules (the same 404 for an unknown id). The words on a PNG cannot be read back, so the test reads
// them off the renderer's arguments and checks the bytes it returns are a PNG.
const { itemFacts, worldFacts, titles, rendered } = vi.hoisted(() => ({
  itemFacts: { rates: [] as unknown[], names: [] as unknown[], npcs: [] as unknown[], unreachable: false },
  worldFacts: { npcs: [] as unknown[], quests: [] as unknown[], vendors: [] as unknown[], unreachable: false },
  titles: { quests: null as unknown },
  rendered: vi.fn(),
}));
vi.mock("@/lib/rollup-compute", () => ({
  loadItemFacts: async () => itemFacts,
  loadWorldFacts: async () => worldFacts,
  computeRollups: async () => ({ rates: [], measuredZeros: [], rejected: [], stats: { unreachable: worldFacts.unreachable } }),
  loadCraftedItems: async () => ({ items: new Set<number>(), unreachable: itemFacts.unreachable }),
  loadObservedEdges: async () => ({ edges: [], unreachable: false, dataAsOf: null }),
}));
vi.mock("@/lib/upload-store", () => ({ STORAGE_UNREACHABLE: "Storage unavailable" }));
vi.mock("@/lib/game-assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/game-assets")>()),
  loadQuestNames: async () => titles.quests,
}));
vi.mock("@/lib/og-card", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/og-card")>();
  return { ...real, renderEntityCard: rendered.mockImplementation(real.renderEntityCard) };
});

import ItemImage, * as itemRoute from "./items/[id]/opengraph-image";
import NpcImage, * as npcRoute from "./npcs/[id]/opengraph-image";
import QuestImage, * as questRoute from "./quests/[id]/opengraph-image";
import { generateMetadata as itemMetadata } from "./items/[id]/page";
import { generateMetadata as npcMetadata } from "./npcs/[id]/page";
import { generateMetadata as questMetadata } from "./quests/[id]/page";

const props = (id: string) => ({ params: Promise.resolve({ id }) });
const installs = (n: number, row: Record<string, unknown>) => ["a", "b", "c"].slice(0, n).map((installId) => ({ installId, ...row }));
const npc = (n: number) => installs(n, { npcId: 123, name: "Hogger", mapId: 1, x: 1, y: 1, positionKind: "npc" });
const quest = (n: number) => installs(n, { questId: 176, title: "Wanted: Hogger", level: 11, giverNpcId: 123, turnInNpcId: 123, rewardItemIds: [] });
const image = (m: Metadata) => (m.openGraph as { images: { url: string }[] }).images[0].url;
const lastCard = () => rendered.mock.lastCall?.[0];

async function expectPng(res: Response) {
  expect(res.headers.get("content-type")).toBe("image/png");
  // Kept as long as the site's own hover card, since the installs line changes as players report.
  expect(res.headers.get("cache-control")).toBe("public, max-age=300, s-maxage=3600, stale-while-revalidate=86400");
  expect([...new Uint8Array(await res.arrayBuffer()).slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
}

describe("the database entity cards", () => {
  beforeEach(() => {
    Object.assign(itemFacts, { rates: [], names: [], npcs: [], unreachable: false });
    Object.assign(worldFacts, { npcs: [], quests: [], vendors: [], unreachable: false });
    titles.quests = null;
    rendered.mockClear();
  });

  it("each route is the shared card size and a PNG", () => {
    for (const route of [itemRoute, npcRoute, questRoute]) {
      expect(route.size).toEqual({ width: 1200, height: 630 });
      expect(route.contentType).toBe("image/png");
      expect(route.alt).toMatch(/WoW Forever (item|NPC|quest) on Everloot/);
    }
  });

  it("an item's card shows its name, its class line and how many installs agree on the name", async () => {
    itemFacts.names = installs(3, { itemId: 19019, name: "Thunderfury" });
    await expectPng(await ItemImage(props("19019")));
    expect(lastCard()).toEqual({ title: "Thunderfury", type: "Weapons · One-Handed Swords", quality: "legendary", omitZero: true, installs: 3 });
    // Two installs so far: the id for a name, in no quality colour, and their count.
    itemFacts.names = installs(2, { itemId: 19019, name: "Thunderfury" });
    await ItemImage(props("19019"));
    expect(lastCard()).toEqual({ title: "Item 19019", type: "Weapons · One-Handed Swords", quality: undefined, omitZero: true, installs: 2 });
    // With storage out of reach the page shows no meter, so the card has no installs line.
    itemFacts.unreachable = true;
    await ItemImage(props("19019"));
    expect(lastCard()).toEqual({ title: "Item 19019", type: "Weapons · One-Handed Swords", quality: undefined, omitZero: true, installs: null });
  });

  it("an NPC's and a quest's card show the agreed name and level; a wiki-titled quest says no install agrees yet", async () => {
    worldFacts.npcs = npc(3);
    worldFacts.quests = quest(3);
    await expectPng(await NpcImage(props("123")));
    expect(lastCard()).toEqual({ title: "Hogger", type: "NPC", omitZero: true, installs: 3 });
    await expectPng(await QuestImage(props("176")));
    expect(lastCard()).toEqual({ title: "Wanted: Hogger", type: "Quest · Level 11", installs: 3 });
    worldFacts.npcs = npc(2);
    await NpcImage(props("123"));
    expect(lastCard()).toEqual({ title: "NPC 123", type: "NPC", omitZero: true, installs: 2 });
    worldFacts.quests = [];
    titles.quests = { names: new Map([[177, { name: "Wiki quest", wikiPage: "x" }]]) };
    await QuestImage(props("177"));
    expect(lastCard()).toEqual({ title: "Wiki quest", type: "Quest", installs: 0 });
  });

  it("an unknown id, or a class slug, is a 404 from the card as it is from the page", async () => {
    titles.quests = { names: new Map() };
    for (const [draw, id] of [[ItemImage, "99999999"], [ItemImage, "weapons"], [NpcImage, "123"], [QuestImage, "176"]] as const) {
      await expect(draw(props(id)), id).rejects.toThrow(/404|NEXT_NOT_FOUND/);
    }
    expect(rendered).not.toHaveBeenCalled();
  });

  it("each page's metadata points its card at the route", async () => {
    itemFacts.names = installs(3, { itemId: 19019, name: "Thunderfury" });
    worldFacts.npcs = npc(3);
    worldFacts.quests = quest(3);
    expect(image(await itemMetadata(props("19019")))).toBe("/database/items/19019/opengraph-image");
    expect(image(await npcMetadata(props("123")))).toBe("/database/npcs/123/opengraph-image");
    expect(image(await questMetadata(props("176")))).toBe("/database/quests/176/opengraph-image");
  });
});
