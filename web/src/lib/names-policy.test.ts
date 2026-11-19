import { expect, test } from "vitest";
import type { WorldFacts } from "../../../kb/src/world-pages";
import { itemNames, npcNames, objectNames, questTitles, type Names } from "./names";
import { shownSearchNames, tokenNamer } from "./shown-item-names";

// Which functions answer with AGREED names (3 installs; every surface, and the only names the API, MCP and bulk
// export use) and which with SHOWN names (pages only), on one fixture. The policy is the comment atop names.ts.
// Placeholder names only: none comes from the game files.

const installs = ["a", "b", "c"];
const itemRows = [
  ...installs.map((installId) => ({ installId, itemId: 1, name: "Agreed Item" })),
  { installId: "a", itemId: 2, name: "Lone Item" },
];
const sighting = (npcId: number, name: string, installId: string) => ({ installId, npcId, name, mapId: 0, x: 0, y: 0 });
const quest = (questId: number, title: string, installId: string) => ({ installId, questId, title, level: 1, rewardItemIds: [] });
const world = {
  npcs: [...installs.map((i) => sighting(10, "Agreed NPC", i)), sighting(11, "lone npc", "a")],
  quests: [...installs.map((i) => quest(20, "Agreed Quest", i)), quest(21, "Lone Quest", "a")],
  vendors: [],
  unreachable: false,
} as unknown as WorldFacts & { unreachable: boolean };
const items = { names: itemRows, objects: [] };

// The private files' answers: an item and a quest players have not named, and the wiki NPC name the lone report matches.
const matched = { version: "x", wiki: { name: "wiki", url: "https://example.test" }, names: new Map([[2, { name: "Matched Item", color: "#fff", quality: 1, wikiPage: null, source: "wiki" as const }]]) };
const questWiki = { version: "x", wiki: { name: "wiki", url: "https://example.test" }, names: new Map([[21, { name: "Wiki Quest", wikiPage: "q" }]]) };
const npcWiki = { version: "x", names: new Map<number | string, { name: string; wikiPage: string }>([["lone npc", { name: "Wiki NPC", wikiPage: "n" }]]) };

const agreed = (): Names => ({ items: itemNames(items), npcs: npcNames(world), objects: objectNames(items), quests: questTitles(world) });

test("names.ts answers with agreed names only: nothing one install reported, nothing from the private files", () => {
  const names = agreed();
  expect([...names.items]).toEqual([[1, "Agreed Item"]]);
  expect([...names.npcs]).toEqual([[10, "Agreed NPC"]]);
  expect([...names.quests]).toEqual([[20, "Agreed Quest"]]);
  expect(names.objects.size).toBe(0);
});

test("shownSearchNames answers with shown names: agreed first, then the files and wiki matches", () => {
  const shown = shownSearchNames({ agreed: agreed(), shown: { matched }, quests: questWiki, world, npcWiki });
  expect(Object.fromEntries(shown.items)).toEqual({ 1: "Agreed Item", 2: "Matched Item" });
  expect(Object.fromEntries(shown.npcs)).toEqual({ 10: "Agreed NPC", 11: "Wiki NPC" });
  expect(Object.fromEntries(shown.quests)).toEqual({ 20: "Agreed Quest", 21: "Wiki Quest" });
  expect(shown.objects).toBe(agreed().objects);
});

test("tokenNamer: shown item names and quest titles, agreed NPC names (as wiki tokens always did)", () => {
  const nameOf = tokenNamer({ shown: { agreed: itemNames(items), matched }, world, questWiki });
  expect([nameOf("item", 1), nameOf("item", 2), nameOf("npc", 10), nameOf("npc", 11), nameOf("quest", 20), nameOf("quest", 21)])
    .toEqual(["Agreed Item", "Matched Item", "Agreed NPC", undefined, "Agreed Quest", "Wiki Quest"]);
});
