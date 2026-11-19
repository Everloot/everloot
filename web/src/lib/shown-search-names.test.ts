import { beforeEach, expect, test, vi } from "vitest";
import type { WorldFacts } from "../../../kb/src/world-pages";

// No name here comes from the private files: the fixtures stand in for the agreed names, the world rows and the wiki file.
const mocks = vi.hoisted(() => ({
  agreed: { items: new Map<number, string>(), npcs: new Map<number, string>(), objects: new Map<number, string>(), quests: new Map<number, string>() },
  world: { npcs: [], quests: [], vendors: [], unreachable: false } as WorldFacts & { unreachable: boolean },
  wiki: null as { version: string; names: Map<number | string, { name: string; wikiPage: string }> } | null,
}));
vi.mock("@/lib/names", () => ({ loadNames: async () => mocks.agreed }));
vi.mock("@/lib/shown-item-names", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/shown-item-names")>(), loadShownNames: async () => ({ matched: null }) }));
vi.mock("@/lib/game-assets", () => ({ loadQuestNames: async () => null }));
vi.mock("@/lib/rollup-compute", () => ({ loadWorldFacts: async () => mocks.world }));
vi.mock("@/lib/wiki-entity-names", () => ({ loadWikiEntityNames: async (kind: string) => (kind === "npc" ? mocks.wiki : null) }));

import { loadShownSearchNames } from "./shown-search-names";

const sighting = (npcId: number, name: string, install: string) => ({ npcId, name, installId: install, mapId: 0, x: 0, y: 0 });
const wiki = (pairs: [string, string][]) => ({ version: "x", names: new Map<number | string, { name: string; wikiPage: string }>(pairs.map(([key, name]) => [key, { name, wikiPage: `https://warcraft.wiki.gg/wiki/${name}` }])) });

beforeEach(() => {
  mocks.agreed = { items: new Map(), npcs: new Map(), objects: new Map(), quests: new Map() };
  mocks.world = { npcs: [], quests: [], vendors: [], unreachable: false };
  mocks.wiki = null;
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
