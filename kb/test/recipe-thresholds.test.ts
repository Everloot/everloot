import { expect, test } from "vitest";
import { formatThresholds, handleRecipeThresholds, inferThresholds, recipeFactsFromRecords, recipeObservationsFromRecords } from "../src/recipe-thresholds.js";

const obs = (installId: string, rank: number, difficulty: string, recipe = "Lesser Healing Potion") =>
  ({ kind: "recipe_observed", installId, profession: "Alchemy", recipe, rank, difficulty, reagents: [] });

test("unlearned recipes cannot supply learned rank evidence", () => {
  const legacy = obs("a", 50, "optimal");
  const learned = { ...obs("b", 60, "medium"), learned: true };
  expect(recipeObservationsFromRecords([legacy, learned, { ...obs("c", 1, "optimal"), learned: false }]))
    .toEqual(recipeObservationsFromRecords([legacy, learned]));
});

test("different API IDs sharing a name cannot agree as one recipe", () => {
  const records = [
    { ...obs("a", 50, "optimal"), recipeId: 2330 },
    { ...obs("b", 60, "medium"), recipeId: 2330 },
    { ...obs("c", 55, "medium"), recipeId: 2331 },
  ];
  expect(inferThresholds(recipeObservationsFromRecords(records))).toEqual([]);
  expect(inferThresholds(recipeObservationsFromRecords(records.map((row) => ({ ...row, recipeId: 2330 }))))).toHaveLength(1);
});

test("colours seen at different ranks narrow each threshold to a range once three installs agree", () => {
  const records = [
    obs("install-a", 50, "optimal"),
    obs("install-b", 60, "medium"),
    obs("install-c", 55, "medium"),
    obs("install-c", 70, "easy"),
    obs("install-a", 90, "trivial"),
  ];
  const [only] = inferThresholds(recipeObservationsFromRecords(records));
  expect(only).toEqual({
    profession: "Alchemy", recipe: "Lesser Healing Potion", installs: 3, observations: 5,
    yellow: { min: 51, max: 55 }, green: { min: 61, max: 70 }, grey: { min: 71, max: 90 }, reagents: null,
  });
  expect(formatThresholds(only)).toBe(
    "Lesser Healing Potion (Alchemy), 3 installs: yellow from 51-55, green from 61-70, grey from 71-90.");
});

test("fewer than three installs publish nothing", () => {
  expect(inferThresholds(recipeObservationsFromRecords([obs("install-a", 50, "optimal"), obs("install-b", 60, "medium")]))).toEqual([]);
});

test("contradicting colours withhold the recipe instead of publishing a wrong range", () => {
  const records = [obs("install-a", 40, "trivial"), obs("install-b", 50, "optimal"), obs("install-c", 45, "easy")];
  expect(inferThresholds(recipeObservationsFromRecords(records))).toEqual([]);
});

test("an unbounded side stays unrecorded, never guessed", () => {
  const records = [obs("install-a", 10, "optimal"), obs("install-b", 12, "optimal"), obs("install-c", 15, "optimal")];
  const [only] = inferThresholds(recipeObservationsFromRecords(records));
  expect(only.yellow).toEqual({ min: 16, max: null });
  expect(only.grey).toEqual({ min: 16, max: null });
  expect(formatThresholds(only)).toContain("yellow from 16 (upper bound unrecorded)");
});

test("only well-formed recipe observations are read", () => {
  expect(recipeObservationsFromRecords([{ kind: "loot" }, { ...obs("i", 5, "glowing") }, obs("install-a", 5, "easy")])).toHaveLength(1);
});

test("the tool answers per profession, filters by recipe, and says why it is empty", () => {
  const rows = recipeObservationsFromRecords([
    obs("install-a", 50, "optimal"), obs("install-b", 60, "medium"), obs("install-c", 55, "medium"),
    obs("install-a", 10, "optimal", "Minor Healing Potion"),
  ]);
  const text = handleRecipeThresholds({ profession: "alchemy" }, rows);
  expect(text).toContain("Lesser Healing Potion (Alchemy), 3 installs: yellow from 51-55");
  expect(text).not.toContain("Minor Healing Potion (Alchemy)");
  expect(handleRecipeThresholds({ profession: "Alchemy", recipe: "minor" }, rows)).toMatch(/No recipe ranges/);
  expect(handleRecipeThresholds({ profession: "Tailoring" }, rows)).toMatch(/No recipe ranges for Tailoring yet.*3 installs.*unrecorded, not zero/s);
  expect(handleRecipeThresholds({ profession: " " }, rows)).toBe("Name a profession.");
});

