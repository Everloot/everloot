import { beforeEach, expect, test, vi } from "vitest";
import type { Names } from "./names";

const loaders = vi.hoisted(() => ({ names: vi.fn(), catalog: vi.fn() }));
vi.mock("./names", () => ({ loadNames: loaders.names }));
vi.mock("./completion-lists", async (original) => ({ ...await original<object>(), loadCatalog: loaders.catalog }));
vi.mock("./lore", () => ({ MAX_QUERY: 200, UNAVAILABLE: null, searchLore: () => null }));
import { siteSearch } from "./site-search";

const empty = (): Names => ({ items: new Map(), npcs: new Map(), quests: new Map(), objects: new Map() });
function pending<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
beforeEach(() => { vi.clearAllMocks(); loaders.names.mockResolvedValue(empty()); loaders.catalog.mockResolvedValue(null); });

test("global search starts its independent catalogue read while names are still loading", async () => {
  const names = pending<Names>();
  loaders.names.mockReturnValue(names.promise);
  const answer = siteSearch("Linen Cloth");
  const catalogueStarted = loaders.catalog.mock.calls.length > 0;
  names.resolve({ ...empty(), items: new Map([[2589, "Linen Cloth"]]) });
  const groups = await answer;
  expect(catalogueStarted).toBe(true);
  expect(groups[0].results[0]).toMatchObject({ label: "Linen Cloth", href: "/database/items/2589", exact: true });
});

test("item-only search never starts the unrelated catalogue loader", async () => {
  await siteSearch("Linen Cloth", { only: "item" });
  expect(loaders.catalog).not.toHaveBeenCalled();
});
