import { expect, test } from "vitest";
import { houseParam, realmSlug, slugParam } from "./auction-house";
import { DEFAULT_SHARE, catalogTree, evaluateCraft, parseCraftShare, realmSlugOf, routeBlock, shareSearch, staleDay, type CatalogRecipe } from "./crafting-profit";

test("strict decimal crafts 1..9999; anything else is 1 and explained", () => {
  for (const [raw, want] of [["1", 1], ["7", 7], ["9999", 9999]] as const) expect(parseCraftShare({ crafts: raw }).state.crafts).toBe(want);
  for (const raw of ["NaN", "Infinity", "-3", "0", "2.5", "10000", "1e309", "3abc", "", "3e2", "0x1F", " 7 ", "1e2", "007", "+5"]) {
    const read = parseCraftShare({ crafts: raw });
    expect(read.state.crafts, raw).toBe(1);
    expect(read.issues.map((i) => i.field), raw).toEqual(["crafts"]);
  }
});

test("a repeated key invalidates that field only, the same way for every key", () => {
  const read = parseCraftShare({ recipe: ["3920", "3930"], crafts: ["2", "5"], realm: ["a", "b"], house: ["alliance", "horde"], dest: ["ah", "ah"], strategy: ["buy", "cheapest"], make: ["1", "2"], have: ["1:1", "2:2"] });
  expect(read.state).toEqual(DEFAULT_SHARE);
  expect(read.issues.map((i) => i.field).sort()).toEqual(["crafts", "dest", "have", "house", "make", "realm", "recipe", "strategy"]);
  // Other fields stand.
  const mixed = parseCraftShare({ recipe: "3920", crafts: ["2", "5"], house: "neutral", realm: "camwow-us1-realm-2-pvp" });
  expect(mixed.state).toMatchObject({ recipe: 3920, crafts: 1, house: "Neutral", realm: "camwow-us1-realm-2-pvp" });
  expect(mixed.issues.map((i) => i.field)).toEqual(["crafts"]);
});

test("make and owned lists are bounded and validated whole; a malformed field is rejected, never partly applied", () => {
  expect(parseCraftShare({ make: "3930,3920" }).state.make).toEqual([3920, 3930]);
  expect(parseCraftShare({ have: "2589:5,2320:0,2592:1000000" }).state.have).toEqual([[2589, 5], [2592, 1_000_000]]);
  for (const have of ["2589:-1", "2589:1.5", "2589:1e999", "2589:NaN", "2589:5x", "2589:1000001", "2589:1,2589:2", "x:1", "2589"]) {
    const read = parseCraftShare({ have: `2320:3,${have}` });
    expect(read.state.have, have).toEqual([]);
    expect(read.issues.map((i) => i.field), have).toEqual(["have"]);
  }
  for (const make of ["3920,3920", "3920,abc", "0", "3920.0", "-1"]) expect(parseCraftShare({ make }).state.make, make).toEqual([]);
  const many = Array.from({ length: 65 }, (_, i) => i + 1).join(",");
  expect(parseCraftShare({ make: many }).issues[0].message).toContain("at most 64");
  const owned = Array.from({ length: 129 }, (_, i) => `${i + 1}:1`).join(",");
  expect(parseCraftShare({ have: owned }).issues[0].message).toContain("more than 128");
  expect(parseCraftShare({ make: Array.from({ length: 64 }, (_, i) => i + 1).join(",") }).state.make).toHaveLength(64);
});

test("recipe, realm, house, destination and route values", () => {
  for (const recipe of ["abc", "0", "3920.0", "99999999999999999999"]) expect(parseCraftShare({ recipe }).state.recipe, recipe).toBeNull();
  expect(parseCraftShare({ recipe: "99999999" }).state.recipe).toBe(99999999);
  expect(parseCraftShare({ house: "elves" }).state.house).toBeNull();
  expect(parseCraftShare({ house: "constructor" }).state.house).toBeNull();
  expect(parseCraftShare({ house: "Alliance" }).state.house).toBeNull();
  expect(parseCraftShare({ dest: "bogus" }).state.destination).toBe("ah");
  expect(parseCraftShare({ dest: "vendor", strategy: "cheapest" }).state).toMatchObject({ destination: "vendor", strategy: "cheapest" });
  expect(parseCraftShare({ strategy: "fastest" }).issues.map((i) => i.field)).toEqual(["strategy"]);
});

