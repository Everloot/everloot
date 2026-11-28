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

// Task 13: a selected recipe's plan. Bag (3755) takes 3 bolts and 3 thread and makes one Bag (4245). The catalog has
// Bolt of Linen Cloth (2963: 2 linen 2589 -> 1 bolt 2996), a cooldown thread recipe from another profession and one
// whose output count the files do not give.
const bag = {
  profession: "Tailoring", slug: "tailoring", spellId: 3755, name: "Linen Bag", itemName: "Linen Bag",
  yellow: 30, grey: 65, recipeItems: [], output: { itemId: 4245, minimum: 1, maximum: 1 },
  reagents: [{ itemId: 2996, name: "Bolt of Linen Cloth", count: 3 }, { itemId: 2320, name: "Coarse Thread", count: 3 }],
};
const catalog = [
  { recipeId: 2963, name: "Bolt of Linen Cloth", profession: "Tailoring", itemId: 2996, minimum: 1, maximum: 1, reagents: [[2589, 2]] as [number, number][], cooldownMs: null },
  { recipeId: 9101, name: "Thread Ritual", profession: "Enchanting", itemId: 2320, minimum: 1, maximum: 1, reagents: [[2589, 1]] as [number, number][], cooldownMs: 600000 },
  { recipeId: 9102, name: "Random Thread", profession: "Engineering", itemId: 2320, minimum: null, maximum: null, reagents: [[2589, 1]] as [number, number][], cooldownMs: null },
];
const share = (over: Partial<import("@/lib/crafting-profit").CraftShareState> = {}) =>
  ({ recipe: 3755, crafts: 2, realm: "forever-pvp", house: "Horde" as const, destination: "ah" as const, strategy: "cheapest" as const, make: [2963], have: [], ...over });
const forever = { realm: "forever-pvp", realmName: "Forever PvP", house: "Horde" as const };
const row = (id: number, market: number | null, day = "2026-11-27", age = 1) => [id, market, 1, 1, 30, day, 3, null, age, null];

async function mount(props: Partial<Parameters<typeof RecipeShopping>[0]>, respond: (url: string) => Promise<unknown>) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fetcher = vi.fn(async (url: string) => ({ ok: true, json: () => respond(url) }));
  vi.stubGlobal("fetch", fetcher);
  const copy = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText: copy }, configurable: true });
  window.history.replaceState(null, "", "/tools/professions/tailoring?page=2&recipe=3755");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<RecipeShopping recipe={bag} initial={share()} issues={[]} market={forever} catalog={catalog}
    itemNames={{ 2589: "Linen Cloth" }} vendorOffers={[]} training={null} rankingShown={false} {...props} />));
  await act(async () => { await Promise.resolve(); });
  const button = (text: string) => [...host.querySelectorAll("button")].find(b => (b.querySelector("[data-copy-labels] > span")?.textContent ?? b.textContent)?.trim() === text)!;
  const type = async (input: HTMLInputElement, value: string) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const done = async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); Reflect.deleteProperty(navigator, "clipboard"); };
  return { host, fetcher, copy, button, type, done };
}

test("a linked recipe requests only its validated matching realm and house before showing prices", async () => {
  const ui = await mount({ initial: share({ make: [] }) }, async () =>
    ({ ok: true, items: [row(2320, 10), row(2996, 10), row(4245, 4000)] }));
  try {
    expect(ui.fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/market/prices?realm=Forever+PvP&house=Horde&items=2320%2C2996%2C4245&fields=full",
    ]);
    expect(ui.host.textContent).toContain("Forever PvP, Horde auction house");
    expect(ui.host.textContent).toContain("Material value: 1s 20c");
  } finally { await ui.done(); }
});

