import { expect, test } from "vitest";
import { armoryBoardHref, armoryBoardQuery } from "./armory";
import { armoryCharacter } from "./armory.fixture";
import { createMemoryArmoryStore } from "./armory-store";

test("classification filters round-trip and refuse unknown classifications", () => {
  const q = armoryBoardQuery({ region: "eu", ruleset: "2", class: "mage", faction: "alliance" });
  expect(q).toEqual({ region: "eu", ruleset: 2, class: "Mage", faction: "Alliance" });
  expect(armoryBoardHref("gear-score", q!)).toContain("class=mage&faction=alliance");
  expect(armoryBoardQuery({ class: "invented" })).toBeNull();
  expect(armoryBoardQuery({ faction: "invented" })).toBeNull();
  expect(armoryBoardQuery({ class: ["mage", "hunter"] })).toBeNull();
});

test("filtered boards rank within classification; class winners include classes outside the top 100", async () => {
  const store = createMemoryArmoryStore();
  for (let i = 0; i < 101; i++) store.putCharacter(armoryCharacter({ slug: `velkara-${i}`, gearScore: 200 + i }));
  store.putCharacter(armoryCharacter({ slug: "xelra-fable", class: "Mage", faction: "Alliance", gearScore: 50 }));
  const filtered = await store.boardFiltered("gear_score", "eu", 2, "Mage", "Alliance", 100);
  expect(filtered).toMatchObject([{ rank: 1, slug: "xelra-fable", guildSlug: "ember-wardens" }]);
  expect(await store.boardFiltered("gear_score", "us", null, null, null, 100)).toEqual([]);
  expect((await store.topPerClass("gear_score", null, null)).map((r) => r.class)).toEqual(["Hunter", "Mage"]);
  await store.hide("eu", "xelra-fable");
  expect((await store.topPerClass("gear_score", null, null)).map((r) => r.class)).toEqual(["Hunter"]);
});
