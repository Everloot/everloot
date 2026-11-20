import { beforeEach, expect, test, vi } from "vitest";
import type { WorldFacts } from "@kb/world-pages";

// No name here comes from the private files: the fixtures stand in for the agreed names, the world rows and the wiki file.
const mocks = vi.hoisted(() => ({
  agreed: { items: new Map<number, string>(), npcs: new Map<number, string>(), objects: new Map<number, string>(), quests: new Map<number, string>() },
  world: { npcs: [], quests: [], vendors: [], unreachable: false } as WorldFacts & { unreachable: boolean },
  wiki: null as { version: string; names: Map<number | string, { name: string; wikiPage: string }> } | null,
  // The stored names file (search-names-store.ts) and the private item names file; none unless a test sets them.
  stored: null as unknown,
  itemFile: null as { names: Map<number, { name: string; color: string; wikiPage: string }> } | null,
  reads: { names: 0, world: 0 },
}));
vi.mock("@/lib/names", () => ({ loadNames: async () => { mocks.reads.names++; return mocks.agreed; } }));
vi.mock("@/lib/shown-item-names", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/shown-item-names")>(), loadShownNames: async () => ({ matched: null, showsTip: () => false }) }));
vi.mock("@/lib/game-assets", () => ({ loadQuestNames: async () => null, loadItemNames: async () => mocks.itemFile, PRIVATE_UNREACHABLE: Symbol("private bucket unreachable") }));
vi.mock("@/lib/rollup-compute", () => ({ loadWorldFacts: async () => { mocks.reads.world++; return mocks.world; } }));
vi.mock("@/lib/search-names-store", () => ({ loadStoredSearchNames: async () => mocks.stored }));
vi.mock("@/lib/wiki-entity-names", () => ({ loadWikiEntityNames: async (kind: string) => (kind === "npc" ? mocks.wiki : null) }));

import { loadSearchShown, loadShownSearchNames } from "./shown-search-names";

const sighting = (npcId: number, name: string, install: string) => ({ npcId, name, installId: install, mapId: 0, x: 0, y: 0 });
const wiki = (pairs: [string, string][]) => ({ version: "x", names: new Map<number | string, { name: string; wikiPage: string }>(pairs.map(([key, name]) => [key, { name, wikiPage: `https://warcraft.wiki.gg/wiki/${name}` }])) });

beforeEach(() => {
  mocks.agreed = { items: new Map(), npcs: new Map(), objects: new Map(), quests: new Map() };
  mocks.world = { npcs: [], quests: [], vendors: [], unreachable: false };
  mocks.wiki = null;
  mocks.stored = null;
  mocks.itemFile = null;
  mocks.reads = { names: 0, world: 0 };
});

test("an NPC is found by the Warcraft Wiki name its page prints, as the NPC page picks it", async () => {
  // NPC 1 has one install's name that the wiki matches; NPC 2 two installs that disagree; NPC 3 a name the wiki lacks.
  mocks.world.npcs = [sighting(1, "test npc", "a"), sighting(2, "Test Guard", "a"), sighting(2, "Other Guard", "b"), sighting(3, "Nobody", "a")];
  mocks.wiki = wiki([["test npc", "Test NPC"], ["test guard", "Test Guard"]]);
  const { npcs } = await loadShownSearchNames();
  expect([...npcs]).toEqual([[1, "Test NPC"]]);
});

test("a name 3 installs agree on wins over the wiki's, and objects keep their agreed names only", async () => {
  mocks.world.npcs = [sighting(1, "test npc", "a")];
  mocks.wiki = wiki([["test npc", "Test NPC"]]);
  mocks.agreed.npcs = new Map([[1, "Agreed Name"]]);
  mocks.agreed.objects = new Map([[5, "Agreed Object"]]);
  const names = await loadShownSearchNames();
  expect(names.npcs.get(1)).toBe("Agreed Name");
  expect(names.objects).toBe(mocks.agreed.objects);
});

test("without the wiki file, or with the store out of reach, NPCs keep the agreed names", async () => {
  mocks.world.npcs = [sighting(1, "test npc", "a")];
  mocks.agreed.npcs = new Map([[9, "Agreed"]]);
  expect((await loadShownSearchNames()).npcs).toBe(mocks.agreed.npcs);
  mocks.wiki = wiki([["test npc", "Test NPC"]]);
  mocks.world = { ...mocks.world, unreachable: true };
  expect((await loadShownSearchNames()).npcs).toBe(mocks.agreed.npcs);
});

test("the merged NPC names are built once per corpus and wiki file, so each keystroke reuses them", async () => {
  mocks.world.npcs = [sighting(1, "test npc", "a")];
  mocks.wiki = wiki([["test npc", "Test NPC"]]);
  const first = (await loadShownSearchNames()).npcs;
  expect((await loadShownSearchNames()).npcs).toBe(first);
  mocks.wiki = wiki([["test npc", "Test NPC"]]);
  expect((await loadShownSearchNames()).npcs).not.toBe(first);
});


test("with the stored names file a search reads no aggregate: the file's names merge with the game files and the wiki NPC match, and the icon rule follows the file", async () => {
  mocks.stored = {
    generatedAt: "2026-11-19T06:00:00.000Z", dataAsOf: "2026-11-19T06:00:00.000Z",
    names: { items: new Map([[1003, "Linen Cloth"]]), npcs: new Map([[100, "Kobold Vermin"]]), objects: new Map([[600, "Copper Vein"]]), quests: new Map([[7, "Kobold Camp Cleanup"]]) },
    candidates: new Map([[300, "marshal mcbride"]]), dropped: new Set([1001]), objectIds: new Set([600]),
  };
  mocks.wiki = wiki([["marshal mcbride", "Marshal McBride"]]);
  mocks.itemFile = { names: new Map([[19019, { name: "Thunderfury", color: "#ff8000", wikiPage: "w" }], [1003, { name: "Linen Cloth (files)", color: "#fff", wikiPage: "v" }]]) };
  const shown = await loadSearchShown();
  expect(shown.names.items.get(1003)).toBe("Linen Cloth");
  expect(shown.names.items.get(19019)).toBe("Thunderfury");
  expect(shown.names.npcs.get(100)).toBe("Kobold Vermin");
  expect(shown.names.npcs.get(300)).toBe("Marshal McBride");
  expect(shown.names.objects.get(600)).toBe("Copper Vein");
  expect(shown.names.quests.get(7)).toBe("Kobold Camp Cleanup");
  // An agreed name, a public drop or a game-file name shows the icon; anything else does not.
  expect([1003, 1001, 19019, 5].map(shown.showsTip)).toEqual([true, true, true, false]);
  expect(shown.objects).toEqual(new Set([600]));
  expect(mocks.reads).toEqual({ names: 0, world: 0 });
  // The same file gives the same maps, so the memos keyed on them hold between keystrokes.
  expect((await loadSearchShown()).names.npcs).toBe(shown.names.npcs);
});

test("without the stored file a search reads the aggregates as before", async () => {
  mocks.agreed.npcs.set(100, "Kobold Vermin");
  const shown = await loadSearchShown();
  expect(shown.names.npcs.get(100)).toBe("Kobold Vermin");
  expect(shown.showsTip(100)).toBe(false);
  expect(shown.objects).toBeUndefined();
  expect(mocks.reads.names).toBe(1);
});