test("a selected plan prices the plan's items once, follows allowed catalog makes and typed stock, and shares its state", async () => {
  const ui = await mount({ initial: share({ make: [2963, 424242], have: [[2996, 1], [777777, 5]] }) }, async () =>
    ({ ok: true, items: [row(2320, 10), row(2589, 100), row(2996, 500), row(4245, 4000)] }));
  try {
    // One request for every item the plan can need: the materials, the product and the allowed make's inputs.
    expect(ui.fetcher).toHaveBeenCalledTimes(1);
    expect(ui.fetcher.mock.calls[0][0]).toBe("/api/market/prices?realm=Forever+PvP&house=Horde&items=2320%2C2589%2C2996%2C4245&fields=full");
    const text = () => ui.host.textContent ?? "";
    // Link values that are not in this plan are dropped and said.
    expect(text()).toContain("Recipe 424242 is not a catalog recipe for this plan's materials");
    expect(text()).toContain("Item 777777 is not in this plan");
    // Per craft at the Horde house (5% cut): 4,000 sale, 3,800 after the cut, less 1,530 materials bought.
    expect(text()).toContain("Everloot estimate");
    // The headline follows the selected route and count (I3): two crafts sell 8,000, keep 7,600 after the 5% cut, less
    // the route's 1,260 of materials: 6,340, an average 3,170 a craft and a 503% margin. Buying everything for one craft
    // (3,800 less 1,530) is the secondary, labelled baseline.
    expect(text()).toContain("Average per craft: 31s 70c (503% margin)");
    expect(text()).toContain("Buy-all, one craft: 22s 70c (148% margin)");
    expect(text()).not.toContain("Profit per craft");
    expect(text()).toContain("Forever PvP, Horde auction house");
    // Two crafts, cheapest allowed: 6 bolts made from 12 linen (1,200) and 6 thread (60); one owned bolt saves a craft.
    expect(text()).toContain("Material value: 12s 60c");
    expect(text()).toContain("To buy after your counts: 10s 60c");
    expect(text()).toContain("Profit for 2 crafts: 63s 40c");
    const steps = [...ui.host.querySelectorAll("[data-plan-steps] li")].map(li => li.textContent);
    expect(steps[0]).toContain("5 × Bolt of Linen Cloth");
    expect(steps[0]).toContain("Tailoring");
    expect(steps[1]).toContain("2 × Linen Bag");
    expect(text()).toContain("not checked against any character");
    const buy = [...ui.host.querySelectorAll("[data-plan-buy] li")].map(li => li.textContent).join("|");
    expect(buy).toContain("10 × Linen Cloth");
    expect(buy).toContain("6 × Coarse Thread");
    expect(buy).not.toContain("Bolt of Linen Cloth");
    // Make choices: allowed, refused with a visible reason, or unavailable output.
    const allow = (name: string) => [...ui.host.querySelectorAll("[data-make] button")].find(b => b.closest("li")?.textContent?.includes(name)) as HTMLButtonElement;
    expect(allow("Bolt of Linen Cloth").getAttribute("aria-pressed")).toBe("true");
    expect(allow("Thread Ritual").getAttribute("aria-disabled")).toBe("true");
    expect(allow("Thread Ritual").closest("li")!.textContent).toContain("cooldown");
    expect(allow("Random Thread").closest("li")!.textContent).toContain("output count unknown");
    // Copy: the plan and a canonical link without the dropped values, the list's other parameters kept.
    await act(async () => ui.button("Copy recipe shopping list").click());
    const copied = ui.copy.mock.calls.at(-1)![0] as string;
    for (const part of ["Linen Bag", "2 crafts", "Forever PvP, Horde", "Sell: auction house", "Route: cheapest allowed", "Profit for 2 crafts: 63s 40c", "Average per craft: 31s 70c (503% margin)", "Buy-all, one craft: 22s 70c", "1. Craft 5 × Bolt of Linen Cloth", "not checked against any character", "10 × Linen Cloth", "Leftovers: none"]) expect(copied).toContain(part);
    expect(copied).not.toMatch(/learned|you know/i);
    await act(async () => ui.button("Copy link").click());
    expect(ui.copy.mock.calls.at(-1)![0]).toBe("http://localhost:3000/tools/professions/tailoring?page=2&recipe=3755&crafts=2&realm=forever-pvp&house=horde&strategy=cheapest&make=2963&have=2996%3A1#recipe-shopping");
    // Typing a count for linen buys none; turning the bolt make off buys bolts again. The address follows each edit.
    const have = ui.host.querySelector<HTMLInputElement>('input[aria-label="Have Linen Cloth"]')!;
    await ui.type(have, "10");
    expect(window.location.search).toContain("have=2589%3A10%2C2996%3A1");
    expect([...ui.host.querySelectorAll("[data-plan-buy] li")].map(li => li.textContent).join("|")).not.toContain("Linen Cloth");
    // A bad typed count is refused and explained; the last valid link stays.
    await ui.type(have, "1.5");
    expect(text()).toContain("whole number from 0 to 1,000,000");
    expect(window.location.search).toContain("have=2589%3A10");
    await ui.type(have, "10");
    await act(async () => allow("Bolt of Linen Cloth").click());
    expect(allow("Bolt of Linen Cloth").getAttribute("aria-pressed")).toBe("false");
    expect(window.location.search).not.toContain("make=");
    // Turning the make off changes what the plan can need: one new bounded request for that set, without linen (M1).
    expect(ui.fetcher).toHaveBeenCalledTimes(2);
    expect(ui.fetcher.mock.calls[1][0]).toBe("/api/market/prices?realm=Forever+PvP&house=Horde&items=2320%2C2996%2C4245&fields=full");
    expect([...ui.host.querySelectorAll("[data-plan-buy] li")].map(li => li.textContent).join("|")).toContain("5 × Bolt of Linen Cloth");
  } finally { await ui.done(); }
});