test("the restated realm and house readers agree with the market pages'", () => {
  for (const name of ["CAMWOW US1 Realm 2 PvP", "Kel'Thuzad", "Item", "  Spaced  Realm- "]) expect(realmSlugOf(name)).toBe(realmSlug(name));
  for (const raw of ["camwow-us1-realm-2-pvp", "%E2%82%AC", "Bad Slug", "a".repeat(41), "ünïcode"]) {
    expect(parseCraftShare({ realm: raw }).state.realm, raw).toBe(slugParam(raw));
  }
  for (const raw of ["alliance", "horde", "neutral", "Horde", "all", "x"]) expect(parseCraftShare({ house: raw }).state.house, raw).toBe(houseParam(raw) || null);
});

test("share search is canonical, keeps other page parameters and refuses to pass the size limit", () => {
  const current = new URLSearchParams("page=2&q=bolt&crafts=3e2&make=1,1&recipe=1&have=bad");
  const state = { ...DEFAULT_SHARE, recipe: 3920, crafts: 12, realm: "camwow-us1-realm-2-pvp", house: "Horde" as const, destination: "vendor" as const, strategy: "cheapest" as const, make: [3930, 3920], have: [[2589, 4], [2320, 0]] as [number, number][] };
  expect(shareSearch(current, state)).toBe("page=2&q=bolt&recipe=3920&crafts=12&realm=camwow-us1-realm-2-pvp&house=horde&dest=vendor&strategy=cheapest&make=3920%2C3930&have=2589%3A4");
  // Round trip: reading the canonical link gives the same state (zero counts dropped).
  const back = parseCraftShare(Object.fromEntries(new URLSearchParams(shareSearch(new URLSearchParams(), state)!)));
  expect(back.issues).toEqual([]);
  expect(back.state).toEqual({ ...state, make: [3920, 3930], have: [[2589, 4]] });
  // Within the field bounds the state stays well under 8,192 characters; the guard still refuses a larger one.
  const full = { ...DEFAULT_SHARE, have: Array.from({ length: 128 }, (_, i): [number, number] => [9_007_199_254_740_000 + i, 1_000_000]), make: Array.from({ length: 64 }, (_, i) => 9_007_199_254_740_000 + i) };
  expect(shareSearch(new URLSearchParams(), full)!.length).toBeLessThan(8192);
  const huge = { ...full, have: Array.from({ length: 400 }, (_, i): [number, number] => [9_007_199_254_740_000 + i, 1_000_000]) };
  expect(shareSearch(new URLSearchParams(), huge)).toBeNull();
  expect(shareSearch(new URLSearchParams("page=3"), DEFAULT_SHARE)).toBe("page=3");
});

const recipe = (recipeId: number, itemId: number, reagents: [number, number][], minimum: number | null = 1, cooldownMs: number | null = null): CatalogRecipe =>
  ({ recipeId, itemId, minimum, maximum: minimum, reagents: reagents.map(([i, count]) => ({ itemId: i, count })), cooldownMs });

