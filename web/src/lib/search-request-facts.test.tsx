import { beforeEach, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const reads = vi.hoisted(() => ({ items: vi.fn(), world: vi.fn(), tips: vi.fn() }));
vi.mock("./rollup-compute", () => ({ loadItemFacts: reads.items, loadWorldFacts: reads.world }));
vi.mock("./game-assets", () => ({
  loadItemNames: async () => null,
  loadQuestNames: async () => null,
  loadSiteAssets: async () => ({ base: "https://assets.everloot.app/b" }),
  loadItemTips: reads.tips,
}));
vi.mock("./completion-lists", async (original) => ({ ...await original<object>(), loadCatalog: async () => null }));
vi.mock("./lore", async (original) => ({ ...await original<object>(), searchLore: () => "unavailable" }));
import { GET } from "../app/search/suggest/route";
import SearchPage from "../app/search/page";

const facts = (published = true) => ({
  rates: [], npcs: [], unreachable: false,
  names: published ? ["a", "b", "c"].map((installId) => ({ installId, itemId: 2589, name: "Linen Cloth" })) : [],
});
beforeEach(() => {
  vi.clearAllMocks();
  reads.items.mockResolvedValue(facts());
  reads.world.mockResolvedValue({ npcs: [], quests: [], vendors: [], unreachable: false });
  reads.tips.mockImplementation(async (_assets, ids: number[]) => new Map(ids.map((id) => [id, { icon: `https://assets.everloot.app/b/icons/${id}.webp` }])));
});

test.each(["item", undefined])("a search page shares one item fact read between names and allowed icons (%s)", async (scope) => {
  const html = renderToStaticMarkup(await SearchPage({ searchParams: Promise.resolve({ q: "Linen Cloth", in: scope }) }));
  expect(html).toContain("/database/items/2589");
  expect(html).toContain("icons/2589.webp");
  expect(reads.items).toHaveBeenCalledTimes(1);
  expect(reads.world).toHaveBeenCalledTimes(1);
});

test("type-ahead shares facts within a request but rechecks publication on the next request", async () => {
  const before = await (await GET(new Request("https://everloot.app/search/suggest?q=2589&in=item"))).json();
  expect(before.results[0]).toMatchObject({ label: "Linen Cloth", icon: "https://assets.everloot.app/b/icons/2589.webp" });
  expect(reads.items).toHaveBeenCalledTimes(1);
  reads.items.mockResolvedValue(facts(false));
  reads.tips.mockClear();
  const after = await (await GET(new Request("https://everloot.app/search/suggest?q=2589&in=item"))).json();
  expect(after.results[0]?.label).not.toBe("Linen Cloth");
  expect(after.results.every((r: { icon?: string }) => !r.icon)).toBe(true);
  expect(reads.tips).not.toHaveBeenCalled();
  expect(reads.items).toHaveBeenCalledTimes(2);
});

test("blank and rejected searches do not start item fact reads", async () => {
  await SearchPage({ searchParams: Promise.resolve({}) });
  for (const query of ["", "?q=x&in=wrong", `?q=${"a".repeat(201)}`]) await GET(new Request(`https://everloot.app/search/suggest${query}`));
  expect(reads.items).not.toHaveBeenCalled();
});


test("a failed fact read rejects both searches without an unhandled promise or stale icon", async () => {
  reads.items.mockRejectedValue(new Error("facts unavailable"));
  await expect(GET(new Request("https://everloot.app/search/suggest?q=Linen&in=item"))).rejects.toThrow("facts unavailable");
  await expect(SearchPage({ searchParams: Promise.resolve({ q: "Linen Cloth" }) })).rejects.toThrow("facts unavailable");
  expect(reads.tips).not.toHaveBeenCalled();
});