test("vendor sale and unknown output stay unavailable, a community vendor offer is never a unit price, payback needs a complete profit", async () => {
  const ui = await mount({ initial: share({ destination: "vendor", make: [] }), vendorOffers: [2320], training: 5000 }, async () =>
    ({ ok: true, items: [row(2996, 500), row(4245, 4000)] }));
  try {
    const text = () => ui.host.textContent ?? "";
    expect(text()).toContain("Profit unavailable: no verified vendor sell price");
    expect(text()).toContain("Vendor offer seen, not a unit price");
    expect(text()).toContain("Training payback unavailable");
    const thread = [...ui.host.querySelectorAll("[data-plan-buy] li")].find(li => li.textContent?.includes("Coarse Thread"))!;
    expect(thread.textContent).toContain("No quote");
  } finally { await ui.done(); }
  const unknown = await mount({ recipe: { ...bag, output: { itemId: 4245, minimum: null, maximum: null } }, initial: share({ make: [] }), training: 5000 }, async () =>
    ({ ok: true, items: [row(2320, 10), row(2996, 500), row(4245, 4000)] }));
  try {
    const text = unknown.host.textContent ?? "";
    expect(text).toContain("Profit unavailable: output count unknown");
    // The materials stay useful: the cost of the requested crafts is still shown.
    expect(text).toContain("Material value: 30s 60c");
    expect(text).not.toContain("Average per craft");
    expect(text).not.toContain("Buy-all, one craft:");
  } finally { await unknown.done(); }
  const paid = await mount({ initial: share({ make: [] }), training: 5000 }, async () =>
    ({ ok: true, items: [row(2320, 10), row(2996, 500), row(4245, 4000)] }));
  try {
    // 5,000 training over the buy-all one-craft profit of 2,270 (the addon's trainer basis): three crafts.
    expect(paid.host.textContent).toContain("pays back after 3 crafts");
  } finally { await paid.done(); }
});

