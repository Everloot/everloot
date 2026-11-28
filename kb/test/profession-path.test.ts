import { expect, test } from "vitest";
import {
  agreeVendorPrices,
  agreeVendorPricesById,
  handleProfessionPath,
  mergeVendorPrices,
  professionFactsFromRecords,
  professionPath,
  type PriceSighting,
  type RecipeSighting,
} from "../src/profession-path.js";

const sight = (installId: string, recipe: string, reagents: RecipeSighting["reagents"], extra: Partial<RecipeSighting> = {}): RecipeSighting => ({
  installId,
  profession: "Alchemy",
  recipe,
  skillMin: 1,
  skillMax: 10,
  points: 1,
  reagents,
  ...extra,
});

const price = (installId: string, copper: number, item = "Peacebloom"): PriceSighting => ({ installId, item, copper });

test("a recipe stays off the path until 3 installs agree, and one install cannot agree with itself", () => {
  const reagents = [{ item: "Peacebloom", count: 1 }];
  const two = professionPath([sight("a", "Minor Healing Potion", reagents), sight("a", "Minor Healing Potion", reagents), sight("b", "Minor Healing Potion", reagents)], [], {
    profession: "Alchemy",
    fromSkill: 1,
    toSkill: 10,
  });
  expect(two.steps).toHaveLength(0);
  const three = professionPath(
    [sight("a", "Minor Healing Potion", reagents), sight("b", "Minor Healing Potion", reagents), sight("c", "Minor Healing Potion", reagents)],
    [],
    { profession: "alchemy", fromSkill: 1, toSkill: 10 },
  );
  expect(three.steps).toMatchObject([{ recipe: "Minor Healing Potion", fromSkill: 1, toSkill: 10, crafts: 9, reporters: 3, copper: null }]);
});

test("the path prefers more skill per reagent and leaves a gap instead of inventing a step", () => {
  const lean = [{ item: "Peacebloom", count: 1 }];
  const heavy = [{ item: "Peacebloom", count: 5 }, { item: "Silverleaf", count: 5 }];
  const rows = ["a", "b", "c"].flatMap((installId) => [
    sight(installId, "Heavy", heavy),
    sight(installId, "Lean", lean),
    sight(installId, "Later", lean, { skillMin: 15, skillMax: 20 }),
  ]);
  const path = professionPath(rows, [], { profession: "Alchemy", fromSkill: 1, toSkill: 20 });
  expect(path.steps.map((step) => step.recipe)).toEqual(["Lean", "Later"]);
  expect(path.gaps).toEqual([{ fromSkill: 10, toSkill: 15 }]);
  expect(path.reagents).toEqual([{ item: "Peacebloom", count: 14 }]);
  expect(path.copper).toBeNull();
});

test("gold is the median of 3 prices, and a missing reagent price keeps the total unpublished", () => {
  const reagents = [{ item: "Peacebloom", count: 2 }];
  const rows = ["a", "b", "c"].map((installId) => sight(installId, "Minor Healing Potion", reagents, { skillMax: 2 }));
  const priced = professionPath(rows, [price("a", 100), price("b", 300), price("c", 500)], { profession: "Alchemy", fromSkill: 1, toSkill: 2 });
  expect(priced.steps[0]?.copper).toBe(600);
  expect(priced.copper).toBe(600);
  const withVial = ["a", "b", "c"].map((installId) =>
    sight(installId, "Minor Healing Potion", [{ item: "Peacebloom", count: 1 }, { item: "Empty Vial", count: 1 }], { skillMax: 2 }),
  );
  const missing = professionPath(withVial, [price("a", 100), price("b", 300), price("c", 500), price("a", 10, "Empty Vial"), price("b", 10, "Empty Vial")], {
    profession: "Alchemy",
    fromSkill: 1,
    toSkill: 2,
  });
  expect(missing.steps[0]?.copper).toBeNull();
  expect(missing.copper).toBeNull();
  const text = handleProfessionPath({ profession: "Alchemy", fromSkill: 1, toSkill: 2 }, rows, [price("a", 100), price("b", 300), price("c", 500)]);
  expect(text).toContain("6s 0c");
  expect(text).toContain("3 distinct install reports");
  expect(text).toContain("unscoped observed prices");
  expect(text).toContain("not a guaranteed current realm minimum");
  expect(text).toContain("Estimated gold: 6s 0c");
});

