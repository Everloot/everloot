import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import type { WorldFacts } from "@kb/world-pages";

const data = vi.hoisted(() => ({
  facts: { npcs: [], quests: [], vendors: [], unreachable: false, dataAsOf: "2026-11-10T00:00:00Z" } as WorldFacts & { unreachable: boolean; dataAsOf: string | null },
  confirmations: true,
  chains: [] as { questLineId: number; name: string; questIds: number[]; confirmed: boolean; reporters: number }[],
  tips: new Map<number, { name: string; icon: string | null; quality: string; color: string }>(),
  starters: [] as number[],
  shown: new Set<number>(),
}));
vi.mock("@/data/game-data/client-quest-starts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/data/game-data/client-quest-starts")>()),
  itemsStartingQuest: (questId: number) => (questId === 8 ? data.starters : []),
}));
vi.mock("@/lib/shown-item-names", () => ({
  loadShownNames: async () => ({ agreed: new Map([[500, "Sealed Orders"]]), matched: null, showsTip: (id: number) => data.shown.has(id) }),
}));
vi.mock("@/lib/completion-lists", () => ({
  loadCatalog: async () => ({ chains: data.chains, dataAsOf: "2026-11-10T00:00:00Z", confirmations: data.confirmations }),
  chainHref: (id: number) => `/database/quest-chains/${id}`,
}));
vi.mock("@/lib/game-assets", () => ({
  loadQuestNames: async () => ({ names: new Map([[7, { name: "Earlier quest" }], [8, { name: "A quest" }], [9, { name: "Later quest" }]]) }),
  loadSiteAssets: async () => null,
  loadItemTips: async () => data.tips,
}));
vi.mock("@/lib/names", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/names")>()), itemNames: () => new Map() }));
vi.mock("@/lib/rollup-compute", () => ({ loadWorldFacts: async () => data.facts, loadItemFacts: async () => ({ unreachable: true }) }));
vi.mock("@/lib/lore", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/lore")>()), loreForEntity: async () => null }));

import QuestPage from "./page";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";
import { DEGRADED_META } from "@/lib/cf-edge-cache";
const html = async () => renderToStaticMarkup(await QuestPage({ params: Promise.resolve({ id: "8" }) }));
const fact = (out: string, label: string) => new RegExp(`>${label}</dt><dd[^>]*>(.*?)</dd>`).exec(out)?.[1] ?? "";
// Unreported facts fold into one row: their labels after a single empty meter.
const unreported = (out: string) => fact(out, "Not yet reported");

beforeEach(() => {
  data.chains = [];
  data.confirmations = true;
  data.tips = new Map();
  data.starters = [];
  data.shown = new Set();
  data.facts ={ npcs: [], quests: [], vendors: [], unreachable: false, dataAsOf: "2026-11-10T00:00:00Z" };
});

test("a catalog chain links its ordered previous and next quests with source and date", async () => {
  data.chains = [{ questLineId: 900, name: "The road", questIds: [7, 8, 9], confirmed: false, reporters: 0 }];
  const out = await html();
  expect(fact(out, "Chain")).toContain('href="/database/quest-chains/900"');
  expect(fact(out, "Chain")).toContain("Found in game files, unconfirmed");
  expect(fact(out, "Chain")).toContain("0 of 3 installs reported");
  expect(fact(out, "Chain")).toContain("2026-11-25");
  expect(fact(out, "Previous quest")).toContain('href="/database/quests/7"');
  expect(fact(out, "Next quest")).toContain('href="/database/quests/9"');
});

test("an unlisted quest has an unknown chain and zone, without navigation", async () => {
  const out = await html();
  expect(unreported(out)).toMatch(/data-agreement="0"[\s\S]*Chain[\s\S]*Zone/);
  expect(out).not.toContain("Previous quest");
  expect(out).not.toContain("Next quest");
});

test("zone needs an agreed giver and three installs placing it, with source and date", async () => {
  data.facts.quests = ["a", "b", "c"].map((installId) => ({ installId, questId: 8, title: "A quest", level: 1, giverNpcId: 10, rewardItemIds: [] }));
  data.facts.npcs = ["a", "b"].map((installId) => ({ installId, npcId: 10, name: "Giver", mapId: 1429, x: 40, y: 50, positionKind: "interaction", capturedAt: "2026-11-10T00:00:00Z" }));
  expect(unreported(await html())).toContain("Zone");
  data.facts.npcs.push({ ...data.facts.npcs[0], installId: "c" });
  const zone = fact(await html(), "Zone");
  expect(zone).toContain('href="/database/zones/1429-elwynn-forest"');
  expect(zone).toContain("Player reports");
  expect(zone).toContain("3 of 3 installs agree");
  expect(zone).toContain("2026-11-10");
});

test("chain boundaries do not invent previous or next quests", async () => {
  data.chains = [{ questLineId: 900, name: "One quest", questIds: [8], confirmed: true, reporters: 3 }];
  const out = await html();
  expect(fact(out, "Chain")).toContain("Player reports");
  expect(out).not.toContain("Previous quest");
  expect(out).not.toContain("Next quest");
});

test("the first and last quests only link their existing neighbor", async () => {
  data.chains = [{ questLineId: 900, name: "The road", questIds: [8, 9], confirmed: false, reporters: 0 }];
  const first = await html();
  expect(first).not.toContain("Previous quest");
  expect(fact(first, "Next quest")).toContain('href="/database/quests/9"');
  data.chains[0].questIds = [7, 8];
  const last = await html();
  expect(last).not.toContain("Next quest");
  expect(fact(last, "Previous quest")).toContain('href="/database/quests/7"');
});

test("a position without an eligible pin cannot establish the zone", async () => {
  data.facts.quests = ["a", "b", "c"].map((installId) => ({ installId, questId: 8, title: "A quest", level: 1, giverNpcId: 10, rewardItemIds: [] }));
  data.facts.npcs = ["a", "b", "c"].map((installId) => ({ installId, npcId: 10, name: "Giver", mapId: 1429, x: 40, y: 50, positionKind: "player" }));
  expect(unreported(await html())).toContain("Zone");
});

test("neighbors use known names and multiple chain membership is visible", async () => {
  data.chains = [
    { questLineId: 900, name: "The road", questIds: [7, 8, 9], confirmed: false, reporters: 1 },
    { questLineId: 901, name: "Another road", questIds: [8], confirmed: false, reporters: 0 },
  ];
  const out = await html();
  expect(fact(out, "Previous quest")).toContain("Earlier quest");
  expect(fact(out, "Next quest")).toContain("Later quest");
  expect(fact(out, "Chain")).toContain("also in 1 other chain");
});

test("unreadable confirmations distinguish unavailable data from unreported facts", async () => {
  data.confirmations = false;
  const out = await html();
  expect(out).toContain(DEGRADED_META);
  expect(fact(out, "Chain")).toContain(STORAGE_UNREACHABLE);
  expect(fact(out, "Chain")).not.toContain("Not reported yet");
  data.chains = [{ questLineId: 900, name: "The road", questIds: [8], confirmed: false, reporters: 0 }];
  const chain = fact(await html(), "Chain");
  expect(chain).toContain("player reports could not be read just now");
  expect(chain).not.toContain("0 of 3");
  expect(chain).not.toContain("installs unrecorded");
});

test("unreachable world facts show the degraded notice", async () => {
  data.facts.unreachable = true;
  expect(await html()).toContain(DEGRADED_META);
});

const sighting = (installId: string, over: Record<string, unknown> = {}) => ({ installId, questId: 8, title: "A quest", level: 20, rewardItemIds: [], ...over });
const header = (out: string) => /<header[^>]*data-entity-header[^>]*>(.*?)<\/header>/s.exec(out)?.[1] ?? "";

test("the header names the side in its faction colour, the type and the category, once 3 installs agree", async () => {
  data.facts.quests = ["a", "b", "c"].map((id) => sighting(id, { faction: "horde", tag: "dungeon", suggestedGroup: 5, category: "Elwynn Forest" }));
  const out = await html();
  const head = header(out);
  expect(head).toMatch(/class="[^"]*text-faction-horde[^"]*">Horde</);
  expect(head).toContain("Dungeon, 5 players");
  expect(head).toContain('href="/database/zones/1429-elwynn-forest"');
  expect(fact(out, "Side")).toContain("Horde");
  expect(fact(out, "Type")).toContain("Dungeon, 5 players");
  expect(fact(out, "Category")).toContain("Elwynn Forest");
  // Two installs are not an agreement: no side, no type, and a category that is not a zone stays plain text.
  data.facts.quests = ["a", "b"].map((id) => sighting(id, { faction: "horde", tag: "dungeon" })).concat(["a", "b", "c"].map((id) => sighting(id, { category: "Warrior" })));
  const two = await html();
  expect(header(two)).not.toContain("Horde");
  expect(two).not.toContain(">Type</dt>");
  expect(fact(two, "Category")).toContain("Warrior");
  expect(fact(two, "Category")).not.toContain("href");
});

test("the summary counts the facts players agree on, and never says nobody reported a quest it shows them for", async () => {
  data.facts.quests = ["a", "b", "c"].map((id) => sighting(id, { faction: "alliance", category: "Westfall", giverNpcId: 10 }));
  const out = await html();
  expect(out).not.toContain("No player has reported it yet.");
  expect(out).toContain("Players agree on its level, side, category and giver.");
  // With nothing agreed beyond the title, the line stays as it was.
  data.facts.quests = ["a", "b"].map((id) => sighting(id, {}));
  expect(await html()).toContain("No player has reported it yet.");
});

test("the start and end NPCs are labelled Start and End", async () => {
  data.facts.quests = ["a", "b", "c"].map((id) => sighting(id, { giverNpcId: 10, turnInNpcId: 11 }));
  const out = await html();
  expect(fact(out, "Start")).toContain('href="/database/npcs/10"');
  expect(fact(out, "End")).toContain('href="/database/npcs/11"');
  expect(out).toContain("Start and end");
});

test("rewards show their icon and name in the quality colour, and say choices are not recorded", async () => {
  data.facts.quests = ["a", "b", "c"].map((id) => sighting(id, { rewardItemIds: [100] }));
  data.tips = new Map([[100, { name: "Sturdy Blade", icon: "/icons/blade.webp", quality: "Rare", color: "#0070dd" }]]);
  const out = await html();
  expect(out).toMatch(/<img[^>]*src="\/icons\/blade.webp"[^>]*class="[^"]*border-q-rare/);
  const link = /<a[^>]*href="\/database\/items\/100"[^>]*>Sturdy Blade<\/a>/.exec(out)?.[0] ?? "";
  expect(link).toMatch(/class="[^"]*text-q-rare/);
  expect(out).toContain("which rewards were a choice");
});