test("a late reply for an earlier realm and house never prices the new selection", async () => {
  let release: ((v: unknown) => void) | undefined;
  const ui = await mount({}, (url) => {
    if (url === "/api/market/prices") return Promise.resolve({ houses: { "Forever PvP": ["Horde", "Alliance"], "Other Realm": ["Alliance"] } });
    if (url.includes("realm=Forever+PvP")) return new Promise(r => { release = r; });
    return Promise.resolve({ ok: true, items: [row(2996, 700, "2026-11-28", 0), row(2320, 12, "2026-11-28", 0), row(4245, 5000, "2026-11-28", 0)] });
  });
  try {
    expect(ui.host.textContent).toContain("Loading prices");
    await act(async () => ui.button("Change realm or house").click());
    const choose = async (label: string, value: string) => {
      const input = ui.host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
      await act(async () => { input.value = value; input.dispatchEvent(new Event("change", { bubbles: true })); });
    };
    await choose("Realm", "Other Realm");
    await choose("Auction house", "Alliance");
    expect(window.location.search).toContain("realm=other-realm&house=alliance");
    await act(async () => release!({ ok: true, items: [row(2996, 1, "2026-11-01", 27)] }));
    const text = ui.host.textContent ?? "";
    expect(text).toContain("Other Realm, Alliance auction house");
    expect(text).not.toContain("2026-11-01");
    expect(text).toContain("2026-11-28");
    // The whole-profession ranking is the server's: a link reloads the page for the new market.
    expect(ui.host.querySelector('a[href*="#profit-ranking"]')?.getAttribute("href")).toContain("realm=other-realm&house=alliance");
  } finally { await ui.done(); }
});

test("share-link problems from the server are explained beside the plan", async () => {
  const ui = await mount({ issues: ["The owned counts in the link were ignored: an item is listed twice."], market: null, initial: share({ realm: null, house: null }) }, async () => ({}));
  try {
    expect(ui.host.textContent).toContain("The owned counts in the link were ignored: an item is listed twice.");
    expect(ui.fetcher).not.toHaveBeenCalled();
  } finally { await ui.done(); }
});

