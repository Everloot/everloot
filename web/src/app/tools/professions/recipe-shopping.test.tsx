// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import RecipeShopping from "./recipe-shopping";

test("only prices the selected recipe's reagents and copies missing materials", async () => {
  const recipe = {
    profession: "Tailoring", slug: "tailoring", spellId: 3755, name: "Linen Bag", itemName: "Linen Bag",
    yellow: 30, grey: 65, recipeItems: [],
    reagents: [{ itemId: 2996, name: "Bolt of Linen Cloth", count: 3 }, { itemId: 2320, name: "Coarse Thread", count: 3 }],
  };
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fetcher = vi.fn(async (url: string) => ({
    ok: true,
    json: async () => url.includes("house=Alliance")
      ? { ok: true, items: [[2320, 10, 10, 10, 30, "2026-11-24", 3, null, 0, null]] }
      : url.includes("house=Horde")
        ? { ok: true, items: [[2996, 405, 400, 400, 30, "2026-11-21", 3, null, 3, null]] }
        : { houses: { "Forever PvP": ["Alliance", "Horde"] } },
  }));
  vi.stubGlobal("fetch", fetcher);
  const copy = vi.fn().mockResolvedValue(undefined);
  const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", { value: { writeText: copy }, configurable: true });
  const host = document.createElement("div");
  const root = createRoot(host);
  const button = (text: string) => [...host.querySelectorAll("button")].find(b =>
    (b.querySelector("[data-copy-labels] > span")?.textContent ?? b.textContent) === text)!;
  const choose = async (label: string, value: string) => {
    const input = host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
    await act(async () => { input.value = value; input.dispatchEvent(new Event("change", { bubbles: true })); });
  };
  try {
    await act(async () => root.render(<RecipeShopping recipe={recipe} initialCrafts={2} />));
    expect(fetcher).not.toHaveBeenCalled();
    expect(host.textContent).toContain("6 × Coarse Thread");
    // Each reagent links its item page, so the site's hover card shows on it.
    expect(host.querySelector('a[href="/database/items/2320"]')?.textContent).toBe("Coarse Thread");
    await act(async () => button("Load auction prices").click());
    await choose("Realm", "Forever PvP");
    await choose("Auction house", "Horde");
    expect(fetcher.mock.calls[1][0]).toBe("/api/market/prices?realm=Forever+PvP&house=Horde&items=2320%2C2996&fields=full");
    expect(host.textContent).toContain("2026-11-21 (stale)");
    expect(host.textContent).toContain("Known subtotal");
    expect(host.textContent).toContain("Batch total incomplete");
    await act(async () => button("Copy recipe shopping list").click());
    expect(copy).toHaveBeenCalledWith(expect.stringContaining("6 × Coarse Thread"));
    await choose("Auction house", "Alliance");
    expect(host.textContent).toContain("2026-11-24");
    expect(host.textContent).not.toContain("2026-11-21");
  } finally {
    await act(async () => root.unmount());
    if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
    else Reflect.deleteProperty(navigator, "clipboard");
    vi.unstubAllGlobals();
  }
});
