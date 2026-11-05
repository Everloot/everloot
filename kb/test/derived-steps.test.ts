import { expect, test } from "vitest";
import { handleProfessionPath } from "../src/profession-path.js";
import { derivedSteps, pathFactsFromRecords } from "../src/recipe-thresholds.js";

const herbs = [{ item: "Peacebloom", count: 1 }];
const seen = (installId: string, rank: number, difficulty: string, recipe = "Minor Healing Potion") =>
  ({ kind: "recipe_observed", installId, profession: "Alchemy", recipe, rank, difficulty, reagents: herbs });
const trained = (installId: string, requiredRank: number, recipe = "Minor Healing Potion") =>
  ({ kind: "trainer_seen", installId, profession: "Alchemy", recipe, requiredRank, costCopper: 50 });
const ids = ["install-a", "install-b", "install-c"];

test("a published recipe becomes an orange-only step from the trainer's agreed rank to the first rank not known orange", () => {
  const records = [
    seen("install-a", 5, "optimal"), seen("install-b", 20, "optimal"), seen("install-c", 30, "medium"),
    ...ids.map((id) => trained(id, 1)),
  ];
  const facts = pathFactsFromRecords(records);
  expect(derivedSteps(facts.observations, facts.trainers)).toEqual([
    { profession: "Alchemy", recipe: "Minor Healing Potion", skillMin: 1, skillMax: 21, points: 1, reagents: herbs, reporters: 3, trainingCopper: 50 },
  ]);
});

test("without three agreeing trainer rows the step starts at the lowest rank anyone saw it orange", () => {
  const records = [
    seen("install-a", 5, "optimal"), seen("install-b", 20, "optimal"), seen("install-c", 30, "medium"),
    trained("install-a", 1), trained("install-b", 1),
  ];
  const facts = pathFactsFromRecords(records);
  expect(derivedSteps(facts.observations, facts.trainers)[0]).toMatchObject({ skillMin: 5, skillMax: 21 });
});

test("no step without a known end of orange, agreed reagents, or published ranges", () => {
  const noOrange = [seen("install-a", 30, "medium"), seen("install-b", 31, "medium"), seen("install-c", 32, "easy")];
  const noReagents = ids.map((id, i) => ({ ...seen(id, 5 + i, "optimal"), reagents: [{ item: `Herb ${i}`, count: 1 }] }));
  const twoInstalls = [seen("install-a", 5, "optimal"), seen("install-b", 20, "medium")];
  for (const records of [noOrange, noReagents, twoInstalls]) {
    const facts = pathFactsFromRecords(records);
    expect(derivedSteps(facts.observations, facts.trainers)).toEqual([]);
  }
});

test("the profession path routes through a derived step and prices it", () => {
  const records = [
    seen("install-a", 1, "optimal"), seen("install-b", 10, "optimal"), seen("install-c", 12, "medium"),
    ...ids.map((id) => trained(id, 1)),
    ...ids.flatMap((id) => [
      { kind: "auction_scan", installId: id, capturedAt: "2026-10-10T00:00:00Z", realm: "Forever", itemId: 2447, copper: 20, priceBasis: "unit" },
      { kind: "item_seen", installId: id, itemId: 2447, name: "Peacebloom" },
    ]),
  ];
  const facts = pathFactsFromRecords(records);
  const text = handleProfessionPath({ profession: "Alchemy", fromSkill: 1, toSkill: 11 }, facts.sightings, facts.prices, facts.derived);
  expect(text).toContain("1–11  Minor Healing Potion  10 crafts × 1");
  expect(text).toContain("Estimated gold: 2s 0c");
  expect(text).toContain("orange");
});

test("ranks past the end of orange stay a gap rather than a guess", () => {
  const records = [seen("install-a", 1, "optimal"), seen("install-b", 10, "optimal"), seen("install-c", 12, "medium")];
  const facts = pathFactsFromRecords(records);
  const text = handleProfessionPath({ profession: "Alchemy", fromSkill: 1, toSkill: 15 }, facts.sightings, facts.prices, facts.derived);
  expect(text).toContain("Gap 11–15");
});

test("a route names the training cost of its recipes: the median of three installs' trainers", () => {
  const records = [
    seen("install-a", 1, "optimal"), seen("install-b", 10, "optimal"), seen("install-c", 12, "medium"),
    seen("install-a", 11, "optimal", "Elixir"), seen("install-b", 14, "optimal", "Elixir"), seen("install-c", 20, "medium", "Elixir"),
    // Reputation discounts make trainer prices differ between installs.
    { ...trained("install-a", 1), costCopper: 45 }, trained("install-b", 1), trained("install-c", 1),
  ];
  const facts = pathFactsFromRecords(records);
  const text = handleProfessionPath({ profession: "Alchemy", fromSkill: 1, toSkill: 15 }, facts.sightings, facts.prices, facts.derived);
  expect(text).toContain("Training, if not yet learned: 50c (Minor Healing Potion 50c). Training for Elixir unrecorded.");
});

// Spell 2152 is Leatherworking's Light Armor Kit in the game files; a Spanish client shows "Peletería".
const kit = (installId: string, rank: number, difficulty: string, spanish = false) => ({
  kind: "recipe_observed", installId, recipeId: 2152, rank, difficulty,
  ...(spanish
    ? { profession: "Peletería", recipe: "Kit de armadura ligero", reagents: [{ item: "Cuero ligero", count: 1 }] }
    : { profession: "Leatherworking", recipe: "Light Armor Kit", reagents: [{ item: "Light Leather", count: 1 }] }),
});
const kitTrainer = (installId: string, spanish = false) => ({
  kind: "trainer_seen", installId, requiredRank: 1, costCopper: 50,
  ...(spanish ? { profession: "Peletería", recipe: "Kit de armadura ligero" } : { profession: "Leatherworking", recipe: "Light Armor Kit" }),
});

test("trainer rows match a recipe by its English name; Spanish trainer rows are left out", () => {
  const observed = [kit("en-a", 10, "optimal"), kit("en-b", 15, "optimal"), kit("en-c", 30, "medium"), kit("es-d", 5, "optimal", true)];
  const spanishTrainers = pathFactsFromRecords([...observed, ...["es-d", "es-e", "es-f"].map((id) => kitTrainer(id, true))]);
  // The Spanish install's orange at 5 counts; its trainer rows do not.
  expect(spanishTrainers.derived).toEqual([
    { profession: "Leatherworking", recipe: "Light Armor Kit", skillMin: 5, skillMax: 16, points: 1, reagents: [{ item: "Light Leather", count: 1 }], reporters: 4, trainingCopper: null },
  ]);
  const englishTrainers = pathFactsFromRecords([...observed, ...["en-a", "en-b", "en-c"].map((id) => kitTrainer(id))]);
  expect(englishTrainers.derived[0]).toMatchObject({ skillMin: 1, trainingCopper: 50 });
});

test("fewer than three trainer prices leave the training cost unrecorded", () => {
  const records = [
    seen("install-a", 1, "optimal"), seen("install-b", 10, "optimal"), seen("install-c", 12, "medium"),
    ...ids.map((id) => trained(id, 1)).map((row, i) => (i === 0 ? row : { ...row, costCopper: undefined })),
  ];
  const facts = pathFactsFromRecords(records);
  expect(facts.derived[0]?.trainingCopper).toBeNull();
  expect(handleProfessionPath({ profession: "Alchemy", fromSkill: 1, toSkill: 5 }, facts.sightings, facts.prices, facts.derived))
    .toContain("Training for Minor Healing Potion unrecorded.");
});
