import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { WorldFacts } from "../../../../../../kb/src/world-pages";

const mocks = vi.hoisted(() => ({ world: vi.fn(), rollup: vi.fn(), items: vi.fn() }));
vi.mock("@/lib/rollup-compute", () => ({
  loadWorldFacts: mocks.world, computeRollups: mocks.rollup, loadItemFacts: mocks.items,
  loadLootTables: async () => ({ tables: { sources: new Map(), leftOut: 0 }, dataAsOf: null }),
}));
vi.mock("@/lib/game-assets", () => ({ loadSiteAssets: async () => null, loadItemTips: async () => new Map() }));
vi.mock("@/lib/lore", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/lore")>()), loreForEntity: async () => null }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));

import NpcPage from "./page";
import VendorPage from "../../vendors/[id]/page";

const at = "2026-11-08T12:00:00Z";
let facts: WorldFacts & { unreachable: boolean };
const installs = ["one", "two", "three"];
const quest = (questId: number, role: "giverNpcId" | "turnInNpcId", count = 3) => installs.slice(0, count).map((installId) => ({
  installId, questId, title: `Quest ${questId} title`, level: 55, [role]: 1125, rewardItemIds: [], capturedAt: at,
}));
const goods = (count = 3) => installs.slice(0, count).map((installId) => ({ installId, vendorNpcId: 1125, itemId: 117, priceCopper: 12345, capturedAt: at }));
const html = async () => renderToStaticMarkup(await NpcPage({ params: Promise.resolve({ id: "1125" }) }));
const panel = (out: string, id: string) => out.split(`data-tab-panel="${id}"`)[1]?.split('role="tabpanel"')[0] ?? "";
const fact = (out: string, name: string) => new RegExp(`>${name}</dt><dd[^>]*>(.*?)</dd>`).exec(out)?.[1];

afterEach(() => vi.restoreAllMocks());

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-10T12:00:00Z"));
  facts = {
    npcs: installs.map((installId) => ({ installId, npcId: 1125, name: installId, mapId: 0, x: 0, y: 0, level: 55, reaction: "friendly", creatureType: "Humanoid", rank: "normal", capturedAt: at })),
    quests: [], vendors: [], unreachable: false,
  };
  mocks.world.mockImplementation(async () => facts);
  mocks.rollup.mockResolvedValue({ rates: [], measuredZeros: [], stats: { unreachable: false } });
  mocks.items.mockResolvedValue({ rates: [], names: [], npcs: [], unreachable: false });
});

test("four tabs link agreed goods and giver/turn-in quests with their evidence", async () => {
  facts.vendors = goods();
  facts.quests = [...quest(10, "giverNpcId"), ...quest(11, "turnInNpcId"), ...quest(12, "giverNpcId").map((r) => ({ ...r, turnInNpcId: 1125 }))];
  const out = await html();
  expect(out.match(/role="tab"/g)).toHaveLength(4);
  for (const id of ["drops", "map", "goods", "quests"]) expect(out).toContain(`data-tab-panel="${id}"`);
  expect(panel(out, "goods")).toContain('href="/database/vendors/1125"');
  expect(panel(out, "goods")).toContain('href="/database/items/117"');
  expect(panel(out, "goods")).toContain("1 gold 23 silver 45 copper");
  for (const id of [10, 11, 12]) expect(panel(out, "quests")).toContain(`href="/database/quests/${id}"`);
  expect(panel(out, "quests")).toContain("Giver");
  expect(panel(out, "quests")).toContain("Turn-in");
  for (const id of ["goods", "quests"]) {
    expect(panel(out, id)).toContain("3 of 3 installs agree");
    expect(panel(out, id)).toContain(`last seen 2 days ago`);
  }
  expect(panel(out, "goods")).not.toContain(">Installs<");
  expect(out).toContain("1 goods and 3 quests");
  expect(panel(out, "goods")).toContain("This NPC sells goods.");
  expect(mocks.world).toHaveBeenCalledTimes(1);
  expect(mocks.items).toHaveBeenCalledTimes(1);
});

test("empty and below-threshold tabs explain the three-install rule without publishing reports", async () => {
  for (const count of [0, 1, 2]) {
    facts.vendors = goods(count);
    facts.quests = quest(10, "giverNpcId", count);
    const out = await html();
    expect(panel(out, "goods")).toContain("No agreed goods yet. A price needs 3 installs.");
    expect(panel(out, "quests")).toContain("No agreed quest yet. A quest needs its giver or turn-in from 3 installs.");
    expect(panel(out, "goods")).toContain(`data-agreement="${count}"`);
    expect(panel(out, "quests")).toContain(`data-agreement="${count}"`);
    expect(panel(out, "goods")).not.toContain("12345");
    expect(panel(out, "quests")).not.toContain('href="/database/quests/10"');
  }
});

test("repeated rows from one install and conflicting quest relations stay private", async () => {
  facts.vendors = [goods(1)[0], goods(1)[0], goods(1)[0]];
  facts.quests = [...quest(10, "giverNpcId"), ...quest(10, "giverNpcId").map((r) => ({ ...r, giverNpcId: 999 }))];
  const out = await html();
  expect(panel(out, "quests")).toContain("No agreed quest yet.");
  expect(panel(out, "goods")).toContain("No agreed goods yet.");
});

