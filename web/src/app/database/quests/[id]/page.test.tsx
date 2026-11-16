import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import type { WorldFacts } from "../../../../../../kb/src/world-pages";

const data = vi.hoisted(() => ({
  facts: { npcs: [], quests: [], vendors: [], unreachable: false, dataAsOf: "2026-11-10T00:00:00Z" } as WorldFacts & { unreachable: boolean; dataAsOf: string | null },
  confirmations: true,
  chains: [] as { questLineId: number; name: string; questIds: number[]; confirmed: boolean; reporters: number }[],
}));
vi.mock("@/lib/rollup-compute", () => ({ loadWorldFacts: async () => data.facts }));
vi.mock("@/lib/completion-lists", () => ({
  loadCatalog: async () => ({ chains: data.chains, dataAsOf: "2026-11-10T00:00:00Z", confirmations: data.confirmations }),
  chainHref: (id: number) => `/database/quest-chains/${id}`,
}));
vi.mock("@/lib/game-assets", () => ({
  loadQuestNames: async () => ({ names: new Map([[7, { name: "Earlier quest" }], [8, { name: "A quest" }], [9, { name: "Later quest" }]]) }),
  loadSiteAssets: async () => null,
  loadItemTips: async () => new Map(),
}));
vi.mock("@/lib/lore", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/lore")>()), loreForEntity: async () => null }));

import QuestPage from "./page";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";
import { DEGRADED_META } from "@/lib/cf-edge-cache";
const html = async () => renderToStaticMarkup(await QuestPage({ params: Promise.resolve({ id: "8" }) }));
const fact = (out: string, label: string) => new RegExp(`>${label}</dt><dd[^>]*>(.*?)</dd>`).exec(out)?.[1] ?? "";

beforeEach(() => {
  data.chains = [];
  data.confirmations = true;
  data.facts = { npcs: [], quests: [], vendors: [], unreachable: false, dataAsOf: "2026-11-10T00:00:00Z" };
});

test("a catalog chain links its ordered previous and next quests with source and date", async () => {
  data.chains = [{ questLineId: 900, name: "The road", questIds: [7, 8, 9], confirmed: false, reporters: 0 }];
  const out = await html();
  expect(fact(out, "Chain")).toContain('href="/database/quest-chains/900"');
  expect(fact(out, "Chain")).toContain("Found in game files, unconfirmed");
  expect(fact(out, "Chain")).toContain("0 of 3 installs reported");
  expect(fact(out, "Chain")).toContain("2026-11-13");
  expect(fact(out, "Previous quest")).toContain('href="/database/quests/7"');
  expect(fact(out, "Next quest")).toContain('href="/database/quests/9"');
});

test("an unlisted quest has an unknown chain and zone, without navigation", async () => {
  const out = await html();
  expect(fact(out, "Chain")).toContain("Not reported yet");
  expect(fact(out, "Zone")).toContain("Not reported yet");
  expect(out).not.toContain("Previous quest");
  expect(out).not.toContain("Next quest");
});

test("zone needs an agreed giver and three installs placing it, with source and date", async () => {
  data.facts.quests = ["a", "b", "c"].map((installId) => ({ installId, questId: 8, title: "A quest", level: 1, giverNpcId: 10, rewardItemIds: [] }));
  data.facts.npcs = ["a", "b"].map((installId) => ({ installId, npcId: 10, name: "Giver", mapId: 1429, x: 40, y: 50, positionKind: "interaction", capturedAt: "2026-11-10T00:00:00Z" }));
  expect(fact(await html(), "Zone")).toContain("Not reported yet");
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
  expect(fact(await html(), "Zone")).toContain("Not reported yet");
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
