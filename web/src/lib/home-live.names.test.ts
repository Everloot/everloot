import { expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn, revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const at = "2026-11-25T00:00:00.000Z";
vi.mock("./database-activity-store", () => ({
  loadDatabaseActivity: async () => ({
    version: 1, generatedAt: at, dataAsOf: null, publicKeys: [],
    entries: [
      { kind: "item", id: 249881, name: "Item #249881", path: "/database/items/249881", installs: 3, publicAt: at },
      { kind: "npc", id: 2376, name: "NPC #2376", path: "/database/npcs/2376", installs: 3, publicAt: at },
      { kind: "item", id: 276916, name: "Item #276916", path: "/database/items/276916", installs: 3, publicAt: at },
    ],
  }),
}));
vi.mock("./search-names-store", () => ({
  loadStoredSearchNames: async () => ({
    names: { items: new Map(), npcs: new Map(), objects: new Map(), quests: new Map() },
    candidates: new Map([[2376, "torn fin oracle"]]), dropped: new Set(), objectIds: new Set(),
  }),
}));
vi.mock("./wiki-entity-names", () => ({
  loadWikiEntityNames: async () => ({ version: "v", names: new Map([["torn fin oracle", { name: "Torn Fin Oracle", wikiPage: "https://warcraft.wiki.gg/wiki/Torn_Fin_Oracle" }]]) }),
}));
vi.mock("./game-assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./game-assets")>()),
  loadItemNames: async () => ({ version: "v", names: new Map([[249881, { name: "Recipe: Root Tea", color: "ffffff", wikiPage: null, source: "files" }]]) }),
  loadQuestNames: async () => null,
  loadSiteAssets: async () => { throw new Error("no assets in this test"); },
}));

import { loadHomeNewest } from "./home-live";

test("the home and hub panels name a fact the way its page does, and leave out a fact its page has no name for", async () => {
  // Item 276916 has no name anywhere: it stays on /database/recent and its own page, never in the showcase card.
  expect((await loadHomeNewest())?.map((f) => f.name)).toEqual(["Recipe: Root Tea", "Torn Fin Oracle"]);
});