test("unnamed NPC retains all agreed list traits, with unreported traits shown as unknown", async () => {
  const out = await html();
  expect(out).toMatch(/<h1[^>]*>NPC 1125<\/h1>/);
  expect(fact(out, "Level")).toBe("55");
  expect(fact(out, "Type")).toBe("Humanoid");
  expect(fact(out, "Reaction")).toBe("Friendly");
  expect(fact(out, "Rank")).toBe("Normal");
  facts.npcs = facts.npcs.slice(0, 2);
  const short = await html();
  expect(fact(short, "Level")).toContain("data-agreement");
  expect(fact(short, "Type")).not.toContain("Humanoid");
});

test("missing dates say not reported yet; stock without agreement never becomes zero", async () => {
  facts.vendors = goods().map(({ capturedAt: _, ...r }, i) => ({ ...r, limitedStock: i + 1 }));
  facts.quests = quest(10, "giverNpcId").map(({ capturedAt: _, ...r }) => r);
  const out = await html();
  expect(panel(out, "goods")).toContain("date not reported yet");
  expect(panel(out, "quests")).toContain("date not reported yet");
  expect(panel(out, "goods")).toContain("stock unrecorded");
});

test("named NPC uses only agreed quest names and counts each install once per relation", async () => {
  facts.npcs = facts.npcs.map((r) => ({ ...r, name: "A shopkeeper" }));
  facts.quests = quest(10, "giverNpcId").map((r) => ({ ...r, title: r.installId }));
  facts.quests.push({ ...facts.quests[0], installId: "four", capturedAt: "2026-11-10T00:00:00Z" }, facts.quests[0]);
  const out = await html();
  expect(out).toMatch(/<h1[^>]*>A shopkeeper<\/h1>/);
  expect(panel(out, "quests")).toContain('href="/database/quests/10"');
  expect(panel(out, "quests")).toContain("3 of 3 installs agree");
  expect(panel(out, "quests")).toContain("last seen 12 h ago");
  expect(panel(out, "quests")).not.toContain(">one<");
});

test("a recheck on a quest reward item also resets its NPC relation", async () => {
  facts.quests = quest(10, "giverNpcId").map((r) => ({ ...r, rewardItemIds: [117] }));
  facts.recheck = [{ source: "test", type: "quests", ids: [117], since: "2026-11-09T00:00:00Z" }];
  expect(panel(await html(), "quests")).toContain("No agreed quest yet.");
});

test("rechecks hide old agreements until three fresh installs agree", async () => {
  facts.vendors = goods();
  facts.quests = quest(10, "giverNpcId");
  facts.recheck = [{ source: "test", since: "2026-11-09T00:00:00Z", ids: [1125, 10] }];
  expect(panel(await html(), "goods")).toContain("No agreed goods yet.");
  expect(panel(await html(), "quests")).toContain("No agreed quest yet.");
  const fresh = "2026-11-10T00:00:00Z";
  facts.vendors.push(...goods().map((r) => ({ ...r, capturedAt: fresh })));
  facts.quests.push(...quest(10, "giverNpcId").map((r) => ({ ...r, capturedAt: fresh })));
  const out = await html();
  expect(panel(out, "goods")).toContain(`last seen 12 h ago`);
  expect(panel(out, "quests")).toContain(`last seen 12 h ago`);
});

test("unreachable storage shows unavailable panels rather than empty agreements", async () => {
  facts.unreachable = true;
  const out = await html();
  expect(panel(out, "goods")).not.toContain("No agreed goods");
  expect(panel(out, "quests")).not.toContain("No agreed quest");
});

test("vendor page keeps the same goods table after sharing it with NPC pages", async () => {
  facts.vendors = goods();
  const out = renderToStaticMarkup(await VendorPage({ params: Promise.resolve({ id: "1125" }) }));
  expect(out).toContain('href="/database/items/117"');
  expect(out).toContain("1 gold 23 silver 45 copper");
  expect(out).toContain("Installs");
});

test("short meters count agreement on one offer or relation, not unrelated reports", async () => {
  facts.vendors = goods(2).map((r, i) => ({ ...r, priceCopper: i + 1 }));
  facts.quests = [quest(10, "giverNpcId", 1)[0], quest(11, "giverNpcId", 2)[1]];
  const out = await html();
  expect(panel(out, "goods")).toContain('data-agreement="1"');
  expect(panel(out, "quests")).toContain('data-agreement="1"');
});

test("zone rechecks reset goods and quest relations at the NPC's reported zone", async () => {
  facts.npcs = facts.npcs.map((r) => ({ ...r, mapId: 1426, positionKind: "npc" }));
  facts.vendors = goods();
  facts.quests = quest(10, "giverNpcId");
  facts.recheck = [{ source: "test", zones: [1426], since: "2026-11-09T00:00:00Z" }];
  const out = await html();
  expect(panel(out, "goods")).toContain('data-agreement="0"');
  expect(panel(out, "quests")).toContain('data-agreement="0"');
});
