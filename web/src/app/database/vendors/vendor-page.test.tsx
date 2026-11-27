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

test("Sells prices leave out zero coins as the game does, and on a phone the price, stock and evidence fold under the name", async () => {
  facts.vendors = installs.map((installId) => ({ installId, vendorNpcId: 1125, itemId: 117, priceCopper: 100, capturedAt: at }));
  const sells = panel(await html(), "goods");
  expect(sells).toContain('<span class="sr-only">1 silver</span>');
  expect(sells).not.toContain("0 copper");
  // The Reported column hides below 640 px; its words ride the item cell's second line there.
  expect(sells).toMatch(/<div class="dt-meta">(?:<[^>]*>)*(?:[^<]*<[^>]*>)*[^<]*not limited[^<]*(?:<[^>]*>)*3 of 3 installs agree/);
  expect(sells).toMatch(/<th scope="col"[^>]*hidden sm:table-cell[^>]*>(?:<[^>]*>)*Reported/);
});

test("an item agreed at two prices is one row at the higher price, with the other price players saw as a note", async () => {
  // SYNTHETIC, in the shape of Barkeep Hann's Melon Juice: 3 installs at 5s, 3 at 4s 50c.
  facts.vendors = [
    ...installs.map((installId) => ({ installId, vendorNpcId: 1125, itemId: 117, priceCopper: 500, capturedAt: at })),
    ...["four", "five", "six"].map((installId) => ({ installId, vendorNpcId: 1125, itemId: 117, priceCopper: 450, capturedAt: at })),
  ];
  const out = await html();
  const sells = panel(out, "goods");
  const rows = sells.split("<tr").filter((r) => r.includes('href="/database/items/117"'));
  expect(rows).toHaveLength(1);
  expect(rows[0]).toContain("5 silver</span>");
  expect(rows[0]).toMatch(/data-other-prices[^>]*>players also saw (?:<!-- -->)?(?:<[^>]*>)*.*4 silver 50 copper.*\(likely a reputation discount\)/);
  expect(out).toMatch(/role="tab"[^>]*>Sells<span[^>]*> \(1\)<\/span>/);
});

test("Limited stock counts the merged rows: every row not limited reads None, not an unreported chip; an item at two prices counts once", async () => {
  // SYNTHETIC, in the shape of Barkeep Hann: four items, one agreed at two prices, every row "not limited".
  const sold = (itemId: number, priceCopper: number, ids = installs, extra: { limitedStock?: number } = {}) => ids.map((installId) => ({ installId, vendorNpcId: 1125, itemId, priceCopper, capturedAt: at, ...extra }));
  facts.vendors = [...sold(117, 500), ...sold(117, 450, ["four", "five", "six"]), ...sold(159, 25), ...sold(1179, 125), ...sold(1205, 400)];
  const out = await html();
  expect(fact(out, "Limited stock")).toBe("None");
  expect(out).not.toMatch(/Not yet reported(?:<[^>]*>|[^<])*Limited stock/);
  // One limited item seen at two prices is one limited item.
  facts.vendors = [...sold(117, 500, installs, { limitedStock: 5 }), ...sold(117, 450, ["four", "five", "six"], { limitedStock: 5 }), ...sold(159, 25)];
  expect(fact(await html(), "Limited stock")).toBe("1");
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