test("prices materials at market value, and a missing market value stays unpriced even with a minimum", async () => {
  const recipe = {
    profession: "Tailoring", slug: "tailoring", spellId: 3755, name: "Linen Bag", itemName: "Linen Bag",
    yellow: 30, grey: 65, recipeItems: [],
    reagents: [{ itemId: 2996, name: "Bolt of Linen Cloth", count: 3 }, { itemId: 2320, name: "Coarse Thread", count: 3 }],
  };
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // Bolt: market 5s, lowest listing 3s. Thread: no market value, only a 50c minimum.
  const fetcher = vi.fn(async (url: string) => ({
    ok: true,
    json: async () => url.includes("house=Horde")
      ? { ok: true, items: [[2996, 500, 300, 450, 30, "2026-11-27", 3, null, 0, null], [2320, null, 50, 60, 2, "2026-11-27", 1, null, 0, null]] }
      : { houses: { "Forever PvP": ["Horde"] } },
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
  const line = (name: string) => [...host.querySelectorAll("li")].find(li => li.textContent?.includes(name))!.textContent;
  try {
    await act(async () => root.render(<RecipeShopping recipe={recipe} initialCrafts={2} />));
    await act(async () => button("Load auction prices").click());
    await choose("Realm", "Forever PvP");
    await choose("Auction house", "Horde");
    expect(line("Bolt of Linen Cloth")).toContain("30s 0c · 5s 0c each · 2026-11-27");
    expect(line("Coarse Thread")).toContain("No quote");
    expect(line("Coarse Thread")).not.toContain("50c");
    expect(host.textContent).toContain("Known subtotal: 30s 0c");
    expect(host.textContent).toContain("Batch total incomplete");
    expect(host.textContent).not.toContain("Estimated material total");
    await act(async () => button("Copy recipe shopping list").click());
    expect(copy).toHaveBeenLastCalledWith(expect.stringContaining("6 × Bolt of Linen Cloth — 30s 0c (2026-11-27)"));
    expect(copy).toHaveBeenLastCalledWith(expect.stringContaining("6 × Coarse Thread — no quote"));
    expect(copy).toHaveBeenLastCalledWith(expect.stringContaining("Known subtotal (incomplete): 30s 0c"));
    // Changing the craft count rescales on the same market basis.
    const crafts = host.querySelector<HTMLInputElement>('input[type="number"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(crafts, "3");
      crafts.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(line("Bolt of Linen Cloth")).toContain("45s 0c · 5s 0c each");
    expect(line("Coarse Thread")).toContain("9 × Coarse Thread");
    expect(line("Coarse Thread")).toContain("No quote");
    expect(host.textContent).toContain("Known subtotal: 45s 0c");
    expect(host.querySelector('a[href="/database/items/2320"]')?.textContent).toBe("Coarse Thread");
  } finally {
    await act(async () => root.unmount());
    if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
    else Reflect.deleteProperty(navigator, "clipboard");
    vi.unstubAllGlobals();
  }
});

test("the controller's QA plan: the headline is the selected route's batch, its per-craft figure an average, buy-all secondary", async () => {
  // Linen Bag, 2 crafts, make 2963, one owned bolt, Horde: cloth 100, bolt 1,000, thread 50, bag 12,000.
  const ui = await mount({ initial: share({ make: [2963], have: [[2996, 1]] }) }, async () =>
    ({ ok: true, items: [row(2320, 50), row(2589, 100), row(2996, 1000), row(4245, 12000)] }));
  try {
    const text = ui.host.textContent ?? "";
    expect(text).toContain("Material value: 15s 0c");
    expect(text).toContain("To buy after your counts: 13s 0c");
    // 24,000 sale, 1,200 cut, 22,800 net, less 1,500: 21,300 for the two crafts.
    expect(text).toContain("Profit for 2 crafts: 2g 13s 0c (sale 2g 40s 0c, cut 12s 0c)");
    expect(text).toContain("Average per craft: 1g 6s 50c (1420% margin)");
    expect(text).toContain("Buy-all, one craft: 82s 50c (262% margin)");
    const estimate = ui.host.querySelector("[data-estimate]")!.textContent!;
    expect(estimate.indexOf("Profit for 2 crafts")).toBeLessThan(estimate.indexOf("Buy-all, one craft"));
  } finally { await ui.done(); }
});

test("the price request puts the root and the allowed makes' inputs first, skips catalog candidates nobody allowed, and names items over the cap", async () => {
  const noise = Array.from({ length: 120 }, (_, i) => ({ recipeId: 20000 + i, name: `Noise ${i}`, profession: "Engineering", itemId: 2996,
    minimum: 1, maximum: 1, reagents: [[30000 + i, 1]] as [number, number][], cooldownMs: null }));
  const thread = { recipeId: 9201, name: "Spin Thread", profession: "Tailoring", itemId: 2320, minimum: 1, maximum: 1, reagents: [[6001, 2]] as [number, number][], cooldownMs: null };
  const ui = await mount({ catalog: [...noise, ...catalog, thread], initial: share({ make: [2963], have: [] }) }, async () =>
    ({ ok: true, items: [row(2320, 10), row(2589, 100), row(2996, 500), row(4245, 4000)] }));
  try {
    expect(ui.fetcher.mock.calls[0][0]).toBe("/api/market/prices?realm=Forever+PvP&house=Horde&items=2320%2C2589%2C2996%2C4245&fields=full");
    const allow = [...ui.host.querySelectorAll("[data-make] button")].find(b => b.closest("li")?.textContent?.includes("Spin Thread")) as HTMLButtonElement;
    await act(async () => allow.click());
    expect(ui.fetcher).toHaveBeenCalledTimes(2);
    expect(ui.fetcher.mock.calls[1][0]).toContain("items=2320%2C2589%2C2996%2C4245%2C6001&");
  } finally { await ui.done(); }
  // 101 materials: the last one listed is past the 100-item request, and has the lowest ID, so the plan (which lists
  // up to 50 purchases in ID order) shows it.
  const wide = { ...bag, reagents: [...Array.from({ length: 100 }, (_, i) => ({ itemId: 7000 + i, name: `Part ${i}`, count: 1 })), { itemId: 6999, name: "Part 100", count: 1 }], output: undefined };
  const capped = await mount({ recipe: wide, catalog: [], initial: share({ make: [] }) }, async (url) =>
    ({ ok: true, items: new URLSearchParams(url.split("?")[1]).get("items")!.split(",").map((id) => row(Number(id), 5)) }));
  try {
    const items = new URLSearchParams(String(capped.fetcher.mock.calls[0][0]).split("?")[1]).get("items")!.split(",");
    expect(items).toHaveLength(100);
    const over = [...capped.host.querySelectorAll("[data-plan-buy] li")].find(li => li.textContent?.includes("Part 100"))!;
    expect(over.textContent).toContain("Not priced: over the 100-item price request");
    expect(over.textContent).not.toContain("No quote");
  } finally { await capped.done(); }
});

test("a valid realm without a house survives edits and the link, and nothing is fetched until a house is chosen", async () => {
  const ui = await mount({ market: { realm: "forever-pvp", realmName: "Forever PvP", house: null }, initial: share({ house: null }) }, async () => ({}));
  try {
    expect(ui.fetcher).not.toHaveBeenCalled();
    expect(ui.host.textContent).toContain("Forever PvP: pick an auction house");
    await ui.type(ui.host.querySelector<HTMLInputElement>('input[type="number"]')!, "3");
    expect(window.location.search).toContain("crafts=3&realm=forever-pvp");
    expect(window.location.search).not.toContain("house=");
    expect(ui.fetcher).not.toHaveBeenCalled();
  } finally { await ui.done(); }
});

test("owned counts stay within 128: an extra one is refused and said, existing ones stay editable and removable", async () => {
  const parts = Array.from({ length: 127 }, (_, i) => 8000 + i);
  const wideCatalog = [...catalog, { recipeId: 9301, name: "Bolt From Scraps", profession: "Tailoring", itemId: 2996, minimum: null, maximum: null,
    reagents: parts.map((id): [number, number] => [id, 1]), cooldownMs: null }];
  const have: [number, number][] = [[2996, 1], ...parts.map((id): [number, number] => [id, 1])];
  const ui = await mount({ catalog: wideCatalog, initial: share({ make: [], have }) }, async () => ({ ok: true, items: [row(2320, 10), row(2996, 500), row(4245, 4000)] }));
  try {
    const input = (name: string) => ui.host.querySelector<HTMLInputElement>(`input[aria-label="Have ${name}"]`)!;
    await ui.type(input("Coarse Thread"), "5");
    expect(ui.host.textContent).toContain("At most 128 owned counts fit in a plan");
    expect(window.location.search).not.toContain("2320%3A");
    await ui.type(input("Bolt of Linen Cloth"), "0");
    expect(window.location.search).not.toContain("2996%3A");
    await ui.type(input("Coarse Thread"), "5");
    expect(window.location.search).toContain("2320%3A5");
    expect(ui.host.textContent).not.toContain("At most 128 owned counts fit in a plan");
  } finally { await ui.done(); }
});

test("a recorded cooldown on the selected recipe is shown as a hypothetical limit, with the materials still planned", async () => {
  const ui = await mount({ rootCooldownMs: 342_000_000, initial: share({ make: [] }) }, async () => ({ ok: true, items: [row(2320, 10), row(2996, 500), row(4245, 4000)] }));
  try {
    const text = ui.host.textContent ?? "";
    expect(text).toContain("The game files record a 3 d 23 h cooldown for this recipe");
    expect(text).toContain("not checked against any character");
    expect(text).toContain("6 × Bolt of Linen Cloth");
    expect(text).not.toMatch(/ready|you know|learned/i);
  } finally { await ui.done(); }
});
test("a cut catalog is said on the card", async () => {
  const ui = await mount({ catalogTruncated: true, market: null, initial: share({ realm: null, house: null }) }, async () => ({}));
  try {
    expect(ui.host.textContent).toContain("Only part of the catalog is listed");
  } finally { await ui.done(); }
});