const withMats = (installId: string, rank: number, difficulty: string, reagents: { item: string; count: number }[]) =>
  ({ ...obs(installId, rank, difficulty), reagents });
const herbs = [{ item: "Peacebloom", count: 2 }, { item: "Empty Vial", count: 1 }];
const scan = (installId: string, itemId: number, copper: number) =>
  ({ kind: "auction_scan", installId, capturedAt: "2026-10-10T00:00:00Z", realm: "Forever", itemId, copper, priceBasis: "unit" });
const named = (installId: string, itemId: number, name: string) => ({ kind: "item_seen", installId, itemId, name });

test("a range shows the reagents three installs agree on, and the cost per craft once every reagent has an agreed price", () => {
  const records = [
    withMats("install-a", 50, "optimal", herbs),
    withMats("install-b", 60, "medium", [...herbs].reverse()),
    withMats("install-c", 70, "easy", herbs),
    ...["install-a", "install-b", "install-c"].flatMap((id, i) => [
      scan(id, 2447, 40 + i * 10), named(id, 2447, "Peacebloom"),
      scan(id, 3371, 4), named(id, 3371, "Empty Vial"),
    ]),
  ];
  const facts = recipeFactsFromRecords(records);
  expect(inferThresholds(facts.observations)[0]?.reagents).toEqual(herbs);
  const text = handleRecipeThresholds({ profession: "Alchemy" }, facts.observations, facts.prices);
  // Median Peacebloom 50c x 2 + Empty Vial 4c.
  expect(text).toContain("Reagents: 2 Peacebloom, 1 Empty Vial. Estimated cost per craft: 1s 4c");
});

test("a reagent without an agreed price leaves the cost unrecorded and names it", () => {
  const records = [
    withMats("install-a", 50, "optimal", herbs),
    withMats("install-b", 60, "medium", herbs),
    withMats("install-c", 70, "easy", herbs),
    ...["install-a", "install-b", "install-c"].flatMap((id) => [scan(id, 2447, 50), named(id, 2447, "Peacebloom")]),
  ];
  const facts = recipeFactsFromRecords(records);
  expect(handleRecipeThresholds({ profession: "Alchemy" }, facts.observations, facts.prices))
    .toContain("Cost per craft unrecorded: no agreed price for Empty Vial.");
});

test("reagent lists that fewer than three installs agree on are not shown", () => {
  const records = [
    withMats("install-a", 50, "optimal", herbs),
    withMats("install-b", 60, "medium", herbs),
    withMats("install-c", 70, "easy", [{ item: "Peacebloom", count: 3 }]),
  ];
  const facts = recipeFactsFromRecords(records);
  expect(inferThresholds(facts.observations)[0]?.reagents).toBeNull();
  expect(handleRecipeThresholds({ profession: "Alchemy" }, facts.observations, facts.prices)).toContain("Reagents unrecorded.");
});

const vendorOffer = (installId: string, itemId: number, priceCopper: number) => ({
  kind: "vendor",
  installId,
  vendorNpcId: 80,
  items: [{ itemId, priceCopper }],
});

test("a vendor-sold reagent gets a cost per craft from vendor + item_seen rows alone", () => {
  const records = [
    withMats("install-a", 50, "optimal", herbs),
    withMats("install-b", 60, "medium", herbs),
    withMats("install-c", 70, "easy", herbs),
    ...["install-a", "install-b", "install-c"].flatMap((id, i) => [
      scan(id, 2447, 40 + i * 10), named(id, 2447, "Peacebloom"),
      vendorOffer(id, 3371, 4), named(id, 3371, "Empty Vial"),
    ]),
  ];
  const facts = recipeFactsFromRecords(records);
  expect(facts.prices.every((p) => p.item !== "Empty Vial")).toBe(true);
  expect([...facts.vendorPrices.entries()]).toEqual([["empty vial", 4]]);
  const text = handleRecipeThresholds(
    { profession: "Alchemy" },
    facts.observations,
    facts.prices,
    facts.vendorPrices,
  );
  // Median Peacebloom 50c x 2 + vendor Empty Vial 4c.
  expect(text).toContain("Reagents: 2 Peacebloom, 1 Empty Vial. Estimated cost per craft: 1s 4c");
  expect(text).toContain("NPC vendor price");
});
