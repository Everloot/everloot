import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import type { AuctionHouse } from "@everloot/protocol";
import { HOUSE_CUT, evaluateCraft, rankCrafts, resolveCraftPlan, unitQuote, type CatalogRecipe, type ItemQuotes } from "./crafting-profit";

// The cases the addon's crafting_contract.py runs through its real Context, Evaluate, PlanSale, Rank and Resolve.
type Market = Record<string, { unit: number | null; min?: number; day: string }>;
type Fixture = {
  today: string;
  cut: Record<AuctionHouse, number>;
  evaluate: {
    name: string; house: AuctionHouse; destination: "ah" | "vendor"; crafts: number;
    recipe: { id: number; name: string; product: number; output: { minimum: number; maximum: number } | null; reagents: { itemId: number; count: number }[] };
    market: Market; vendorUnit?: Record<string, number>; rawVendorOffer?: Record<string, number>; vendorSell?: Record<string, number>;
    expected: { cost: number | null; profit: number | null; margin: number | null; gross: number | null; cut: number | null; batchProfit: number | null; stale: boolean; unpriced: number; sources?: Record<string, "ah" | "vendor"> };
  }[];
  rank: { rows: { id: number; name: string; profit: number | null; cost: number | null }[]; expected: { profit: number[]; name: number[]; profitable: number[] } };
  plans: {
    recipes: Record<string, { itemId: number; minimum: number | null; maximum: number | null; reagents: [number, number][] }>;
    market: Record<string, number>;
    vendorUnit: Record<string, number>;
    cases: {
      name: string; strategy: "buy" | "cheapest"; requests: [number, number][]; allowed: number[]; cooldown?: number[];
      market?: Record<string, number | null>; vendorUnit?: Record<string, number>; rawVendorOffer?: Record<string, number>; owned?: Record<string, number>;
      expected: {
        cost: number | null; cashCost: number | null; buyCost: number | null; steps: [number, number][]; purchases: [number, number][];
        unpriced: [number, number][]; leftovers: Record<string, number>; possibleLeftovers: Record<string, number>; used: Record<string, number>;
        exclusions: [number, number, string][]; complete: boolean;
      };
    }[];
  };
};
const fixture: Fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../addon/tests/fixtures/crafting-parity.json"), "utf8"));

/**
 * The website's quote book for a case. A raw vendor offer is deliberately not passed anywhere: the website has no
 * field for it, which is the point of the regression cases that carry one.
 */
function book(market: Market, vendorUnit: Record<string, number> = {}, vendorSell: Record<string, number> = {}) {
  const ids = new Set([...Object.keys(market), ...Object.keys(vendorUnit), ...Object.keys(vendorSell)].map(Number));
  return new Map([...ids].map((id): [number, ItemQuotes] => [id, {
    market: market[id] ? { unit: market[id].unit, day: market[id].day } : null,
    vendorUnit: vendorUnit[id] ?? null,
    vendorSell: vendorSell[id] ?? null,
  }]));
}

test("the cut per house is the addon's", () => {
  expect(HOUSE_CUT).toEqual(fixture.cut);
});

test.each(fixture.evaluate.map((c) => [c.name, c] as const))("valuation: %s", (_, c) => {
  const est = evaluateCraft({ ...c.recipe, output: c.recipe.output }, book(c.market, c.vendorUnit, c.vendorSell),
    { house: c.house, destination: c.destination, crafts: c.crafts, today: fixture.today });
  const x = c.expected;
  expect({ cost: est.cost, profit: est.profit, gross: est.gross, cut: est.cut, batchProfit: est.batchProfit, stale: est.stale, unpriced: est.unpriced })
    .toEqual({ cost: x.cost, profit: x.profit, gross: x.gross, cut: x.cut, batchProfit: x.batchProfit, stale: x.stale, unpriced: x.unpriced });
  if (x.margin === null) expect(est.margin).toBeNull(); else expect(est.margin).toBeCloseTo(x.margin, 9);
  for (const [id, source] of Object.entries(x.sources ?? {})) expect(est.parts.find((p) => p.itemId === Number(id))?.source).toBe(source);
  // Unknown output never becomes one item; vendor sale never comes from a purchase offer or a market value.
  if (c.recipe.output === null) expect(est.unavailable).toBe("output count unknown");
  if (c.destination === "vendor" && !c.vendorSell) expect(est.unavailable).toBe("no verified vendor sell price");
});

test("ranking: profit, name and profitable-only orders, ties by name in code-unit order, then recipe ID", () => {
  const ids = (rows: { id: number }[]) => rows.map((r) => r.id);
  const rows = fixture.rank.rows.map((r) => ({ ...r, key: `k${r.id}` }));
  expect(ids(rankCrafts(rows, { sort: "profit" }))).toEqual(fixture.rank.expected.profit);
  expect(ids(rankCrafts(rows, { sort: "name" }))).toEqual(fixture.rank.expected.name);
  expect(ids(rankCrafts(rows, { sort: "profit", profitableOnly: true }))).toEqual(fixture.rank.expected.profitable);
  expect(rows.map((r) => r.id)).toEqual(fixture.rank.rows.map((r) => r.id));
});

const P = fixture.plans;
test.each(P.cases.map((c) => [c.name, c] as const))("plan: %s", (_, c) => {
  const market: Market = {};
  for (const [id, unit] of Object.entries({ ...P.market, ...(c.market ?? {}) })) if (unit !== null) market[id] = { unit, day: fixture.today };
  const quotes = book(market, c.vendorUnit ?? P.vendorUnit);
  const catalog = new Map(Object.entries(P.recipes).map(([id, r]): [number, CatalogRecipe] => [Number(id), {
    recipeId: Number(id), itemId: r.itemId, minimum: r.minimum, maximum: r.maximum, reagents: r.reagents.map(([itemId, count]) => ({ itemId, count })),
    cooldownMs: c.cooldown?.includes(Number(id)) ? 1 : null,
  }]));
  const requests = c.requests.map(([recipeId, crafts]) => {
    const r = catalog.get(recipeId)!;
    return { recipeId, crafts, recipe: { itemId: r.itemId, minimum: r.minimum, maximum: r.maximum, reagents: r.reagents } };
  });
  const owned = new Map(Object.entries(c.owned ?? {}).map(([id, n]) => [Number(id), n]));
  const plan = resolveCraftPlan(requests, { quote: (id) => unitQuote(quotes.get(id)) }, catalog, c.allowed, owned, { strategy: c.strategy });
  const x = c.expected;
  const keyed = (m: Record<string, number>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [Number(k), v]));
  expect({
    cost: plan.cost, cashCost: plan.cashCost, buyCost: plan.buyCost, complete: plan.complete,
    steps: plan.steps.map((s) => [s.recipeId, s.crafts]), purchases: plan.purchases.map((p) => [p.itemId, p.count]),
    unpriced: plan.unpriced.map((u) => [u.itemId, u.count]), leftovers: plan.leftovers, possibleLeftovers: plan.possibleLeftovers, used: plan.used,
    exclusions: plan.exclusions.map((e) => [e.recipeId, e.itemId, e.reason]),
  }).toEqual({
    cost: x.cost, cashCost: x.cashCost, buyCost: x.buyCost, complete: x.complete, steps: x.steps, purchases: x.purchases, unpriced: x.unpriced,
    leftovers: keyed(x.leftovers), possibleLeftovers: keyed(x.possibleLeftovers), used: keyed(x.used), exclusions: x.exclusions,
  });
});