test("the chain is drawn as ordered steps with this quest marked and a link to the whole chain", async () => {
  data.chains = [{ questLineId: 900, name: "The road", questIds: [7, 8, 9], confirmed: false, reporters: 0 }];
  const out = await html();
  const flow = /<ol[^>]*data-quest-chain[^>]*>(.*?)<\/ol>/s.exec(out)?.[1] ?? "";
  expect(flow).toContain('href="/database/quests/7"');
  expect(flow).toContain('href="/database/quests/9"');
  expect(flow).toMatch(/aria-current="step"[^>]*>.*A quest/s);
  expect(flow).not.toContain('href="/database/quests/8"');
  expect(flow.indexOf("Earlier quest")).toBeLessThan(flow.indexOf("Later quest"));
  expect(out).toMatch(/href="\/database\/quest-chains\/900"[^>]*>All 3 quests/);
});

test("a long chain shows its ends and this quest's neighbours, and counts the steps it leaves out", async () => {
  const ids = Array.from({ length: 20 }, (_, i) => i + 1);
  data.chains = [{ questLineId: 900, name: "The long road", questIds: ids, confirmed: false, reporters: 0 }];
  const flow = /<ol[^>]*data-quest-chain[^>]*>(.*?)<\/ol>/s.exec(await html())?.[1] ?? "";
  for (const id of [1, 6, 7, 9, 10, 20]) expect(flow).toContain(`href="/database/quests/${id}"`);
  for (const id of [2, 5, 11, 19]) expect(flow).not.toContain(`href="/database/quests/${id}"`);
  expect(flow).toContain("4 more");
  expect(flow).toContain("9 more");
});

test("an item the game files say begins the quest is listed as Started by, marked as from the game files", async () => {
  expect(await html()).not.toContain(">Started by</dt>");
  data.starters = [500];
  data.shown = new Set([500]);
  data.tips = new Map([[500, { name: "Sealed Orders", icon: "/icons/orders.webp", quality: "Common", color: "#fff" }]]);
  const started = fact(await html(), "Started by");
  expect(started).toMatch(/<a[^>]*href="\/database\/items\/500"[^>]*>Sealed Orders<\/a>/);
  expect(started).toContain("/icons/orders.webp");
  expect(started).toContain("Found in game files, unconfirmed");
});

test("Started by sits beside an agreed giver, and an item held back by the item name rule stays hidden", async () => {
  data.facts.quests = ["a", "b", "c"].map((id) => sighting(id, { giverNpcId: 10 }));
  data.starters = [500, 501];
  data.shown = new Set([500]);
  const out = await html();
  expect(fact(out, "Start")).toContain('href="/database/npcs/10"');
  expect(fact(out, "Started by")).toContain('href="/database/items/500"');
  expect(out).not.toContain("/database/items/501");
  data.shown = new Set();
  expect(await html()).not.toContain(">Started by</dt>");
});