test("a blank profession or a backwards range is refused", () => {
  expect(handleProfessionPath({ profession: "  " })).toBe("Name a profession.");
  expect(handleProfessionPath({ profession: "Alchemy", fromSkill: 10, toSkill: 10 })).toContain("target skill");
});

test("recipe_seen and price_seen records become path facts", () => {
  const facts = professionFactsFromRecords([
    {
      kind: "recipe_seen",
      installId: "a",
      profession: "Alchemy",
      recipe: "Minor Healing Potion",
      skillMin: 1,
      skillMax: 10,
      points: 1,
      reagents: [{ item: "Peacebloom", count: 1 }],
    },
    { kind: "price_seen", installId: "a", item: "Peacebloom", copper: 100 },
    { kind: "loot", installId: "a" },
  ]);
  expect(facts.sightings).toHaveLength(1);
  expect(facts.prices).toEqual([{ installId: "a", item: "Peacebloom", copper: 100 }]);
});

test("a gold total never hides a gap: it covers the agreed steps and names the gap", () => {
  const reagents = [{ item: "Peacebloom", count: 1 }];
  const recipe = (installId: string) => sight(installId, "Minor Healing Potion", reagents, { skillMin: 1, skillMax: 10 });
  const text = handleProfessionPath(
    { profession: "Alchemy", fromSkill: 1, toSkill: 20 },
    [recipe("a"), recipe("b"), recipe("c")],
    [price("a", 10), price("b", 10), price("c", 10)],
  );
  expect(text).toContain("Gap 10–20");
  expect(text).toContain("Estimated gold for agreed steps:");
  expect(text).toContain("Gold for 10–20 unrecorded");
  expect(text).not.toMatch(/^Gold: /m);
});

test("priced paths compare craft copper rather than reagent counts", () => {
  const rows = ["a", "b", "c"].flatMap((installId) => [
    sight(installId, "Rare", [{ item: "Rare Herb", count: 1 }]),
    sight(installId, "Common", [{ item: "Common Herb", count: 2 }]),
  ]);
  const prices = ["a", "b", "c"].flatMap((installId) => [
    price(installId, 100000, "Rare Herb"),
    price(installId, 100, "Common Herb"),
  ]);
  const path = professionPath(rows, prices, { profession: "Alchemy", fromSkill: 1, toSkill: 10 });
  expect(path.steps).toMatchObject([{ recipe: "Common", crafts: 9, copper: 1800 }]);
  expect(path.reagents).toEqual([{ item: "Common Herb", count: 18 }]);
  expect(path.copper).toBe(1800);
});

test("the path looks ahead to recipes unlocked before the current recipe stops giving points", () => {
  const rows = ["a", "b", "c"].flatMap((installId) => [
    sight(installId, "Early", [{ item: "Early Herb", count: 1 }]),
    sight(installId, "Later", [{ item: "Later Herb", count: 1 }], { skillMin: 3 }),
  ]);
  const prices = ["a", "b", "c"].flatMap((installId) => [
    price(installId, 100, "Early Herb"),
    price(installId, 1, "Later Herb"),
  ]);
  const path = professionPath(rows, prices, { profession: "Alchemy", fromSkill: 1, toSkill: 5 });
  expect(path.steps).toMatchObject([
    { recipe: "Early", fromSkill: 1, toSkill: 3, crafts: 2, copper: 200 },
    { recipe: "Later", fromSkill: 3, toSkill: 5, crafts: 2, copper: 2 },
  ]);
  expect(path.copper).toBe(202);
});

test("craft-sized transitions account for overshoot and later costs", () => {
  const rows = ["a", "b", "c"].flatMap((installId) => [
    sight(installId, "Cheap now", [{ item: "Cheap Herb", count: 1 }], { skillMax: 2 }),
    sight(installId, "Jump", [{ item: "Jump Herb", count: 1 }], { skillMax: 2, points: 2 }),
    sight(installId, "Expensive later", [{ item: "Later Herb", count: 1 }], { skillMin: 2 }),
  ]);
  const prices = ["a", "b", "c"].flatMap((installId) => [
    price(installId, 1, "Cheap Herb"),
    price(installId, 5, "Jump Herb"),
    price(installId, 100, "Later Herb"),
  ]);
  const path = professionPath(rows, prices, { profession: "Alchemy", fromSkill: 1, toSkill: 4 });
  expect(path.steps).toMatchObject([
    { recipe: "Jump", fromSkill: 1, toSkill: 3, crafts: 1, copper: 5 },
    { recipe: "Expensive later", fromSkill: 3, toSkill: 4, crafts: 1, copper: 100 },
  ]);
  expect(path.copper).toBe(105);
});

