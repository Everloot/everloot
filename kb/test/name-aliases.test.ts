import { expect, test } from "vitest";
import { openDb } from "../src/db.js";
import { replaceSourceRows, type EntityInput } from "../src/entities.js";
import { expandAliases, sameTitle, withoutArticle } from "../src/name-aliases.js";
import { getByName, search } from "../src/search.js";

test("expandAliases: whole-word short forms become the record's name; upper case always, lower case only when unambiguous", () => {
  expect(expandAliases("where is MC")).toEqual({ text: "where is Molten Core", expanded: ["Molten Core"] });
  expect(expandAliases("BRD entrance")).toEqual({ text: "Blackrock Depths entrance", expanded: ["Blackrock Depths"] });
  expect(expandAliases("how do I get to BWL")).toEqual({ text: "how do I get to Blackwing Lair", expanded: ["Blackwing Lair"] });
  expect(expandAliases("naxx bosses")).toEqual({ text: "Naxxramas bosses", expanded: ["Naxxramas"] });
  // Two short forms in one question, one of them inside a longer phrase.
  expect(expandAliases("fly from IF to SW").text).toBe("fly from Ironforge to Stormwind City");
  // "DM east" is Dire Maul; "DM" alone is the Deadmines.
  expect(expandAliases("DM east").text).toBe("Dire Maul east");
  expect(expandAliases("where is DM").text).toBe("where is Deadmines");
  // Lower-case words that are also words stay words in a longer question.
  expect(expandAliases("what if the auction house is empty").expanded).toEqual([]);
  expect(expandAliases("is st augustine a zone").expanded).toEqual([]);
  // ...but alone or in a two-word question they are the short form.
  expect(expandAliases("sm").text).toBe("Scarlet Monastery");
  expect(expandAliases("mc level").text).toBe("Molten Core level");
  // Letters inside a longer word are never an alias.
  expect(expandAliases("the ifrit's lair").expanded).toEqual([]);
  expect(expandAliases("")).toEqual({ text: "", expanded: [] });
});

test("withoutArticle and sameTitle: a leading article and punctuation do not make two titles differ", () => {
  expect(withoutArticle("The Barrens")).toBe("Barrens");
  expect(withoutArticle("Barrens")).toBe("Barrens");
  expect(withoutArticle("Theramore")).toBe("Theramore");
  expect(sameTitle("The Barrens", "Barrens")).toBe(true);
  expect(sameTitle("Onyxia's Lair", "onyxia’s lair")).toBe(true);
  expect(sameTitle("The Hinterlands", "Hillsbrad")).toBe(false);
});

const row = (extId: string, name: string, body: string): EntityInput => ({
  kind: "lore_page", extId, name, body, gameVersion: "lore", sourceUrl: `https://example.test/${extId}`, retrievedAt: "2023-11-13",
});

async function seed() {
  const db = openDb(":memory:");
  await replaceSourceRows(db, "warcraft-wiki-2023", ["lore_page"], [
    row("mc", "Molten Core", "Molten Core is a raid under Blackrock Mountain."),
    row("barrens", "Barrens", "The Barrens is a zone in Kalimdor."),
    row("stv", "Stranglethorn Vale", "Stranglethorn Vale is a jungle."),
    row("mcwords", "Molten Core loot", "What drops where in the raid."),
  ]);
  return db;
}

test("search: a question with a short form finds the page the long name has; the eval's alias questions resolve", async () => {
  const db = await seed();
  expect((await search(db, "where is MC", 3))[0]?.name).toBe("Molten Core");
  expect((await search(db, "where is STV", 3))[0]?.name).toBe("Stranglethorn Vale");
  // A lower-case word that is also a real word is left alone in a longer question.
  expect(await search(db, "the stockade under the keep", 3)).toEqual([]);
  // The long form still works exactly as before.
  expect((await search(db, "where is Molten Core", 3))[0]?.name).toBe("Molten Core");
});

test("getByName: the exact name first, then the short form's name, then the name with or without its article", async () => {
  const db = await seed();
  expect((await getByName(db, "Molten Core")).map((h) => h.name)).toEqual(["Molten Core"]);
  expect((await getByName(db, "MC")).map((h) => h.name)).toEqual(["Molten Core"]);
  expect((await getByName(db, "The Barrens")).map((h) => h.name)).toEqual(["Barrens"]);
  expect((await getByName(db, "Nowhere")).map((h) => h.name)).toEqual([]);
});
