import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { WorldFacts } from "@kb/world-pages";

const mocks = vi.hoisted(() => ({ world: vi.fn(), items: vi.fn(), tips: vi.fn() }));
vi.mock("@/lib/rollup-compute", () => ({ loadWorldFacts: mocks.world, loadItemFacts: mocks.items }));
vi.mock("@/lib/game-assets", () => ({ loadSiteAssets: async () => null, loadItemTips: mocks.tips }));
vi.mock("@/lib/lore", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/lore")>()), loreForEntity: async () => null }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));

import VendorPage from "./[id]/page";
import VendorListPage from "./page";

const at = "2026-11-08T12:00:00Z";
const installs = ["one", "two", "three"];
let facts: WorldFacts & { unreachable: boolean };
const offer = (itemId: number, extra: { limitedStock?: number } = {}) => installs.map((installId) => ({ installId, vendorNpcId: 1125, itemId, priceCopper: 12345, capturedAt: at, ...extra }));
const html = async () => renderToStaticMarkup(await VendorPage({ params: Promise.resolve({ id: "1125" }) }));
const panel = (out: string, id: string) => out.split(`data-tab-panel="${id}"`)[1]?.split('role="tabpanel"')[0] ?? "";
const fact = (out: string, name: string) => new RegExp(`>${name}</dt><dd[^>]*>(.*?)</dd>`).exec(out)?.[1];

afterEach(() => vi.restoreAllMocks());

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tips.mockResolvedValue(new Map([[117, { name: "Tough Jerky", color: "#ffffff", quality: "Common", icon: null, lines: [], partial: false, why: [], label: "", level: 5, required: 0, binding: 0 }]]));
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-10T12:00:00Z"));
  facts = {
    npcs: installs.map((installId) => ({ installId, npcId: 1125, name: "Brother Danil", mapId: 1429, x: 40, y: 50, positionKind: "npc", reaction: "friendly", capturedAt: at })),
    quests: [], vendors: [...offer(117), ...offer(159, { limitedStock: 5 })], unreachable: false,
  } as WorldFacts & { unreachable: boolean };
  mocks.world.mockImplementation(async () => facts);
  mocks.items.mockResolvedValue({ rates: [], names: [], npcs: [], unreachable: false });
});

test("the vendor header names its NPC, reaction and zone; the facts count what it sells", async () => {
  const out = await html();
  const header = out.split("</header>")[0]!;
  expect(header).toMatch(/href="\/database\/npcs\/1125"[^>]*>Brother Danil</);
  expect(header).toContain("Friendly");
  expect(header).toContain('href="/database/zones/1429-elwynn-forest"');
  expect(fact(out, "Reaction")).toBe("Friendly");
  expect(fact(out, "Zone")).toContain('href="/database/zones/1429-elwynn-forest"');
  expect(fact(out, "Items sold")).toBe("2");
  expect(fact(out, "Limited stock")).toBe("1");
});

test("the Sells tab is the NPC page's table: item links, prices in coins, stock and each offer's evidence", async () => {
  const out = await html();
  expect(out).toMatch(/role="tab"[^>]*>Sells<span[^>]*> \(2\)<\/span>/);
  const sells = panel(out, "goods");
  expect(sells).toMatch(/href="\/database\/items\/117"[^>]*>(?:<[^>]*>)*Tough Jerky/);
  expect(sells).toContain("1 gold 23 silver 45 copper");
  // Stock reads as words with only its number in mono, not a whole cell of mono letters.
  expect(sells).toMatch(/stock (?:<!-- -->)?<span class="font-mono tabular-nums">5<\/span>/);
  expect(sells).toMatch(/<td class="dt-td dt-nowrap[^"]*">not limited<\/td>/);
  expect(sells).not.toMatch(/<td class="dt-td dt-num[^"]*">not limited/);
  expect(sells).toContain("3 of 3 installs agree");
  expect(sells).not.toContain(">Installs<");
});

test("storage down: no reaction, zone or counts stated", async () => {
  facts.unreachable = true;
  const out = await html();
  expect(out).not.toContain("Friendly");
  expect(out).not.toContain("Items sold");
});

test("the vendor list shows a reaction column beside the zone", async () => {
  const out = renderToStaticMarkup(await VendorListPage({}));
  expect(out).toMatch(/>Reaction</);
  expect(out).toContain("Friendly");
  expect(out).toContain("Elwynn Forest");
});