test("an unpriced alternative is not treated as free, while required unpriced steps stay unknown", () => {
  const rows = ["a", "b", "c"].flatMap((installId) => [
    sight(installId, "Unknown", [{ item: "Unknown Herb", count: 1 }]),
    sight(installId, "Priced", [{ item: "Peacebloom", count: 2 }]),
  ]);
  const prices = [price("a", 100), price("b", 100), price("c", 100)];
  const path = professionPath(rows, prices, { profession: "Alchemy", fromSkill: 1, toSkill: 3 });
  expect(path.steps).toMatchObject([{ recipe: "Priced", crafts: 2, copper: 400 }]);
  expect(path.copper).toBe(400);
  const required = professionPath(rows.filter((row) => row.recipe === "Unknown"), prices, { profession: "Alchemy", fromSkill: 1, toSkill: 3 });
  expect(required.steps).toMatchObject([{ recipe: "Unknown", crafts: 2, copper: null }]);
  expect(required.copper).toBeNull();
  expect(handleProfessionPath({ profession: "Alchemy", fromSkill: 1, toSkill: 3 }, rows, prices)).toContain("Missing prices prevent comparison of all recipes");
});

test("equal-cost routes use deterministic ties regardless of recipe report order", () => {
  const rows = ["a", "b", "c"].flatMap((installId) => [
    sight(installId, "Zeta", [{ item: "Peacebloom", count: 1 }]),
    sight(installId, "Alpha", [{ item: "Peacebloom", count: 1 }]),
  ]);
  const prices = [price("a", 100), price("b", 100), price("c", 100)];
  const query = { profession: "Alchemy", fromSkill: 1, toSkill: 3 };
  expect(professionPath(rows, prices, query).steps[0]?.recipe).toBe("Alpha");
  expect(professionPath([...rows].reverse(), prices, query)).toEqual(professionPath(rows, prices, query));
});

test("the last craft pays for all its reagents even when it exceeds the target skill", () => {
  const rows = ["a", "b", "c"].map((installId) => sight(installId, "Three points", [{ item: "Peacebloom", count: 2 }], { points: 3 }));
  const prices = [price("a", 100), price("b", 100), price("c", 100)];
  const path = professionPath(rows, prices, { profession: "Alchemy", fromSkill: 1, toSkill: 5 });
  expect(path.steps).toMatchObject([{ fromSkill: 1, toSkill: 5, crafts: 2, copper: 400 }]);
  expect(path.reagents).toEqual([{ item: "Peacebloom", count: 4 }]);
  expect(path.copper).toBe(400);
});

test("per-unit auction scans price reagents by the item name players' clients reported", () => {
  const scan = (installId: string, copper: number, capturedAt: string, extra: Record<string, unknown> = {}) =>
    ({ kind: "auction_scan", installId, capturedAt, realm: "Forever", itemId: 2447, copper, count: 5, priceBasis: "unit", ...extra });
  const facts = professionFactsFromRecords([
    scan("a", 90, "2026-10-09T10:00:00Z"),
    scan("a", 80, "2026-10-09T09:00:00Z"),
    scan("b", 100, "2026-10-09T10:00:00Z"),
    scan("c", 120, "2026-10-09T10:00:00Z", { realm: "Other" }),
    { kind: "auction_scan", installId: "d", capturedAt: "2026-10-09T10:00:00Z", realm: "Forever", itemId: 2447, copper: 500 },
    { kind: "auction_scan", installId: "e", capturedAt: "2026-10-09T10:00:00Z", realm: "Forever", itemId: 9999, copper: 7, priceBasis: "unit" },
    { kind: "item_seen", installId: "a", itemId: 2447, name: "Peacebloom" },
    { kind: "item_seen", installId: "b", itemId: 2447, name: "Peacebloom" },
    { kind: "item_seen", installId: "c", itemId: 2447, name: "Pacebloom" },
  ]);
  // Latest scan per install; 0.2.1 stack totals and items no client named are left out.
  expect(facts.prices).toEqual([
    { installId: "a", item: "Peacebloom", copper: 90 },
    { installId: "b", item: "Peacebloom", copper: 100 },
    { installId: "c", item: "Peacebloom", copper: 120 },
  ]);
  const rows = ["a", "b", "c"].map((installId) => sight(installId, "Minor Healing Potion", [{ item: "Peacebloom", count: 2 }]));
  const path = professionPath(rows, facts.prices, { profession: "Alchemy", fromSkill: 1, toSkill: 2 });
  expect(path.copper).toBe(200);
});

