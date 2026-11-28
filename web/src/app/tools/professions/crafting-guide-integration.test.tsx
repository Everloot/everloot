// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { parseCraftShare } from "@/lib/crafting-profit";
import type { ProfessionGuideRecipe } from "@/lib/profession-guide-data";
import LevelingGuide from "./leveling-guide";
import RecipeShopping from "./recipe-shopping";

const replace = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const recipes: ProfessionGuideRecipe[] = [{
  id: 10, name: "Practice Potion", reagents: [{ itemId: 11, count: 2 }],
  windows: [{ fromSkill: 1, toSkill: 3, points: 1, chance: 1, evidence: "observed" }],
  prices: { materials: null }, trainingCopper: 15, output: null,
  source: { kind: "trainer", npcIds: [12], provider: "everloot" },
}];

async function guide(initialRealm = "", initialHouse = "") {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  replace.mockClear();
  window.history.replaceState(null, "", "/tools/professions/alchemy?recipe=2329");
  const fetcher = vi.fn(async (input: string) => Response.json(input.includes("items=")
    ? { ok: true, items: [[11, 100, 30, 100, 12, "2026-11-28", 3, null, 0, null]] }
    : { houses: { "Forever PvP": ["Alliance", "Horde"] } }));
  vi.stubGlobal("fetch", fetcher);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<LevelingGuide profession="Alchemy" recipes={recipes}
    items={{ 11: { name: "Peacebloom" } }} from={1} to={3} initialRealm={initialRealm} initialHouse={initialHouse} />));
  return { host, fetcher, done: async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); } };
}

test("the leveling guide writes a market link the recipe card reads without errors", async () => {
  const ui = await guide();
  try {
    await act(async () => [...ui.host.querySelectorAll("button")].find(b => b.textContent === "Load auction prices")!.click());
    for (const [label, value] of [["Realm", "Forever PvP"], ["Auction house", "Horde"]]) {
      const select = [...ui.host.querySelectorAll("label")].find(l => l.textContent?.startsWith(label))!.querySelector("select")!;
      await act(async () => { select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); });
    }
    await act(async () => { ui.host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    const url = new URL(replace.mock.calls.at(-1)![0], window.location.origin);
    const parsed = parseCraftShare(Object.fromEntries(url.searchParams));
    expect(parsed.issues).toEqual([]);
    expect(parsed.state).toMatchObject({ recipe: 2329, realm: "forever-pvp", house: "Horde" });
    expect(url.searchParams.get("house")).toBe("horde");
  } finally { await ui.done(); }
});

test("a recipe card's canonical market link preselects and prices the leveling guide", async () => {
  const ui = await guide("forever-pvp", "horde");
  try {
    expect(ui.fetcher.mock.calls.map(([url]) => url)).toContain("/api/market/prices?realm=Forever+PvP&house=Horde&items=11&fields=full");
    expect(ui.host.textContent).toContain("Forever PvP · Horde · Everloot listing estimates");
    expect(ui.host.textContent).toContain("1s 20c");
    expect(ui.host.textContent).not.toContain("The realm in this link has no public prices");
  } finally { await ui.done(); }
});

test("the selected-route headline and copy flag stale intermediate inputs even when bags cover them", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.history.replaceState(null, "", "/tools/professions/tailoring?recipe=3755");
  const rows = [[2320, 10], [2996, 500], [4245, 4000]].map(([id, price]) => [id, price, price, price, 30, "2026-11-28", 3, null, 0, null]);
  rows.push([2589, 100, 100, 100, 30, "2026-11-10", 3, null, 18, null]);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true, items: rows })));
  const copy = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<RecipeShopping
      recipe={{ profession: "Tailoring", slug: "tailoring", spellId: 3755, name: "Bag", itemName: "Bag", yellow: 30, grey: 65, recipeItems: [],
        output: { itemId: 4245, minimum: 1, maximum: 1 }, reagents: [{ itemId: 2996, name: "Bolt", count: 3 }, { itemId: 2320, name: "Thread", count: 3 }] }}
      initial={{ recipe: 3755, crafts: 2, realm: "forever-pvp", house: "Horde", destination: "ah", strategy: "cheapest", make: [2963], have: [[2589, 12]] }}
      market={{ realm: "forever-pvp", realmName: "Forever PvP", house: "Horde" }}
      catalog={[{ recipeId: 2963, name: "Bolt", profession: "Tailoring", itemId: 2996, minimum: 1, maximum: 1, reagents: [[2589, 2]], cooldownMs: null }]} />));
    expect(host.textContent).toContain("includes stale prices");
    const button = (label: string) => [...host.querySelectorAll("button")].find(b =>
      (b.querySelector("[data-copy-labels] > span")?.textContent ?? b.textContent)?.trim() === label)!;
    await act(async () => button("Copy recipe shopping list").click());
    expect(copy.mock.calls.at(-1)![0]).toContain("Profit for 2 crafts: 63s 40c (includes stale prices)");
    await act(async () => button("Make allowed").click());
    expect(host.textContent).not.toContain("includes stale prices");
  } finally {
    await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); Reflect.deleteProperty(navigator, "clipboard");
  }
});