test("the catalog tree follows producers of the root's materials, across professions, within the bounds", () => {
  const byItem = new Map<number, CatalogRecipe[]>([
    [2996, [recipe(2963, 2996, [[2589, 2]])]],
    [2589, []],
    [14342, [recipe(18560, 14342, [[14256, 2]], 1, 342_000_000)]],
    [4365, [recipe(3931, 4365, [[2835, 1]], null)]],
  ]);
  const tree = catalogTree([{ itemId: 2996 }, { itemId: 14342 }, { itemId: 4365 }], byItem);
  expect(tree.recipes.map((r) => r.recipeId)).toEqual([2963, 18560, 3931]);
  expect(tree.items).toEqual([2996, 14342, 4365, 2589, 14256, 2835]);
  expect(tree.truncated).toBe(false);
  expect(tree.recipes.map(routeBlock)).toEqual([null, "cooldown", "output"]);
  // A 14-deep chain stops at the depth bound and says so.
  const chain = new Map(Array.from({ length: 14 }, (_, i): [number, CatalogRecipe[]] => [i + 1, [recipe(1000 + i, i + 1, [[i + 2, 1]])]]));
  const deep = catalogTree([{ itemId: 1 }], chain);
  expect(deep.recipes).toHaveLength(12);
  expect(deep.truncated).toBe(true);
  // The root recipe itself is never its own route.
  expect(catalogTree([{ itemId: 2996 }], byItem, 2963).recipes).toEqual([]);
});

test("stale is a community day more than two days old", () => {
  expect(staleDay("2026-10-27", "2026-10-30")).toBe(true);
  expect(staleDay("2026-10-28", "2026-10-30")).toBe(false);
  expect(staleDay(null, "2026-10-30")).toBe(false);
});

test("a market value with only a minimum, or no product output, leaves profit unavailable with a reason", () => {
  const quotes = new Map([[1, { market: { unit: null, day: "2026-10-30" } }], [2, { market: { unit: 900, day: "2026-10-30" } }]]);
  const est = evaluateCraft({ id: 1, name: "R", product: 2, output: { minimum: 1, maximum: 1 }, reagents: [{ itemId: 1, count: 1 }] }, quotes, { house: "Alliance", today: "2026-10-30" });
  expect([est.cost, est.profit, est.unavailable]).toEqual([null, null, "a material has no price"]);
  const noSale = evaluateCraft({ id: 1, name: "R", product: 3, output: { minimum: 1, maximum: 1 }, reagents: [{ itemId: 2, count: 1 }] }, quotes, { house: "Alliance", today: "2026-10-30" });
  expect([noSale.cost, noSale.profit, noSale.unavailable]).toEqual([900, null, "no market value for the finished item"]);
  const zero = evaluateCraft({ id: 1, name: "R", product: 2, output: { minimum: 0, maximum: 0 }, reagents: [] }, quotes, { house: "Alliance", today: "2026-10-30" });
  expect([zero.yield, zero.profit, zero.unavailable]).toEqual([null, null, "output count unknown"]);
});

test("share search refuses a state its own parser would reject: over 128 owned counts or 64 makes", () => {
  const owned = Array.from({ length: 129 }, (_, i): [number, number] => [i + 1, 1]);
  expect(shareSearch(new URLSearchParams(), { ...DEFAULT_SHARE, have: owned })).toBeNull();
  expect(shareSearch(new URLSearchParams(), { ...DEFAULT_SHARE, have: owned.slice(0, 128) })).not.toBeNull();
  expect(shareSearch(new URLSearchParams(), { ...DEFAULT_SHARE, make: Array.from({ length: 65 }, (_, i) => i + 1) })).toBeNull();
});
test("the card's catalog stops at its byte budget and says it was cut", async () => {
  const { planCardCatalog } = await import("./crafting-catalog");
  const { recipeBySpell } = await import("./professions");
  // Engineering 19830 has the largest catalog tree in build 71139 (21 recipes).
  const recipe = recipeBySpell(19830)!;
  const full = planCardCatalog(recipe, (id) => `Spell ${id}`, (id) => `Item ${id}`);
  expect(full.truncated).toBe(false);
  expect(full.catalog.length).toBeGreaterThan(10);
  const cut = planCardCatalog(recipe, (id) => `Spell ${id}`, (id) => `Item ${id}`, 1500);
  expect(cut.truncated).toBe(true);
  expect(cut.catalog.length).toBeLessThan(full.catalog.length);
  expect(JSON.stringify(cut).length).toBeLessThanOrEqual(1500 + 64);
});