test("an install's own price report and its auction scan of the same item count once", () => {
  const facts = professionFactsFromRecords([
    { kind: "price_seen", installId: "a", item: "Peacebloom", copper: 100 },
    { kind: "auction_scan", installId: "a", capturedAt: "2026-10-09T10:00:00Z", realm: "Forever", itemId: 2447, copper: 90, priceBasis: "unit" },
    { kind: "item_seen", installId: "a", itemId: 2447, name: "Peacebloom" },
  ]);
  const path = professionPath(["a", "b", "c"].map((id) => sight(id, "Minor Healing Potion", [{ item: "Peacebloom", count: 1 }])),
    facts.prices, { profession: "Alchemy", fromSkill: 1, toSkill: 2 });
  expect(path.copper).toBeNull();
});

const vendorOffer = (installId: string, vendorNpcId: number, itemId: number, priceCopper: number) => ({
  kind: "vendor",
  installId,
  vendorNpcId,
  items: [{ itemId, priceCopper }],
});

test("a vendor-sold reagent is priced from vendor + item_seen rows alone", () => {
  const facts = professionFactsFromRecords([
    vendorOffer("a", 80, 3371, 20),
    vendorOffer("b", 80, 3371, 20),
    vendorOffer("c", 80, 3371, 20),
    { kind: "item_seen", installId: "a", itemId: 3371, name: "Empty Vial" },
    { kind: "item_seen", installId: "b", itemId: 3371, name: "Empty Vial" },
    { kind: "item_seen", installId: "c", itemId: 3371, name: "Empty Vial" },
  ]);
  expect(facts.prices).toEqual([]);
  expect([...facts.vendorPrices.entries()]).toEqual([["empty vial", 20]]);
  const rows = ["a", "b", "c"].map((id) =>
    sight(id, "Minor Healing Potion", [{ item: "Empty Vial", count: 1 }], { skillMax: 2 }),
  );
  const path = professionPath(rows, facts.prices, { profession: "Alchemy", fromSkill: 1, toSkill: 2 }, [], facts.vendorPrices);
  expect(path.steps[0]?.copper).toBe(20);
  expect(path.copper).toBe(20);
  const text = handleProfessionPath(
    { profession: "Alchemy", fromSkill: 1, toSkill: 2 },
    rows,
    facts.prices,
    [],
    facts.vendorPrices,
  );
  expect(text).toContain("estimated 20c");
  expect(text).toContain("NPC vendor price");
});

test("mergeVendorPrices keeps player and vendor maps separate and takes the lower when both agree", () => {
  expect([...mergeVendorPrices(new Map([["empty vial", 100]]), new Map()).entries()]).toEqual([["empty vial", 100]]);
  expect([...mergeVendorPrices(new Map(), new Map([["empty vial", 20]])).entries()]).toEqual([["empty vial", 20]]);
  expect([...mergeVendorPrices(new Map([["empty vial", 100]]), new Map([["empty vial", 20]])).entries()]).toEqual([
    ["empty vial", 20],
  ]);
  // A vendor row must not overwrite an install's player price in agreePrices' map.
  const facts = professionFactsFromRecords([
    { kind: "price_seen", installId: "a", item: "Empty Vial", copper: 50 },
    { kind: "price_seen", installId: "b", item: "Empty Vial", copper: 50 },
    { kind: "price_seen", installId: "c", item: "Empty Vial", copper: 50 },
    vendorOffer("a", 80, 3371, 20),
    vendorOffer("b", 80, 3371, 20),
    vendorOffer("c", 80, 3371, 20),
    { kind: "item_seen", installId: "a", itemId: 3371, name: "Empty Vial" },
    { kind: "item_seen", installId: "b", itemId: 3371, name: "Empty Vial" },
    { kind: "item_seen", installId: "c", itemId: 3371, name: "Empty Vial" },
  ]);
  expect(facts.prices).toEqual([
    { installId: "a", item: "Empty Vial", copper: 50 },
    { installId: "b", item: "Empty Vial", copper: 50 },
    { installId: "c", item: "Empty Vial", copper: 50 },
  ]);
  expect([...facts.vendorPrices.entries()]).toEqual([["empty vial", 20]]);
});

test("when several vendors agree on different prices for one item, the route uses the lowest", () => {
  const facts = professionFactsFromRecords([
    vendorOffer("a", 80, 3371, 20),
    vendorOffer("b", 80, 3371, 20),
    vendorOffer("c", 80, 3371, 20),
    vendorOffer("d", 81, 3371, 15),
    vendorOffer("e", 81, 3371, 15),
    vendorOffer("f", 81, 3371, 15),
    { kind: "item_seen", installId: "a", itemId: 3371, name: "Empty Vial" },
    { kind: "item_seen", installId: "b", itemId: 3371, name: "Empty Vial" },
    { kind: "item_seen", installId: "c", itemId: 3371, name: "Empty Vial" },
  ]);
  expect([...facts.vendorPrices.entries()]).toEqual([["empty vial", 15]]);
});

const vendorRow = (installId: string, items: { itemId: number; priceCopper: number }[], vendorNpcId = 1) => ({ kind: "vendor", installId, vendorNpcId, items });
const three = ["install-a", "install-b", "install-c"];

test("agreeVendorPricesById: item-ID identity, three installs, positive copper only, the lowest agreed price", () => {
  const records = [
    ...three.map((id) => vendorRow(id, [{ itemId: 2320, priceCopper: 10 }, { itemId: 2321, priceCopper: 0 }, { itemId: 2324, priceCopper: 25 }])),
    // A second vendor sells 2320 cheaper, agreed by three installs; a third sells it cheaper still, seen by two.
    ...three.map((id) => vendorRow(id, [{ itemId: 2320, priceCopper: 8 }], 2)),
    ...three.slice(0, 2).map((id) => vendorRow(id, [{ itemId: 2320, priceCopper: 5 }], 3)),
    // A negative or fractional price is never a price.
    ...three.map((id) => vendorRow(id, [{ itemId: 2325, priceCopper: -4 }, { itemId: 2326, priceCopper: 1.5 }])),
  ];
  expect(agreeVendorPricesById(records)).toEqual(new Map([[2320, 8], [2324, 25]]));
});

test("agreeVendorPricesById: distinct items that share a name stay separate, and need no name", () => {
  const records = [
    ...three.map((id) => vendorRow(id, [{ itemId: 4470, priceCopper: 38 }, { itemId: 4471, priceCopper: 90 }])),
    ...three.flatMap((id) => [4470, 4471].map((itemId) => ({ kind: "item_seen", installId: id, itemId, name: "Simple Wood" }))),
  ];
  expect(agreeVendorPricesById(records)).toEqual(new Map([[4470, 38], [4471, 90]]));
  // The legacy name-keyed price folds them into one name, so it is kept for levelling only.
  expect(agreeVendorPrices(records)).toEqual(new Map([["simple wood", 38]]));
  expect(agreeVendorPricesById(records.filter((r) => r.kind === "vendor"))).toEqual(new Map([[4470, 38], [4471, 90]]));
});

test("agreeVendorPrices (by name, for the levelling planner) is unchanged", () => {
  const records = [
    ...three.map((id) => vendorRow(id, [{ itemId: 2321, priceCopper: 0 }])),
    ...three.map((id) => ({ kind: "item_seen", installId: id, itemId: 2321, name: "Fine Thread" })),
  ];
  expect(agreeVendorPrices(records)).toEqual(new Map([["fine thread", 0]]));
  expect(agreeVendorPricesById(records)).toEqual(new Map());
});
